import { expect, test } from "bun:test";
import { extractFeatures, FEATURE_CATALOG, FEATURE_IDS, marketFacing } from "../src/jev-features";
import type { JsonValue } from "../src/jev-evidence";
import type { TradeState } from "../src/model";

function fixture(side: TradeState["position"]["side"] = "flat"): TradeState {
  return {
    coin: "BTC",
    market: "BTC-USD",
    tick: 1,
    tickMs: 500,
    mid: 77000,
    spreadBps: 0.13,
    bookImbalance: 0,
    depth: { "10": { bid: 2, ask: 3 }, "25": { bid: 5, ask: 8 }, "50": { bid: 13, ask: 21 } },
    book: { bids: ["76999 x 1"], asks: ["77001 x 1"] },
    returnsBps: { last1: 0, last5: 0, last20: 0, last100: 0 },
    recentMids: "77000",
    trades: { count: 0, buySz: 0, sellSz: 0, cvdSz: 0, vwap: null, lastPrice: null, lastSide: null },
    recentTrades: [],
    position: {
      coin: "BTC",
      side,
      size: side === "flat" ? 0 : 0.001,
      notionalUsd: side === "flat" ? 0 : 77,
      entry: side === "flat" ? null : 77000,
      leverage: side === "flat" ? null : 3,
      liquidationPx: null,
      distanceBps: null,
      unrealizedUsd: side === "flat" ? 0 : -1.25,
    },
    indicators: {
      sma20: null, sma50: null, ema20: null, midVsSma20Bps: null, midVsSma50Bps: null,
      rsi14: null, vol20Bps: null, high20: null, low20: null, rangePos20: null,
    },
    asset: {
      markPx: null, oraclePx: null, fundingBps: null, premiumBps: null,
      openInterest: null, dayNtlVlmUsd: null, dayChangeBps: null, maxLeverage: 40,
    },
    maxLeverage: 40,
  };
}

function jsonObject(value: JsonValue): { readonly [key: string]: JsonValue } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("expected JSON object");
  return value;
}

function jsonArray(value: JsonValue): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new Error("expected JSON array");
  return value;
}

test("all catalog features reproduce the market-facing projection in key order", () => {
  const state = fixture("long");
  const features = extractFeatures(state, FEATURE_IDS);
  const projected = marketFacing(state);
  expect(Object.keys(FEATURE_CATALOG)).toEqual([...FEATURE_IDS]);
  expect(features).toEqual(projected);
  expect(JSON.stringify(features)).toBe(JSON.stringify(projected));
});

test("flat positions omit unrealized PnL and open positions include it", () => {
  const flat = extractFeatures(fixture("flat"), ["position"]);
  const open = extractFeatures(fixture("long"), ["position"]);
  expect(Object.hasOwn(jsonObject(flat.position), "unrealizedUsd")).toBe(false);
  expect(jsonObject(open.position).unrealizedUsd).toBe(-1.25);
});

test("collections are bounded and undeclared nested fields never escape", () => {
  const state = fixture("long");
  state.book.bids = Array.from({ length: 8 }, (_, index) => `bid-${index}`);
  state.book.asks = Array.from({ length: 9 }, (_, index) => `ask-${index}`);
  state.recentTrades = Array.from({ length: 14 }, (_, index) => `trade-${index}`);
  state.depth["100"] = { bid: 1, ask: 2 };
  Object.assign(state.position, { pnlUsd: 42, wallet: "private" });
  Object.assign(state.trades, { pnlUsd: 17, wallet: "private" });

  const features = extractFeatures(state, ["depth", "book", "recentTrades", "position", "trades"]);
  const depth = jsonObject(features.depth);
  const book = jsonObject(features.book);
  expect(Object.keys(depth)).toEqual(["10", "25", "50"]);
  expect(jsonArray(book.bids!).length).toBe(5);
  expect(jsonArray(book.asks!).length).toBe(5);
  expect(jsonArray(features.recentTrades).length).toBe(10);
  expect(jsonObject(features.position)).not.toHaveProperty("pnlUsd");
  expect(jsonObject(features.position)).not.toHaveProperty("wallet");
  expect(jsonObject(features.trades)).not.toHaveProperty("pnlUsd");
  expect(jsonObject(features.trades)).not.toHaveProperty("wallet");
});

test("market-facing state excludes wallet and lifetime position fields", () => {
  const state = fixture("flat") as TradeState & Record<string, unknown>;
  state.recentFills = ["sell 0.001 @ 77000 close"];
  state.horizonTicks = 100;
  Object.assign(state.position, {
    realizedUsd: -10.5,
    feesUsd: 3.8,
    pnlUsd: -14.3,
    pnlPct: -7,
    equity: 185,
    withdrawable: 185,
  });
  const seen = marketFacing(state);
  const text = JSON.stringify(seen).toLowerCase();
  expect(seen.book).toEqual(state.book);
  expect(seen.trades).toEqual(state.trades);
  expect(seen.position.side).toBe("flat");
  expect("unrealizedUsd" in seen.position).toBe(false);
  for (const word of ["recentfills", "realizedusd", "feesusd", "pnlusd", "pnlpct", "equity", "withdrawable", "horizonticks"]) {
    expect(text).not.toContain(word);
  }
  expect(marketFacing(fixture("long")).position.unrealizedUsd).toBe(-1.25);
});

test("extracted snapshots are copied and deeply frozen", () => {
  const state = fixture("long");
  const features = extractFeatures(state, FEATURE_IDS);
  expect(Object.isFrozen(features)).toBe(true);
  expect(Object.isFrozen(jsonObject(features.position))).toBe(true);
  expect(Object.isFrozen(jsonObject(features.depth))).toBe(true);
  expect(Object.isFrozen(jsonObject(features.book))).toBe(true);
  state.mid = 1;
  state.depth["10"]!.bid = 99;
  state.book.bids[0] = "mutated";
  state.position.size = 7;
  state.recentTrades.push("late");
  expect(features.mid).toBe(77000);
  expect(jsonObject(jsonObject(features.depth)["10"]!).bid).toBe(2);
  expect(jsonArray(jsonObject(features.book).bids!)[0]).toBe("76999 x 1");
  expect(jsonObject(features.position).size).toBe(0.001);
  expect(features.recentTrades).toEqual([]);
});

test("unknown feature ids fail closed", () => {
  expect(() => extractFeatures(fixture(), ["marketState"])).toThrow("Unknown feature: marketState");
});
