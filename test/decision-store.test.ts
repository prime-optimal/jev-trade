import { expect, test } from "bun:test";
import type { DecisionJournalEvent } from "../src/decision-events";
import { createDecisionStore } from "../src/decision-store";

interface StoredRow {
  decision_id: string;
  created_at: number;
  updated_at: number;
  decision: unknown;
  quote: unknown | null;
  fills: unknown[];
  markouts: Record<string, unknown>;
}

class MemorySql {
  readonly rows = new Map<string, StoredRow>();
  closed = false;
  ambiguousFillCommit = false;

  async unsafe(query: string, parameters: unknown[] = []): Promise<unknown[]> {
    if (/^(CREATE|ALTER)/.test(query)) return [];
    if (query.startsWith("SELECT")) {
      const ownerId = String(parameters[0]);
      return [...this.rows.entries()]
        .filter(([key]) => key.startsWith(`${ownerId}:`))
        .map(([, row]) => row);
    }

    const ownerId = String(parameters[0]);
    const decisionId = String(parameters[1]);
    const timestamp = Number(parameters[2]);
    const key = `${ownerId}:${decisionId}`;
    const row = this.rows.get(key) ?? {
      decision_id: decisionId,
      created_at: timestamp,
      updated_at: timestamp,
      decision: null,
      quote: null,
      fills: [],
      markouts: {},
    };
    const payload = structuredClone(parameters[3]);
    row.updated_at = timestamp;
    if (query.includes("updated_at, decision)")) row.decision = payload;
    else if (query.includes("updated_at, fills)")) {
      if (!row.fills.some((fill) => fill !== null && typeof fill === "object" && "fillId" in fill && fill.fillId === parameters[4])) row.fills.push(payload);
      this.rows.set(key, row);
      if (this.ambiguousFillCommit) {
        this.ambiguousFillCommit = false;
        throw new Error("Connection lost after commit");
      }
    }
    this.rows.set(key, row);
    return [];
  }

  close() { this.closed = true; }
}

const totals = {
  blocks: 1, decisions: 1, quotes: 0, fills: 0, reverted: 0, lateBlocks: 0,
  jevUsd: 0, gasSz: 0, gasUsd: 0, realizedUsd: 0, pnlUsd: 0, pnlSz: 0, pnlPct: 0,
};
const position = { side: "flat" as const, size: 0, entryPrice: null, leverage: null, unrealizedUsd: 0, unrealizedSz: 0 };

function decision(decisionId: string): DecisionJournalEvent {
  return {
    type: "decision", decisionId, runId: "run-1", coin: "BTC", market: "BTC-USD", block: 1, timestamp: 1_000,
    model: "mock", provider: "local", modelId: "mock", promptRevision: "test", prompt: {} as never,
    decision: {} as never, late: false, position, totals,
  };
}

function fill(decisionId: string, orderId: number): DecisionJournalEvent {
  return {
    type: "fill", decisionId, runId: "run-1", coin: "BTC", market: "BTC-USD", block: 1,
    timestamp: 1_000 + orderId, fillId: `fill-${orderId}`,
    fill: { decisionId, side: "buy", size: 0.01, price: 100, txHash: null, orderId, simulated: true },
    position, totals: { ...totals, fills: orderId },
  };
}

test("decision store preserves every fill and partitions reads by owner", async () => {
  const sql = new MemorySql();
  const store = createDecisionStore({ sql });
  await store.ready();

  store.enqueue("owner-a", decision("decision-a"));
  store.enqueue("owner-a", fill("decision-a", 1));
  store.enqueue("owner-a", fill("decision-a", 2));
  store.enqueue("owner-b", decision("decision-b"));

  const ownerA = await store.list("owner-a");
  const ownerB = await store.list("owner-b");
  expect(ownerA.rows.map((row) => row.decisionId)).toEqual(["decision-a"]);
  expect(ownerA.rows[0]?.fills).toHaveLength(2);
  expect(ownerB.rows.map((row) => row.decisionId)).toEqual(["decision-b"]);

  await store.close();
  expect(sql.closed).toBe(true);
});

test("duplicate delivery and retry after an ambiguous fill commit preserve one fill", async () => {
  const sql = new MemorySql();
  const errors: unknown[] = [];
  const store = createDecisionStore({ sql, onError: (error) => errors.push(error) });
  await store.ready();
  sql.ambiguousFillCommit = true;
  store.enqueue("owner-a", fill("decision-a", 1));
  store.enqueue("owner-a", fill("decision-a", 1));
  store.enqueue("owner-a", fill("decision-a", 2));
  const page = await store.list("owner-a");
  expect(page.rows[0]?.fills).toEqual([fill("decision-a", 1), fill("decision-a", 2)]);
  expect(errors).toHaveLength(1);
  await store.close();
});
