import type { BlockEvent } from "./types";

export const SUMMARY_WINDOW = 100;

export type DecisionCategory = "openLong" | "openShort" | "close" | "hold" | "late";

export const CATEGORIES: { key: DecisionCategory; label: string; color: string; info: string }[] = [
  { key: "openLong", label: "open long", color: "var(--buy-bar)", info: "Jev chose to open or add to a long position, so the bot quoted a buy." },
  { key: "openShort", label: "open short", color: "var(--sell-bar)", info: "Jev chose to open or add to a short position, so the bot quoted a sell." },
  { key: "close", label: "close", color: "var(--ink-2)", info: "Jev chose to close the open position with a reduce only order." },
  { key: "hold", label: "hold", color: "var(--hold-cell)", info: "Jev chose to do nothing this tick. No order is sent and any position stays as it is." },
  { key: "late", label: "late", color: "var(--late-ink)", info: "Jev did not answer before the next tick arrived, so the tick passed without a call." },
];

/**
 * Events plus `latest` when it is a newer block. `latest` from the feed is often the last
 * event repainted with a newer price mark (new object, same block, price timestamp), so
 * identity checks would double count it and move its time with the price feed.
 */
export function withLatest(events: BlockEvent[], latest: BlockEvent | null): BlockEvent[] {
  const last = events.at(-1);
  return latest && (!last || latest.block > last.block) ? [...events, latest] : events;
}

export interface DecisionSummary {
  total: number;
  counts: Record<DecisionCategory, number>;
  /** Shares that sum to 1 when total > 0. */
  shares: Record<DecisionCategory, number>;
  spanMs: number;
}

export function categoryOf(event: BlockEvent): DecisionCategory | null {
  const d = event.decision;
  if (!d) return null;
  if (d.late) return "late";
  if (d.intent === "hold" || d.action === "hold") return "hold";
  if (d.intent === "close") return "close";
  if (d.bias === "short" || (!d.bias && d.action === "sell")) return "openShort";
  return "openLong";
}

/** Counts the newest `window` decisions. Each decision lands in exactly one category. */
export function summarizeDecisions(events: BlockEvent[], window = SUMMARY_WINDOW): DecisionSummary {
  const counts: Record<DecisionCategory, number> = { openLong: 0, openShort: 0, close: 0, hold: 0, late: 0 };
  let total = 0;
  let newest = 0;
  let oldest = 0;
  for (let i = events.length - 1; i >= 0 && total < window; i--) {
    const e = events[i]!;
    const c = categoryOf(e);
    if (!c) continue;
    counts[c] += 1;
    if (total === 0) newest = e.ts;
    oldest = e.ts;
    total += 1;
  }
  const shares = { ...counts };
  for (const k of Object.keys(shares) as DecisionCategory[]) shares[k] = total ? counts[k] / total : 0;
  return { total, counts, shares, spanMs: total > 1 ? Math.max(0, newest - oldest) : 0 };
}

/** 95_000 -> "1m 35s", 7_200_000 -> "2h 0m" */
export function fmtSpan(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Whole percents that always sum to 100 (largest remainder), so the labels never read past 100%. */
export function wholePercents(counts: Record<DecisionCategory, number>): Record<DecisionCategory, number> {
  const keys = Object.keys(counts) as DecisionCategory[];
  const total = keys.reduce((s, k) => s + counts[k], 0);
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<DecisionCategory, number>;
  if (!total) return out;
  const raw = keys.map((k) => ({ k, v: (counts[k] * 100) / total }));
  let left = 100;
  for (const r of raw) {
    out[r.k] = Math.floor(r.v);
    left -= out[r.k];
  }
  raw.sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)));
  for (let i = 0; i < left; i++) out[raw[i]!.k] += 1;
  return out;
}
