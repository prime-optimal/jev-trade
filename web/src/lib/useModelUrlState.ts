"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_MODEL_HORIZON, parseModelUrl, serializeModelUrl, type ModelHorizon, type ModelUrlValues } from "./model-url";

export function useModelUrlState(): ModelUrlValues & {
  setDecision: (decisionId: string) => void;
  setHorizon: (horizon: ModelHorizon) => void;
} {
  const [values, setValues] = useState<ModelUrlValues>({ decisionId: null, horizon: DEFAULT_MODEL_HORIZON });
  useEffect(() => {
    const sync = () => {
      const next = parseModelUrl(window.location.search);
      setValues(next);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);


  const update = useCallback((patch: Partial<ModelUrlValues>) => {
    const current = parseModelUrl(window.location.search);
    const next = { ...current, ...patch };
    if (next.decisionId === current.decisionId && next.horizon === current.horizon) return;
    window.history.pushState(null, "", `${window.location.pathname}${serializeModelUrl(next)}`);
    setValues(next);
  }, []);

  const setDecision = useCallback((decisionId: string) => update({ decisionId }), [update]);
  const setHorizon = useCallback((horizon: ModelHorizon) => update({ horizon }), [update]);

  return { ...values, setDecision, setHorizon };
}
