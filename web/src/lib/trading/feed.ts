import { NETWORK_ENDPOINTS, deriveWebSocketUrl, type TradingNetwork } from "./networks";
import type { TradingSettings } from "./settings";
import type { Book } from "./types";
import { bookFromLevels } from "./book";

export interface VenueMessage { channel: string; data: unknown }
export interface HyperliquidTransport {
  readonly network: TradingNetwork;
  info(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  subscribe(subscription: Record<string, unknown>, listener: (message: VenueMessage) => void): () => void;
  onDisconnect(listener: () => void): () => void;
  close(): void;
}

/** A session owns this transport. Public feeds and the single account watch share it. */
export function createHyperliquidTransport(
  settings: Pick<TradingSettings, "network" | "hyperliquidApiUrl" | "hyperliquidWsUrl">,
  options: { fetch?: typeof fetch; socket?: (url: string) => WebSocket; deadlineMs?: number } = {},
): HyperliquidTransport {
  const apiUrl = settings.hyperliquidApiUrl ?? NETWORK_ENDPOINTS[settings.network].apiUrl;
  const wsUrl = settings.hyperliquidWsUrl ?? (settings.hyperliquidApiUrl
    ? deriveWebSocketUrl(apiUrl) : NETWORK_ENDPOINTS[settings.network].wsUrl);
  const request = options.fetch ?? fetch;
  const deadlineMs = options.deadlineMs ?? 10_000;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw new Error("A finite transport deadline is required");
  const subscriptions = new Map<string, { subscription: Record<string, unknown>; listeners: Set<(message: VenueMessage) => void> }>();
  const disconnected = new Set<() => void>();
  const pending = new Set<AbortController>();
  let socket: WebSocket | null = null;
  let ping: ReturnType<typeof setInterval> | undefined;
  let opening: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const send = (method: string, subscription: Record<string, unknown>) => {
    if (socket?.readyState === 1) socket.send(JSON.stringify({ method, subscription }));
  };
  const connect = () => {
    if (closed || socket) return;
    const ws = (options.socket ?? ((url) => new WebSocket(url)))(wsUrl);
    socket = ws;
    const fail = () => {
      if (socket !== ws) return;
      socket = null;
      clearInterval(ping);
      clearTimeout(opening);
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.onopen = null;
      ws.close();
      for (const listener of disconnected) listener();
    };
    opening = setTimeout(fail, deadlineMs);
    ws.onopen = () => {
      if (socket !== ws || closed) return;
      clearTimeout(opening);
      for (const { subscription } of subscriptions.values()) send("subscribe", subscription);
      ping = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ method: "ping" })); }, 20_000);
    };
    ws.onmessage = (event) => {
      if (socket !== ws || closed) return;
      let message: VenueMessage;
      try { message = JSON.parse(String(event.data)) as VenueMessage; } catch { return; }
      for (const { subscription, listeners } of subscriptions.values()) {
        if (message.channel !== subscription.type) continue;
        const data = message.data as { coin?: string; s?: string; user?: string } | null;
        let routed = message;
        if (subscription.coin) {
          if (Array.isArray(message.data)) {
            const rows = message.data.filter((row: { coin?: string; s?: string }) => (row.coin ?? row.s) === subscription.coin);
            if (rows.length === 0) continue;
            routed = { channel: message.channel, data: rows };
          } else if ((data?.coin ?? data?.s) !== subscription.coin) continue;
        }
        if (subscription.user && data?.user && data.user.toLowerCase() !== String(subscription.user).toLowerCase()) continue;
        for (const listener of listeners) listener(routed);
      }
    };
    ws.onclose = fail;
    ws.onerror = fail;
  };
  return {
    network: settings.network,
    async info(body, signal) {
      if (closed) throw new Error("Transport is closed");
      const controller = new AbortController();
      pending.add(controller);
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      const timer = setTimeout(abort, deadlineMs);
      try {
        const response = await request(`${apiUrl}/info`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(body), signal: controller.signal, credentials: "omit",
        });
        if (!response.ok) throw new Error(`Hyperliquid request failed: ${response.status}`);
        return await response.json();
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        pending.delete(controller);
      }
    },
    subscribe(subscription, listener) {
      if (closed) throw new Error("Transport is closed");
      const key = JSON.stringify(subscription);
      let entry = subscriptions.get(key);
      if (!entry) {
        entry = { subscription: { ...subscription }, listeners: new Set() };
        subscriptions.set(key, entry);
        send("subscribe", entry.subscription);
      }
      entry.listeners.add(listener);
      connect();
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) {
          subscriptions.delete(key);
          send("unsubscribe", entry.subscription);
        }
      };
    },
    onDisconnect(listener) { disconnected.add(listener); return () => { disconnected.delete(listener); }; },
    close() {
      closed = true;
      for (const controller of pending) controller.abort();
      clearInterval(ping);
      clearTimeout(opening);
      if (socket) { socket.onclose = null; socket.onerror = null; socket.onmessage = null; socket.onopen = null; socket.close(); }
      socket = null;
      subscriptions.clear();
      disconnected.clear();
    },
  };
}

export interface ReadyBook { book: Book; receivedAt: number; venueAt: number }

/** No account subscription, signing, or decision timer belongs to a public feed. */
export class PublicFeed {
  private latest: ReadyBook | null = null;
  private generation = 0;
  private stop: (() => void)[] = [];
  private refreshAbort: AbortController | null = null;
  constructor(
    readonly coin: string,
    private readonly transport: HyperliquidTransport,
    private readonly options: {
      staleMs: number;
      now?: () => number;
      onBook?: (book: ReadyBook) => void;
      onMessage?: (message: VenueMessage) => void;
      onUnavailable?: () => void;
    },
  ) {
    if (!Number.isFinite(options.staleMs) || options.staleMs <= 0) throw new Error("A finite book freshness window is required");
  }
  ready(now = (this.options.now ?? Date.now)()): ReadyBook | null {
    const latest = this.latest;
    return latest && now >= latest.receivedAt && now - latest.receivedAt <= this.options.staleMs
      && now - latest.venueAt <= this.options.staleMs && latest.venueAt <= now + 1_000 ? latest : null;
  }
  private ingest(value: unknown): void {
    const data = value as { coin?: string; time?: number; levels?: [{ px: string; sz: string }[], { px: string; sz: string }[]] } | null;
    if (data?.coin !== this.coin || !Number.isFinite(data.time) || !Array.isArray(data.levels) || data.levels.length !== 2) return;
    const venueAt = data.time!;
    if (this.latest && venueAt < this.latest.venueAt) return;
    const book = bookFromLevels(0, data.levels[0], data.levels[1]);
    if (!book) return;
    this.latest = { book, receivedAt: (this.options.now ?? Date.now)(), venueAt };
    if (this.ready()) this.options.onBook?.(this.latest);
  }
  async refresh(): Promise<void> {
    this.suspend();
    const generation = this.generation;
    const abort = new AbortController();
    this.refreshAbort = abort;
    const snapshot = await this.transport.info({ type: "l2Book", coin: this.coin }, abort.signal);
    if (generation !== this.generation) return;
    this.ingest(snapshot);
    if (!this.ready()) throw new Error(`Fresh book unavailable: ${this.coin}`);
    this.stop.push(this.transport.onDisconnect(() => {
      this.latest = null;
      this.options.onUnavailable?.();
    }));
    for (const type of ["l2Book", "trades", "activeAssetCtx", "candle"]) {
      const subscription: Record<string, unknown> = { type, coin: this.coin };
      if (type === "candle") subscription.interval = "1m";
      this.stop.push(this.transport.subscribe(subscription, (message) => {
        if (generation !== this.generation) return;
        if (message.channel === "l2Book") this.ingest(message.data);
        this.options.onMessage?.(message);
      }));
    }
  }
  suspend(): void {
    this.generation++;
    this.refreshAbort?.abort();
    this.refreshAbort = null;
    for (const stop of this.stop) stop();
    this.stop = [];
    this.latest = null;
  }
  close(): void { this.suspend(); }
}
