import type { Book } from "./types";
import type { Action, Intent, Side } from "../bot-types";

export interface HlLevel { px: string; sz: string }

/** Perp tick: 10^-(6 - szDecimals). BTC szDecimals=5 => 0.1. */
export function priceTick(szDecimals: number): number {
  return 10 ** -Math.max(0, 6 - szDecimals);
}

export function alignPrice(price: number, szDecimals: number): number {
  const tick = priceTick(szDecimals);
  const decimals = Math.max(0, 6 - szDecimals);
  return Number((Math.round(price / tick) * tick).toFixed(decimals));
}

/**
 * Post-only price `quoteInsideTicks` inside the touch. Never crosses.
 * If the spread is too tight, join the touch.
 */
export function quotePrice(side: Side, book: Book, szDecimals: number, inside: number): number {
  const tick = priceTick(szDecimals);
  const step = inside * tick;
  let raw = side === "buy" ? book.bid + step : book.ask - step;
  if (side === "buy" && raw >= book.ask) raw = book.bid;
  if (side === "sell" && raw <= book.bid) raw = book.ask;
  return alignPrice(raw, szDecimals);
}

/**
 * Crossing limit for an Ioc exit. Walks `slippageBps` past the far touch so the
 * order clears the visible book instead of resting on it. Rounds away from the
 * touch so tick alignment can never pull the price back inside the spread.
 */
export function takerPrice(side: Side, book: Book, szDecimals: number, slippageBps: number): number {
  const tick = priceTick(szDecimals);
  const decimals = Math.max(0, 6 - szDecimals);
  const bps = Math.max(0, slippageBps) / 10_000;
  const raw = side === "buy" ? book.ask * (1 + bps) : book.bid * (1 - bps);
  const away = side === "buy" ? Math.ceil(raw / tick) : Math.floor(raw / tick);
  return Number(Math.max(tick, away * tick).toFixed(decimals));
}

export function bookFromLevels(block: number, bids: HlLevel[], asks: HlLevel[]): Book | null {
  const bidLv: [number, number][] = [];
  const askLv: [number, number][] = [];
  for (const l of bids) {
    const px = Number(l.px), sz = Number(l.sz);
    if (Number.isFinite(px) && Number.isFinite(sz) && px > 0 && sz > 0) bidLv.push([px, sz]);
  }
  for (const l of asks) {
    const px = Number(l.px), sz = Number(l.sz);
    if (Number.isFinite(px) && Number.isFinite(sz) && px > 0 && sz > 0) askLv.push([px, sz]);
  }
  if (!bidLv.length || !askLv.length) return null;
  bidLv.sort((a, b) => b[0] - a[0]);
  askLv.sort((a, b) => a[0] - b[0]);
  const bid = bidLv[0]![0], ask = askLv[0]![0];
  if (!(ask > bid)) return null;
  const mid = (bid + ask) / 2;
  const spreadBps = ((ask - bid) / mid) * 10_000;
  const near = (side: [number, number][], maxBps: number) => {
    let d = 0;
    for (const [px, sz] of side) {
      const bps = Math.abs(px - mid) / mid * 10_000;
      if (bps <= maxBps) d += sz;
    }
    return d;
  };
  const bid1 = near(bidLv, 100), ask1 = near(askLv, 100);
  const tot = bid1 + ask1;
  return {
    block,
    bid,
    ask,
    mid,
    spreadBps,
    imbalance: tot > 0 ? (bid1 - ask1) / tot : 0,
    levels: { bids: bidLv.slice(0, 5), asks: askLv.slice(0, 5) },
    depthBps: {
      "10": { bid: near(bidLv, 10), ask: near(askLv, 10) },
      "25": { bid: near(bidLv, 25), ask: near(askLv, 25) },
      "50": { bid: near(bidLv, 50), ask: near(askLv, 50) },
    },
  };
}

export interface QuotePlan {
  side: Side;
  size: number;
  reduceOnly: boolean;
  taker: boolean;
}

/** Consume normalized Jev output, never derive an entry action from bias. */
export function planQuote(opts: {
  intent: Intent;
  action: Action;
  positionSz: number;
  quoteSz: number;
}): QuotePlan | null {
  if (opts.intent === "hold") return null;
  if (opts.intent === "open") {
    if (opts.action !== "buy" && opts.action !== "sell") throw new Error("Entry requires a buy or sell action");
    if (!Number.isFinite(opts.quoteSz)) throw new Error("Quote size must be finite");
    return opts.quoteSz > 0
      ? { side: opts.action, size: opts.quoteSz, reduceOnly: false, taker: false }
      : null;
  }
  if (opts.intent !== "close") throw new Error("Invalid quote intent");
  if (!Number.isFinite(opts.positionSz)) throw new Error("Position size must be finite");
  if (opts.positionSz > 0) return { side: "sell", size: opts.positionSz, reduceOnly: true, taker: true };
  if (opts.positionSz < 0) return { side: "buy", size: -opts.positionSz, reduceOnly: true, taker: true };
  return null;
}
