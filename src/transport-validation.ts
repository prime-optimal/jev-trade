import { type HyperliquidEnv } from "./config";
import { createHttpTransport, infoPost, runtimeTransport } from "./hyperliquid";
import { NETWORK_ENDPOINTS, type NetworkEndpoints, type TradingNetwork } from "./networks";
import { effectiveEndpoints, type ConnectionValidation, type TradingSettings } from "./settings";

const VALIDATION_TIMEOUT_MS = 8_000;

type ExplorerResponse = { type?: unknown; txs?: unknown };

class ValidationFailure extends Error {}

function hasNamedUniverse(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("universe" in value) || !Array.isArray(value.universe)) return false;
  return value.universe.length > 0 && value.universe.every((asset) => (
    typeof asset === "object" && asset !== null && "name" in asset && typeof asset.name === "string"
  ));
}

function canonical(value: string): string {
  return new URL(value).toString().replace(/\/$/, "");
}

function endpointMatches(actual: string, expected: string): boolean {
  return canonical(actual) === canonical(expected);
}

function wrongOfficialEndpoint(
  endpoints: NetworkEndpoints,
  network: TradingNetwork,
): "API" | "WebSocket" | "RPC" | null {
  const other = NETWORK_ENDPOINTS[network === "testnet" ? "mainnet" : "testnet"];
  if (endpointMatches(endpoints.apiUrl, other.apiUrl)) return "API";
  if (endpointMatches(endpoints.wsUrl, other.wsUrl)) return "WebSocket";
  if (endpointMatches(endpoints.rpcUrl, other.rpcUrl)) return "RPC";
  return null;
}

function officialIdentityKnown(endpoints: NetworkEndpoints, network: TradingNetwork): boolean {
  const expected = NETWORK_ENDPOINTS[network];
  return endpointMatches(endpoints.apiUrl, expected.apiUrl)
    && endpointMatches(endpoints.wsUrl, expected.wsUrl)
    && endpointMatches(endpoints.rpcUrl, expected.rpcUrl);
}

function sanitizedFailure(error: unknown): string {
  if (error instanceof ValidationFailure) return error.message;
  if (error instanceof DOMException && error.name === "TimeoutError") return "Connection validation timed out";
  if (error instanceof Error && error.name === "AbortError") return "Connection validation timed out";
  if (error instanceof Error && (
    error.message === "API keys are not supported for official Hyperliquid API hosts"
    || error.message === "An API key requires a custom Hyperliquid API URL"
  )) return error.message;
  return "Connection validation failed before a response was received. Check the endpoint URLs and local network access.";
}

async function validateStage(task: Promise<void>, failure: string): Promise<void> {
  try {
    await task;
  } catch (error) {
    const timedOut = (error instanceof DOMException && error.name === "TimeoutError")
      || (error instanceof Error && error.name === "AbortError");
    throw new ValidationFailure(`${failure}${timedOut ? " The request timed out." : ""}`);
  }
}

async function validateMeta(transport: HyperliquidEnv, signal: AbortSignal): Promise<void> {
  const response = await infoPost({ type: "meta" }, transport, signal);
  if (!response.ok) throw new Error("Metadata request failed");
  const body: unknown = await response.json();
  if (!hasNamedUniverse(body)) throw new Error("Unexpected metadata response");
}

async function validateRpc(transport: HyperliquidEnv, signal: AbortSignal): Promise<void> {
  const response = await createHttpTransport(transport).request<ExplorerResponse>(
    "explorer",
    { type: "userDetails", user: "0x0000000000000000000000000000000000000000" },
    signal,
  );
  if (response?.type !== "userDetails" || !Array.isArray(response.txs)) {
    throw new Error("Unexpected explorer response");
  }
}

function validateWebSocket(url: string, signal: AbortSignal): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const socket = new WebSocket(url);
  let settled = false;
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    signal.removeEventListener("abort", abort);
    socket.close();
    if (error) reject(error);
    else resolve();
  };
  const abort = () => finish(new DOMException("Timed out", "TimeoutError"));
  signal.addEventListener("abort", abort, { once: true });
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ method: "subscribe", subscription: { type: "allMids" } }));
  }, { once: true });
  socket.addEventListener("message", (event) => {
    try {
      const body: unknown = JSON.parse(String(event.data));
      if (typeof body === "object" && body !== null && "channel" in body
        && (body.channel === "allMids" || body.channel === "subscriptionResponse")) finish();
    } catch {
      finish(new Error("Unexpected WebSocket response"));
    }
  });
  socket.addEventListener("error", () => finish(new Error("WebSocket validation failed")), { once: true });
  socket.addEventListener("close", () => finish(new Error("WebSocket closed before validation")), { once: true });
  return promise;
}

export async function validateConnection(
  settings: TradingSettings,
  apiKey?: string,
): Promise<ConnectionValidation> {
  const checkedAt = Date.now();
  const endpoints = effectiveEndpoints(settings);
  const base = { ...endpoints, checkedAt };
  const wrong = wrongOfficialEndpoint(endpoints, settings.network);
  if (wrong) {
    return {
      ...base,
      ok: false,
      realAllowed: false,
      message: `${wrong} endpoint belongs to the other Hyperliquid network. Select matching ${settings.network} endpoints.`,
    };
  }

  try {
    const transport = runtimeTransport(settings, apiKey);
    const signal = AbortSignal.timeout(VALIDATION_TIMEOUT_MS);
    await Promise.all([
      validateStage(
        validateMeta(transport, signal),
        "Hyperliquid metadata validation failed. Check the HTTP API URL and API-key configuration.",
      ),
      validateStage(
        validateRpc(transport, signal),
        "Hyperliquid RPC validation failed. The RPC URL must support SDK explorer requests.",
      ),
      validateStage(
        validateWebSocket(transport.wsUrl, signal),
        "Hyperliquid WebSocket validation failed. The URL must support market subscriptions.",
      ),
    ]);
    const known = officialIdentityKnown(endpoints, settings.network);
    return {
      ...base,
      ok: true,
      realAllowed: known,
      message: known
        ? `Connected to Hyperliquid ${settings.network}.`
        : "Connected, but the custom endpoint network identity cannot be verified. Use matching official endpoints to enable real trading.",
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      realAllowed: false,
      message: sanitizedFailure(error),
    };
  }
}
