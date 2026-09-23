"use client";

import { useReducer } from "react";
import { applyLiveMid } from "./ohlc";
import type { BlockEvent, ConnectionState, FeedState, Fill, Meta, PricePoint, Quote, SleeveFeed, SleeveMeta } from "./types";
import { useFeedTransport } from "./useFeedTransport";

const CAP = 1000;
const TAPE_CAP = 200_000;

interface Mark {
  ts: number;
  mid: number;
  bestBid: number;
  bestAsk: number;
  spreadBps: number;
}

interface SleeveMem extends SleeveFeed {
  latSum: number;
  latCount: number;
  mark: Mark | null;
}

interface State {
  meta: Meta | null;
  connection: ConnectionState;
  sleeves: Record<string, SleeveMem>;
}

export type FeedAction =
  | { type: "reset" }
  | { type: "snapshot"; meta: Meta | null; historyByCoin: Record<string, BlockEvent[]>; tapeByCoin: Record<string, PricePoint[]> }
  | { type: "block"; event: BlockEvent }
  | { type: "fill"; coin: string; block: number; fill: Fill; ts?: number }
  | { type: "quote"; coin: string; block: number; quote: Quote }
  | { type: "connection"; connection: ConnectionState }
  | { type: "tapes"; tapeByCoin: Record<string, PricePoint[]> }
  | { type: "sleeve"; sleeve: unknown }
  | { type: "price"; coin: string; mark: Mark };

const emptySleeve = (): SleeveMem => ({
  events: [],
  tape: [],
  latest: null,
  avgLatencyMs: 0,
  latSum: 0,
  latCount: 0,
  mark: null,
});

function latencyOf(e: BlockEvent): number | null {
  const d = e?.decision;
  if (!d || d.late || typeof d.latencyMs !== "number" || !Number.isFinite(d.latencyMs)) return null;
  return d.latencyMs;
}

function indexOfBlock(events: BlockEvent[], block: number): number {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].block === block) return i;
  return -1;
}

function avg(latSum: number, latCount: number): number {
  return latCount > 0 ? Math.round(latSum / latCount) : 0;
}

function insertFillPoint(tape: PricePoint[] | undefined, fill: Fill, ts: number): PricePoint[] {
  const cur = tape ?? [];
  const mark = { side: fill.side, price: fill.price, size: fill.size, dir: fill.dir, hash: fill.txHash ?? undefined };
  for (let i = cur.length - 1; i >= 0; i--) {
    const p = cur[i]!;
    if (p.fill && p.ts === ts && p.fill.side === fill.side && p.fill.price === fill.price && p.fill.size === fill.size) {
      return cur;
    }
  }
  const point: PricePoint = { ts, mid: fill.price, fill: mark };
  const next = cur.slice();
  let idx = next.length;
  for (let i = 0; i < next.length; i++) {
    if (next[i]!.ts > ts) {
      idx = i;
      break;
    }
  }
  next.splice(idx, 0, point);
  return next.length > TAPE_CAP ? next.slice(next.length - TAPE_CAP) : next;
}

function stubLatest(coin: string, mark: Mark): BlockEvent {
  return {
    coin,
    block: 0,
    ts: mark.ts,
    mid: mark.mid,
    bestBid: mark.bestBid,
    bestAsk: mark.bestAsk,
    spreadBps: mark.spreadBps,
    decision: null,
    quote: null,
    fill: null,
    resting: { bidSz: 0, askSz: 0 },
    position: { side: "flat", size: 0, entryPrice: null, leverage: null, unrealizedUsd: 0, unrealizedSz: 0 },
    totals: {
      blocks: 0, decisions: 0, quotes: 0, fills: 0, reverted: 0, lateBlocks: 0,
      jevUsd: 0, gasSz: 0, gasUsd: 0, realizedUsd: 0, pnlUsd: 0, pnlSz: 0, pnlPct: 0,
    },
  };
}

function lastRealDecision(s: SleeveMem): BlockEvent | null {
  if (s.latest?.decision && !s.latest.decision.late) return s.latest;
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i]!;
    if (e.decision && !e.decision.late) return e;
  }
  return s.latest;
}

function paintLatest(coin: string, latest: BlockEvent | null, mark: Mark | null): BlockEvent | null {
  if (!mark) return latest;
  if (!latest) return stubLatest(coin, mark);
  if (mark.ts < latest.ts) return latest;
  return {
    ...latest,
    ts: mark.ts,
    mid: mark.mid,
    bestBid: mark.bestBid,
    bestAsk: mark.bestAsk,
    spreadBps: mark.spreadBps,
  };
}

function viewOf(s: SleeveMem): SleeveMem {
  return { ...s, avgLatencyMs: avg(s.latSum, s.latCount) };
}

function replaceSleeve(state: State, coin: string, next: SleeveMem): State {
  return { ...state, sleeves: { ...state.sleeves, [coin]: viewOf(next) } };
}

function fromHistory(history: BlockEvent[], tape: PricePoint[]): SleeveMem {
  const events = history.length > CAP ? history.slice(history.length - CAP) : history;
  let latSum = 0;
  let latCount = 0;
  for (const e of events) {
    const l = latencyOf(e);
    if (l !== null) {
      latSum += l;
      latCount++;
    }
  }
  const latest = events.length ? events[events.length - 1]! : null;
  return viewOf({
    events,
    tape,
    latest,
    avgLatencyMs: 0,
    latSum,
    latCount,
    mark: latest
      ? { ts: latest.ts, mid: latest.mid, bestBid: latest.bestBid, bestAsk: latest.bestAsk, spreadBps: latest.spreadBps }
      : null,
  });
}

function applyBlock(s: SleeveMem, ev: BlockEvent): SleeveMem {
  const prev = s.events;
  const last = prev.length ? prev[prev.length - 1] : null;

  if (last && ev.block <= last.block) {
    const idx = indexOfBlock(prev, ev.block);
    if (idx < 0) return s;
    const events = prev.slice();
    const old = events[idx]!;
    events[idx] = ev;
    let latSum = s.latSum;
    let latCount = s.latCount;
    const o = latencyOf(old);
    if (o !== null) {
      latSum -= o;
      latCount--;
    }
    const n = latencyOf(ev);
    if (n !== null) {
      latSum += n;
      latCount++;
    }
    return {
      ...s,
      events,
      latest: events[events.length - 1]!,
      latSum,
      latCount,
    };
  }

  let latSum = s.latSum;
  let latCount = s.latCount;
  const n = latencyOf(ev);
  if (n !== null) {
    latSum += n;
    latCount++;
  }
  let events = prev.concat(ev);
  if (events.length > CAP) {
    const drop = events.length - CAP;
    for (let i = 0; i < drop; i++) {
      const l = latencyOf(events[i]!);
      if (l !== null) {
        latSum -= l;
        latCount--;
      }
    }
    events = events.slice(drop);
  }
  return {
    ...s,
    events,
    latest: ev,
    latSum,
    latCount,
  };
}

function reducer(state: State, action: FeedAction): State {
  if (action.type === "reset") {
    return { meta: null, connection: "connecting", sleeves: {} };
  }
  switch (action.type) {
    case "price": {
      const s = state.sleeves[action.coin] ?? emptySleeve();
      return replaceSleeve(state, action.coin, {
        ...s,
        mark: action.mark,
        tape: applyLiveMid(s.tape, action.mark.mid, action.mark.ts),
      });
    }

    case "tapes": {
      let next = state;
      for (const [coin, tape] of Object.entries(action.tapeByCoin)) {
        if (!tape.length) continue;
        const s = next.sleeves[coin] ?? emptySleeve();
        if (tape.length <= (s.tape?.length ?? 0)) continue;
        next = replaceSleeve(next, coin, { ...s, tape: tape.length > TAPE_CAP ? tape.slice(tape.length - TAPE_CAP) : tape });
      }
      return next;
    }

    case "connection":
      return state.connection === action.connection ? state : { ...state, connection: action.connection };

    case "snapshot": {
      const coins = new Set<string>([
        ...Object.keys(action.historyByCoin),
        ...Object.keys(action.tapeByCoin),
        ...(action.meta?.sleeves.map((s) => s.coin) ?? []),
      ]);
      const sleeves: Record<string, SleeveMem> = {};
      for (const coin of coins) {
        sleeves[coin] = fromHistory(action.historyByCoin[coin] ?? [], action.tapeByCoin[coin] ?? []);
      }
      return {
        meta: action.meta ?? state.meta,
        connection: "live",
        sleeves,
      };
    }

    case "sleeve": {
      const raw = action.sleeve as Record<string, unknown> | null;
      const coin = raw && typeof raw.coin === "string" ? raw.coin : "";
      if (!coin || !state.meta) return state;
      const sleeve = parseSleeve(raw, Boolean(state.sleeves[coin]?.latest));
      if (!sleeve) return state;
      const index = state.meta.sleeves.findIndex((item) => item.coin === coin);
      const sleeves = state.meta.sleeves.slice();
      if (index < 0) sleeves.push(sleeve);
      else sleeves[index] = sleeve;
      return { ...state, meta: { ...state.meta, sleeves } };
    }

    case "block": {
      const ev = action.event;
      if (!ev || typeof ev.block !== "number") return state;
      const coin = ev.coin || state.meta?.coin;
      if (!coin) return state;
      return replaceSleeve(state, coin, applyBlock(state.sleeves[coin] ?? emptySleeve(), ev));
    }

    case "fill": {
      const s = state.sleeves[action.coin] ?? emptySleeve();
      const ts = action.ts ?? Date.now();
      const idx = indexOfBlock(s.events, action.block);
      if (idx < 0) {
        return replaceSleeve(state, action.coin, { ...s, tape: insertFillPoint(s.tape, action.fill, ts) });
      }
      const events = s.events.slice();
      const updated: BlockEvent = { ...events[idx]!, fill: action.fill };
      events[idx] = updated;
      return replaceSleeve(state, action.coin, {
        ...s,
        events,
        tape: insertFillPoint(s.tape, action.fill, ts),
        latest: idx === events.length - 1 ? updated : s.latest,
      });
    }

    case "quote": {
      const s = state.sleeves[action.coin] ?? emptySleeve();
      const idx = indexOfBlock(s.events, action.block);
      if (idx < 0) return state;
      const events = s.events.slice();
      const updated: BlockEvent = { ...events[idx]!, quote: action.quote };
      events[idx] = updated;
      return replaceSleeve(state, action.coin, {
        ...s,
        events,
        latest: idx === events.length - 1 ? updated : s.latest,
      });
    }

    default:
      return state;
  }
}

function parseSleeve(raw: unknown, hasLatest: boolean): SleeveMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.coin !== "string" || typeof s.pair !== "string" || typeof s.label !== "string") return null;
  const status = s.status === "starting" || s.status === "live" || s.status === "retrying"
    ? s.status
    : hasLatest ? "live" : "starting";
  return {
    coin: s.coin,
    pair: s.pair,
    label: s.label,
    wallet: typeof s.wallet === "string" ? s.wallet : null,
    status,
    error: typeof s.error === "string" ? s.error : null,
    retryAt: typeof s.retryAt === "number" && Number.isFinite(s.retryAt) ? s.retryAt : null,
  };
}

function parseSleeves(raw: unknown, liveCoins: ReadonlySet<string>): Meta["sleeves"] {
  if (!Array.isArray(raw)) return [];
  const out: Meta["sleeves"] = [];
  for (const item of raw) {
    const coin = item && typeof item === "object" && typeof (item as Record<string, unknown>).coin === "string"
      ? (item as Record<string, unknown>).coin as string
      : "";
    const sleeve = parseSleeve(item, liveCoins.has(coin));
    if (sleeve) out.push(sleeve);
  }
  return out;
}

function parseMeta(raw: Record<string, unknown> | null, liveCoins: ReadonlySet<string>): Meta | null {
  if (!raw) return null;
  return {
    model: typeof raw.model === "string" ? raw.model : "",
    wallet: typeof raw.wallet === "string" ? raw.wallet : null,
    dryRun: Boolean(raw.dryRun),
    market: typeof raw.market === "string" ? raw.market : "BTC-USD",
    startedAt: typeof raw.startedAt === "number" ? raw.startedAt : Date.now(),
    venue: typeof raw.venue === "string" ? raw.venue : "hyperliquid",
    coin: typeof raw.coin === "string" ? raw.coin : "BTC",
    pair: typeof raw.pair === "string" ? raw.pair : "BTC-USD",
    explorerTx: typeof raw.explorerTx === "string" ? raw.explorerTx : "",
    tickMs: typeof raw.tickMs === "number" ? raw.tickMs : 30000,
    sleeves: parseSleeves(raw.sleeves, liveCoins),
  };
}

function asEvents(v: unknown): BlockEvent[] {
  return Array.isArray(v) ? (v as BlockEvent[]) : [];
}

export function asTape(v: unknown): PricePoint[] {
  return Array.isArray(v) ? (v as PricePoint[]) : [];
}

export function mapByCoin(raw: unknown): Record<string, unknown[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v;
  }
  return out;
}

export function snapshotFrom(data: unknown): {
  meta: Meta | null;
  historyByCoin: Record<string, BlockEvent[]>;
  tapeByCoin: Record<string, PricePoint[]>;
} {
  const d = (data ?? {}) as Record<string, unknown>;
  const historyByCoin: Record<string, BlockEvent[]> = {};
  const tapeByCoin: Record<string, PricePoint[]> = {};
  const histMap = mapByCoin(d.historyByCoin);
  const tapeMap = mapByCoin(d.tapeByCoin);
  for (const [coin, rows] of Object.entries(histMap)) historyByCoin[coin] = asEvents(rows);
  for (const [coin, rows] of Object.entries(tapeMap)) tapeByCoin[coin] = asTape(rows);
  if (!Object.keys(historyByCoin).length && Array.isArray(d.history)) {
    const coin = typeof d.coin === "string" ? d.coin : "BTC";
    historyByCoin[coin] = asEvents(d.history);
    tapeByCoin[coin] = asTape(d.tape);
  }
  const liveCoins = new Set(Object.entries(historyByCoin).filter(([, rows]) => rows.length > 0).map(([coin]) => coin));
  return { meta: parseMeta(d, liveCoins), historyByCoin, tapeByCoin };
}

export interface FeedResult extends FeedState {
  loadTape: () => void;
}

/**
 * Live sleeve feed. First paint comes from gzipped GET /snapshot.
 * SSE is lite after that. The full candle tape hydrates right after the snapshot.
 */
export function useFeed(apiUrl: string, enabled = true): FeedResult {
  const [state, dispatch] = useReducer(reducer, {
    meta: null,
    connection: "connecting" as ConnectionState,
    sleeves: {},
  });
  const loadTape = useFeedTransport(apiUrl, enabled, dispatch, snapshotFrom, mapByCoin, asTape);
  const byCoin: Record<string, SleeveFeed> = {};
  for (const [coin, s] of Object.entries(state.sleeves)) {
    byCoin[coin] = {
      events: s.events,
      tape: s.tape,
      latest: paintLatest(coin, lastRealDecision(s), s.mark),
      avgLatencyMs: s.avgLatencyMs,
    };
  }

  return { meta: state.meta, connection: state.connection, byCoin, loadTape };
}
