const COOKIE_NAME = "jev-paper-session";
const OWNER_COOKIE_NAME = "jev-paper-owner";
const COOKIE_PATH = "/api/session";
const MAX_BODY_BYTES = 64 * 1024;
const SESSION_MAX_AGE_SECONDS = 10 * 60;
const OWNER_TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60;

const ROUTES: Readonly<Record<string, readonly string[]>> = {
  operator: ["GET"],
  settings: ["POST"],
  validate: ["POST"],
  start: ["POST"],
  stop: ["POST"],
  reconcile: ["POST"],
  run: ["GET"],
  snapshot: ["GET"],
  history: ["GET"],
  tape: ["GET"],
  events: ["GET"],
  decisions: ["GET"],
};

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export function backendBaseUrl(): URL {
  const configured = process.env.BOT_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!configured) throw new Error("BOT_API_URL or NEXT_PUBLIC_API_URL must be configured for visitor sessions.");

  let url: URL;
  try {
    if (configured.includes("://") && !/^https?:\/\//.test(configured)) throw new Error();
    url = new URL(/^https?:\/\//.test(configured) ? configured : `https://${configured}`);
  } catch {
    throw new Error("The visitor session bot URL is invalid.");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username
    || url.password
    || (url.pathname !== "/" && url.pathname !== "")
    || url.search
    || url.hash
  ) {
    throw new Error("The visitor session bot URL must be an HTTP(S) host without credentials, path, query, or fragment.");
  }
  url.pathname = "/";
  return url;
}

function backendUrl(path: string): URL {
  return new URL(path.replace(/^\/+/, ""), backendBaseUrl());
}

export function isSameOriginMutation(request: Request): boolean {
  const originHeader = request.headers.get("Origin");
  if (!originHeader) return false;
  try {
    const origin = new URL(originHeader).origin;
    const requestUrl = new URL(request.url);
    const host = request.headers.get("Host");
    if (!host) return origin === requestUrl.origin;
    if (!/^[A-Za-z0-9.:[\]-]+$/.test(host)) return false;

    const forwardedProto = request.headers.get("X-Forwarded-Proto");
    if (forwardedProto !== null && forwardedProto !== "http" && forwardedProto !== "https") return false;
    const protocol = forwardedProto ?? requestUrl.protocol.slice(0, -1);
    if (protocol !== "http" && protocol !== "https") return false;
    return origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

export function readSessionCookie(request: Request): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== COOKIE_NAME) continue;
    try {
      const token = decodeURIComponent(rawValue.join("="));
      return token.length > 0 && token.length <= 512 && !/[\s\x00-\x1f\x7f]/.test(token) ? token : null;
    } catch {
      return null;
    }
  }
  return null;
}
export function readOwnerCookie(request: Request): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== OWNER_COOKIE_NAME) continue;
    try {
      const token = decodeURIComponent(rawValue.join("="));
      return token.length > 0 && token.length <= 1024 && !/[\s\x00-\x1f\x7f]/.test(token) ? token : null;
    } catch {
      return null;
    }
  }
  return null;
}


export function sessionCookie(token: string | null): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const value = token ? encodeURIComponent(token) : "";
  const lifetime = token ? `; Max-Age=${SESSION_MAX_AGE_SECONDS}` : "; Max-Age=0";
  return `${COOKIE_NAME}=${value}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Strict${secure}${lifetime}`;
}
export function ownerCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${OWNER_COOKIE_NAME}=${encodeURIComponent(token)}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Strict${secure}; Max-Age=${OWNER_TOKEN_LIFETIME_SECONDS}`;
}


function authorizedHeaders(token: string, contentType?: string): Headers {
  const headers = new Headers();
  headers.set("Author" + "ization", `Bearer ${token}`);
  if (contentType) headers.set("Content-Type", contentType);
  return headers;
}

async function boundedJsonBody(request: Request): Promise<Uint8Array | Response> {
  const contentType = request.headers.get("Content-Type");
  if (contentType?.toLowerCase() !== "application/json") return jsonError(415, "Content-Type must be application/json.");
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return jsonError(413, "Request body exceeds 64 KiB.");
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        return jsonError(413, "Request body exceeds 64 KiB.");
      }
      chunks.push(value);
    }
  } catch {
    return jsonError(400, "Could not read request body.");
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    JSON.parse(new TextDecoder().decode(body));
  } catch {
    return jsonError(400, "Request body must contain valid JSON.");
  }
  return body;
}

function expiredResponse(): Response {
  const response = jsonError(410, "Visitor session expired. Reconnect to continue.");
  response.headers.append("Set-Cookie", sessionCookie(null));
  return response;
}

function safeSnapshot(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const snapshot: Record<string, unknown> = { ...(value as Record<string, unknown>), paperOnly: true };
  for (const key of ["token", "capability", "apiKey", "privateKey", "secret"]) delete snapshot[key];
  return snapshot;
}

async function operatorSnapshot(token: string, signal: AbortSignal): Promise<Response> {
  const response = await fetch(backendUrl("sessions/operator"), {
    headers: authorizedHeaders(token),
    cache: "no-store",
    signal,
  });
  if (!response.ok) return response;
  const value = await response.json().catch(() => null);
  if (!value || typeof value !== "object") return jsonError(502, "The trading service returned an invalid session snapshot.");
  return Response.json(safeSnapshot(value), { headers: { "Cache-Control": "no-store" } });
}

export async function bootstrapSession(request: Request): Promise<Response> {
  if (!isSameOriginMutation(request)) return jsonError(403, "This request must originate from this site.");

  const existing = readSessionCookie(request);
  if (existing) {
    const resumed = await operatorSnapshot(existing, request.signal);
    if (resumed.status !== 410) {
      if (resumed.ok) resumed.headers.append("Set-Cookie", sessionCookie(existing));
      return resumed;
    }
  }

  const durableOwner = readOwnerCookie(request);
  const created = await fetch(backendUrl("sessions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(durableOwner ? { ownerToken: durableOwner } : {}),
    cache: "no-store",
    signal: request.signal,
  });
  if (!created.ok) return new Response(created.body, { status: created.status, headers: { "Content-Type": created.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-store" } });
  const payload = await created.json().catch(() => null) as { token?: unknown; ownerToken?: unknown } | null;
  const token = typeof payload?.token === "string" ? payload.token : "";
  const returnedOwner = typeof payload?.ownerToken === "string" ? payload.ownerToken : "";
  if (!token || token.length > 512 || /[\s\x00-\x1f\x7f]/.test(token) || returnedOwner.length > 1024 || /[\s\x00-\x1f\x7f]/.test(returnedOwner)) {
    return jsonError(502, "The trading service returned an invalid session capability.");
  }

  const snapshot = await operatorSnapshot(token, request.signal);
  if (!snapshot.ok) {
    void fetch(backendUrl("sessions"), { method: "DELETE", headers: authorizedHeaders(token) }).catch(() => undefined);
    return snapshot.status === 410 ? expiredResponse() : snapshot;
  }
  snapshot.headers.append("Set-Cookie", sessionCookie(token));
  if (returnedOwner) snapshot.headers.append("Set-Cookie", ownerCookie(returnedOwner));
  return snapshot;
}

export async function closeSession(request: Request): Promise<Response> {
  if (!isSameOriginMutation(request)) return jsonError(403, "This request must originate from this site.");
  const token = readSessionCookie(request);
  if (token) {
    const upstream = await fetch(backendUrl("sessions"), { method: "DELETE", headers: authorizedHeaders(token), cache: "no-store", signal: request.signal });
    if (!upstream.ok && upstream.status !== 410) {
      return new Response(upstream.body, { status: upstream.status, headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-store" } });
    }
  }
  const response = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  response.headers.append("Set-Cookie", sessionCookie(null));
  return response;
}

function streamingBody(upstream: Response): ReadableStream<Uint8Array> | null {
  if (!upstream.body) return null;
  const reader = upstream.body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export async function proxySession(request: Request, path: readonly string[]): Promise<Response> {
  if (path.length !== 1 || !Object.hasOwn(ROUTES, path[0]!)) return jsonError(404, "Unknown visitor session route.");
  const route = path[0]!;
  const allowed = ROUTES[route]!;
  if (!allowed.includes(request.method)) return jsonError(405, "Method is not allowed for this visitor session route.");
  if (request.method !== "GET" && !isSameOriginMutation(request)) return jsonError(403, "This request must originate from this site.");
  const token = readSessionCookie(request);
  if (!token) return jsonError(401, "Visitor session is not connected.");

  const sourceUrl = new URL(request.url);
  let suffix = "";
  if (route === "events") {
    for (const key of sourceUrl.searchParams.keys()) if (key !== "lite") return jsonError(400, "Unsupported query parameter.");
    const lite = sourceUrl.searchParams.get("lite");
    if (lite !== null && lite !== "1") return jsonError(400, "The events lite flag must be 1.");
    if (lite !== null) suffix = "?lite=1";
  } else if (route === "decisions") {
    for (const key of sourceUrl.searchParams.keys()) if (key !== "limit" && key !== "before") return jsonError(400, "Unsupported query parameter.");
    suffix = sourceUrl.search;
  } else if (sourceUrl.search) {
    return jsonError(400, "Query parameters are not supported for this route.");
  }

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET") {
    const parsed = await boundedJsonBody(request);
    if (parsed instanceof Response) return parsed;
    body = parsed.buffer.slice(parsed.byteOffset, parsed.byteOffset + parsed.byteLength) as ArrayBuffer;
  }
  const upstream = await fetch(backendUrl(`sessions/${route}${suffix}`), {
    method: request.method,
    headers: authorizedHeaders(token, body ? "application/json" : undefined),
    body,
    cache: "no-store",
    signal: request.signal,
  });
  if (upstream.status === 410) return expiredResponse();

  const headers = new Headers({ "Cache-Control": "no-store, no-cache, must-revalidate, no-transform" });
  const contentType = upstream.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  if (route === "events") {
    headers.set("X-Accel-Buffering", "no");
  }
  const response = new Response(route === "events" ? streamingBody(upstream) : upstream.body, { status: upstream.status, headers });
  response.headers.append("Set-Cookie", sessionCookie(token));
  return response;
}
