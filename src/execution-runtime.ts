import { applySettingsToConfig, config } from "./config";
import type { DecisionJournal, DecisionJournalEvent } from "./decision-events";
import { Feed } from "./feed";
import { resetHyperliquidMetadata, safeTransportMessage } from "./hyperliquid";
import { Market } from "./market";
import { createModel } from "./model";
import { createRunLifecycle, type RunGuard, type RunLifecycle } from "./run-lifecycle";
import type { PublicServer, SleeveView } from "./server";
import { createSleeveLifecycle, type SleeveLifecycle } from "./sleeve-lifecycle";
import { createStartupAutostart, type StartupAutostart } from "./startup-autostart";
import { coinPair, type SleeveConfig } from "./sleeves";
import type { TradingSettings } from "./settings";
import { Trader } from "./trader";
import type { BlockEvent, Fill, Meta, Quote, Timing } from "./types";

interface ExecutionSleeve {
  feed: Feed;
  market: Market;
  trader: Trader;
}

interface Executor {
  lifecycle: SleeveLifecycle;
  sleeves: ExecutionSleeve[];
}

export type ExecutionSink = Pick<PublicServer,
  "broadcast" | "broadcastQuote" | "broadcastFill" | "broadcastRun" | "broadcastSleeve" | "broadcastPrice"
>;

export interface ExecutionRuntime {
  readonly meta: Meta;
  readonly views: SleeveView[];
  readonly lifecycle: RunLifecycle;
  rebuild(settings: TradingSettings, apiKey?: string): Promise<void>;
  attachSink(sink: ExecutionSink | null): void;
  armAutostart(mode: TradingSettings["mode"]): Promise<void>;
  dispose(): Promise<void>;
}

export interface ExecutionRuntimeOptions {
  specs: SleeveConfig[];
  durationMinutes?: number;
  journal?: DecisionJournal;
}

export function createExecutionRuntime(options: ExecutionRuntimeOptions): ExecutionRuntime {
  const configuredByCoin = new Map(options.specs.map((spec) => [spec.coin, spec]));
  const initial = options.specs[0] ?? { coin: "BTC", pair: "BTC-USD", label: "BTC" };
  const views: SleeveView[] = [];
  const meta: Meta = {
    model: config.model,
    wallet: null,
    dryRun: true,
    market: initial.pair,
    startedAt: Date.now(),
    venue: "hyperliquid",
    coin: initial.coin,
    pair: initial.pair,
    explorerTx: config.explorerTx,
    tickMs: config.tickMs,
    sleeves: [],
  };

  let executor: Executor | null = null;
  let sink: ExecutionSink | null = null;
  let activeSettings: TradingSettings | null = null;
  let activeApiKey: string | undefined;
  let activeGuard: RunGuard | null = null;
  let rebuildingExecutor = false;
  let disposed = false;
  const inFlight = new Set<Promise<void>>();
  const settleInFlight = async () => {
    while (inFlight.size) await Promise.all([...inFlight]);
  };
  const drainExecutor = async (current: Executor) => {
    current.lifecycle.stopAll();
    for (const sleeve of current.sleeves) sleeve.trader.invalidate();
    await settleInFlight();
    await Promise.all(current.sleeves.map((sleeve) => sleeve.trader.drain()));
    await Promise.all(current.sleeves.map((sleeve) => sleeve.market.cleanupOwned()));
    await Promise.all(current.sleeves.map((sleeve) => sleeve.trader.drain()));
  };
  let startupAutostart: StartupAutostart;

  const lifecycle = createRunLifecycle({
    durationMinutes: options.durationMinutes ?? 30,
    onChange: (run) => {
      sink?.broadcastRun(run);
      startupAutostart?.observe(run.status);
    },
    hooks: {
      async start(guard) {
        const current = executor;
        if (!current || !current.lifecycle.anyReady()) throw new Error("no execution resources are ready");
        activeGuard = guard;
        for (const sleeve of current.sleeves) sleeve.trader.setRunGuard(guard);
        guard.assertLive();
        current.lifecycle.startAll();
      },
      async stop() {
        const current = executor;
        activeGuard = null;
        if (!current) return;
        await drainExecutor(current);
      },
    },
  });

  startupAutostart = createStartupAutostart({
    status: () => lifecycle.snapshot().status,
    anyReady: () => executor?.lifecycle.anyReady() ?? false,
    start: () => lifecycle.start(),
  });

  const journal: DecisionJournal | undefined = options.journal && {
    enqueue(event: DecisionJournalEvent) {
      options.journal!.enqueue(event.runId == null
        ? { ...event, runId: lifecycle.snapshot().runId } as DecisionJournalEvent
        : event);
    },
  };

  const onEvent = (coin: string) => (event: BlockEvent, timing?: Timing) => {
    sink?.broadcast(event);
    if (!event.decision || event.decision.late) return;
    const decision = event.decision;
    const quote = event.quote;
    const leverage = decision.intent === "open" && decision.leverage != null ? ` ${decision.leverage}x` : "";
    const call = decision.intent === "hold" ? "hold" : decision.intent && decision.bias ? `${decision.intent} ${decision.bias}${leverage}` : decision.action;
    const order = quote && ` ${quote.side.toUpperCase()} ${quote.size} @ ${quote.price}${quote.taker ? " cross" : ""}${quote.reduceOnly ? " reduce" : ""}${quote.unchanged ? " unchanged" : quote.status === "sim" ? " (sim)" : ` ${quote.status}`}`;
    console.log(`${coin} #${event.block} ${event.mid} ${call} ${decision.latencyMs}ms${order || (decision.intent === "hold" ? " NO ORDER" : "")} pnl $${event.totals.pnlUsd}${timing ? ` loop ${timing.loopMs}ms` : ""}`);
  };
  const onFill = (coin: string) => (block: number, fill: Fill) => {
    const kind = fill.dir === "open" ? "OPEN " : fill.dir === "close" ? "CLOSE " : fill.dir === "flip" ? "FLIP " : "";
    console.log(`${coin} #${block} ${kind}FILL ${fill.side} ${fill.size} @ ${fill.price}${fill.simulated ? " (sim)" : ""}`);
  };
  const onQuote = (coin: string) => (block: number, quote: Quote) => {
    sink?.broadcastQuote(coin, block, quote);
    if (quote.status !== "placed") console.log(`${coin} #${block} ${quote.status.toUpperCase()} ${quote.side} @ ${quote.price}`);
  };

  const rebuild = async (settings: TradingSettings, apiKey?: string): Promise<void> => {
    if (disposed) throw new Error("execution runtime is closed");
    const previousSettings = activeSettings;
    const previousApiKey = activeApiKey;
    const previousExecutor = executor;
    if (previousExecutor) {
      await drainExecutor(previousExecutor);
      for (const sleeve of previousExecutor.sleeves) sleeve.feed.suspend();
      await Promise.all(previousExecutor.sleeves.map((sleeve) => sleeve.trader.drain()));
    }
    applySettingsToConfig(settings, apiKey);
    resetHyperliquidMetadata();

    const specs = settings.enabledCoins.map((coin): SleeveConfig => {
      const configured = configuredByCoin.get(coin);
      return configured ?? { coin, pair: coinPair(coin), label: coin };
    });
    const sleeves: ExecutionSleeve[] = [];
    const candidateViews: SleeveView[] = [];
    const first = specs[0];
    const candidateMeta: Meta = {
      ...meta,
      wallet: null,
      dryRun: config.dryRun || specs.every((spec) => !spec.privateKey),
      coin: first?.coin ?? meta.coin,
      pair: first?.pair ?? meta.pair,
      market: first?.pair ?? meta.market,
      explorerTx: config.explorerTx,
      tickMs: config.tickMs,
      sleeves: [],
    };
    let committed = false;
    const sleeveLifecycle = createSleeveLifecycle({
      specs,
      meta: candidateMeta,
      views: candidateViews,
      autoStart: false,
      canRetry: () => committed
        && !rebuildingExecutor
        && executor?.lifecycle === sleeveLifecycle
        && ["off", "running"].includes(lifecycle.snapshot().status),
      onStatus: (sleeve) => {
        if (sleeve.coin === first?.coin && sleeve.status === "live") {
          candidateMeta.wallet = sleeve.wallet;
          if (committed) meta.wallet = sleeve.wallet;
        }
        if (committed) {
          views.splice(0, views.length, ...candidateViews);
          sink?.broadcastSleeve(sleeve);
        }
        if (committed && sleeve.status === "live") void startupAutostart.request();
      },
      initialize: async (spec) => {
        const feed = new Feed(spec.coin);
        try {
          feed.onPrice = (book) => {
            if (!committed) return;
            sink?.broadcastPrice(spec.coin, {
              ts: Date.now(), mid: book.mid, bestBid: book.bid, bestAsk: book.ask, spreadBps: book.spreadBps,
            });
          };
          const market = new Market(feed, spec);
          await market.init();
          await market.reconcileStartupOwned();
          await feed.connect();
          const trader = new Trader(market, createModel(), onEvent(spec.coin), onFill(spec.coin), onQuote(spec.coin), journal);
          trader.attachTradeFeed(feed.trades);
          market.onVenueFill = (fill) => {
            if (!committed) return;
            sink?.broadcastFill(spec.coin, 0, {
              decisionId: "uncorrelated",
              side: fill.side, size: fill.size, price: fill.price, txHash: fill.hash ?? null,
              orderId: 0, simulated: false, dir: fill.dir,
            }, fill.ts);
          };
          sleeves.push({ feed, market, trader });
          console.log(`sleeve ${spec.label} ${spec.pair} ${market.address ?? "DRY RUN"}`);
          return {
            wallet: market.address,
            view: { coin: spec.coin, history: () => trader.history, tape: () => trader.tape },
            start: () => {
              const guard = activeGuard;
              if (!guard) return;
              trader.setRunGuard(guard);
              guard.assertLive();
              feed.start((tick) => {
                const work = trader.onBlock(tick);
                inFlight.add(work);
                void work.finally(() => inFlight.delete(work));
              });
            },
            stop: () => feed.stop(),
            dispose: () => feed.close(),
          };
        } catch (error) {
          feed.close();
          throw error;
        }
      },
    });

    const commitCandidate = () => {
      previousExecutor?.lifecycle.disposeAll();
      executor = { lifecycle: sleeveLifecycle, sleeves };
      views.splice(0, views.length, ...candidateViews);
      meta.wallet = candidateMeta.wallet;
      meta.dryRun = candidateMeta.dryRun;
      meta.coin = candidateMeta.coin;
      meta.pair = candidateMeta.pair;
      meta.market = candidateMeta.market;
      meta.explorerTx = candidateMeta.explorerTx;
      meta.tickMs = candidateMeta.tickMs;
      meta.sleeves.splice(0, meta.sleeves.length, ...candidateMeta.sleeves);
      activeSettings = { ...settings, enabledCoins: [...settings.enabledCoins] };
      activeApiKey = apiKey;
      committed = true;
      for (const sleeve of meta.sleeves) sink?.broadcastSleeve(sleeve);
      void startupAutostart.request();
    };

    rebuildingExecutor = true;
    try {
      await sleeveLifecycle.initializeAll();
    } finally {
      rebuildingExecutor = false;
    }
    if (!sleeveLifecycle.allReady()) {
      if (!previousSettings) {
        commitCandidate();
        return;
      }
      const failed = candidateMeta.sleeves.find((sleeve) => sleeve.error)?.error ?? "execution resources failed to initialize";
      sleeveLifecycle.disposeAll();
      applySettingsToConfig(previousSettings, previousApiKey);
      resetHyperliquidMetadata();
      try {
        await Promise.all(previousExecutor?.sleeves.map((sleeve) => sleeve.feed.connect()) ?? []);
      } catch (resumeError) {
        throw new Error(`Candidate failed (${failed}); previous feeds could not resume: ${safeTransportMessage(resumeError)}`);
      }
      throw new Error(failed);
    }
    commitCandidate();
  };

  return {
    meta,
    views,
    lifecycle,
    rebuild,
    attachSink(next) { sink = next; },
    armAutostart: (mode) => startupAutostart.arm(mode),
    async dispose() {
      if (disposed) return;
      disposed = true;
      await lifecycle.stop("shutdown");
      const active = executor;
      if (active) {
        await drainExecutor(active);
        active.lifecycle.disposeAll();
        await Promise.all(active.sleeves.map((sleeve) => sleeve.trader.drain()));
      }
      executor = null;
      sink = null;
    },
  };
}
