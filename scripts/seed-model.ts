import { createDecisionStore } from "../src/decision-store";
import { createOwnerTokens } from "../src/owner-token";

const OWNER_ID = "smoke-fixture-owner";
const databaseUrl = process.env.DATABASE_URL;
const secret = process.env.DECISION_OWNER_SECRET;
if (!databaseUrl || !secret) throw new Error("DATABASE_URL and DECISION_OWNER_SECRET are required");
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(databaseUrl)) throw new Error("Refusing to seed a non-local database");

type Row = Record<string, unknown>;
const rows = await Bun.file(new URL("../test/fixtures/decision-journal.json", import.meta.url)).json() as Row[];

const store = createDecisionStore({ databaseUrl });
await store.ready();
await store.close();

const sql = new Bun.SQL(databaseUrl);
await sql.begin(async (tx) => {
 await tx`DELETE FROM decision_journal WHERE owner_id = ${OWNER_ID}`;
 for (const row of rows) {
  await tx.unsafe(
   `INSERT INTO decision_journal (owner_id, decision_id, created_at, updated_at, decision, record_type, evidence, observations, quote, fills, markouts)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb)`,
   [OWNER_ID, row.decision_id, row.created_at, row.updated_at, row.decision, row.record_type, row.evidence,
    row.observations ?? {}, row.quote, row.fills ?? [], row.markouts ?? {}],
  );
 }
});
const [check] = await sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE jsonb_typeof(evidence) = 'string')::int AS encoded FROM decision_journal WHERE owner_id = ${OWNER_ID}`;
await sql.close();
if (check.encoded) throw new Error(`${check.encoded} rows double-encoded`);

const { ownerToken } = await createOwnerTokens({ secret }).issue(OWNER_ID);
console.log(`Seeded ${check.n} decisions for owner ${OWNER_ID}.`);
console.log(`Owner token: ${ownerToken}`);
console.log("Set it as the HttpOnly cookie jev-paper-owner (path /api/session) on http://127.0.0.1:3001, clear jev-paper-session, then open /model.");
