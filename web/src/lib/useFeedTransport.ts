"use client";

import { createFeedStore, marketEvent, type FeedResult } from "./useFeed";
import { requestJev } from "./jev";
import { createHyperliquidTransport, PublicFeed, type HyperliquidTransport } from "./trading/feed";
import { loadMarkets, requireReadyMarkets, type MarketMetadata } from "./trading/market";
import { createBrowserSession, type BrowserSession, type SessionSnapshot } from "./trading/session";
import { createAccountSubscriber, type BrowserAccountSnapshot } from "./trading/account";
import { createOwnerLocks } from "./trading/locks";
import { DecisionScheduler } from "./trading/trader";
import { parseAssetCtx, snapshotIndicators, venueFeatures, type AssetCtx } from "./trading/indicators";
import { TradeFeed } from "./trading/trades";
import { quotePrice, takerPrice } from "./trading/book";
import { DEFAULT_SETTINGS, SUPPORTED_COINS, effectiveEndpoints, validateSettings, type TradingSettings, type RunSnapshot, type ConnectionValidation } from "./trading/settings";
import { discoverWallets, createWalletAdapter, type WalletAdapter, type WalletSnapshot } from "./wallet/provider";
import { createAgentSession, prepareNetworkFromClick, type AgentMetadata } from "./wallet/agent";
import type { DirectExchange, OrderEvidence } from "./trading/exchange";
import type { Cloid } from "./trading/journal";

export interface BrowserTradingSnapshot {
  run: RunSnapshot; feed: FeedResult; wallet: WalletSnapshot; authorization: AgentMetadata | null;
  session: SessionSnapshot | null; account: BrowserAccountSnapshot | null; fills: unknown[]; orders: unknown[];
}
export interface BrowserTradingAdapter {
  getSnapshot(): BrowserTradingSnapshot;
  subscribe(listener: () => void): () => void;
  applySettings(settings: TradingSettings, apiKey?: string): Promise<void>;
  validateConnection(settings: TradingSettings, apiKey?: string): Promise<ConnectionValidation>;
  connect(): Promise<void>; disconnect(): Promise<void>; prepareNetwork(): Promise<void>; authorize(replace?: boolean): Promise<void>;
  start(settings: TradingSettings, confirmReal: boolean): Promise<void>; stop(): Promise<void>; reconcile(): Promise<void>;
  dispose(): Promise<void>;
}
export const EMPTY_TRADING_SNAPSHOT: BrowserTradingSnapshot = {
  run: { runId: null, status: "off", startedAt: null, deadlineAt: null, stoppedAt: null, durationMs: 0, stopReason: null, serverNow: 0 },
  feed: { meta: null, connection: "connecting", byCoin: {} },
  wallet: { owner: null, chainId: null, epoch: 0, connected: false }, authorization: null,
  session: null, account: null, fills: [], orders: [],
};

/** Created in the root provider's client effect, never by a route or render. */
export function createBrowserTradingAdapter(): BrowserTradingAdapter {
  const feed = createFeedStore();
  const listeners = new Set<() => void>();
  let snapshot = EMPTY_TRADING_SNAPSHOT;
  let settings = { ...DEFAULT_SETTINGS, enabledCoins: [...DEFAULT_SETTINGS.enabledCoins] };
  let transport: HyperliquidTransport | null = null;
  let markets: MarketMetadata[] = [];
  const feeds = new Map<string, PublicFeed>();
  const trades = new Map<string, TradeFeed>();
  const contexts = new Map<string, AssetCtx>();
  const pending = new Map<string, { id: string; buy: boolean; price: number; remaining: number; tick: number }>();
  let wallet: WalletAdapter | null = null;
  let agent: ReturnType<typeof createAgentSession> | null = null;
  let session: BrowserSession | null = null;
  let scheduler: DecisionScheduler | null = null;
  let accountStop: (() => void) | null = null;
  let accountListeners = new Set<(account: BrowserAccountSnapshot) => void>();
  let generation = 0;
  let disposed = false;
  let busy = false;
  let attention: string | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let lastWakeAt = Date.now();
  const discovery = discoverWallets(window as Window & { navigator: Navigator & { brave?: unknown } });
  const publish = (patch: Partial<BrowserTradingSnapshot> = {}) => {
    snapshot = { ...snapshot, ...patch, feed: feed.getSnapshot(), wallet: wallet?.snapshot() ?? EMPTY_TRADING_SNAPSHOT.wallet, authorization: agent?.metadata() ?? null };
    for (const listener of listeners) listener();
  };
  const syncSession = () => {
    const current = session?.snapshot() ?? null;
    if (current?.status !== "running") scheduler?.stop();
    publish({ session: current, run: { ...snapshot.run, status: attention ? "attention-required" : current?.status ?? "off", deadlineAt: current?.deadlineAt ?? null,
      stopReason: attention ?? current?.reason ?? null, serverNow: Date.now(), stoppedAt: current?.status === "off" ? Date.now() : null } });
  };
  feed.subscribe(() => publish());
  const stop = async () => {
    attention = null;
    scheduler?.stop(); scheduler = null;
    await session?.stop();
    pending.clear();
    if (!session || session.snapshot().status === "off") { agent?.endSession(); agent = null; }
    syncSession();
  };
  const fail = (reason: string) => {
    attention = reason;
    scheduler?.stop();
    void session?.stop(reason).then(syncSession).catch(() => syncSession());
    publish({ run: { ...snapshot.run, status: "attention-required", stopReason: reason } });
  };
  const subscribeAccount = async () => {
    accountStop?.(); accountStop = null;
    const owner = wallet?.snapshot().owner;
    if (!owner || !transport) { publish({ account: null, fills: [], orders: [] }); return; }
    const captured = generation;
    const unsubscribe = await createAccountSubscriber(transport, {
      onError: error => fail(error.message),
      onFills: data => {
        if (captured === generation && data && typeof data === "object" && "fills" in data && Array.isArray(data.fills)) {
          publish({ fills: [...snapshot.fills, ...data.fills].slice(-1000) });
        }
      },
      onOrders: data => { if (captured === generation && Array.isArray(data)) publish({ orders: data }); },
    })(owner, account => {
      if (captured !== generation || wallet?.snapshot().owner !== owner) return;
      publish({ account });
      for (const listener of accountListeners) listener(account);
    });
    if (captured !== generation || wallet?.snapshot().owner !== owner) unsubscribe(); else accountStop = unsubscribe;
  };
  const refresh = async () => {
    const captured = ++generation;
    clearTimeout(retry);
    accountStop?.(); accountStop = null;
    for (const item of feeds.values()) item.close();
    feeds.clear(); trades.clear(); contexts.clear();
    transport?.close();
    transport = createHyperliquidTransport(settings);
    const currentTransport = transport;
    feed.connection("connecting");
    try {
      const loaded = await loadMarkets(currentTransport, settings.enabledCoins);
      if (disposed || captured !== generation) return;
      markets = loaded;
      const shown = loaded.filter(market => SUPPORTED_COINS.some(coin => coin === market.coin));
      feed.metadata({ model: "Jev", dryRun: settings.mode === "paper", market: "Hyperliquid", startedAt: Date.now(), venue: "hyperliquid", coin: "BTC", pair: "BTC-USD", explorerTx: "https://hypurrscan.io/tx/", tickMs: settings.tickMs,
        sleeves: shown.map(market => ({ coin: market.coin, pair: `${market.coin}-USD`, label: market.coin, status: "starting", error: null, retryAt: null })) });
      for (const market of shown) {
        trades.set(market.coin, new TradeFeed());
        const item = new PublicFeed(market.coin, currentTransport, {
          staleMs: settings.fallbackMs,
          onBook: ready => {
            if (captured !== generation) return;
            const prior = feed.getSnapshot().byCoin[market.coin]?.latest;
            const event = marketEvent(market.coin, ready.book, ready.receivedAt);
            feed.event(prior ? { ...prior, ts: event.ts, mid: event.mid, bestBid: event.bestBid, bestAsk: event.bestAsk, spreadBps: event.spreadBps } : event, false);
          },
          onUnavailable: () => { if (captured === generation) reconnect(); },
          onMessage: ({ channel, data }) => {
            if (captured !== generation) return;
            if (channel === "activeAssetCtx") contexts.set(market.coin, parseAssetCtx((data as { ctx?: unknown })?.ctx));
            if (channel !== "trades" || !Array.isArray(data)) return;
            for (const row of data as { px: string; sz: string; side: string }[]) {
              const price = Number(row.px), size = Number(row.sz), side = row.side === "B" ? "buy" : "sell";
              trades.get(market.coin)?.pushPrint({ price, size, side });
              const order = pending.get(market.coin);
              if (settings.mode !== "paper" || !order || session?.snapshot().status !== "running" || !Number.isFinite(price) || !Number.isFinite(size) || size <= 0) continue;
              if (order.buy ? side !== "sell" || price > order.price : side !== "buy" || price < order.price) continue;
              const filled = Math.min(size, order.remaining);
              session.paperFill(order.id, filled, order.price);
              order.remaining -= filled;
              if (order.remaining <= 1e-9) pending.delete(market.coin);
              const prior = feed.getSnapshot().byCoin[market.coin]?.latest;
              if (prior) feed.event({ ...prior, block: order.tick, fill: { side: order.buy ? "buy" : "sell", size: filled, price: order.price, txHash: null, orderId: Number(order.id.replace("paper-", "")), simulated: true } });
            }
          },
        });
        feeds.set(market.coin, item);
      }
      await Promise.all([...feeds.values()].map(item => item.refresh()));
      if (captured !== generation || disposed) return;
      feed.connection("live");
      await subscribeAccount();
    } catch {
      if (captured === generation && !disposed) reconnect();
    }
  };
  const reconnect = () => {
    if (disposed) return;
    scheduler?.stop();
    if (session?.snapshot().status === "running") fail("Market connection lost. Turn On explicitly after reconnecting.");
    feed.connection("reconnecting");
    clearTimeout(retry);
    retry = setTimeout(() => { if (navigator.onLine && document.visibilityState === "visible") void refresh(); else reconnect(); }, 2000);
  };
  const guard = () => {
    const now = Date.now();
    const active = session?.snapshot().status === "running";
    const observedAt = Math.min(...[...feeds.values()].filter(item => settings.enabledCoins.some(coin => coin === item.coin)).map(item => item.ready()?.receivedAt ?? 0));
    if (active) session?.guard({ visible: document.visibilityState === "visible", online: navigator.onLine, observedAt, lastWakeAt });
    lastWakeAt = now;
  };
  const timer = setInterval(guard, 1000);
  window.addEventListener("offline", guard);
  document.addEventListener("visibilitychange", guard);
  const lookup = async (cloid: Cloid): Promise<OrderEvidence | null> => {
    const result = await transport!.info({ type: "orderStatus", user: wallet!.snapshot().owner, oid: cloid }) as { status: string; order?: { status: string; order: { oid: number; cloid?: string } } };
    const order = result.order;
    if (!order || order.order.cloid !== cloid) return null;
    const state = order.status === "open" ? "open" : order.status === "filled" ? "filled" : order.status.toLowerCase().includes("cancel") ? "canceled" : order.status.toLowerCase().includes("reject") ? "rejected" : null;
    return state ? { cloid, state, oid: order.order.oid } : null;
  };
  const exchange: DirectExchange = {
    async updateLeverage(input) { await agent!.updateLeverage(input); },
    async place(order) {
      const input = { orders: [{ a: order.asset, b: order.buy, p: order.price, s: order.size, r: order.reduceOnly, t: { limit: { tif: order.tif } }, c: order.cloid }], grouping: "na" as const, expiresAfter: order.expiresAfter };
      const result = await agent!.order(input);
      const status = result.response.data.statuses[0];
      if (status && typeof status === "object" && "resting" in status) return { cloid: order.cloid, state: "open", oid: status.resting.oid };
      if (status && typeof status === "object" && "filled" in status) return { cloid: order.cloid, state: "filled", oid: status.filled.oid };
      if (status && typeof status === "object" && "error" in status) return { cloid: order.cloid, state: "rejected" };
      throw new Error("Unknown order acknowledgement");
    },
    async cancel(order) {
      const evidence = await lookup(order.cloid);
      if (!evidence) throw new Error("Order needs reconciliation");
      if (evidence.state === "open" && evidence.oid !== undefined) {
        const input = { cancels: [{ a: order.asset, o: evidence.oid }], expiresAfter: order.expiresAfter };
        await agent!.cancel(input);
      }
    }, lookup,
  };
  const adapter: BrowserTradingAdapter = {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async applySettings(next, key) {
      if (key) throw new Error("Authenticated endpoint overrides are not supported by the direct wallet transport.");
      if (session && session.snapshot().status !== "off") throw new Error("Stop the session before changing settings.");
      agent?.endSession(); agent = null; session = null;
      settings = validateSettings(next); feed.reset(); syncSession();
      await refresh();
    },
    async validateConnection(next, key) {
      if (key) throw new Error("Authenticated endpoint overrides are not supported by the direct wallet transport.");
      const valid = validateSettings(next), endpoints = effectiveEndpoints(valid);
      const probe = createHyperliquidTransport(valid);
      try { const metadata = await loadMarkets(probe, valid.enabledCoins); requireReadyMarkets(metadata, valid);
        return { ...endpoints, ok: true, realAllowed: !valid.hyperliquidApiUrl && !valid.hyperliquidWsUrl && !valid.rpcUrl, message: "Direct Hyperliquid metadata is available. On also requires fresh books.", checkedAt: Date.now() };
      } finally { probe.close(); }
    },
    async connect() {
      if (wallet?.snapshot().connected) return;
      const provider = discovery.selectBrave();
      if (!provider) { discovery.retry(); throw new Error(discovery.guidance().message); }
      wallet?.teardown(); wallet = createWalletAdapter(provider);
      wallet.subscribe(() => { scheduler?.stop(); void stop().then(() => subscribeAccount()).catch(error => fail(error instanceof Error ? error.message : "Wallet changed")); publish(); });
      await wallet.connectFromClick(); publish();
    },
    async disconnect() { await stop(); if (session?.snapshot().status !== "off" && session) throw new Error("Reconcile owned orders before disconnecting."); accountStop?.(); accountStop = null; wallet?.disconnect(); publish({ account: null, fills: [], orders: [] }); },
    async prepareNetwork() { if (!wallet) throw new Error("Connect Brave Wallet first."); await prepareNetworkFromClick(wallet, settings.network); publish(); },
    async authorize(replace = false) {
      if (!wallet?.snapshot().owner) throw new Error("Connect Brave Wallet first.");
      if (session && session.snapshot().status !== "off") throw new Error("Stop before replacing authorization.");
      if (settings.hyperliquidApiUrl || settings.hyperliquidWsUrl || settings.rpcUrl) throw new Error("Real trading requires the selected network's official endpoints.");
      if (!navigator.locks) throw new Error("This browser cannot lock the owner account.");
      const lock = await createOwnerLocks(navigator.locks).acquire(wallet.snapshot().owner!, settings.network);
      try {
        if (!agent) agent = createAgentSession({ wallet, network: settings.network, onStop: () => { void stop(); } });
        await agent.authorizeFromClick({ replace }); publish();
      } finally { lock.release(); }
    },
    async start(next, confirmReal) {
      if (busy) throw new Error("Session is busy.");
      if (!wallet?.snapshot().owner) throw new Error("Connect a wallet before turning On.");
      if (JSON.stringify(next) !== JSON.stringify(settings)) throw new Error("Save settings before turning On.");
      if (session && session.snapshot().status !== "off") throw new Error("Stop or reconcile the current run first.");
      requireReadyMarkets(markets, settings);
      if (settings.mode === "real" && (!confirmReal || !agent?.metadata())) throw new Error("Authorize and confirm whole-account management first.");
      busy = true;
      attention = null;
      try {
        await Promise.all([...feeds.values()].map(item => item.refresh()));
        session = createBrowserSession({ owner: wallet.snapshot().owner!, settings, locks: createOwnerLocks(navigator.locks),
          markets: markets.map(market => ({ ...market, asset: market.assetIndex })), onChange: syncSession,
          authorize: async () => { const metadata = agent?.metadata(); if (!metadata) throw new Error("Authorize trading first."); return { owner: metadata.owner, network: metadata.network, expiresAt: metadata.expiresAt, exchange, clear: () => { agent?.endSession(); agent = null; } }; },
          subscribeAccount: async (_owner, listener) => { if (!snapshot.account) throw new Error("Wait for a fresh account snapshot."); accountListeners.add(listener); listener(snapshot.account); return () => { accountListeners.delete(listener); }; },
        });
        await session.start(confirmReal ? { wholeNetPosition: true } : undefined);
        publish({ run: { ...snapshot.run, runId: crypto.randomUUID(), startedAt: Date.now(), durationMs: settings.runDurationMinutes * 60000 } });
        scheduler = new DecisionScheduler({ network: settings.network, markets, feeds, tickMs: settings.tickMs, deadlineMs: Math.min(10000, settings.tickMs - 1000), sleepMs: settings.fallbackMs, request: requestJev,
          buildState(coin, ready, tick) {
            const book = ready.book, market = markets.find(item => item.coin === coin)!;
            const mids = (feed.getSnapshot().byCoin[coin]?.tape ?? []).map(point => point.mid);
            const position = session!.snapshot().account.positions[coin];
            const size = position?.size ?? 0;
            trades.get(coin)!.setTick(tick);
            const returns = (n: number) => { const previous = mids[mids.length - 1 - n]; return previous ? (book.mid / previous - 1) * 10000 : 0; };
            return { coin, market: `${coin}-USD`, tick, tickMs: settings.tickMs, mid: book.mid, spreadBps: book.spreadBps, bookImbalance: book.imbalance, depth: book.depthBps,
              book: { bids: book.levels.bids.map(([p, s]) => `${p} x ${s}`), asks: book.levels.asks.map(([p, s]) => `${p} x ${s}`) },
              returnsBps: { last1: returns(1), last5: returns(5), last20: returns(20), last100: returns(100) }, recentMids: mids.slice(-settings.horizonBlocks).join(","),
              trades: trades.get(coin)!.summary(settings.horizonBlocks, tick), recentTrades: trades.get(coin)!.recent(20).map(item => `${item.side} ${item.size} @ ${item.price}`),
              position: { coin, side: size > 0 ? "long" : size < 0 ? "short" : "flat", size: Math.abs(size), notionalUsd: Math.abs(size) * book.mid, entry: position?.entryPrice ?? null, leverage: position?.leverage ?? null, liquidationPx: null, distanceBps: null, unrealizedUsd: position ? (book.mid - position.entryPrice) * size : 0 },
              indicators: snapshotIndicators(mids, book.mid), asset: { ...venueFeatures(contexts.get(coin) ?? null, book.mid), maxLeverage: market.maxLeverage }, maxLeverage: market.maxLeverage };
          },
          async onDecision(coin, decision, ready, tick) {
            if (session?.snapshot().status !== "running") return;
            const prior = pending.get(coin);
            if (prior) { await session.cancel(prior.id); pending.delete(coin); }
            const event = marketEvent(coin, { ...ready.book, block: tick }, Date.now());
            event.decision = decision ? { ...decision, late: false } : { action: "hold", intent: "hold", probabilities: { buy: 0, sell: 0, hold: 1 }, upIn10: 0, latencyMs: 0, late: false };
            if (decision) {
              const market = markets.find(item => item.coin === coin)!;
              const position = session.snapshot().account.positions[coin];
              const reduceOnly = decision.intent === "close";
              const price = reduceOnly ? takerPrice(decision.action as "buy" | "sell", ready.book, market.szDecimals, settings.closeSlippageBps) : quotePrice(decision.action as "buy" | "sell", ready.book, market.szDecimals, settings.quoteInsideTicks);
              const size = reduceOnly ? Math.abs(position?.size ?? 0) : Math.floor(settings.quoteUsd / price * 10 ** market.szDecimals) / 10 ** market.szDecimals;
              if (size > 0) {
                const id = await session.submit({ coin, asset: market.assetIndex, buy: decision.action === "buy", price: String(price), size: String(size), reduceOnly }, decision.leverage, ready.receivedAt);
                pending.set(coin, { id, buy: decision.action === "buy", price, remaining: size, tick });
                event.quote = { side: decision.action as "buy" | "sell", price, size, txHash: null, cancel: [], status: settings.mode === "paper" ? "sim" : "placed", orderId: null, capped: false, reduceOnly, taker: reduceOnly };
              }
            }
            const position = session.snapshot().account.positions[coin];
            if (position) event.position = { side: position.size > 0 ? "long" : position.size < 0 ? "short" : "flat", size: Math.abs(position.size), entryPrice: position.entryPrice, leverage: position.leverage, unrealizedUsd: (ready.book.mid - position.entryPrice) * position.size, unrealizedSz: 0 };
            feed.event(event); syncSession();
          },
          onPause: reason => fail(`Trading paused: ${reason}. Turn On explicitly after recovery.`),
          onError: (_coin, error) => fail(error.message),
        });
        scheduler.start(); syncSession();
      } catch (error) { await stop(); throw error; } finally { busy = false; }
    },
    stop,
    async reconcile() { await session?.reconcile(); syncSession(); },
    async dispose() {
      disposed = true; generation++; clearTimeout(retry); clearInterval(timer);
      window.removeEventListener("offline", guard); document.removeEventListener("visibilitychange", guard);
      scheduler?.stop(); await stop(); accountStop?.();
      for (const item of feeds.values()) item.close(); transport?.close(); discovery.teardown(); wallet?.teardown(); listeners.clear();
    },
  };
  return adapter;
}
