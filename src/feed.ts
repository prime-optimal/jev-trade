import { config } from "./config";
import type { Book } from "./legacy-types";
import { fillDir, type ClearinghouseLike, type FillPnlLike } from "./account";
import { bookFromLevels } from "./book";
import { CHART_INTERVAL, VenueChart } from "./chart";
import { infoPost, safeTransportMessage } from "./hyperliquid";
import { parseAssetCtx, type AssetCtx } from "./indicators";
import { sameCoin } from "./sleeves";
import { TradeFeed } from "./trades";

export function shouldRunHttpFallback(readyState: number | null): boolean {
  return readyState !== WebSocket.OPEN;
}

/**
 * Local Hyperliquid book + tape over the official WS, with an HTTP snapshot so startup
 * does not wait on the socket. Ticks fire at `tickMs` once a book exists.
 */
export class Feed {
  readonly trades = new TradeFeed();
  readonly chart = new VenueChart();
  assetCtx: AssetCtx | null = null;
  book: Book | null = null;
  tick = 0;
  onGone: ((oid: number) => void) | null = null;
  onClearinghouse: ((state: ClearinghouseLike) => void) | null = null;
  onUserPnl: ((fill: FillPnlLike) => void) | null = null;
  private lastTickAt = 0;
  private lastPriceAt = 0;
  private lastPriceMid = Number.NaN;
  private onTick: ((tick: number) => void) | null = null;
  onPrice: ((book: Book) => void) | null = null;
  private user: `0x${string}` | null = null;
  private ws: WebSocket | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private suspended = false;
  private generation = 0;
  private seenTids = new Set<number>();
  private fallbackRunning = false;

  constructor(readonly coin: string) {}

  async connect(): Promise<void> {
    if (this.closed) throw new Error(`${this.coin} feed is closed`);
    const generation = ++this.generation;
    this.suspended = false;
    await this.snapshot(generation);
    if (!this.isCurrent(generation)) return;
    await this.chart.loadCandles(this.coin, Date.now(), () => this.isCurrent(generation)).catch((e) => {
      console.warn(`${this.coin} candles: ${safeTransportMessage(e).slice(0, 160)}`);
    });
    if (!this.isCurrent(generation)) return;
    this.pollAssetCtx(generation).catch(() => {});
    this.openSocket(0, generation);
    this.tickTimer = setInterval(() => { if (this.isCurrent(generation)) this.maybeTick(); }, config.tickMs);
    this.fallbackTimer = setInterval(() => { if (this.isCurrent(generation)) this.runHttpFallback(generation); }, config.hyperliquid.fallbackMs);
    this.pollTrades(generation).catch(() => {});
  }

  watchUser(user: `0x${string}`) {
    this.user = user;
    this.subscribeUser();
  }

  start(onTick: (tick: number) => void) {
    this.onTick = onTick;
    this.maybePrice();
    this.maybeTick();
  }

  stop() {
    this.onTick = null;
  }

  suspend() {
    this.suspended = true;
    this.generation++;
    this.stop();
    clearInterval(this.tickTimer ?? undefined);
    clearInterval(this.fallbackTimer ?? undefined);
    clearTimeout(this.reconnectTimer ?? undefined);
    clearInterval(this.ping ?? undefined);
    this.tickTimer = null;
    this.fallbackTimer = null;
    this.reconnectTimer = null;
    this.ping = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.close();
    }
  }

  close() {
    this.closed = true;
    this.suspend();
  }

  private isCurrent(generation: number) {
    return generation === this.generation && !this.closed && !this.suspended;
  }

  private async snapshot(generation = this.generation) {
    const res = await infoPost({ type: "l2Book", coin: this.coin });
    if (!res.ok) throw new Error(`hl l2Book HTTP ${res.status}`);
    const data = (await res.json()) as { levels?: [{ px: string; sz: string }[], { px: string; sz: string }[]] };
    if (!this.isCurrent(generation) || !data.levels) return;
    const next = bookFromLevels(this.tick, data.levels[0] ?? [], data.levels[1] ?? []);
    if (next) this.book = next;
  }

  private openSocket(delay = 0, generation = this.generation) {
    if (!this.isCurrent(generation)) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isCurrent(generation)) return;
      const ws = new WebSocket(config.hyperliquid.wsUrl);
      this.ws = ws;
      ws.onopen = () => {
        if (!this.isCurrent(generation) || this.ws !== ws) { ws.close(); return; }
        this.send({ method: "subscribe", subscription: { type: "l2Book", coin: this.coin, fast: true } });
        this.send({ method: "subscribe", subscription: { type: "trades", coin: this.coin } });
        this.send({ method: "subscribe", subscription: { type: "candle", coin: this.coin, interval: CHART_INTERVAL } });
        this.send({ method: "subscribe", subscription: { type: "activeAssetCtx", coin: this.coin } });
        this.subscribeUser();
        clearInterval(this.ping ?? undefined);
        this.ping = setInterval(() => { if (this.isCurrent(generation)) this.send({ method: "ping" }); }, 20_000);
      };
      ws.onmessage = (e) => {
        if (this.isCurrent(generation) && this.ws === ws) this.onMessage(String(e.data));
      };
      ws.onclose = () => {
        if (!this.isCurrent(generation) || this.ws !== ws) return;
        clearInterval(this.ping ?? undefined);
        this.ping = null;
        this.ws = null;
        this.openSocket(Math.min(delay + 500, 8_000), generation);
      };
      ws.onerror = () => {
        if (this.isCurrent(generation) && this.ws === ws) ws.close();
      };
    }, delay);
  }

  private subscribeUser() {
    if (!this.user || this.ws?.readyState !== WebSocket.OPEN) return;
    this.send({ method: "subscribe", subscription: { type: "userFills", user: this.user } });
    this.send({ method: "subscribe", subscription: { type: "orderUpdates", user: this.user } });
    this.send({ method: "subscribe", subscription: { type: "clearinghouseState", user: this.user } });
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private onMessage(raw: string) {
    let m: { channel?: string; data?: any };
    try { m = JSON.parse(raw); } catch { return; }
    if (m.channel === "l2Book" && m.data?.levels) {
      const next = bookFromLevels(this.tick, m.data.levels[0] ?? [], m.data.levels[1] ?? []);
      if (next) {
        this.book = next;
        this.maybePrice();
        this.maybeTick();
      }
      return;
    }
    if (m.channel === "trades") {
      const prints = Array.isArray(m.data) ? m.data : m.data ? [m.data] : [];
      for (const t of prints) this.ingestPrint(t);
      return;
    }
    if (m.channel === "candle") {
      const rows = Array.isArray(m.data) ? m.data : m.data ? [m.data] : [];
      for (const c of rows) this.chart.upsertCandle(c);
      return;
    }
    if (m.channel === "activeAssetCtx" && m.data) {
      const coin = m.data.coin ?? m.data.ctx?.coin;
      if (coin && !sameCoin(coin, this.coin)) return;
      this.assetCtx = parseAssetCtx(m.data.ctx ?? m.data);
      return;
    }
    if (m.channel === "userFills" && m.data) {
      for (const f of m.data.fills ?? []) {
        if (!sameCoin(f.coin, this.coin)) continue;
        this.onUserPnl?.(f);
        if (m.data.isSnapshot) continue;
        this.trades.pushFill({
          block: this.tick,
          txHash: f.hash,
          orderId: f.oid,
          price: Number(f.px),
          size: Number(f.sz),
          updatedSize: -1,
          side: f.side === "B" ? "buy" : "sell",
          feeUsd: Number(f.fee) || 0,
          closedPnl: Number.isFinite(Number(f.closedPnl)) ? Number(f.closedPnl) : undefined,
          dir: fillDir(f.dir),
        });
      }
      return;
    }
    if (m.channel === "clearinghouseState" && m.data) {
      const state = m.data.clearinghouseState ?? m.data;
      if (state?.assetPositions || state?.marginSummary) this.onClearinghouse?.(state);
      return;
    }
    if (m.channel === "orderUpdates" && Array.isArray(m.data)) {
      for (const u of m.data) {
        if (!sameCoin(u.order?.coin, this.coin)) continue;
        if (u.status === "filled" || u.status === "canceled" || u.status === "rejected") this.onGone?.(u.order.oid);
      }
    }
  }

  private async pollAssetCtx(generation = this.generation) {
    const res = await infoPost({ type: "metaAndAssetCtxs" });
    if (!res.ok) return;
    const pair = (await res.json()) as [{ universe?: { name?: string }[] }, unknown[]];
    if (!this.isCurrent(generation) || !Array.isArray(pair) || pair.length < 2) return;
    const uni = pair[0]?.universe;
    const ctxs = pair[1];
    if (!Array.isArray(uni) || !Array.isArray(ctxs)) return;
    const i = uni.findIndex((u) => u.name === this.coin);
    if (i >= 0) this.assetCtx = parseAssetCtx(ctxs[i]);
  }

  private async pollTrades(generation = this.generation) {
    const res = await infoPost({ type: "recentTrades", coin: this.coin });
    if (!res.ok) return;
    const prints = (await res.json()) as { px: string; sz: string; side: string; tid?: number }[];
    if (!this.isCurrent(generation) || !Array.isArray(prints)) return;
    for (const t of prints) this.ingestPrint(t);
  }

  private async runHttpFallback(generation = this.generation) {
    if (!this.isCurrent(generation) || !shouldRunHttpFallback(this.ws?.readyState ?? null) || this.fallbackRunning) return;
    this.fallbackRunning = true;
    try {
      await Promise.allSettled([this.snapshot(generation), this.pollTrades(generation), this.pollAssetCtx(generation)]);
    } finally {
      this.fallbackRunning = false;
    }
  }

  private ingestPrint(t: { px?: string; sz?: string; side?: string; tid?: number }) {
    const tid = t.tid;
    if (tid != null) {
      if (this.seenTids.has(tid)) return;
      this.seenTids.add(tid);
      if (this.seenTids.size > 4000) {
        const first = this.seenTids.values().next().value;
        if (first != null) this.seenTids.delete(first);
      }
    }
    this.trades.pushPrint({
      price: Number(t.px),
      size: Number(t.sz),
      side: t.side === "B" ? "buy" : "sell",
    });
  }

  private maybePrice() {
    if (!this.book) return;
    const now = Date.now();
    this.chart.addMid(this.book.mid, now);
    if (!this.onPrice) return;
    if (now - this.lastPriceAt < config.priceMs) return;
    if (this.book.mid === this.lastPriceMid) return;
    this.lastPriceAt = now;
    this.lastPriceMid = this.book.mid;
    this.onPrice(this.book);
  }

  private maybeTick() {
    if (!this.book || !this.onTick) return;
    const now = Date.now();
    if (now - this.lastTickAt < config.tickMs) return;
    this.lastTickAt = now;
    this.tick++;
    this.trades.setTick(this.tick);
    this.book = { ...this.book, block: this.tick };
    this.onTick(this.tick);
  }
}
