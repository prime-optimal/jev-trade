import { deepFreeze, type FeatureMetadata, type JsonValue } from "./jev-evidence";
import type { TradeState } from "./model";

export const FEATURE_CATALOG_VERSION = "jev-features-2026-09-24.1";

export type FeatureId = "coin" | "market" | "tick" | "tickMs" | "mid" | "spreadBps" | "bookImbalance" | "depth" | "book" | "returnsBps" | "recentMids" | "trades" | "recentTrades" | "position" | "indicators" | "asset" | "maxLeverage";

export const FEATURE_IDS: readonly FeatureId[] = Object.freeze([
  "coin", "market", "tick", "tickMs", "mid", "spreadBps", "bookImbalance", "depth", "book", "returnsBps", "recentMids", "trades", "recentTrades", "position", "indicators", "asset", "maxLeverage",
]);

export const FEATURE_CATALOG: { readonly [id in FeatureId]: FeatureMetadata } = deepFreeze({
  coin: { id: "coin", type: "string", meaning: "Asset identifier", units: null, maxItems: null, availability: "always", freshness: "tick" },
  market: { id: "market", type: "string", meaning: "Market identifier", units: null, maxItems: null, availability: "always", freshness: "tick" },
  tick: { id: "tick", type: "number", meaning: "Tick sequence number", units: "tick", maxItems: null, availability: "always", freshness: "tick" },
  tickMs: { id: "tickMs", type: "number", meaning: "Tick time of day", units: "ms", maxItems: null, availability: "always", freshness: "tick" },
  mid: { id: "mid", type: "number", meaning: "Mid-market price", units: "USD", maxItems: null, availability: "always", freshness: "tick" },
  spreadBps: { id: "spreadBps", type: "number", meaning: "Bid-ask spread", units: "bps", maxItems: null, availability: "always", freshness: "tick" },
  bookImbalance: { id: "bookImbalance", type: "number", meaning: "Top-of-book size imbalance", units: "ratio", maxItems: null, availability: "always", freshness: "tick" },
  depth: { id: "depth", type: "object", meaning: "Cumulative resting size by distance from mid", units: "size", maxItems: 3, availability: "always", freshness: "tick" },
  book: { id: "book", type: "object", meaning: "Best resting prices and sizes", units: "price x size", maxItems: 5, availability: "always", freshness: "tick" },
  returnsBps: { id: "returnsBps", type: "object", meaning: "Recent price returns", units: "bps", maxItems: null, availability: "always", freshness: "tick" },
  recentMids: { id: "recentMids", type: "string", meaning: "Recent mid-market prices", units: "USD", maxItems: null, availability: "always", freshness: "tick" },
  trades: { id: "trades", type: "object", meaning: "Taker trade summary", units: null, maxItems: null, availability: "always", freshness: "tick" },
  recentTrades: { id: "recentTrades", type: "array", meaning: "Recent taker prints", units: null, maxItems: 10, availability: "always", freshness: "tick" },
  position: { id: "position", type: "object", meaning: "Current position", units: null, maxItems: null, availability: "always", freshness: "unknown" },
  indicators: { id: "indicators", type: "object", meaning: "Candle-derived technical indicators", units: null, maxItems: null, availability: "nullable", freshness: "unknown" },
  asset: { id: "asset", type: "object", meaning: "Venue market data", units: null, maxItems: null, availability: "nullable", freshness: "unknown" },
  maxLeverage: { id: "maxLeverage", type: "number", meaning: "Maximum allowed cross leverage", units: "x", maxItems: null, availability: "always", freshness: "unknown" },
});

export type MarketFacingState = Omit<TradeState, "position"> & {
  position: Omit<TradeState["position"], "unrealizedUsd"> & { unrealizedUsd?: number };
};

export function marketFacing(state: TradeState): MarketFacingState {
  const pos = state.position;
  return {
    coin: state.coin,
    market: state.market,
    tick: state.tick,
    tickMs: state.tickMs,
    mid: state.mid,
    spreadBps: state.spreadBps,
    bookImbalance: state.bookImbalance,
    depth: state.depth,
    book: state.book,
    returnsBps: state.returnsBps,
    recentMids: state.recentMids,
    trades: state.trades,
    recentTrades: state.recentTrades,
    position: {
      coin: pos.coin,
      side: pos.side,
      size: pos.size,
      notionalUsd: pos.notionalUsd,
      entry: pos.entry,
      leverage: pos.leverage,
      liquidationPx: pos.liquidationPx,
      distanceBps: pos.distanceBps,
      ...(pos.side === "flat" ? {} : { unrealizedUsd: pos.unrealizedUsd }),
    },
    indicators: state.indicators,
    asset: state.asset,
    maxLeverage: state.maxLeverage,
  };
}

function featureValue(state: TradeState, id: string): JsonValue {
  switch (id) {
    case "coin": return state.coin;
    case "market": return state.market;
    case "tick": return state.tick;
    case "tickMs": return state.tickMs;
    case "mid": return state.mid;
    case "spreadBps": return state.spreadBps;
    case "bookImbalance": return state.bookImbalance;
    case "depth": {
      const depth: { [band: string]: JsonValue } = {};
      for (const band of ["10", "25", "50"] as const) {
        if (Object.hasOwn(state.depth, band)) {
          const levels = state.depth[band]!;
          depth[band] = { bid: levels.bid, ask: levels.ask };
        }
      }
      return depth;
    }
    case "book":
      return { bids: state.book.bids.slice(0, 5), asks: state.book.asks.slice(0, 5) };
    case "returnsBps":
      return {
        last1: state.returnsBps.last1,
        last5: state.returnsBps.last5,
        last20: state.returnsBps.last20,
        last100: state.returnsBps.last100,
      };
    case "recentMids": return state.recentMids;
    case "trades":
      return {
        count: state.trades.count,
        buySz: state.trades.buySz,
        sellSz: state.trades.sellSz,
        cvdSz: state.trades.cvdSz,
        vwap: state.trades.vwap,
        lastPrice: state.trades.lastPrice,
        lastSide: state.trades.lastSide,
      };
    case "recentTrades": return state.recentTrades.slice(0, 10);
    case "position": {
      const position = state.position;
      return {
        coin: position.coin,
        side: position.side,
        size: position.size,
        notionalUsd: position.notionalUsd,
        entry: position.entry,
        leverage: position.leverage,
        liquidationPx: position.liquidationPx,
        distanceBps: position.distanceBps,
        ...(position.side === "flat" ? {} : { unrealizedUsd: position.unrealizedUsd }),
      };
    }
    case "indicators":
      return {
        sma20: state.indicators.sma20,
        sma50: state.indicators.sma50,
        ema20: state.indicators.ema20,
        midVsSma20Bps: state.indicators.midVsSma20Bps,
        midVsSma50Bps: state.indicators.midVsSma50Bps,
        rsi14: state.indicators.rsi14,
        vol20Bps: state.indicators.vol20Bps,
        high20: state.indicators.high20,
        low20: state.indicators.low20,
        rangePos20: state.indicators.rangePos20,
      };
    case "asset":
      return {
        markPx: state.asset.markPx,
        oraclePx: state.asset.oraclePx,
        fundingBps: state.asset.fundingBps,
        premiumBps: state.asset.premiumBps,
        openInterest: state.asset.openInterest,
        dayNtlVlmUsd: state.asset.dayNtlVlmUsd,
        dayChangeBps: state.asset.dayChangeBps,
        maxLeverage: state.asset.maxLeverage,
      };
    case "maxLeverage": return state.maxLeverage;
    default: throw new Error(`Unknown feature: ${id}`);
  }
}

export function extractFeatures(state: TradeState, ids: readonly string[]): { readonly [feature: string]: JsonValue } {
  const result: { [feature: string]: JsonValue } = {};
  for (const id of ids) result[id] = featureValue(state, id);
  return deepFreeze(result);
}
