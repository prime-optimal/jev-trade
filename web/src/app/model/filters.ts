import type { Action, DecisionSummary, Horizon } from "./record";

export type Outcome = "right" | "wrong";

export interface RailFilter {
  calls: Action[];
  coins: string[];
  late: boolean;
  invalid: boolean;
  outcome: Outcome | null;
}

export const DEFAULT_FILTERS: RailFilter = { calls: [], coins: [], late: false, invalid: false, outcome: null };

export function outcomeAt(summary: DecisionSummary, horizon: Horizon): Outcome | null {
  const bps = summary.markouts[horizon]?.signedBps;
  if (bps === null || bps === undefined) return null;
  return bps > 0 ? "right" : "wrong";
}

export function isInvalid(summary: DecisionSummary): boolean {
  return summary.action === "unavailable" || summary.action === "no decision" || summary.hasInvalidAnswers;
}

export function applyFilters(summaries: DecisionSummary[], filter: RailFilter, horizon: Horizon): DecisionSummary[] {
  if (!filtersActive(filter)) return summaries;
  return summaries.filter((summary) => {
    const outcome = filter.outcome === null ? null : outcomeAt(summary, horizon);
    return (filter.calls.length === 0 || filter.calls.includes(summary.action))
      && (filter.coins.length === 0 || summary.coin !== null && filter.coins.includes(summary.coin))
      && (!filter.late || summary.late)
      && (!filter.invalid || isInvalid(summary))
      && (filter.outcome === null || outcome === filter.outcome);
  });
}

export function filtersActive(filter: RailFilter): boolean {
  return filter.calls.length > 0 || filter.coins.length > 0 || filter.late || filter.invalid || filter.outcome !== null;
}

export function listCoins(summaries: readonly DecisionSummary[]): string[] {
  return [...new Set(summaries.map((summary) => summary.coin).filter((coin): coin is string => coin !== null))].sort();
}
