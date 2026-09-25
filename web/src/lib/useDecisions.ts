"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DecisionPage, DecisionRow } from "./journal-types";
import { createVisitorSession, OperatorRequestError, SESSION_API } from "./trading/operator";

export type DecisionHistoryStatus = "loading" | "ready" | "empty" | "error" | "expired";

export function useDecisions(): {
  rows: DecisionRow[];
  selectedId: string | null;
  select: (id: string) => void;
  status: DecisionHistoryStatus;
  error: string | null;
  nextBefore: string | null;
  loadingMore: boolean;
  refresh: () => void;
  loadOlder: () => void;
  retry: () => void;
} {
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<DecisionHistoryStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const rowsRef = useRef<DecisionRow[]>([]);
  const sequence = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  const loadPage = useCallback(async (before: string | null, replace: boolean, reconnect: boolean) => {
    const requestId = ++sequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    if (replace) {
      setStatus("loading");
      setError(null);
      setLoadingMore(false);
    } else {
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
      if (replace) setSelectedId((selected) => selected && nextRows.some((row) => row.decisionId === selected) ? selected : nextRows[0]?.decisionId ?? null);
      setNextBefore(page.nextBefore);
      setStatus(nextRows.length === 0 ? "empty" : "ready");
      setError(null);
    } catch (cause) {
      if (!current()) return;
      const requestError = cause instanceof OperatorRequestError ? cause : null;
      setStatus(requestError?.status === 410 ? "expired" : "error");
      setError(cause instanceof Error ? cause.message : "Could not load decision history.");
    } finally {
      if (current()) setLoadingMore(false);
    }
  }, []);

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
    };
  }, [loadPage]);

  return { rows, selectedId, select, status, error, nextBefore, loadingMore, refresh, loadOlder, retry };
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
