"use client";

import { useSyncExternalStore } from "react";
import { applyLiveMid } from "./ohlc";
import type { FeedState, BlockEvent, Meta } from "./types";
import type { Book } from "./trading/types";

export type FeedResult = FeedState;
export interface FeedStore {
  getSnapshot(): FeedResult;
  subscribe(listener: () => void): () => void;
  reset(): void;
  metadata(meta: Meta): void;
  connection(connection: FeedResult["connection"]): void;
  event(event: BlockEvent, history?: boolean): void;
}
export function marketEvent(coin: string, book: Book, ts: number): BlockEvent {
  return { coin, block: book.block, ts, mid: book.mid, bestBid: book.bid, bestAsk: book.ask, spreadBps: book.spreadBps,
    decision: null, quote: null, fill: null, resting: { bidSz: 0, askSz: 0 },
    position: { side: "flat", size: 0, entryPrice: null, leverage: null, unrealizedUsd: 0, unrealizedSz: 0 },
    totals: { blocks: 0, decisions: 0, quotes: 0, fills: 0, reverted: 0, lateBlocks: 0, jevUsd: 0, gasSz: 0, gasUsd: 0, realizedUsd: 0, pnlUsd: 0, pnlSz: 0, pnlPct: 0 } };
}
/** A provider-owned store. Public prices never carry account-wide equity. */
export function createFeedStore(): FeedStore {
  let state: FeedResult = { meta: null, connection: "connecting", byCoin: {} };
  const listeners = new Set<() => void>();
  const publish = (next: FeedResult) => { state = next; for (const listener of listeners) listener(); };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reset() { publish({ meta: null, connection: "connecting", byCoin: {} }); },
    metadata(meta: Meta) { publish({ ...state, meta }); },
    connection(connection: FeedResult["connection"]) { publish({ ...state, connection }); },
    event(event: BlockEvent, history = true) {
      const prior = state.byCoin[event.coin] ?? { events: [], tape: [], latest: null, avgLatencyMs: 0 };
      const events = history ? [...prior.events, event].slice(-1000) : prior.events;
      const measured = events.filter(item => item.decision && !item.decision.late);
      publish({ ...state, byCoin: { ...state.byCoin, [event.coin]: {
        events, latest: event, tape: applyLiveMid(prior.tape, event.mid, event.ts).slice(-20000),
        avgLatencyMs: measured.length ? measured.reduce((sum, item) => sum + item.decision!.latencyMs, 0) / measured.length : 0,
      } } });
    },
  };
}
export function useFeed(store: FeedStore): FeedResult {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
