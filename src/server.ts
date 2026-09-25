import { config } from "./config";
import type { LogBuffer, LogRecord } from "./log-buffer";
import { clipHistory, clipSnapshotTape, clipTape, TAPE_MIDS } from "./snapshot";
import type { RunSnapshot } from "./settings";
import type { BlockEvent, Fill, Meta, PricePoint, Quote, SleeveMeta } from "./types";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
const SNAP_MS = 400;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

function jsonMaybeGzip(req: Request, body: unknown, status = 200) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const accept = req.headers.get("accept-encoding") ?? "";
  if (accept.includes("gzip")) {
    return new Response(Bun.gzipSync(raw), {
      status,
      headers: {
        ...CORS,
        "content-type": "application/json",
        "content-encoding": "gzip",
        vary: "accept-encoding",
        "cache-control": "no-store",
      },
    });
  }
  return new Response(raw, {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });
}

export type SleeveView = { coin: string; history: () => BlockEvent[]; tape: () => PricePoint[] };

export interface PublicServer {
  readonly port: number;
  broadcast(e: BlockEvent): void;
  broadcastQuote(coin: string, block: number, quote: Quote): void;
  broadcastFill(coin: string, block: number, fill: Fill, ts?: number): void;
  broadcastRun(run: RunSnapshot): void;
  broadcastSleeve(sleeve: SleeveMeta): void;
  broadcastPrice(coin: string, print: { ts: number; mid: number; bestBid: number; bestAsk: number; spreadBps: number }): void;
  close(): void;
}

export interface PublicServerOptions {
  port?: number;
  hostname?: string;
  fetch?: (request: Request) => Response | undefined | Promise<Response | undefined>;
  /** Loopback-only console log stream. Only the visitor worker server passes one; the shared public server never serves /logs. */
  logs?: LogBuffer;
  logPingMs?: number;
}

/** Public read-only market data and authoritative run status. */
export function startServer(
  meta: Meta,
  sleeves: SleeveView[],
  runSnapshot: () => RunSnapshot,
  options: PublicServerOptions = {},
): PublicServer {
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const enc = new TextEncoder();
  const send = (c: ReadableStreamDefaultController<Uint8Array>, type: string, data: unknown) => {
    try { c.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { clients.delete(c); }
  };
  const ping = setInterval(() => clients.forEach((c) => send(c, "ping", Date.now())), 15_000);
  const publicMeta = () => {
    const { model: _operatorModel, ...visible } = meta;
    return visible;
  };

  const historyByCoin = () => {
    const out: Record<string, BlockEvent[]> = {};
    for (const s of sleeves) out[s.coin] = s.history();
    return out;
  };
  const tapeByCoin = () => {
    const out: Record<string, PricePoint[]> = {};
    for (const s of sleeves) out[s.coin] = clipTape(s.tape(), TAPE_MIDS);
    return out;
  };
  const snapshotBody = () => {
    const history: Record<string, BlockEvent[]> = {};
    const tape: Record<string, PricePoint[]> = {};
    for (const s of sleeves) {
      history[s.coin] = clipHistory(s.history());
      tape[s.coin] = clipSnapshotTape(s.tape());
    }
    return { ...publicMeta(), historyByCoin: history, tapeByCoin: tape };
  };
  const latestByCoin = () => {
    const out: Record<string, BlockEvent | null> = {};
    for (const s of sleeves) out[s.coin] = s.history().at(-1) ?? null;
    return out;
  };

  type SnapCache = { at: number; json: string; event: Uint8Array };
  let snapCache: SnapCache | null = null;
  const snap = (): SnapCache => {
    const now = Date.now();
    if (snapCache && now - snapCache.at < SNAP_MS) return snapCache;
    const body = JSON.stringify(snapshotBody());
    snapCache = { at: now, json: body, event: enc.encode(`event: snapshot\ndata: ${body}\n\n`) };
    return snapCache;
  };

  const listener = Bun.serve({
    port: options.port ?? config.port,
    hostname: options.hostname,
    idleTimeout: 0,
    async fetch(req) {
      const hooked = await options.fetch?.(req);
      if (hooked) return hooked;
      const url = new URL(req.url);
      const { pathname } = url;
      if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
      if (pathname === "/") return json({ ...publicMeta(), latestByCoin: latestByCoin() });
      if (pathname === "/snapshot") return jsonMaybeGzip(req, snap().json);
      if (pathname === "/history") return jsonMaybeGzip(req, historyByCoin());
      if (pathname === "/tape") return jsonMaybeGzip(req, tapeByCoin());
      if (pathname === "/run" && req.method === "GET") return json(runSnapshot());
      if (pathname === "/logs" && req.method === "GET" && options.logs) {
        const logs = options.logs;
        const lastEventId = Number(req.headers.get("last-event-id"));
        const afterSeq = Number.isSafeInteger(lastEventId) ? lastEventId : 0;
        const frame = (record: LogRecord) => enc.encode(`id: ${record.seq}\ndata: ${JSON.stringify(record)}\n\n`);
        let unsubscribe: (() => void) | null = null;
        let pingTimer: Timer | null = null;
        let closed = false;
        const cleanup = () => {
          if (closed) return;
          closed = true;
          unsubscribe?.();
          unsubscribe = null;
          clearInterval(pingTimer ?? undefined);
          pingTimer = null;
        };
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            unsubscribe = logs.subscribe((record) => {
              try { controller.enqueue(frame(record)); } catch { cleanup(); }
            });
            for (const record of logs.replay(afterSeq)) {
              try { controller.enqueue(frame(record)); } catch { cleanup(); return; }
            }
            pingTimer = setInterval(() => {
              try { controller.enqueue(enc.encode(": ping\n\n")); } catch { cleanup(); }
            }, options.logPingMs ?? 15_000);
            pingTimer.unref?.();
          },
          cancel() { cleanup(); },
        });
        return new Response(stream, { headers: { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
      }
      if (pathname === "/events") {
        const lite = url.searchParams.get("lite") === "1";
        let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
            clients.add(c);
            if (lite) send(c, "ready", meta.startedAt);
            else {
              try { c.enqueue(snap().event); } catch { clients.delete(c); }
            }
          },
          cancel() {
            if (controller) clients.delete(controller);
            controller = null;
          },
        });
        return new Response(stream, { headers: { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
      }
      return json({ error: "not found" }, 404);
    },
  });
  const port = listener.port;
  if (typeof port !== "number") {
    clearInterval(ping);
    listener.stop(true);
    throw new Error("Public server did not bind a TCP port");
  }


  const broadcast = (type: string, data: unknown) => clients.forEach((c) => send(c, type, data));
  return {
    port,
    broadcast: (e: BlockEvent) => broadcast("block", e),
    broadcastQuote: (coin: string, block: number, quote: Quote) => broadcast("quote", { coin, block, quote }),
    broadcastFill: (coin: string, block: number, fill: Fill, ts?: number) => broadcast("fill", { coin, block, fill, ts }),
    broadcastRun: (run: RunSnapshot) => broadcast("run", run),
    broadcastSleeve: (sleeve: SleeveMeta) => {
      snapCache = null;
      broadcast("sleeve", { type: "sleeve", sleeve });
    },
    broadcastPrice: (coin: string, print: { ts: number; mid: number; bestBid: number; bestAsk: number; spreadBps: number }) =>
      broadcast("price", { coin, ...print }),
    close() {
      clearInterval(ping);
      for (const client of clients) {
        try { client.close(); } catch {}
      }
      clients.clear();
      listener.stop(true);
    },
  };
}
