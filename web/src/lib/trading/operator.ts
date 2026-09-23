import type { ConnectionValidation, OperatorSnapshot, RunSnapshot, TradingSettings } from "./settings";

export const OFF_RUN: RunSnapshot = {
  runId: null, status: "off", startedAt: null, deadlineAt: null, stoppedAt: null,
  durationMs: 30 * 60_000, stopReason: null, serverNow: 0,
};

export class OperatorRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "OperatorRequestError";
  }
}

export const SESSION_API = "/api/session";

export function resolvePublicApiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return /^https?:\/\//.test(configured) ? configured.replace(/\/+$/, "") : `https://${configured.replace(/\/+$/, "")}`;
  if (typeof window === "undefined") return "http://localhost:3000";
  return `${window.location.protocol}//${window.location.hostname}:3000`;
}

export function resolveOperatorApiUrl(): string | null {
  if (typeof window === "undefined") return null;
  const configured = process.env.NEXT_PUBLIC_OPERATOR_API_URL;
  if (configured) return /^https?:\/\//.test(configured) ? configured.replace(/\/+$/, "") : `https://${configured.replace(/\/+$/, "")}`;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:3002"
    : null;
}

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  if (!response.ok) throw new OperatorRequestError(body?.message || body?.error || `Request failed with status ${response.status}`, response.status);
  return body as T;
}

export function createVisitorSession(signal?: AbortSignal): Promise<OperatorSnapshot> {
  return request("", SESSION_API, { method: "POST", credentials: "same-origin", signal });
}

export function getRun(base: string, signal?: AbortSignal): Promise<RunSnapshot> {
  return request(base, "/run", { signal });
}

export function getOperator(base: string, signal?: AbortSignal): Promise<OperatorSnapshot> {
  return request(base, "/operator", { signal, credentials: "same-origin" });
}
export function applyOperatorSettings(base: string, settings: TradingSettings, apiKey?: string, clearedEndpoints: (keyof TradingSettings)[] = []): Promise<OperatorSnapshot> {
  return request(base, "/settings", { method: "POST", credentials: "same-origin", body: JSON.stringify({ settings, apiKey, clearedEndpoints }) });
}
export function applyVisitorSettings(base: string, settings: TradingSettings): Promise<OperatorSnapshot> {
  return request(base, "/settings", { method: "POST", credentials: "same-origin", body: JSON.stringify({ settings }) });
}

export function validateOperatorConnection(base: string, settings: TradingSettings, apiKey?: string): Promise<ConnectionValidation> {
  return request(base, "/validate", { method: "POST", credentials: "same-origin", body: JSON.stringify({ settings, apiKey }) });
}

export function startOperator(base: string, confirmReal = false): Promise<RunSnapshot> {
  return request(base, "/start", { method: "POST", credentials: "same-origin", body: JSON.stringify({ confirmReal }) });
}

export function stopOperator(base: string): Promise<RunSnapshot> {
  return request(base, "/stop", { method: "POST", credentials: "same-origin", body: "{}" });
}

export function reconcileOperator(base: string): Promise<RunSnapshot> {
  return request(base, "/reconcile", { method: "POST", credentials: "same-origin", body: "{}" });
}
