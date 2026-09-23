import type { DecisionStore } from "./decision-store";
import { validateConnection } from "./transport-validation";
import { SettingsRuntime, type LifecycleControl } from "./settings-runtime";
import { validateApiKey, validateSettings, type ConnectionValidation, type RunSnapshot, type TradingSettings } from "./settings";

const MAX_BODY_BYTES = 64 * 1024;
const MUTATION_PATHS: Record<string, true> = {
  "/settings": true,
  "/validate": true,
  "/start": true,
  "/stop": true,
  "/reconcile": true,
};

export interface OperatorControlOptions {
  lifecycle: LifecycleControl;
  rebuild(settings: TradingSettings, apiKey?: string): Promise<void>;
  validate?: (settings: TradingSettings, apiKey?: string) => Promise<ConnectionValidation>;
  env?: Record<string, string | undefined>;
  controlPort?: number;
  allowedOrigin?: string;
  controlHost?: string;
  decisionStore?: DecisionStore;
  decisionOwnerId?: string;
}

export interface OperatorControl {
  runtime: SettingsRuntime;
  fetch(request: Request, peerAddress?: string): Promise<Response>;
  listen(): Bun.Server<undefined>;
  close(): void;
}

function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.split("%")[0]?.toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
}

function assertLocalOrigin(raw: string): string {
  const origin = new URL(raw);
  if (origin.origin !== raw || (origin.hostname !== "localhost" && origin.hostname !== "127.0.0.1" && origin.hostname !== "[::1]")) {
    throw new Error("CONTROL_ORIGIN must be an explicit local HTTP origin");
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") throw new Error("CONTROL_ORIGIN must use HTTP or HTTPS");
  return origin.origin;
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new Error("Content-Type must be application/json");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error("Request body is too large");

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("Request body is too large");
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Request body must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Request body must be a JSON object");
  return parsed as Record<string, unknown>;
}

function safeMessage(error: unknown, secrets: readonly (string | undefined)[]): string {
  let message = error instanceof Error ? error.message : "Operator request failed";
  for (const secret of secrets) if (secret) message = message.split(secret).join("[redacted]");
  message = message.replace(/https?:\/\/[^\s]+/gi, (raw) => {
    try {
      const url = new URL(raw.replace(/[),.;]+$/, ""));
      return `${url.protocol}//${url.host}${url.pathname.includes("token") || url.search ? "/[redacted]" : url.pathname}`;
    } catch {
      return "[redacted URL]";
    }
  });
  return message.slice(0, 500);
}

function response(body: unknown, status: number, origin?: string): Response {
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  return Response.json(body, { status, headers });
}

function assertOnly(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw new Error(`Unknown request field: ${key}`);
}

export function createOperatorControl(options: OperatorControlOptions): OperatorControl {
  const env = options.env ?? process.env;
  const port = options.controlPort ?? Number(env.CONTROL_PORT ?? "3002");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("CONTROL_PORT must be an integer from 1 to 65535");
  const allowedOrigin = assertLocalOrigin(options.allowedOrigin ?? env.CONTROL_ORIGIN ?? "http://localhost:3001");
  const expectedHost = options.controlHost ?? env.CONTROL_HOST ?? `127.0.0.1:${port}`;
  if (expectedHost !== `127.0.0.1:${port}` && expectedHost !== `localhost:${port}` && expectedHost !== `[::1]:${port}`) {
    throw new Error("CONTROL_HOST must be an exact loopback host including CONTROL_PORT");
  }
  const runtime = new SettingsRuntime({ lifecycle: options.lifecycle, rebuild: options.rebuild, env });
  const checkConnection = options.validate ?? validateConnection;
  let server: Bun.Server<undefined> | null = null;
  let operationGeneration = 0;
  let activeOperation: "settings" | "validate" | "start" | "reconcile" | null = null;
  let startAttempt: Promise<RunSnapshot> | null = null;

  const fetch = async (request: Request, peerAddress = "127.0.0.1"): Promise<Response> => {
    const origin = request.headers.get("origin");
    const url = new URL(request.url);
    try {
      if (!isLoopback(peerAddress)) return response({ error: "Operator control is available only from this machine" }, 403);
      if (request.headers.get("host") !== expectedHost) return response({ error: "Invalid operator Host header" }, 403);
      if (origin !== null && origin !== allowedOrigin) return response({ error: "Origin is not allowed" }, 403);
      if (request.method === "OPTIONS") {
        if (!MUTATION_PATHS[url.pathname] || origin !== allowedOrigin) return response({ error: "Origin is required" }, 403);
        const headers = {
          "access-control-allow-origin": allowedOrigin,
          "access-control-allow-methods": "POST",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "600",
          vary: "Origin",
        };
        return new Response(null, { status: 204, headers });
      }
      if (request.method === "GET" && url.pathname === "/operator") return response(runtime.snapshot(), 200, origin ?? undefined);
      if (request.method === "GET" && url.pathname === "/decisions") {
        if (!options.decisionStore || !options.decisionOwnerId) return response({ rows: [], nextBefore: null }, 200, origin ?? undefined);
        const limitValue = url.searchParams.get("limit");
        const before = url.searchParams.get("before") ?? undefined;
        for (const key of url.searchParams.keys()) {
          if (key !== "limit" && key !== "before") return response({ error: "Unsupported query parameter" }, 400, origin ?? undefined);
        }
        return response(await options.decisionStore.list(options.decisionOwnerId, {
          limit: limitValue === null ? undefined : Number(limitValue),
          before,
        }), 200, origin ?? undefined);
      }
      if (request.method !== "POST" || !MUTATION_PATHS[url.pathname]) return response({ error: "Not found" }, 404, origin ?? undefined);
      if (origin !== allowedOrigin) return response({ error: "Origin is required for operator mutations" }, 403);
      const body = await jsonBody(request);

      if (url.pathname === "/settings") {
        assertOnly(body, ["settings", "apiKey", "clearedEndpoints"]);
        if (!("settings" in body)) throw new Error("settings is required");
        if (activeOperation) throw new Error(`Wait for the pending ${activeOperation} operation or stop it before changing settings`);
        const generation = ++operationGeneration;
        activeOperation = "settings";
        try {
          await runtime.apply(body.settings, body.apiKey, () => {
            if (generation !== operationGeneration) throw new Error("Settings apply was cancelled");
          }, body.clearedEndpoints);
          return response(runtime.snapshot(), 200, allowedOrigin);
        } finally {
          if (generation === operationGeneration && activeOperation === "settings") activeOperation = null;
        }
      }
      if (url.pathname === "/validate") {
        assertOnly(body, ["settings", "apiKey"]);
        const status = options.lifecycle.snapshot().status;
        if (status !== "off" && status !== "expired") throw new Error("Stop trading before validating a connection");
        if (activeOperation) throw new Error(`Wait for the pending ${activeOperation} operation before validating`);
        const candidate = body.settings === undefined ? runtime.settings() : validateSettings(body.settings);
        const apiKey = body.apiKey === undefined
          ? runtime.credentialFor(candidate)
          : body.apiKey === ""
            ? undefined
            : validateApiKey(body.apiKey as string);
        const generation = ++operationGeneration;
        activeOperation = "validate";
        try {
          const result = await checkConnection(candidate, apiKey);
          if (generation !== operationGeneration) throw new Error("Validation was cancelled");
          runtime.setConnection(result, apiKey);
          const safeResult = runtime.snapshot().connection;
          if (!safeResult) throw new Error("Connection validation produced no result");
          return response(safeResult, safeResult.ok ? 200 : 422, allowedOrigin);
        } finally {
          if (generation === operationGeneration && activeOperation === "validate") activeOperation = null;
        }
      }
      if (url.pathname === "/start") {
        assertOnly(body, ["confirmReal"]);
        const current = runtime.settings();
        if (current.enabledCoins.length === 0) throw new Error("Enable at least one asset before starting");
        const status = options.lifecycle.snapshot().status;
        if (status !== "off" && status !== "expired") return response(options.lifecycle.snapshot(), 200, allowedOrigin);
        if (current.mode === "real" && body.confirmReal !== true) throw new Error("Real trading requires confirmReal: true");
        if (activeOperation === "start" && startAttempt) return response(await startAttempt, 200, allowedOrigin);
        if (activeOperation) throw new Error(`Wait for the pending ${activeOperation} operation before starting`);

        const generation = ++operationGeneration;
        activeOperation = "start";
        const attempt = (async (): Promise<RunSnapshot> => {
          const connection = await checkConnection(current, runtime.credentialFor(current));
          if (generation !== operationGeneration) throw new Error("Start was cancelled");
          runtime.setConnection(connection);
          if (!connection.ok) throw new Error(`Connection preflight failed: ${connection.message}`);
          if (current.mode === "real" && !connection.realAllowed) throw new Error(`Real trading is unavailable: ${connection.message}`);
          return options.lifecycle.start();
        })();
        startAttempt = attempt;
        try {
          return response(await attempt, 200, allowedOrigin);
        } finally {
          if (startAttempt === attempt) startAttempt = null;
          if (generation === operationGeneration && activeOperation === "start") activeOperation = null;
        }
      }
      if (url.pathname === "/stop") {
        assertOnly(body, []);
        if (activeOperation === "start" || activeOperation === "validate") {
          operationGeneration++;
          activeOperation = null;
          startAttempt = null;
        }
        return response(await options.lifecycle.stop("operator"), 200, allowedOrigin);
      }
      assertOnly(body, []);
      if (activeOperation) throw new Error(`Wait for the pending ${activeOperation} operation before reconciling`);
      const reconcileGeneration = ++operationGeneration;
      activeOperation = "reconcile";
      try {
        return response(await options.lifecycle.reconcile(), 200, allowedOrigin);
      } finally {
        if (reconcileGeneration === operationGeneration && activeOperation === "reconcile") activeOperation = null;
      }
    } catch (error) {
      const message = safeMessage(error, [runtime.credential()]);
      const conflict = /Stop trading|unless off|unless expired|pending|cancelled/i.test(message);
      return response({ error: message }, conflict ? 409 : 400, origin === allowedOrigin ? allowedOrigin : undefined);
    }
  };

  return {
    runtime,
    fetch,
    listen() {
      if (server) return server;
      server = Bun.serve({
        hostname: "127.0.0.1",
        port,
        fetch(request, bunServer) {
          return fetch(request, bunServer.requestIP(request)?.address);
        },
      });
      return server;
    },
    close() {
      server?.stop(true);
      server = null;
    },
  };
}
