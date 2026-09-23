import type { JevRequest, JevResponse, ModelDecision, TradeState } from "../bot-types";
import type { PublicFeed, ReadyBook } from "./feed";
import { requireMarket, requireLeverage, type MarketMetadata } from "./market";
import type { TradingNetwork } from "./networks";

/** Copy only the inference contract, never serialize a session or account object. */
export function addressFreeRequest(network: TradingNetwork, state: TradeState): JevRequest {
  const pick = <T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> => {
    const result = {} as Pick<T, K>;
    for (const key of keys) result[key] = value[key];
    return result;
  };
  const copy: TradeState = {
    ...pick(state, ["coin", "market", "tick", "tickMs", "mid", "spreadBps", "bookImbalance", "recentMids", "maxLeverage"]),
    depth: Object.fromEntries(Object.entries(state.depth).map(([band, depth]) => [band, pick(depth, ["bid", "ask"])])),
    book: { bids: [...state.book.bids], asks: [...state.book.asks] },
    returnsBps: pick(state.returnsBps, ["last1", "last5", "last20", "last100"]),
    trades: pick(state.trades, ["count", "buySz", "sellSz", "cvdSz", "vwap", "lastPrice", "lastSide"]),
    recentTrades: [...state.recentTrades],
    position: pick(state.position, ["coin", "side", "size", "notionalUsd", "entry", "leverage", "liquidationPx", "distanceBps", "unrealizedUsd"]),
    indicators: pick(state.indicators, ["sma20", "sma50", "ema20", "midVsSma20Bps", "midVsSma50Bps", "rsi14", "vol20Bps", "high20", "low20", "rangePos20"]),
    asset: pick(state.asset, ["markPx", "oraclePx", "fundingBps", "premiumBps", "openInterest", "dayNtlVlmUsd", "dayChangeBps", "maxLeverage"]),
  };
  const request = { network, state: copy };
  if (/0x[0-9a-f]{40}/i.test(JSON.stringify(request))) throw new Error("Account identifiers cannot be sent to inference");
  return request;
}

export function normalizeDecision(response: JevResponse, tick: number, market: MarketMetadata): ModelDecision | null {
  const decision = response?.decision;
  if (response?.tick !== tick || !decision || !["buy", "sell", "hold"].includes(decision.action)
    || !["open", "close", "hold"].includes(decision.intent) || !["long", "short"].includes(decision.bias)) {
    throw new Error("Invalid Jev decision");
  }
  if (decision.action === "hold" || decision.intent === "hold") {
    if (decision.action !== "hold" || decision.intent !== "hold") throw new Error("Inconsistent Jev hold");
    return null;
  }
  requireLeverage(market, decision.leverage);
  const action = decision.intent === "open"
    ? decision.bias === "long" ? "buy" : "sell"
    : decision.bias === "long" ? "sell" : "buy";
  if (decision.action !== action) throw new Error("Inconsistent Jev action");
  return { ...decision, action };
}

export interface DecisionSchedulerOptions {
  network: TradingNetwork;
  markets: readonly MarketMetadata[];
  feeds: ReadonlyMap<string, PublicFeed>;
  tickMs: number;
  deadlineMs: number;
  sleepMs: number;
  now?: () => number;
  visible?: () => boolean;
  online?: () => boolean;
  buildState: (coin: string, book: ReadyBook, tick: number) => TradeState;
  request: (request: JevRequest, signal: AbortSignal) => Promise<JevResponse>;
  onDecision: (coin: string, decision: ModelDecision | null, book: ReadyBook, tick: number) => void | Promise<void>;
  onPause: (reason: string) => void;
  onError: (coin: string, error: Error) => void;
}

/** The session explicitly refreshes feeds and restarts after every pause. */
export class DecisionScheduler {
  private timer: number | undefined;
  private generation = 0;
  private tick = 0;
  private lastAt = 0;
  private running = false;
  private pending = new Map<string, AbortController>();
  private detach: (() => void) | null = null;
  constructor(private readonly options: DecisionSchedulerOptions) {
    for (const value of [options.tickMs, options.deadlineMs, options.sleepMs]) {
      if (!Number.isFinite(value) || value <= 0) throw new Error("Finite scheduler deadlines are required");
    }
    if (options.deadlineMs >= options.tickMs) throw new Error("Inference deadline must be shorter than the tick interval");
  }
  private environment(): string | null {
    if (!(this.options.visible?.() ?? (typeof document === "undefined" || document.visibilityState === "visible"))) return "hidden";
    if (!(this.options.online?.() ?? (typeof navigator === "undefined" || navigator.onLine))) return "offline";
    return null;
  }
  start(): void {
    if (this.running) throw new Error("Scheduler already running");
    const reason = this.environment();
    if (reason) throw new Error(`Cannot start while ${reason}`);
    const now = (this.options.now ?? Date.now)();
    for (const market of this.options.markets) {
      if (!market.enabled) continue;
      requireMarket(this.options.markets, market.coin);
      if (!this.options.feeds.get(market.coin)?.ready(now)) throw new Error(`Fresh book required: ${market.coin}`);
    }
    this.running = true;
    this.generation++;
    this.lastAt = now;
    if (typeof window !== "undefined") {
      const guard = () => { const reason = this.environment(); if (reason) this.pause(reason); };
      window.addEventListener("offline", guard);
      document.addEventListener("visibilitychange", guard);
      this.detach = () => { window.removeEventListener("offline", guard); document.removeEventListener("visibilitychange", guard); };
    }
    this.timer = globalThis.setInterval(() => this.scheduledTick(), this.options.tickMs) as unknown as number;
  }
  scheduledTick(): void {
    if (!this.running) return;
    const now = (this.options.now ?? Date.now)();
    const reason = this.environment();
    if (reason) { this.pause(reason); return; }
    if (now < this.lastAt || now - this.lastAt > this.options.tickMs + this.options.sleepMs) { this.pause("sleep"); return; }
    if (now - this.lastAt < this.options.tickMs) return;
    const ready: { market: MarketMetadata; book: ReadyBook }[] = [];
    for (const market of this.options.markets) {
      if (!market.enabled) continue;
      const book = this.options.feeds.get(market.coin)?.ready(now);
      if (!book) { this.pause("stale-book"); return; }
      if (this.pending.has(market.coin)) { this.pause("decision-overlap"); return; }
      ready.push({ market, book });
    }
    this.lastAt = now;
    const tick = ++this.tick;
    const generation = this.generation;
    for (const { market, book } of ready) void this.decide(market, book, tick, generation);
  }
  private async decide(market: MarketMetadata, book: ReadyBook, tick: number, generation: number): Promise<void> {
    const controller = new AbortController();
    this.pending.set(market.coin, controller);
    let deadline: number | undefined;
    try {
      const state = this.options.buildState(market.coin, book, tick);
      if (state.coin !== market.coin || state.tick !== tick) throw new Error("Inference state does not match scheduled tick");
      const request = addressFreeRequest(this.options.network, state);
      const response = await Promise.race([
        this.options.request(request, controller.signal),
        new Promise<never>((_, reject) => {
          deadline = globalThis.setTimeout(() => { controller.abort(); reject(new Error("Jev request deadline exceeded")); }, this.options.deadlineMs) as unknown as number;
        }),
      ]);
      if (!this.running || generation !== this.generation) return;
      const now = (this.options.now ?? Date.now)();
      const reason = this.environment();
      if (reason || now - this.lastAt > this.options.tickMs + this.options.sleepMs
        || !this.options.feeds.get(market.coin)?.ready(now)
        || now - book.receivedAt > this.options.tickMs) { this.pause(reason ?? "stale-decision"); return; }
      const decision = normalizeDecision(response, tick, market);
      await this.options.onDecision(market.coin, decision, book, tick);
    } catch {
      if (this.running && generation === this.generation) this.options.onError(market.coin, new Error("Jev decision failed or exceeded its deadline"));
    } finally {
      clearTimeout(deadline);
      if (this.pending.get(market.coin) === controller) this.pending.delete(market.coin);
    }
  }
  pause(reason: string): void {
    if (!this.running) return;
    this.stop();
    this.options.onPause(reason);
  }
  stop(): void {
    this.running = false;
    this.generation++;
    clearInterval(this.timer);
    this.timer = undefined;
    this.detach?.();
    this.detach = null;
    for (const controller of this.pending.values()) controller.abort();
    this.pending.clear();
  }
}

export function createJevRequester(url: string, request: typeof fetch = fetch) {
  return async (input: JevRequest, signal: AbortSignal): Promise<JevResponse> => {
    const response = await request(url, {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "omit",
      body: JSON.stringify(addressFreeRequest(input.network, input.state)), signal,
    });
    if (!response.ok) throw new Error(`Jev request failed: ${response.status}`);
    return await response.json() as JevResponse;
  };
}
