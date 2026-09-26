import type { BlockEvent, PricePoint } from "./types";

/** Brand colors per coin, used for the selected sleeve accent. */
export const COIN_COLOR: Record<string, string> = {
  BTC: "#F7931A",
  ETH: "#627EEA",
  SOL: "#9945FF",
  DOGE: "#C2A633",
  BNB: "#F3BA2F",
};

export function coinColor(coin: string): string {
  return COIN_COLOR[coin.toUpperCase()] ?? "var(--ink)";
}

/** "BTC-USD" -> "USD", "ETH/USDC" -> "USDC". */
export function quoteOf(pair: string | null | undefined): string {
  const parts = (pair ?? "").split(/[-/]/);
  return parts.length > 1 ? parts[parts.length - 1]! : "";
}

/** $105,416.20 above $1, more decimals below. */
export function fmtUsdPrice(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  if (Math.abs(v) >= 1) {
    return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
}

export interface SleeveMetrics {
  /** ms timestamp of the newest non-late call, or null. */
  lastCallTs: number | null;
  decisions: number;
  /** Share of decisions that sent an order. */
  orderRate: number;
  /** Share of orders that filled. */
  fillRate: number;
  avgLatencyMs: number;
  /** ms timestamp the current position was entered, or null when flat. */
  entryTs: number | null;
}

export function sleeveMetrics(events: BlockEvent[], latest: BlockEvent | null): SleeveMetrics {
  const all = latest && events.at(-1) !== latest ? [...events, latest] : events;
  let decisions = 0;
  let orders = 0;
  let fills = 0;
  let latSum = 0;
  let latN = 0;
  let lastCallTs: number | null = null;
  for (const e of all) {
    const d = e.decision;
    if (!d) continue;
    decisions += 1;
    if (e.quote && !e.quote.unchanged) orders += 1;
    if (e.fill && e.fill.size > 0) fills += 1;
    if (!d.late) {
      latSum += d.latencyMs;
      latN += 1;
      lastCallTs = e.ts;
    }
  }
  const tail = all.at(-1);
  let entryTs: number | null = null;
  if (tail && tail.position.side !== "flat") {
    const side = tail.position.side;
    entryTs = tail.ts;
    for (let i = all.length - 1; i >= 0 && all[i]!.position.side === side; i--) entryTs = all[i]!.ts;
  }
  return {
    lastCallTs,
    decisions,
    orderRate: decisions ? orders / decisions : 0,
    fillRate: orders ? fills / orders : 0,
    avgLatencyMs: latN ? latSum / latN : 0,
    entryTs,
  };
}

/** 42_000 -> "42s", 3_900_000 -> "1h 5m" */
export function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** SVG polyline points for the newest `n` tape prints, scaled into w x h. */
export function sparkPoints(tape: PricePoint[], w: number, h: number, n = 120): string {
  const pts = tape.length > n ? tape.slice(tape.length - n) : tape;
  if (pts.length < 2) return "";
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    lo = Math.min(lo, p.mid);
    hi = Math.max(hi, p.mid);
  }
  const span = hi - lo || 1;
  return pts
    .map((p, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${(h - ((p.mid - lo) / span) * h).toFixed(1)}`)
    .join(" ");
}
