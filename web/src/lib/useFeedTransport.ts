"use client";

import { useCallback, useEffect, useRef, type Dispatch } from "react";
import type { BlockEvent, Fill, Meta, PricePoint, Quote } from "./types";
import type { FeedAction } from "./useFeed";

const BACKOFF_MIN = 1000;
const BACKOFF_MAX = 10_000;
const STALE_MS = 45_000;
const FIRST_EVENT_MS = 90_000;

export function useFeedTransport(
  apiUrl: string,
  enabled: boolean,
  dispatch: Dispatch<FeedAction>,
  decodeSnapshot: (data: unknown) => { meta: Meta | null; historyByCoin: Record<string, BlockEvent[]>; tapeByCoin: Record<string, PricePoint[]> },
  decodeMap: (data: unknown) => Record<string, unknown[]>,
  decodeTape: (data: unknown) => PricePoint[],
): () => void {
  const loadTapeRef = useRef<() => void>(() => {});
  const loadTape = useCallback(() => loadTapeRef.current(), []);

  useEffect(() => {
    dispatch({ type: "reset" });
    loadTapeRef.current = () => {};
    if (!enabled) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    const base = (apiUrl || "").replace(/\/+$/, "");
    const controller = new AbortController();
    let closed = false;
    let attempt = 0;
    let haveSnapshot = false;
    let backfillPending = true;
    let tapeStatus: "idle" | "loading" | "done" = "idle";
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;

    const teardown = () => {
      if (es) {
        es.onopen = null;
        es.onerror = null;
        es.close();
        es = null;
      }
      clearTimeout(staleTimer);
    };
    const scheduleReconnect = () => {
      if (closed) return;
      teardown();
      dispatch({ type: "connection", connection: "reconnecting" });
      const delay = Math.min(BACKOFF_MAX, BACKOFF_MIN * 2 ** attempt);
      attempt++;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, delay);
    };
    const armStaleTimer = (ms = STALE_MS) => {
      clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        if (!closed) scheduleReconnect();
      }, ms);
    };
    const handle = (type: string, fn: (data: unknown) => void) => {
      es?.addEventListener(type, (raw: Event) => {
        if (closed) return;
        armStaleTimer();
        const payload = (raw as MessageEvent).data;
        if (typeof payload !== "string" || !payload) return;
        try { fn(JSON.parse(payload)); } catch { return; }
      });
    };
    const hydrateTape = async () => {
      if (tapeStatus !== "idle") return;
      tapeStatus = "loading";
      try {
        const response = await fetch(`${base}/tape`, { signal: controller.signal });
        if (!response.ok || closed) { tapeStatus = "idle"; return; }
        const raw = await response.json();
        if (closed) return;
        const tapeByCoin: Record<string, PricePoint[]> = {};
        for (const [coin, rows] of Object.entries(decodeMap(raw))) tapeByCoin[coin] = decodeTape(rows);
        if (Object.keys(tapeByCoin).length) dispatch({ type: "tapes", tapeByCoin });
        tapeStatus = "done";
      } catch { if (!closed) tapeStatus = "idle"; }
    };
    loadTapeRef.current = hydrateTape;
    // The snapshot carries only a short event tail. Backfill the full history so the
    // decision panes keep their window across reconnects and fill any gap they missed.
    const hydrateHistory = async () => {
      try {
        const response = await fetch(`${base}/history`, { signal: controller.signal });
        if (!response.ok || closed) return;
        const raw = await response.json();
        if (closed) return;
        const historyByCoin: Record<string, BlockEvent[]> = {};
        for (const [coin, rows] of Object.entries(decodeMap(raw))) historyByCoin[coin] = rows as BlockEvent[];
        if (Object.keys(historyByCoin).length) dispatch({ type: "histories", historyByCoin });
      } catch { /* The live stream still works without the backfill. */ }
    };
    const applySnapshot = (data: unknown) => {
      if (closed) return;
      const next = decodeSnapshot(data);
      if (!Object.keys(next.historyByCoin).length && !Object.keys(next.tapeByCoin).length && !next.meta) return;
      haveSnapshot = true;
      dispatch({ type: "snapshot", ...next });
      if (closed || !backfillPending) return;
      // Once per connection: a reconnect may have missed prints and decisions.
      backfillPending = false;
      if (tapeStatus === "done") tapeStatus = "idle";
      void hydrateTape();
      void hydrateHistory();
    };
    let snapInflight: Promise<boolean> | null = null;
    const pullSnapshot = (): Promise<boolean> => {
      if (snapInflight) return snapInflight;
      snapInflight = (async () => {
        try {
          const response = await fetch(`${base}/snapshot`, { signal: controller.signal });
          if (!response.ok || closed) return false;
          const raw = await response.json();
          if (closed) return false;
          applySnapshot(raw);
          return !closed;
        } catch { return false; }
        finally { snapInflight = null; }
      })();
      return snapInflight;
    };
    function connect() {
      if (closed) return;
      backfillPending = true;
      dispatch({ type: "connection", connection: attempt === 0 ? "connecting" : "reconnecting" });
      void pullSnapshot();
      es = new EventSource(`${base}/events?lite=1`);
      es.onopen = () => {
        attempt = 0;
        dispatch({ type: "connection", connection: "live" });
        armStaleTimer(haveSnapshot ? STALE_MS : FIRST_EVENT_MS);
        if (!haveSnapshot) void pullSnapshot();
      };
      es.onerror = () => { if (!closed) scheduleReconnect(); };
      handle("snapshot", applySnapshot);
      handle("ready", () => { if (!haveSnapshot) void pullSnapshot(); });
      handle("block", (data) => dispatch({ type: "block", event: data as BlockEvent }));
      handle("sleeve", (data) => dispatch({ type: "sleeve", sleeve: (data as { sleeve?: unknown } | null)?.sleeve }));
      handle("price", (data) => {
        const value = (data ?? {}) as { coin?: string; ts?: number; mid?: number; bestBid?: number; bestAsk?: number; spreadBps?: number };
        if (typeof value.coin !== "string" || typeof value.mid !== "number" || typeof value.ts !== "number") return;
        dispatch({ type: "price", coin: value.coin, mark: { ts: value.ts, mid: value.mid, bestBid: typeof value.bestBid === "number" ? value.bestBid : value.mid, bestAsk: typeof value.bestAsk === "number" ? value.bestAsk : value.mid, spreadBps: typeof value.spreadBps === "number" ? value.spreadBps : 0 } });
      });
      handle("fill", (data) => {
        const value = (data ?? {}) as { coin?: string; block?: number; fill?: Fill; ts?: number };
        if (typeof value.coin !== "string" || !value.fill) return;
        dispatch({ type: "fill", coin: value.coin, block: typeof value.block === "number" ? value.block : 0, fill: value.fill, ts: typeof value.ts === "number" ? value.ts : undefined });
      });
      handle("quote", (data) => {
        const value = (data ?? {}) as { coin?: string; block?: number; quote?: Quote };
        if (typeof value.coin !== "string" || typeof value.block !== "number" || !value.quote) return;
        dispatch({ type: "quote", coin: value.coin, block: value.block, quote: value.quote });
      });
      handle("ping", () => dispatch({ type: "connection", connection: "live" }));
    }
    connect();
    return () => {
      closed = true;
      controller.abort();
      loadTapeRef.current = () => {};
      clearTimeout(retryTimer);
      teardown();
    };
  }, [apiUrl, decodeMap, decodeSnapshot, decodeTape, dispatch, enabled]);

  return loadTape;
}
