import { applySettingsToConfig, config } from "./config";
import { Feed } from "./feed";
import { resetHyperliquidMetadata, safeTransportMessage } from "./hyperliquid";
import { Market } from "./market";
import { createModel } from "./model";
import { createOperatorControl } from "./operator-control";
import { createRunLifecycle, type RunGuard } from "./run-lifecycle";
import { startServer, type PublicServer, type SleeveView } from "./server";
import { createSleeveLifecycle, type SleeveLifecycle } from "./sleeve-lifecycle";
import { coinPair, loadSleeves, type SleeveConfig } from "./sleeves";
import { Trader } from "./trader";
import type { TradingSettings } from "./settings";
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

const configuredSleeves = loadSleeves();
const configuredByCoin = new Map(configuredSleeves.map((spec) => [spec.coin, spec]));
const initial = configuredSleeves[0] ?? { coin: "BTC", pair: "BTC-USD", label: "BTC" };
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
let server: PublicServer | null = null;
let activeSettings: TradingSettings | null = null;
let activeApiKey: string | undefined;
let activeGuard: RunGuard | null = null;

const runLifecycle = createRunLifecycle({
  durationMinutes: 30,
  onChange: (run) => server?.broadcastRun(run),
  hooks: {
    async start(guard) {
      const current = executor;
      if (!current || !current.lifecycle.allReady()) throw new Error("execution resources are not ready");
      activeGuard = guard;
      for (const sleeve of current.sleeves) sleeve.trader.setRunGuard(guard);
      guard.assertLive();
      current.lifecycle.startAll();
    },
    async stop() {
      const current = executor;
      activeGuard = null;
      if (!current) return;
      current.lifecycle.stopAll();
      for (const sleeve of current.sleeves) sleeve.trader.invalidate();

      await Promise.all(current.sleeves.map((sleeve) => sleeve.market.cleanupOwned()));
    },
  },
});

server = startServer(meta, views, runLifecycle.snapshot);

async function rebuildExecutor(settings: TradingSettings, apiKey?: string): Promise<void> {
  const previousSettings = activeSettings;
  const previousApiKey = activeApiKey;
  const previousExecutor = executor;
  for (const sleeve of previousExecutor?.sleeves ?? []) sleeve.feed.suspend();
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
  const lifecycle = createSleeveLifecycle({
    specs,
    meta: candidateMeta,
    views: candidateViews,
    autoStart: false,
    canRetry: () => committed && runLifecycle.snapshot().status === "running",
    onStatus: (sleeve) => {
      if (sleeve.coin === first?.coin && sleeve.status === "live") candidateMeta.wallet = sleeve.wallet;
      if (committed) server?.broadcastSleeve(sleeve);
    },
    initialize: async (spec) => {
      const feed = new Feed(spec.coin);
      try {
        feed.onPrice = (book) => {
          if (!committed) return;
          server?.broadcastPrice(spec.coin, {
            ts: Date.now(),
            mid: book.mid,
            bestBid: book.bid,
            bestAsk: book.ask,
            spreadBps: book.spreadBps,
          });
        };
        const market = new Market(feed, spec);
        await market.init();
        await market.reconcileStartupOwned();
        await feed.connect();
        const trader = new Trader(market, createModel(), onEvent(spec.coin), onFill(spec.coin), onQuote(spec.coin));
        trader.attachTradeFeed(feed.trades);
        market.onVenueFill = (fill) => {
          if (!committed) return;
          server?.broadcastFill(spec.coin, 0, {
            side: fill.side,
            size: fill.size,
            price: fill.price,
            txHash: fill.hash ?? null,
            orderId: 0,
            simulated: false,
            dir: fill.dir,
          }, fill.ts);
        };
        sleeves.push({ feed, market, trader });
        console.log(`sleeve ${spec.label} ${spec.pair} ${config.dryRun ? "DRY RUN" : market.address}`);
        return {
          wallet: market.address,
          view: { coin: spec.coin, history: () => trader.history, tape: () => trader.tape },
          start: () => {
            const guard = activeGuard;
            if (!guard) return;
            trader.setRunGuard(guard);
            guard.assertLive();
            feed.start((tick) => trader.onBlock(tick));
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

  await lifecycle.initializeAll();
  if (!lifecycle.allReady()) {
    const failed = candidateMeta.sleeves.find((sleeve) => sleeve.error)?.error ?? "execution resources failed to initialize";
    lifecycle.disposeAll();
    if (previousSettings) {
      applySettingsToConfig(previousSettings, previousApiKey);
      resetHyperliquidMetadata();
      try {
        await Promise.all(previousExecutor?.sleeves.map((sleeve) => sleeve.feed.connect()) ?? []);
      } catch (resumeError) {
        throw new Error(`Candidate failed (${failed}); previous feeds could not resume: ${safeTransportMessage(resumeError)}`);
      }
    }
    throw new Error(failed);
  }

  executor?.lifecycle.disposeAll();
  executor = { lifecycle, sleeves };
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
  for (const sleeve of meta.sleeves) server?.broadcastSleeve(sleeve);
}

const operator = createOperatorControl({ lifecycle: runLifecycle, rebuild: rebuildExecutor });
await rebuildExecutor(operator.runtime.settings(), operator.runtime.credential());
runLifecycle.applyDuration(operator.runtime.settings().runDurationMinutes);
operator.listen();

console.log(`jev-trade ready Off model=${meta.model}${config.model === "jev" ? ` ${config.jevProvider}` : ""} :${config.port}`);

function onEvent(coin: string) {
  return (event: BlockEvent, timing?: Timing) => {
    server?.broadcast(event);
    if (!event.decision || event.decision.late) return;
    const decision = event.decision;
    const quote = event.quote;
    const leverage = decision.intent === "open" && decision.leverage != null ? ` ${decision.leverage}x` : "";
    const call = decision.intent === "hold" ? "hold" : decision.intent && decision.bias ? `${decision.intent} ${decision.bias}${leverage}` : decision.action;
    const order = quote && ` ${quote.side.toUpperCase()} ${quote.size} @ ${quote.price}${quote.taker ? " cross" : ""}${quote.reduceOnly ? " reduce" : ""}${quote.unchanged ? " unchanged" : quote.status === "sim" ? " (sim)" : ` ${quote.status}`}`;
    console.log(`${coin} #${event.block} ${event.mid} ${call} ${decision.latencyMs}ms${order || (decision.intent === "hold" ? " NO ORDER" : "")} pnl $${event.totals.pnlUsd}${timing ? ` loop ${timing.loopMs}ms` : ""}`);
  };
}

function onFill(coin: string) {
  return (block: number, fill: Fill) => {
    const kind = fill.dir === "open" ? "OPEN " : fill.dir === "close" ? "CLOSE " : fill.dir === "flip" ? "FLIP " : "";
    console.log(`${coin} #${block} ${kind}FILL ${fill.side} ${fill.size} @ ${fill.price}${fill.simulated ? " (sim)" : ""}`);
  };
}

function onQuote(coin: string) {
  return (block: number, quote: Quote) => {
    server?.broadcastQuote(coin, block, quote);
    if (quote.status !== "placed") console.log(`${coin} #${block} ${quote.status.toUpperCase()} ${quote.side} @ ${quote.price}`);
  };
}
