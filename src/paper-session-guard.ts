import type { OperatorControl } from "./operator-control";
import { DEFAULT_SETTINGS } from "./settings";

const OPERATOR_PATHS: Record<string, true> = {
  "/operator": true,
  "/settings": true,
  "/validate": true,
  "/start": true,
  "/stop": true,
  "/reconcile": true,
};

function error(message: string, status = 400): Response {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

function assertPaperSettings(input: unknown): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("settings must be an object");
  const settings = input as Record<string, unknown>;
  if (settings.mode !== "paper") throw new Error("Visitor sessions support paper trading only");
  if (typeof settings.tickMs !== "number" || settings.tickMs < 30_000) throw new Error("Visitor tickMs must be at least 30000");
  if (settings.hyperliquidApiUrl !== null || settings.hyperliquidWsUrl !== null || settings.rpcUrl !== null) {
    throw new Error("Custom transport URLs are unavailable in visitor sessions");
  }
  if (settings.hyperliquidApiKeyHeader !== DEFAULT_SETTINGS.hyperliquidApiKeyHeader
    || settings.hyperliquidApiKeyScheme !== DEFAULT_SETTINGS.hyperliquidApiKeyScheme) {
    throw new Error("Custom transport credentials are unavailable in visitor sessions");
  }
}

async function withPaperOnly(response: Response): Promise<Response> {
  const body = await response.json() as Record<string, unknown>;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return Response.json({ ...body, paperOnly: true }, { status: response.status, headers });
}

/** Restricts a loopback visitor listener before requests reach the shared operator implementation. */
export function createPaperOperatorFetch(operator: OperatorControl) {
  return async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url);
    if (!OPERATOR_PATHS[url.pathname]) return undefined;
    if (url.pathname === "/operator") {
      if (request.method !== "GET") return error("Not found", 404);
    } else if (request.method !== "POST") {
      return error("Not found", 404);
    }

    let body: string | undefined;
    if (request.method === "POST") {
      body = await request.text();
      let parsed: Record<string, unknown>;
      try {
        const value = JSON.parse(body) as unknown;
        if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
        parsed = value as Record<string, unknown>;
      } catch {
        return error("Request body must be valid JSON");
      }
      try {
        if (Object.hasOwn(parsed, "apiKey") || Object.hasOwn(parsed, "credentials") || Object.hasOwn(parsed, "clearedEndpoints")) {
          throw new Error("Credentials and endpoint overrides are unavailable in visitor sessions");
        }
        if (url.pathname === "/settings") assertPaperSettings(parsed.settings);
        if (url.pathname === "/validate" && parsed.settings !== undefined) assertPaperSettings(parsed.settings);
        if (url.pathname === "/start" && parsed.confirmReal === true) throw new Error("Visitor sessions support paper trading only");
      } catch (guardError) {
        return error(guardError instanceof Error ? guardError.message : "Unsafe visitor settings");
      }
    }

    const headers = new Headers();
    headers.set("host", "127.0.0.1:3002");
    headers.set("origin", "http://localhost:3001");
    if (body !== undefined) headers.set("content-type", "application/json");
    const internal = new Request(`http://127.0.0.1:3002${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body,
    });
    const response = await operator.fetch(internal, "127.0.0.1");
    if (url.pathname === "/operator" || url.pathname === "/settings") return withPaperOnly(response);
    return response;
  };
}
