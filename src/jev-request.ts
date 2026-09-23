import type { JevRequest } from "./types";

export const MAX_JEV_REQUEST_BYTES = 32 * 1024;
const COINS: Record<string, true> = { BTC: true, ETH: true, SOL: true, DOGE: true, BNB: true };
const VENUE_MAX_LEVERAGE = 40;

export class JevRequestError extends Error {
  readonly status: 400 | 413;
  constructor(readonly code: "invalid_request" | "payload_too_large" = "invalid_request") {
    super(code);
    this.name = "JevRequestError";
    this.status = code === "payload_too_large" ? 413 : 400;
  }
}

function invalid(): never { throw new JevRequestError(); }
function object(value: unknown, keys: readonly string[], optional = false): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return invalid();
  const own = Reflect.ownKeys(value);
  if ((!optional && own.length !== keys.length) || own.length > keys.length) return invalid();
  for (const key of own) {
    if (typeof key !== "string" || !keys.includes(key)) return invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return invalid();
  }
  if (!optional && keys.some((key) => !Object.hasOwn(value, key))) return invalid();
  return value as Record<string, unknown>;
}
function number(value: unknown, min = -Number.MAX_VALUE, max = Number.MAX_VALUE, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) return invalid();
  return value;
}
function nullable(value: unknown, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): void {
  if (value !== null) number(value, min, max);
}
function choice(value: unknown, allowed: readonly string[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) invalid();
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max) return invalid();
  return value;
}
function strings(value: unknown, max: number, validate: (value: unknown) => void): void {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return invalid();
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return invalid();
    validate(descriptor.value);
  }
}
const DECIMAL = "(?:[0-9]+(?:\\.[0-9]+)?(?:e[+-]?[0-9]+)?)";
const LEVEL = new RegExp(`^(${DECIMAL}) x (${DECIMAL})$`);
const PRINT = new RegExp(`^([0-9]+) (buy|sell) (${DECIMAL}) @ (${DECIMAL})$`);

const PRICE = new RegExp(`^${DECIMAL}$`);

/** Exact address-free contract. No caller-supplied questions, providers, or candles. */
export function parseJevRequest(value: unknown): JevRequest {
  const request = object(value, ["network", "state"]);
  choice(request.network, ["testnet", "mainnet"]);
  const state = object(request.state, ["coin", "market", "tick", "tickMs", "mid", "spreadBps", "bookImbalance", "depth", "book", "returnsBps", "recentMids", "trades", "recentTrades", "position", "indicators", "asset", "maxLeverage"]);
  if (typeof state.coin !== "string" || !Object.hasOwn(COINS, state.coin) || state.market !== `${state.coin}-USD`) invalid();
  const tick = number(state.tick, 1, Number.MAX_SAFE_INTEGER, true);
  number(state.tickMs, 5000, 300000, true);
  number(state.mid, Number.MIN_VALUE);
  number(state.spreadBps, 0);
  number(state.bookImbalance, -1, 1);
  const maxLeverage = number(state.maxLeverage, 1, VENUE_MAX_LEVERAGE, true);
  const depth = object(state.depth, ["10bps", "25bps", "50bps"], true);
  for (const band of Object.values(depth)) {
    const sizes = object(band, ["bid", "ask"]);
    number(sizes.bid, 0); number(sizes.ask, 0);
  }
  const book = object(state.book, ["bids", "asks"]);
  for (const side of Object.values(book)) strings(side, 5, (value) => {
    const match = LEVEL.exec(text(value, 96));
    if (!match) return invalid();
    number(Number(match[1]), Number.MIN_VALUE); number(Number(match[2]), 0);
  });
  const returns = object(state.returnsBps, ["last1", "last5", "last20", "last100"]);
  for (const value of Object.values(returns)) number(value);
  const mids = text(state.recentMids, 4096);
  if (mids) {
    const samples = mids.split(" ");
    if (samples.length > 100) invalid();
    for (const sample of samples) {
      if (!PRICE.test(sample)) invalid();
      number(Number(sample), Number.MIN_VALUE);
    }
  }
  const trades = object(state.trades, ["count", "buySz", "sellSz", "cvdSz", "vwap", "lastPrice", "lastSide"]);
  number(trades.count, 0, Number.MAX_SAFE_INTEGER, true);
  number(trades.buySz, 0); number(trades.sellSz, 0); number(trades.cvdSz);
  nullable(trades.vwap, Number.MIN_VALUE); nullable(trades.lastPrice, Number.MIN_VALUE);
  if (trades.lastSide !== null) choice(trades.lastSide, ["buy", "sell"]);
  strings(state.recentTrades, 10, (value) => {
    const match = PRINT.exec(text(value, 128));
    if (!match) return invalid();
    number(Number(match[1]), 0, tick, true);
    number(Number(match[3]), 0); number(Number(match[4]), Number.MIN_VALUE);
  });
  const position = object(state.position, ["coin", "side", "size", "notionalUsd", "entry", "leverage", "liquidationPx", "distanceBps", "unrealizedUsd"]);
  if (position.coin !== state.coin) invalid();
  choice(position.side, ["long", "short", "flat"]);
  number(position.size, 0); number(position.notionalUsd, 0); number(position.unrealizedUsd);
  nullable(position.entry, Number.MIN_VALUE); nullable(position.liquidationPx, 0); nullable(position.distanceBps);
  if (position.leverage !== null) number(position.leverage, 1, maxLeverage, true);
  const indicators = object(state.indicators, ["sma20", "sma50", "ema20", "midVsSma20Bps", "midVsSma50Bps", "rsi14", "vol20Bps", "high20", "low20", "rangePos20"]);
  for (const key of ["sma20", "sma50", "ema20", "high20", "low20"]) nullable(indicators[key], Number.MIN_VALUE);
  nullable(indicators.midVsSma20Bps); nullable(indicators.midVsSma50Bps);
  nullable(indicators.rsi14, 0, 100); nullable(indicators.vol20Bps, 0); nullable(indicators.rangePos20, 0, 1);
  const asset = object(state.asset, ["markPx", "oraclePx", "fundingBps", "premiumBps", "openInterest", "dayNtlVlmUsd", "dayChangeBps", "maxLeverage"]);
  if (asset.maxLeverage !== maxLeverage) invalid();
  nullable(asset.markPx, Number.MIN_VALUE); nullable(asset.oraclePx, Number.MIN_VALUE);
  nullable(asset.fundingBps); nullable(asset.premiumBps); nullable(asset.dayChangeBps);
  nullable(asset.openInterest, 0); nullable(asset.dayNtlVlmUsd, 0);
  return value as JevRequest;
}

/** Count actual bytes before decoding, including chunked bodies and false lengths. */
export async function readJevRequest(request: Request): Promise<JevRequest> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_JEV_REQUEST_BYTES)) {
    throw new JevRequestError(Number(length) > MAX_JEV_REQUEST_BYTES ? "payload_too_large" : "invalid_request");
  }
  if (!request.body) return invalid();
  const reader = request.body.getReader();
  const bytes = new Uint8Array(MAX_JEV_REQUEST_BYTES);
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength > MAX_JEV_REQUEST_BYTES - size) {
        void reader.cancel().catch(() => {});
        throw new JevRequestError("payload_too_large");
      }
      bytes.set(chunk.value, size);
      size += chunk.value.byteLength;
    }
    return parseJevRequest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))));
  } catch (error) {
    if (error instanceof JevRequestError) throw error;
    return invalid();
  } finally {
    reader.releaseLock();
  }
}
