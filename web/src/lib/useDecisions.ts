"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DecisionPage, DecisionRow } from "./journal-types";
import { mergeNewestPage } from "./decisionMerge";
import { createVisitorSession, OperatorRequestError, SESSION_API } from "./trading/operator";

const NEW_ROW_CUE_MS = 5_000;

export type DecisionHistoryStatus = "loading" | "ready" | "empty" | "error" | "expired";

export function useDecisions(options: { initialSelectedId?: string | null; liveSignal?: string } = {}): {
  rows: DecisionRow[];
  selectedId: string | null;
  select: (id: string) => void;
  status: DecisionHistoryStatus;
  error: string | null;
  nextBefore: string | null;
  loadingMore: boolean;
  newIds: ReadonlySet<string>;
  refresh: () => void;
  loadOlder: () => void;
  retry: () => void;
} {
  const liveSignal = options.liveSignal ?? "";
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(options.initialSelectedId ?? null);
  const [status, setStatus] = useState<DecisionHistoryStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(() => new Set());
  const pageLoadInFlight = useRef(false);
  const pendingLive = useRef(false);
  const pendingLiveRetry = useRef(false);
  const liveBusy = useRef(false);
  const liveController = useRef<AbortController | null>(null);
  const liveSignalRef = useRef<string | null>(null);
  const trailingRef = useRef<number | null>(null);
  const freshCueTimer = useRef<number | null>(null);
  const olderLoaded = useRef(false);
  const livePullRef = useRef<(retryOnMiss?: boolean) => void>(() => {});
  const rowsRef = useRef<DecisionRow[]>([]);
  const sequence = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const pinnedId = useRef(options.initialSelectedId ?? null);
  pinnedId.current = options.initialSelectedId ?? null;

  const loadPage = useCallback(async (before: string | null, replace: boolean, reconnect: boolean) => {
    const requestId = ++sequence.current;
    pageLoadInFlight.current = true;
    liveController.current?.abort();
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    if (replace) {
      olderLoaded.current = false;
      if (trailingRef.current !== null) window.clearTimeout(trailingRef.current);
      trailingRef.current = null;
      if (freshCueTimer.current !== null) window.clearTimeout(freshCueTimer.current);
      freshCueTimer.current = null;
      setNewIds(new Set());
      setStatus("loading");
      setError(null);
      setLoadingMore(false);
    } else {
      olderLoaded.current = true;
      setLoadingMore(true);
      setError(null);
    }
    const current = () => mounted.current && requestId === sequence.current && !controller.signal.aborted;
    try {
      let sessionCreated = false;
      if (reconnect) {
        await createVisitorSession(controller.signal);
        sessionCreated = true;
      }
      const query = new URLSearchParams({ limit: "50" });
      if (before !== null) query.set("before", before);
      let page: DecisionPage;
      try {
        page = await fetchPage(query.toString(), controller.signal);
      } catch (cause) {
        if (!(cause instanceof OperatorRequestError) || cause.status !== 401 || sessionCreated) throw cause;
        await createVisitorSession(controller.signal);
        sessionCreated = true;
        page = await fetchPage(query.toString(), controller.signal);
      }
      let nextRows = page.rows;
      if (!replace) {
        const seen: Record<string, true> = {};
        for (const row of rowsRef.current) seen[row.decisionId] = true;
        nextRows = [...rowsRef.current, ...page.rows.filter((row) => !seen[row.decisionId])];
        rowsRef.current = nextRows;
      } else {
        rowsRef.current = nextRows;
      }
      setRows(nextRows);
      if (replace) setSelectedId((selected) => {
        const pinned = pinnedId.current;
        if (selected !== null && (selected === pinned || nextRows.some((row) => row.decisionId === selected))) return selected;
        return pinned !== null && nextRows.some((row) => row.decisionId === pinned) ? pinned : nextRows[0]?.decisionId ?? null;
      });
      setNextBefore(page.nextBefore);
      setStatus(nextRows.length === 0 ? "empty" : "ready");
      setError(null);
    } catch (cause) {
      if (!current()) return;
      const requestError = cause instanceof OperatorRequestError ? cause : null;
      setStatus(requestError?.status === 410 ? "expired" : "error");
      setError(cause instanceof Error ? cause.message : "Could not load decision history.");
    } finally {
      if (current()) {
        setLoadingMore(false);
        pageLoadInFlight.current = false;
        if (pendingLive.current) {
          const retryOnMiss = pendingLiveRetry.current;
          pendingLive.current = false;
          pendingLiveRetry.current = false;
          livePullRef.current(retryOnMiss);
        }
      }
    }
  }, []);
  const pullLatest = useCallback((retryOnMiss = true) => {
    if (!mounted.current) return;
    if (pageLoadInFlight.current || liveBusy.current) {
      pendingLive.current = true;
      pendingLiveRetry.current ||= retryOnMiss;
      return;
    }
    liveBusy.current = true;
    const requestId = sequence.current;
    const controller = new AbortController();
    liveController.current = controller;
    const query = new URLSearchParams({ limit: "50" });
    const run = async () => {
      try {
        let page: DecisionPage;
        try {
          page = await fetchPage(query.toString(), controller.signal);
        } catch (cause) {
          if (!(cause instanceof OperatorRequestError) || cause.status !== 401) throw cause;
          await createVisitorSession(controller.signal);
          page = await fetchPage(query.toString(), controller.signal);
        }
        if (!mounted.current || requestId !== sequence.current || controller.signal.aborted) return;
        const merged = mergeNewestPage(rowsRef.current, page.rows);
        rowsRef.current = merged.rows;
        setRows(merged.rows);
        setStatus(merged.rows.length === 0 ? "empty" : "ready");
        setError(null);
        if (!olderLoaded.current) setNextBefore(page.nextBefore);
        if (merged.newIds.length > 0) {
          setNewIds((current) => new Set([...current, ...merged.newIds]));
          if (freshCueTimer.current !== null) window.clearTimeout(freshCueTimer.current);
          freshCueTimer.current = window.setTimeout(() => {
            freshCueTimer.current = null;
            setNewIds(new Set());
          }, NEW_ROW_CUE_MS);
          if (trailingRef.current !== null) window.clearTimeout(trailingRef.current);
          trailingRef.current = null;
        } else if (retryOnMiss && trailingRef.current === null) {
          trailingRef.current = window.setTimeout(() => {
            trailingRef.current = null;
            livePullRef.current(false);
          }, 1200);
        }
      } catch {
        // The next feed event will retry a transient journal read failure.
      } finally {
        if (liveController.current === controller) {
          liveController.current = null;
          liveBusy.current = false;
        }
        if (mounted.current && !pageLoadInFlight.current && pendingLive.current && !liveBusy.current) {
          const retryOnMiss = pendingLiveRetry.current;
          pendingLive.current = false;
          pendingLiveRetry.current = false;
          livePullRef.current(retryOnMiss);
        }
      }
    };
    void run();
  }, []);
  livePullRef.current = pullLatest;

  const refresh = useCallback(() => { void loadPage(null, true, false); }, [loadPage]);

  const retry = useCallback(() => { void loadPage(null, true, true); }, [loadPage]);
  const loadOlder = useCallback(() => {
    if (nextBefore !== null && !loadingMore) void loadPage(nextBefore, false, false);
  }, [loadPage, loadingMore, nextBefore]);
  const select = useCallback((id: string) => setSelectedId(id), []);

  useEffect(() => {
    mounted.current = true;
    void loadPage(null, true, false);
    return () => {
      mounted.current = false;
      sequence.current += 1;
      controllerRef.current?.abort();
      liveController.current?.abort();
      if (trailingRef.current !== null) window.clearTimeout(trailingRef.current);
      trailingRef.current = null;
      if (freshCueTimer.current !== null) window.clearTimeout(freshCueTimer.current);
      freshCueTimer.current = null;
      pendingLive.current = false;
      pendingLiveRetry.current = false;
    };
  }, [loadPage]);
  useEffect(() => {
    if (liveSignalRef.current === null) {
      liveSignalRef.current = liveSignal;
      if (liveSignal !== "") livePullRef.current();
      return;
    }
    if (liveSignalRef.current === liveSignal) return;
    liveSignalRef.current = liveSignal;
    livePullRef.current();
  }, [liveSignal]);

  return { rows, selectedId, select, status, error, nextBefore, loadingMore, newIds, refresh, loadOlder, retry };
}

async function fetchPage(query: string, signal: AbortSignal): Promise<DecisionPage> {
  const response = await fetch(`${SESSION_API}/decisions?${query}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && !Array.isArray(body) && "error" in body && typeof body.error === "string" ? body.error : `Request failed with status ${response.status}`;
    throw new OperatorRequestError(message, response.status);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body) || !("rows" in body) || !Array.isArray(body.rows) || !("nextBefore" in body) || !(typeof body.nextBefore === "string" || body.nextBefore === null)) {
    throw new Error("The decision history response was invalid.");
  }
  return body as DecisionPage;
}
