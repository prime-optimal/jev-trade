export const MODEL_HORIZONS = [1, 5, 20, 100] as const;
export type ModelHorizon = (typeof MODEL_HORIZONS)[number];

export interface ModelUrlValues {
  decisionId: string | null;
  horizon: ModelHorizon;
}

export const DEFAULT_MODEL_HORIZON: ModelHorizon = 5;

export function parseModelUrl(search: string): ModelUrlValues {
  const params = new URLSearchParams(search);
  const rawId = params.get("d");
  const rawHorizon = params.get("h");
  const horizon = MODEL_HORIZONS.find((value) => rawHorizon === String(value)) ?? DEFAULT_MODEL_HORIZON;
  return { decisionId: rawId !== null && rawId.trim().length > 0 ? rawId : null, horizon };
}

export function serializeModelUrl(values: ModelUrlValues): string {
  const params = new URLSearchParams();
  if (values.decisionId !== null) params.set("d", values.decisionId);
  params.set("h", String(values.horizon));
  return `?${params.toString()}`;
}
