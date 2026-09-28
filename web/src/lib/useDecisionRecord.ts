"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DecisionRow } from "./journal-types";
import { createVisitorSession, OperatorRequestError, SESSION_API } from "./trading/operator";

export type DecisionRecordStatus = "idle" | "loading" | "ready" | "not-found" | "error";

interface DecisionRecordResult {
  id: string | null;
  row: DecisionRow | null;
  status: DecisionRecordStatus;
}

export function useDecisionRecord(id: string | null, missing: boolean): {
  row: DecisionRow | null;
  status: DecisionRecordStatus;
  retry: () => void;
} {
  const [result, setResult] = useState<DecisionRecordResult>({ id: null, row: null, status: "idle" });
  const [retryCount, setRetryCount] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
    const requestId = ++sequence.current;
    if (id === null || !missing) {
      setResult({ id, row: null, status: "idle" });
      return;
    }

    const controller = new AbortController();
    setResult({ id, row: null, status: "loading" });
    const load = async () => {
      try {
        let decision: DecisionRow;
        try {
          decision = await fetchDecision(id, controller.signal);
        } catch (cause) {
          if (!(cause instanceof OperatorRequestError) || cause.status !== 401) throw cause;
          await createVisitorSession(controller.signal);
          decision = await fetchDecision(id, controller.signal);
        }
        if (requestId === sequence.current) setResult({ id, row: decision, status: "ready" });
      } catch (cause) {
        if (controller.signal.aborted || requestId !== sequence.current) return;
        const status = cause instanceof OperatorRequestError && cause.status === 404 ? "not-found" : "error";
        setResult({ id, row: null, status });
      }
    };
    void load();
    return () => controller.abort();
  }, [id, missing, retryCount]);

  const retry = useCallback(() => setRetryCount((count) => count + 1), []);
  const current = result.id === id && missing
    ? result
    : { id, row: null, status: id !== null && missing ? "loading" as const : "idle" as const };
  return { row: current.row, status: current.status, retry };
}

async function fetchDecision(id: string, signal: AbortSignal): Promise<DecisionRow> {
  const query = new URLSearchParams({ id });
  const response = await fetch(`${SESSION_API}/decisions?${query}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && !Array.isArray(body) && "error" in body && typeof body.error === "string"
      ? body.error
      : `Request failed with status ${response.status}`;
    throw new OperatorRequestError(message, response.status);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body) || !("decisionId" in body) || body.decisionId !== id) {
    throw new Error("The decision record response was invalid.");
  }
  return body as DecisionRow;
}
