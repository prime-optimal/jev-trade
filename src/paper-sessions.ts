const DEFAULT_CAPACITY = 8;
const DEFAULT_IDLE_MS = 10 * 60_000;
const DEFAULT_READY_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_STREAMS = 2;
const MAX_BODY_BYTES = 64 * 1024;
const CREATE_BURST = 8;
const CREATE_PER_MINUTE = 16;
const START_COOLDOWN_MS = 30_000;

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
};

const MODEL_ENV = [
  "MODEL",
  "JEV_PROVIDER",
  "JEV_MODEL_ID",
  "OPENROUTER_API_KEY",
  "TYPESAFE_API_KEY",
  "AI_GATEWAY_API_KEY",
] as const;

interface WorkerMessage {
  type?: unknown;
  port?: unknown;
  message?: unknown;
}

interface SessionWorker {
  postMessage(value: unknown): void;
  terminate(): void | Promise<number>;
  addEventListener(type: "message" | "error", listener: EventListener): void;
  removeEventListener(type: "message" | "error", listener: EventListener): void;
}

interface Session {
  token: string;
  worker: SessionWorker;
  port: number;
  touchedAt: number;
  streams: number;
  lastStartAt?: number;
  closed: boolean;
}

export interface PaperSessions {
  fetch(request: Request): Promise<Response | undefined>;
  close(): void;
}
type ProxyFetch = (input: URL, init: RequestInit) => Promise<Response>;


export interface PaperSessionsOptions {
  capacity?: number;
  idleMs?: number;
  readyTimeoutMs?: number;
  maxStreams?: number;
  env?: Record<string, string | undefined>;
  now?: () => number;
  randomToken?: () => string;
  workerFactory?: (url: string, options: { env: Record<string, string> }) => SessionWorker;
  proxyFetch?: ProxyFetch;
  sweepIntervalMs?: number;
}

function json(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extraHeaders },
  });
}

function capability(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function paperSessionEnv(source: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of MODEL_ENV) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function bearer(request: Request): string | undefined {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return undefined;
  const token = value.slice(7);
  return token && !/\s/.test(token) ? token : undefined;
}

async function boundedBody(request: Request): Promise<Uint8Array | undefined> {
  if (!request.body) return undefined;
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error("large");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function controlledRequestHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of ["accept", "content-type"] as const) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function controlledResponseHeaders(response: Response, stream: boolean): Headers {
  const headers = new Headers();
  const contentType = response.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("cache-control", stream ? "no-cache" : "no-store");
  if (stream) headers.set("x-accel-buffering", "no");
  return headers;
}

export function createPaperSessions(options: PaperSessionsOptions = {}): PaperSessions {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const maxStreams = options.maxStreams ?? DEFAULT_MAX_STREAMS;
  const now = options.now ?? Date.now;
  const randomToken = options.randomToken ?? capability;
  const proxyFetch: ProxyFetch = options.proxyFetch ?? fetch;
  const workerFactory = options.workerFactory ?? ((url, init) => new Worker(url, init) as unknown as SessionWorker);
  const sessions = new Map<string, Session>();
  const starting = new Set<SessionWorker>();
  const cancelReadiness = new Map<SessionWorker, () => void>();
  let reserved = 0;
  let closed = false;
  let createTokens = CREATE_BURST;
  let createRefilledAt = now();
  const takeCreateToken = () => {
    const at = now();
    const elapsed = Math.max(0, at - createRefilledAt);
    createTokens = Math.min(CREATE_BURST, createTokens + elapsed * CREATE_PER_MINUTE / 60_000);
    createRefilledAt = at;
    if (createTokens < 1) {
      const retrySeconds = Math.max(1, Math.ceil((1 - createTokens) * 60 / CREATE_PER_MINUTE));
      return json(
        { error: "Paper sessions are being created too quickly" },
        429,
        { "retry-after": String(retrySeconds) },
      );
    }
    createTokens--;
  };

  const disposeWorker = (worker: SessionWorker, graceful = true) => {
    try { worker.postMessage({ type: "close" }); } catch {}
    const terminate = () => {
      try { void worker.terminate(); } catch {}
    };
    if (!graceful) return terminate();
    const fallback = setTimeout(terminate, 1_000);
    fallback.unref?.();
  };

  const dispose = (session: Session) => {
    if (session.closed) return;
    session.closed = true;
    sessions.delete(session.token);
    disposeWorker(session.worker);
  };

  const expire = () => {
    const cutoff = now() - idleMs;
    for (const session of sessions.values()) if (session.touchedAt <= cutoff) dispose(session);
  };

  const interval = setInterval(expire, options.sweepIntervalMs ?? Math.min(30_000, idleMs));
  interval.unref?.();

  const awaitReady = (worker: SessionWorker): Promise<number> => {
    const { promise, resolve, reject } = Promise.withResolvers<number>();
    let settled = false;
    let timeout: Timer;
    const finish = (error?: Error, port?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cancelReadiness.delete(worker);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      if (error) reject(error);
      else resolve(port!);
    };
    const onMessage: EventListener = (event) => {
      if (!(event instanceof MessageEvent)) return;
      const message = event.data as WorkerMessage;
      if (message?.type === "ready" && Number.isInteger(message.port) && Number(message.port) > 0 && Number(message.port) <= 65535) {
        finish(undefined, Number(message.port));
      } else if (message?.type === "error") {
        finish(new Error("Paper session failed to start"));
      }
    };
    const onError: EventListener = () => finish(new Error("Paper session failed to start"));
    timeout = setTimeout(() => finish(new Error("Paper session startup timed out")), readyTimeoutMs);
    cancelReadiness.set(worker, () => finish(new Error("Paper sessions are unavailable")));
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    return promise;
  };

  const create = async (request: Request): Promise<Response> => {
    expire();
    if (closed) return json({ error: "Paper sessions are unavailable" }, 503);
    const rateLimited = takeCreateToken();
    if (rateLimited) return rateLimited;
    try {
      await boundedBody(request);
    } catch {
      return json({ error: "Request body is too large" }, 413);
    }
    if (sessions.size + reserved >= capacity) return json({ error: "Paper session capacity reached" }, 503);
    reserved++;
    let worker: SessionWorker | undefined;
    try {
      const safeEnv = paperSessionEnv(options.env ?? process.env);
      worker = workerFactory(new URL("./paper-session-worker.ts", import.meta.url).href, {
        env: { JEV_VISITOR_ENV: JSON.stringify(safeEnv) },
      });
      starting.add(worker);
      const port = await awaitReady(worker);
      starting.delete(worker);
      if (closed) throw new Error("Paper sessions are unavailable");
      let token = randomToken();
      while (!token || sessions.has(token)) token = randomToken();
      const session: Session = { token, worker, port, touchedAt: now(), streams: 0, closed: false };
      sessions.set(token, session);
      const onWorkerError: EventListener = () => dispose(session);
      const onWorkerMessage: EventListener = (event) => {
        if (event instanceof MessageEvent && (event.data as WorkerMessage)?.type === "error") dispose(session);
      };
      worker.addEventListener("error", onWorkerError);
      worker.addEventListener("message", onWorkerMessage);
      return json({ token }, 201);
    } catch (error) {
      if (worker) {
        starting.delete(worker);
        cancelReadiness.delete(worker);
        disposeWorker(worker, false);
      }
      const message = error instanceof Error && error.message === "Paper session startup timed out"
        ? error.message
        : "Paper session failed to start";
      return json({ error: message }, 503);
    } finally {
      reserved--;
    }
  };

  const proxy = async (request: Request, session: Session, route: string): Promise<Response> => {
    const isStream = route === "events";
    if (isStream) {
      if (session.streams >= maxStreams) return json({ error: "Too many session streams" }, 429);
      session.streams++;
    }
    let body: Uint8Array | undefined;
    try {
      body = await boundedBody(request);
    } catch {
      if (isStream) session.streams--;
      return json({ error: "Request body is too large" }, 413);
    }
    session.touchedAt = now();
    try {
      const incoming = new URL(request.url);
      const upstream = new URL(`http://127.0.0.1:${session.port}/${route}`);
      upstream.search = incoming.search;
      const response = await proxyFetch(upstream, {
        method: request.method,
        headers: controlledRequestHeaders(request),
        body,
        redirect: "manual",
        signal: request.signal,
      });
      const headers = controlledResponseHeaders(response, isStream);
      if (!isStream || !response.body) {
        if (isStream) session.streams--;
        return new Response(response.body, { status: response.status, headers });
      }
      const reader = response.body.getReader();
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        session.streams--;
      };
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              release();
              controller.close();
            } else controller.enqueue(chunk.value);
          } catch (error) {
            release();
            controller.error(error);
          }
        },
        async cancel(reason) {
          release();
          await reader.cancel(reason);
        },
      });
      return new Response(stream, { status: response.status, headers });
    } catch {
      if (isStream) session.streams--;
      if (!request.signal.aborted) dispose(session);
      return json({ error: request.signal.aborted ? "Request cancelled" : "Paper session is unavailable" }, 502);
    }
  };

  return {
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/sessions" || url.pathname.startsWith("/sessions/")) expire();
      if (url.pathname === "/sessions") {
        if (request.method === "POST") return create(request);
        const token = bearer(request);
        if (!token) return json({ error: "Bearer capability required" }, 401);
        const session = sessions.get(token);
        if (!session || session.closed) return json({ error: "Paper session expired" }, 410);
        if (request.method !== "DELETE") return json({ error: "Method not allowed" }, 405);
        try {
          await boundedBody(request);
        } catch {
          return json({ error: "Request body is too large" }, 413);
        }
        dispose(session);
        return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      }
      if (!url.pathname.startsWith("/sessions/")) return undefined;
      const route = url.pathname.slice("/sessions/".length);
      const methods = ROUTES[route];
      if (!methods || route.includes("/")) return json({ error: "Not found" }, 404);
      if (!methods.includes(request.method)) return json({ error: "Method not allowed" }, 405);
      const token = bearer(request);
      if (!token) return json({ error: "Bearer capability required" }, 401);
      const session = sessions.get(token);
      if (!session || session.closed) return json({ error: "Paper session expired" }, 410);
      if (route === "start") {
        const at = now();
        const elapsed = session.lastStartAt === undefined ? START_COOLDOWN_MS : at - session.lastStartAt;
        if (elapsed < START_COOLDOWN_MS) {
          return json(
            { error: "Wait before starting this paper session again" },
            429,
            { "retry-after": String(Math.max(1, Math.ceil((START_COOLDOWN_MS - elapsed) / 1_000))) },
          );
        }
        session.lastStartAt = at;
      }
      return proxy(request, session, route);
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(interval);
      for (const cancel of cancelReadiness.values()) cancel();
      cancelReadiness.clear();
      for (const session of [...sessions.values()]) dispose(session);
      for (const worker of starting) disposeWorker(worker);
      starting.clear();
    },
  };
}
