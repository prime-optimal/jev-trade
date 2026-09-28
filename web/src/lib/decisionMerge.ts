import type { DecisionRow } from "./journal-types";

export function mergeNewestPage(existing: DecisionRow[], incoming: DecisionRow[]): { rows: DecisionRow[]; newIds: string[] } {
  const existingIds = new Set(existing.map((row) => row.decisionId));
  const byId = new Map<string, DecisionRow>();
  for (const row of existing) {
    if (!byId.has(row.decisionId)) byId.set(row.decisionId, row);
  }
  const added = new Set<string>();
  const incomingIds = new Set<string>();
  for (const row of incoming) {
    if (incomingIds.has(row.decisionId)) continue;
    incomingIds.add(row.decisionId);
    if (!existingIds.has(row.decisionId)) added.add(row.decisionId);
    byId.set(row.decisionId, row);
  }
  const rows = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt || compareDescending(a.decisionId, b.decisionId));
  return { rows, newIds: rows.filter((row) => added.has(row.decisionId)).map((row) => row.decisionId) };
}

function compareDescending(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? 1 : -1;
}
