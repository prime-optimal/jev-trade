import { expect, test } from "bun:test";
import { PROGRAM_RECORD_TYPE, type EvaluationEvidence, type GroupResult } from "../src/jev-evidence";
import type { DecisionJournalEvent } from "../src/decision-events";
import { createDecisionStore } from "../src/decision-store";

interface StoredRow {
  owner_id: string;
  decision_id: string;
  created_at: number;
  updated_at: number;
  decision: unknown;
  record_type: string | null;
  evidence: unknown | null;
  observations: Record<string, unknown>;
  quote: unknown | null;
  fills: unknown[];
  markouts: Record<string, unknown>;
}

interface PendingObservation {
  ownerId: string;
  decisionId: string;
  groupId: string;
  revision: string;
  completion: GroupResult;
}

class MemorySql {
  readonly rows = new Map<string, StoredRow>();
  readonly pending = new Map<string, PendingObservation>();
  readonly queries: { query: string; parameters: unknown[] }[] = [];
  closed = false;
  ambiguousFillCommit = false;

  async unsafe(query: string, parameters: unknown[] = []): Promise<unknown[]> {
    this.queries.push({ query, parameters: structuredClone(parameters) });
    if (query.startsWith("CREATE") || query.startsWith("ALTER")) return [];
    if (query.startsWith("SELECT")) {
      const ownerId = String(parameters[0]);
      return [...this.rows.values()]
        .filter((row) => row.owner_id === ownerId)
        .map((row) => structuredClone(row));
    }

    const ownerId = String(parameters[0]);
    const decisionId = String(parameters[1]);
    const timestamp = Number(parameters[2]);
    const key = `${ownerId}:${decisionId}`;

    if (query.startsWith("INSERT INTO decision_journal_pending_observations")) {
      const groupId = String(parameters[2]);
      const revision = String(parameters[3]);
      const completion = structuredClone(parameters[4]) as GroupResult;
      const row = this.rows.get(key);
      if (groupId === completion.groupId && (!row || (row.record_type === null && row.decision === null))) {
        const pendingKey = `${ownerId}:${decisionId}:${groupId}`;
        if (!this.pending.has(pendingKey)) this.pending.set(pendingKey, { ownerId, decisionId, groupId, revision, completion });
      }
      return [];
    }

    if (query.startsWith("UPDATE decision_journal AS journal")) {
      const row = this.rows.get(key);
      const recordType = String(parameters[2]);
      if (row?.record_type === recordType) {
        for (const [pendingKey, pending] of this.pending) {
          if (pending.ownerId !== ownerId || pending.decisionId !== decisionId || row.observations[pending.groupId] !== undefined) continue;
          if (accepts(row, pending.revision, pending.groupId, pending.completion, recordType)) {
            row.observations[pending.groupId] = structuredClone(pending.completion);
          }
          this.pending.delete(pendingKey);
        }
        row.updated_at = timestamp;
      }
      return [];
    }

    if (query.startsWith("DELETE FROM decision_journal_pending_observations")) {
      if (this.rows.get(key)?.record_type !== null && this.rows.has(key)) {
        for (const [pendingKey, pending] of this.pending) {
          if (pending.ownerId === ownerId && pending.decisionId === decisionId) this.pending.delete(pendingKey);
        }
      }
      return [];
    }

    if (query.startsWith("UPDATE decision_journal")) {
      const groupId = String(parameters[3]);
      const completion = structuredClone(parameters[4]) as GroupResult;
      const row = this.rows.get(key);
      if (row && accepts(row, String(parameters[6]), groupId, completion, String(parameters[5])) &&
        row.observations[groupId] === undefined) {
        row.observations[groupId] = completion;
        row.updated_at = timestamp;
      }
      return [];
    }

    if (query.startsWith("INSERT INTO decision_journal") && query.includes("record_type, evidence")) {
      const row = this.getOrCreate(ownerId, decisionId, timestamp);
      if (row.decision === null && row.record_type === null) {
        row.decision = structuredClone(parameters[3]);
        row.record_type = String(parameters[4]);
        row.evidence = structuredClone(parameters[5]);
        row.updated_at = timestamp;
      }
      return [];
    }

    const row = this.getOrCreate(ownerId, decisionId, timestamp);
    const payload = structuredClone(parameters[3]);
    row.updated_at = timestamp;
    if (query.includes("updated_at, fills)")) {
      if (!row.fills.some((fill) => fill !== null && typeof fill === "object" && "fillId" in fill && fill.fillId === parameters[4])) {
        row.fills.push(payload);
      }
      this.rows.set(key, row);
      if (this.ambiguousFillCommit) {
        this.ambiguousFillCommit = false;
        throw new Error("Connection lost after commit");
      }
    } else if (query.includes("updated_at, decision)")) {
      row.decision = payload;
    }
    this.rows.set(key, row);
    return [];
  }

  private getOrCreate(ownerId: string, decisionId: string, timestamp: number): StoredRow {
    const key = `${ownerId}:${decisionId}`;
    const row = this.rows.get(key) ?? {
      owner_id: ownerId,
      decision_id: decisionId,
      created_at: timestamp,
      updated_at: timestamp,
      decision: null,
      record_type: null,
      evidence: null,
      observations: {},
      quote: null,
      fills: [],
      markouts: {},
    };
    this.rows.set(key, row);
    return row;
  }

  close() { this.closed = true; }
}

const totals = {
  blocks: 1, decisions: 1, quotes: 0, fills: 0, reverted: 0, lateBlocks: 0,
  jevUsd: 0, gasSz: 0, gasUsd: 0, realizedUsd: 0, pnlUsd: 0, pnlSz: 0, pnlPct: 0,
};
const position = { side: "flat" as const, size: 0, entryPrice: null, leverage: null, unrealizedUsd: 0, unrealizedSz: 0 };

function completion(groupId: string, status: GroupResult["status"] = "complete"): GroupResult {
  return {
    groupId,
    status,
    answers: [],
    unexpected: [],
    provider: { name: "local" },
    timing: { startedAt: 1_000, completedAt: 1_001, latencyMs: 1 },
  };
}

function evidence(revision = "sha256:first"): EvaluationEvidence {
  return {
    recordType: PROGRAM_RECORD_TYPE,
    capture: {
      recordType: PROGRAM_RECORD_TYPE,
      revision,
      projectionVersion: "projection-test",
      definition: {} as never,
      requiredGroupId: "trade",
      capturedAt: 1_000,
      groups: [{ groupId: "trade" }, { groupId: "notes" }] as never,
    },
    required: completion("trade"),
    status: "complete",
  } as EvaluationEvidence;
}

function decision(decisionId: string, result: unknown = null, revision = "sha256:first"): DecisionJournalEvent {
  return {
    type: "decision",
    decisionId,
    runId: "run-1",
    coin: "BTC",
    market: "BTC-USD",
    block: 1,
    timestamp: 1_000,
    recordType: PROGRAM_RECORD_TYPE,
    model: "mock",
    provider: "local",
    modelId: "mock",
    evidence: evidence(revision),
    decision: result as never,
    late: false,
    position,
    totals,
  };
}

function observation(
  decisionId: string,
  groupId = "notes",
  revision = "sha256:first",
  result = completion(groupId),
): DecisionJournalEvent {
  return {
    type: "decision-observation",
    decisionId,
    runId: "run-1",
    coin: "BTC",
    market: "BTC-USD",
    block: 1,
    timestamp: 1_000,
    recordType: PROGRAM_RECORD_TYPE,
    revision,
    groupId,
    completion: result,
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

function accepts(
  row: StoredRow,
  revision: string,
  groupId: string,
  result: GroupResult,
  recordType: string,
): boolean {
  const stored = row.evidence as EvaluationEvidence | null;
  const capture = stored?.capture;
  if (!capture) return false;
  return row.record_type === recordType &&
    capture.revision === revision &&
    capture.requiredGroupId !== groupId &&
    capture.groups.some((group) => group.groupId === groupId) &&
    result.groupId === groupId;
}

test("decision store persists failed and successful captures with version metadata", async () => {
  const sql = new MemorySql();
  const store = createDecisionStore({ sql });
  await store.ready();
  store.enqueue("owner-a", decision("failed-capture", null));
  store.enqueue("owner-a", decision("successful-capture", { side: "long" }));

  const page = await store.list("owner-a");
  const failed = page.rows.find((row) => row.decisionId === "failed-capture");
  const successful = page.rows.find((row) => row.decisionId === "successful-capture");
  expect(failed?.decision).toMatchObject({ decision: null });
  expect(failed?.recordType).toBe(PROGRAM_RECORD_TYPE);
  expect(failed?.evidence?.capture.revision).toBe("sha256:first");
  expect(successful?.decision).toMatchObject({ decision: { side: "long" } });
  expect(successful?.programMetadata).toBe("available");

  const captures = sql.queries.filter(({ query }) =>
    query.startsWith("INSERT INTO decision_journal") && query.includes("record_type, evidence")
  );
  expect(captures).toHaveLength(2);
  expect(captures[0]?.parameters[3]).toMatchObject({ decision: null });
  expect(captures[1]?.parameters[3]).toMatchObject({ decision: { side: "long" } });
  await store.close();
});

test("duplicate decision capture does not replace the first envelope or evidence", async () => {
  const sql = new MemorySql();
  const store = createDecisionStore({ sql });
  await store.ready();
  const first = decision("same-id", null, "sha256:first");
  store.enqueue("owner-a", first);
  store.enqueue("owner-a", decision("same-id", { side: "short" }, "sha256:second"));

  const row = (await store.list("owner-a")).rows[0]!;
  expect(row.decision).toEqual(first);
  expect(row.evidence?.capture.revision).toBe("sha256:first");
  await store.close();
});

test("observation arriving before capture is retained and reconciled", async () => {
  const sql = new MemorySql();
  const store = createDecisionStore({ sql });
  await store.ready();
  store.enqueue("owner-a", observation("decision-a"));
  store.enqueue("owner-a", decision("decision-a"));

  const row = (await store.list("owner-a")).rows[0]!;
  expect(row.observations).toEqual({ notes: completion("notes") });
  expect(sql.pending.size).toBe(0);
  expect(sql.queries.some(({ query }) => query.includes("decision_journal_pending_observations"))).toBe(true);
  await store.close();
});

test("observation arriving after capture is accepted", async () => {
  const sql = new MemorySql();
  const store = createDecisionStore({ sql });
  await store.ready();
  store.enqueue("owner-a", decision("decision-a"));
  store.enqueue("owner-a", observation("decision-a"));

  expect((await store.list("owner-a")).rows[0]?.observations).toEqual({ notes: completion("notes") });
  await store.close();
});

test("wrong revision, required group, and unknown group observations are rejected", async () => {
  const sql = new MemorySql();
  const store = createDecisionStore({ sql });
  await store.ready();
  store.enqueue("owner-a", decision("decision-a"));
  store.enqueue("owner-a", observation("decision-a", "notes", "sha256:wrong"));
  store.enqueue("owner-a", observation("decision-a", "trade"));
  store.enqueue("owner-a", observation("decision-a", "unknown"));

  const row = (await store.list("owner-a")).rows[0]!;
  expect(row.observations).toEqual({});
  expect(sql.pending.size).toBe(0);
  await store.close();
});

test("first observation completion wins for a group", async () => {
  const sql = new MemorySql();
  const store = createDecisionStore({ sql });
  await store.ready();
  store.enqueue("owner-a", decision("decision-a"));
  store.enqueue("owner-a", observation("decision-a", "notes", "sha256:first", completion("notes", "invalid")));
  store.enqueue("owner-a", observation("decision-a", "notes", "sha256:first", completion("notes", "failed")));

  expect((await store.list("owner-a")).rows[0]?.observations.notes).toEqual(completion("notes", "invalid"));
  await store.close();
});

test("pending observations and captures stay isolated by owner", async () => {
  const sql = new MemorySql();
  const store = createDecisionStore({ sql });
  await store.ready();
  store.enqueue("owner-a", observation("same-id"));
  store.enqueue("owner-b", decision("same-id"));
  store.enqueue("owner-a", decision("same-id"));

  const ownerA = (await store.list("owner-a")).rows[0]!;
  const ownerB = (await store.list("owner-b")).rows[0]!;
  expect(ownerA.observations).toEqual({ notes: completion("notes") });
  expect(ownerB.observations).toEqual({});
  await store.close();
});

test("enqueue persists a snapshot despite later caller mutation", async () => {
  const sql = new MemorySql();
  const store = createDecisionStore({ sql });
  await store.ready();
  const event = decision("snapshot-id");
  const expected = structuredClone(event);
  const mutable = event as unknown as {
    model: string;
    late: boolean;
    evidence: { capture: { revision: string } };
  };
  store.enqueue("owner-a", event);
  mutable.model = "changed";
  mutable.late = true;
  mutable.evidence.capture.revision = "sha256:changed";

  const row = (await store.list("owner-a")).rows[0]!;
  expect(row.decision).toEqual(expected);
  expect(row.decision).toMatchObject({ model: "mock", late: false });
  expect(row.evidence?.capture.revision).toBe("sha256:first");
  await store.close();
});

test("legacy rows return their original envelope without program metadata", async () => {
  const sql = new MemorySql();
  const historical = { type: "decision", promptRevision: "jev-trade-2026-09-23.1", prompt: { old: true } };
  sql.rows.set("owner-a:legacy-id", {
    owner_id: "owner-a",
    decision_id: "legacy-id",
    created_at: 10,
    updated_at: 11,
    decision: historical,
    record_type: null,
    evidence: null,
    observations: { notHistorical: completion("notes") },
    quote: null,
    fills: [],
    markouts: {},
  });
  const store = createDecisionStore({ sql });
  const row = (await store.list("owner-a")).rows[0]!;
  expect(row.decision).toEqual(historical);
  expect(row.recordType).toBe("legacy");
  expect(row.evidence).toBeNull();
  expect(row.observations).toEqual({});
  expect(row.programMetadata).toBe("unavailable");
  await store.close();
});

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
