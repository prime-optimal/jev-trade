import { expect, test, vi } from "bun:test";
import { Feed } from "../src/feed";

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly sent: string[] = [];
  readyState = FakeSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_url: string) {}
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = FakeSocket.CLOSED; }
}

test("suspend invalidates in-flight setup and late socket callbacks", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const { promise: snapshot, resolve: resolveSnapshot } = Promise.withResolvers<Response>();

  try {
    vi.useFakeTimers();
    globalThis.fetch = (() => snapshot) as unknown as typeof fetch;
    const deferred = new Feed("BTC");
    const connecting = deferred.connect();
    deferred.suspend();
    resolveSnapshot(Response.json({ levels: [[], []] }));
    await connecting;
    const deferredState = deferred as unknown as {
      tickTimer: unknown; fallbackTimer: unknown; reconnectTimer: unknown; ws: unknown;
    };
    expect(deferredState.tickTimer).toBeNull();
    expect(deferredState.fallbackTimer).toBeNull();
    expect(deferredState.reconnectTimer).toBeNull();
    expect(deferredState.ws).toBeNull();

    const sockets: FakeSocket[] = [];
    globalThis.WebSocket = class extends FakeSocket {
      constructor(url: string) { super(url); sockets.push(this); }
    } as unknown as typeof WebSocket;
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { type?: string };
      if (body.type === "l2Book") return Response.json({ levels: [[], []] });
      if (body.type === "candleSnapshot") return Response.json([]);
      if (body.type === "metaAndAssetCtxs") return Response.json([{}, []]);
      return Response.json([]);
    }) as typeof fetch;

    const connected = new Feed("BTC");
    await connected.connect();
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    expect(sockets).toHaveLength(1);
    const lateOpen = sockets[0]!.onopen;
    connected.suspend();
    lateOpen?.();
    const connectedState = connected as unknown as { ping: unknown };
    expect(connectedState.ping).toBeNull();
    expect(sockets[0]!.sent).toHaveLength(0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    vi.useRealTimers();
  }
});
