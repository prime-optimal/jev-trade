import { SQL } from "bun";
import type { DecisionJournalEvent } from "./decision-events";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type SqlClient = {
  unsafe(query: string, parameters?: unknown[]): Promise<unknown[]>;
  close(): void | Promise<void>;
};

export interface DecisionListOptions {
  limit?: number;
  before?: string;
}

export interface DecisionRow {
  decisionId: string;
  createdAt: number;
  updatedAt: number;
  decision: unknown;
  quote: unknown | null;
  fills: unknown[];
  markouts: Record<string, unknown>;
}

export interface DecisionPage {
  rows: DecisionRow[];
  nextBefore: string | null;
}

export interface DecisionStore {
  readonly enabled: boolean;
  ready(): Promise<void>;
  enqueue(ownerId: string, event: DecisionJournalEvent): void;
  list(ownerId: string, options?: DecisionListOptions): Promise<DecisionPage>;
  close(): Promise<void>;
}

export interface DecisionStoreOptions {
  databaseUrl?: string;
  sql?: SqlClient;
  onError?: (error: unknown) => void;
}

export class DecisionPaginationError extends Error {}

function parseLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1) throw new DecisionPaginationError("limit must be a positive integer");
  return Math.min(value, MAX_LIMIT);
}

function encodeCursor(createdAt: number, decisionId: string): string {
  return Buffer.from(JSON.stringify([createdAt, decisionId])).toString("base64url");
}

function decodeCursor(value: string): [number, string] {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString()) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2 || !Number.isFinite(parsed[0]) || typeof parsed[1] !== "string") throw new Error();
    return [Number(parsed[0]), parsed[1]];
  } catch {
    throw new DecisionPaginationError("before cursor is invalid");
  }
}

function eventTimestamp(event: DecisionJournalEvent): number {
  return event.type === "markout" ? event.observedTimestamp : event.timestamp;
}

export function createDecisionStore(options: DecisionStoreOptions = {}): DecisionStore {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl && !options.sql) {
    return {
      enabled: false,
      ready: async () => {},
      enqueue() {},
      list: async () => ({ rows: [], nextBefore: null }),
      close: async () => {},
    };
  }

  const sql: SqlClient = options.sql ?? (new SQL(databaseUrl!) as unknown as SqlClient);
  const report = options.onError ?? ((error) => console.error("Decision store error", error));
  let queue = Promise.resolve();
  let closing = false;
  const initialized = (async () => {
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS decision_journal (
      owner_id TEXT NOT NULL,
      decision_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      decision JSONB,
      quote JSONB,
      fills JSONB NOT NULL DEFAULT '[]'::jsonb,
      markouts JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (owner_id, decision_id)
    )`);
    await sql.unsafe("ALTER TABLE decision_journal ADD COLUMN IF NOT EXISTS fills JSONB NOT NULL DEFAULT '[]'::jsonb");
    await sql.unsafe("CREATE INDEX IF NOT EXISTS decision_journal_owner_newest ON decision_journal (owner_id, created_at DESC, decision_id DESC)");
  })();

  const write = async (ownerId: string, event: DecisionJournalEvent) => {
    await initialized;
    const timestamp = eventTimestamp(event);
    const payload = event;
    if (event.type === "decision") {
      await sql.unsafe(
        `INSERT INTO decision_journal (owner_id, decision_id, created_at, updated_at, decision)
         VALUES ($1, $2, $3, $3, $4::jsonb)
         ON CONFLICT (owner_id, decision_id) DO UPDATE
         SET decision = EXCLUDED.decision, updated_at = EXCLUDED.updated_at
         WHERE decision_journal.owner_id = $1`,
        [ownerId, event.decisionId, timestamp, payload],
      );
      return;
    }
    if (event.type === "markout") {
      await sql.unsafe(
        `INSERT INTO decision_journal (owner_id, decision_id, created_at, updated_at, markouts)
         VALUES ($1, $2, $3, $3, jsonb_build_object($5, $4::jsonb))
         ON CONFLICT (owner_id, decision_id) DO UPDATE
         SET markouts = decision_journal.markouts || EXCLUDED.markouts, updated_at = EXCLUDED.updated_at
         WHERE decision_journal.owner_id = $1`,
        [ownerId, event.decisionId, timestamp, payload, String(event.horizonTicks)],
      );
      return;
    }
    if (event.type === "fill") {
      await sql.unsafe(
        `INSERT INTO decision_journal (owner_id, decision_id, created_at, updated_at, fills)
         VALUES ($1, $2, $3, $3, jsonb_build_array($4::jsonb))
         ON CONFLICT (owner_id, decision_id) DO UPDATE
         SET fills = decision_journal.fills || EXCLUDED.fills, updated_at = EXCLUDED.updated_at
         WHERE decision_journal.owner_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(decision_journal.fills) AS existing
             WHERE existing->>'fillId' = $5
           )`,
        [ownerId, event.decisionId, timestamp, payload, event.fillId],
      );
      return;
    }
    const column = "quote";
    await sql.unsafe(
      `INSERT INTO decision_journal (owner_id, decision_id, created_at, updated_at, ${column})
       VALUES ($1, $2, $3, $3, $4::jsonb)
       ON CONFLICT (owner_id, decision_id) DO UPDATE
       SET ${column} = EXCLUDED.${column}, updated_at = EXCLUDED.updated_at
       WHERE decision_journal.owner_id = $1`,
      [ownerId, event.decisionId, timestamp, payload],
    );
  };

  const writeWithRetry = async (ownerId: string, event: DecisionJournalEvent) => {
    let delayMs = 100;
    for (;;) {
      try {
        await write(ownerId, event);
        return;
      } catch (error) {
        report(error);
        if (closing) throw error;
        await Bun.sleep(delayMs);
        delayMs = Math.min(delayMs * 2, 5_000);
      }
    }
  };

  return {
    enabled: true,
    ready: () => initialized,
    enqueue(ownerId, event) {
      if (closing || !ownerId) return;
      queue = queue.then(() => writeWithRetry(ownerId, event)).catch(report);
    },
    async list(ownerId, listOptions = {}) {
      await initialized;
      await queue;
      if (!ownerId) throw new Error("ownerId is required");
      const limit = parseLimit(listOptions.limit);
      const parameters: unknown[] = [ownerId, limit + 1];
      let cursorClause = "";
      if (listOptions.before !== undefined) {
        const [createdAt, decisionId] = decodeCursor(listOptions.before);
        parameters.push(createdAt, decisionId);
        cursorClause = " AND (created_at, decision_id) < ($3, $4)";
      }
      const result = await sql.unsafe(
        `SELECT decision_id, created_at, updated_at, decision, quote, fills, markouts
         FROM decision_journal WHERE owner_id = $1${cursorClause}
         ORDER BY created_at DESC, decision_id DESC LIMIT $2`,
        parameters,
      ) as Record<string, unknown>[];
      const more = result.length > limit;
      const selected = more ? result.slice(0, limit) : result;
      const rows = selected.map((row) => ({
        decisionId: String(row.decision_id),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        decision: row.decision,
        quote: row.quote ?? null,
        fills: Array.isArray(row.fills) ? row.fills : [],
        markouts: row.markouts && typeof row.markouts === "object" && !Array.isArray(row.markouts)
          ? row.markouts as Record<string, unknown>
          : {},
      }));
      const last = rows.at(-1);
      return { rows, nextBefore: more && last ? encodeCursor(last.createdAt, last.decisionId) : null };
    },
    async close() {
      if (closing) return;
      closing = true;
      await initialized.catch(report);
      await queue;
      await sql.close();
    },
  };
}
