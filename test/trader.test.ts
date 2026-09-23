import { expect, test } from "bun:test";
import type { DecisionJournalEvent } from "../src/decision-events";
import type { Market } from "../src/market";
import { buildJevPrompt, type Model, type ModelDecision, type ModelEvaluation, type TradeState } from "../src/model";
import { leverageRungs, liveIntent, parseLeverage, planQuote, quoteAction } from "../src/plan";
import { jevUnavailable, Trader } from "../src/trader";
import { TradeFeed, type MakerFill } from "../src/trades";
import type { BlockEvent, Book, Quote, Side } from "../src/types";

test("jevUnavailable detects a TypeSafe credit 402", () => {
  expect(jevUnavailable(new Error("402 Your organization has no available TypeSafe API credits. Please add more credits"))).toBe(true);
  expect(jevUnavailable(new Error("hyperliquid rate limited"))).toBe(false);
});

test("open long buys and open short sells, resting post-only", () => {
  expect(quoteAction("open", "long")).toBe("buy");
  expect(quoteAction("open", "short")).toBe("sell");
  expect(planQuote({ intent: "open", bias: "long", positionSz: -2, quoteSz: 0.01 })).toEqual({
    side: "buy", size: 0.01, reduceOnly: false, taker: false,
  });
  expect(planQuote({ intent: "open", bias: "short", positionSz: 2, quoteSz: 0.01 })).toEqual({
    side: "sell", size: 0.01, reduceOnly: false, taker: false,
  });
});

test("close flattens the live book as a taker and skips when flat", () => {
  expect(planQuote({ intent: "close", bias: "long", positionSz: 0.08, quoteSz: 0.01 })).toEqual({
    side: "sell", size: 0.08, reduceOnly: true, taker: true,
  });
  expect(planQuote({ intent: "close", bias: "short", positionSz: -0.08, quoteSz: 0.01 })).toEqual({
    side: "buy", size: 0.08, reduceOnly: true, taker: true,
  });
  expect(planQuote({ intent: "close", bias: "long", positionSz: -0.08, quoteSz: 0.01 })).toEqual({
    side: "buy", size: 0.08, reduceOnly: true, taker: true,
  });
  expect(planQuote({ intent: "close", bias: "short", positionSz: 0.08, quoteSz: 0.01 })).toEqual({
    side: "sell", size: 0.08, reduceOnly: true, taker: true,
  });
  expect(planQuote({ intent: "close", bias: "long", positionSz: 0, quoteSz: 0.01 })).toBe(null);
});

test("hold sends nothing, whatever the bias or position", () => {
  expect(quoteAction("hold", "long")).toBe("hold");
  expect(quoteAction("hold", "short")).toBe("hold");
  expect(planQuote({ intent: "hold", bias: "long", positionSz: 0, quoteSz: 0.01 })).toBe(null);
  expect(planQuote({ intent: "hold", bias: "short", positionSz: 0.08, quoteSz: 0.01 })).toBe(null);
  expect(planQuote({ intent: "hold", bias: "long", positionSz: -0.08, quoteSz: 0.01 })).toBe(null);
});

test("liveIntent cannot close a flat book and stands down instead", () => {
  expect(liveIntent("flat", "close")).toBe("hold");
  expect(liveIntent("flat", "hold")).toBe("hold");
  expect(liveIntent("flat", "open")).toBe("open");
  expect(liveIntent("long", "close")).toBe("close");
  expect(liveIntent("long", "hold")).toBe("hold");
  expect(liveIntent("short", "open")).toBe("open");
});

test("leverage rungs follow the coin max", () => {
  expect(leverageRungs(10)).toEqual([1, 2, 3, 5, 10]);
  expect(leverageRungs(50)).toEqual([1, 2, 3, 5, 10, 20, 40, 50]);
  expect(leverageRungs(15)).toEqual([1, 2, 3, 5, 10, 15]);
  expect(parseLeverage("7", 10, 1)).toBe(5);
  expect(parseLeverage("50", 10, 1)).toBe(10);
});

const book: Book = {
  block: 1,
  bid: 99.9,
  ask: 100.1,
  mid: 100,
  spreadBps: 20,
  imbalance: 0,
  levels: { bids: [[99.9, 1]], asks: [[100.1, 1]] },
  depthBps: { "10": { bid: 1, ask: 1 } },
};

function packed(partial: Partial<ModelDecision> & Pick<ModelDecision, "intent" | "bias" | "action">): ModelDecision {
  return {
    leverage: 1,
    probabilities: { buy: 0, sell: 0, hold: 1, long: 0.5, short: 0.5, open: 0, close: 0 },
    upIn10: 0.5,
    latencyMs: 1,
    inputTokens: 0,
    ...partial,
  };
}

class ScriptModel implements Model {
  readonly name = "script";
  next: ModelDecision | Error = packed({ intent: "hold", bias: "long", action: "hold" });
  delayMs = 0;
  async decide(state: TradeState): Promise<ModelEvaluation> {
    if (this.delayMs) await Bun.sleep(this.delayMs);
    if (this.next instanceof Error) throw this.next;
    return { decision: this.next, prompt: buildJevPrompt(state) };
  }
}

class FakeMarket {
  readonly coin = "BTC";
  readonly pair = "BTC-USD";
  readonly wallet = null;
  readonly account = null;
  readonly szDecimals = 5;
  readonly maxLeverage = 40;
  readonly fillPrints: [] = [];
  assetCtx = null;
  lastOid: number | null = null;
  cancels = 0;
  sendDelayMs = 0;
  sentSides: Side[] = [];
  onSend: (() => void) | null = null;
  cleanupCalls = 0;
  reconciledFills: MakerFill[] = [];
  candleCloses() { return []; }
  refresh() { return Promise.resolve(); }
  reconcileUserFills() { return Promise.resolve(this.reconciledFills); }
  readBook() { return book; }
  quoteSize() { return 0.01; }
  setLeverage(n: number) { return Promise.resolve(n); }
  setRunGuard() {}
  async send(side: Side, size: number, _book: Book, cancel: number[], decisionId: string): Promise<Quote> {
    this.sentSides.push(side);
    this.onSend?.();
    if (this.sendDelayMs) await Bun.sleep(this.sendDelayMs);
    this.lastOid = 4242;
    return {
      decisionId, side, price: 99.9, size, txHash: null, cancel, status: "placed",
      orderId: 4242, capped: false, reduceOnly: false, taker: false,
    };
  }
  cleanupOwned() { this.cleanupCalls++; return Promise.resolve([]); }
  async cancelResting() {
    this.cancels++;
    const oid = this.lastOid;
    this.lastOid = null;
    return oid == null ? [] : [oid];
  }
}

function desk(model: Model, market = new FakeMarket()) {
  const events: BlockEvent[] = [];
  const trader = new Trader(market as unknown as Market, model, (e) => events.push(e));
  return { trader, market, events };
}


test("overlapping ticks both ask Jev and an older answer cannot replace the newer order", async () => {
  let calls = 0;
  let startFirst!: () => void;
  let releaseFirst!: () => void;
  const firstStarted = new Promise<void>((resolve) => { startFirst = resolve; });
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const model: Model = {
    name: "overlap",
    async decide(state: TradeState) {
      calls++;
      if (state.tick === 1) {
        startFirst();
        await firstGate;
        return { decision: packed({ intent: "open", bias: "short", action: "sell" }), prompt: buildJevPrompt(state) };
      }
      return { decision: packed({ intent: "open", bias: "long", action: "buy" }), prompt: buildJevPrompt(state) };
    },
  };
  const { trader, market, events } = desk(model);
  const newerSent = new Promise<void>((resolve) => { market.onSend = resolve; });
  const first = trader.onBlock(1);
  await firstStarted;
  await trader.onBlock(2);
  await newerSent;
  releaseFirst();
  await first;
  expect(calls).toBe(2);
  expect(events.find((event) => event.block === 1)?.decision?.late).toBe(true);
  expect(events.find((event) => event.block === 2)?.decision?.action).toBe("buy");
  expect(market.sentSides).toEqual(["buy"]);
});

test("a failed Jev call reports no fabricated Jev decision", async () => {
  const model = new ScriptModel();
  const { events, trader } = desk(model);
  model.next = new Error("boom");
  await trader.onBlock(1);
  expect(events.find((e) => e.block === 1)?.decision).toBeNull();
});

test("Jev is asked again on the tick after a credit error", async () => {
  let calls = 0;
  const model = new ScriptModel();
  model.next = new Error("402 Your organization has no available TypeSafe API credits");
  const decide = model.decide.bind(model);
  model.decide = (state) => { calls++; return decide(state); };
  const { events, trader } = desk(model);
  await trader.onBlock(1);
  model.next = packed({ intent: "hold", bias: "long", action: "hold" });
  await trader.onBlock(2);
  expect(calls).toBe(2);
  expect(events.find((e) => e.block === 2)?.decision?.late).toBe(false);
});

test.each(["Stop", "expiry"] as const)("a successful response after %s is journaled exactly but cannot submit or cancel", async (reason) => {
  const { promise, resolve: release } = Promise.withResolvers<ModelEvaluation>();
  let prompt!: ModelEvaluation["prompt"];
  const model: Model = {
    name: "deferred",
    decide(state) {
      prompt = buildJevPrompt(state);
      return promise;
    },
  };
  const market = new FakeMarket();
  const events: BlockEvent[] = [];
  const journal: DecisionJournalEvent[] = [];
  const trader = new Trader(market as unknown as Market, model, (event) => events.push(event), undefined, undefined, {
    enqueue: (event) => journal.push(event),
  });
  let live = true;
  trader.setRunGuard({ runId: "run-1", isLive: () => live, assertLive: () => {
    if (!live) throw new Error("expired");
  } });
  const pending = trader.onBlock(1);
  if (reason === "Stop") trader.invalidate();
  else live = false;
  const decision = packed({ intent: reason === "Stop" ? "open" : "hold", bias: "long", action: reason === "Stop" ? "buy" : "hold" });
  release({ decision, prompt });
  await pending;
  const recorded = journal.find((event) => event.type === "decision");
  expect(recorded).toMatchObject({ type: "decision", late: true, decision, prompt });
  expect(recorded?.decisionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(events[0]?.decision).toMatchObject({ id: recorded?.decisionId, late: true });
  expect(market.sentSides).toEqual([]);
  expect(market.cancels).toBe(0);
});

test("BTC simulated fill preserves the exact quoted size", () => {
  const model = new ScriptModel();
  const market = new FakeMarket();
  let observed = Number.NaN;
  let observedDecisionId = "";
  const trader = new Trader(
    market as unknown as Market,
    model,
    () => {},
    (_block, fill) => { observed = fill.size; observedDecisionId = fill.decisionId; },
  );
  const quoteSize = 0.00045;
  trader.attachTradeFeed({
    drainPrints: () => [{ block: 2, price: 99, size: quoteSize, side: "sell" }],
    drainFills: () => [],
  } as never);
  const internals = trader as unknown as {
    orders: Map<number, { decisionId: string; side: Side; price: number; size: number; block: number }>;
    harvest(): void;
  };
  const decisionId = crypto.randomUUID();
  internals.orders.set(-1, { decisionId, side: "buy", price: 100, size: quoteSize, block: 1 });
  internals.harvest();
  expect(observed).toBe(quoteSize);
  expect(observedDecisionId).toBe(decisionId);
});

test("journal markouts keep one decision id and emit each horizon once", async () => {
  const model = new ScriptModel();
  const events: DecisionJournalEvent[] = [];
  const journal = { enqueue: (event: DecisionJournalEvent) => { events.push(event); } };
  const market = new FakeMarket();
  const trader = new Trader(market as unknown as Market, model, () => {}, () => {}, () => {}, journal);
  for (let block = 1; block <= 101; block++) await trader.onBlock(block);
  const first = events.find((event) => event.type === "decision" && event.block === 1);
  expect(first?.type).toBe("decision");
  const markouts = events.filter((event) => event.type === "markout" && event.decisionId === first?.decisionId);
  expect(markouts.map((event) => event.horizonTicks)).toEqual([1, 5, 20, 100]);
  expect(new Set(markouts.map((event) => event.horizonTicks)).size).toBe(4);
});

test("live IOC partial fills retain their decision and individual execution details after stand-down", async () => {
  const model = new ScriptModel();
  model.next = packed({ intent: "open", bias: "long", action: "buy" });
  const market = new FakeMarket();
  Object.defineProperty(market, "wallet", { value: {} });
  market.send = async (side, size, _book, cancel, decisionId) => ({
    decisionId, side, size, price: 100, cancel, orderId: 4242, txHash: null,
    status: "placed", capped: false, reduceOnly: false, taker: true,
  });
  const events: DecisionJournalEvent[] = [];
  const trader = new Trader(market as unknown as Market, model, () => {}, undefined, undefined, {
    enqueue: (event) => events.push(event),
  });
  const feed = new TradeFeed();
  trader.attachTradeFeed(feed);
  // Await this trader's exchange queue without adding timing-dependent sleeps.
  const exchange = trader as unknown as { exchangeTail: Promise<void> };
  await trader.onBlock(1);
  await exchange.exchangeTail;
  model.next = packed({ intent: "hold", bias: "long", action: "hold" });
  await trader.onBlock(2);
  await exchange.exchangeTail;
  feed.pushFill({ block: 3, tid: 71, orderId: 4242, txHash: "0xfirst", price: 100, size: 0.004, updatedSize: -1, side: "buy", feeUsd: 0.01, closedPnl: 0.2 });
  feed.pushFill({ block: 3, tid: 72, orderId: 4242, txHash: "0xsecond", price: 101, size: 0.006, updatedSize: -1, side: "buy", feeUsd: 0.02, closedPnl: 0.3 });
  await trader.onBlock(3);
  const decision = events.find((event) => event.type === "decision" && event.block === 1)!;
  const fills = events.filter((event) => event.type === "fill");
  expect(fills).toHaveLength(2);
  expect(fills[0]).toMatchObject({ decisionId: decision.decisionId, block: 1, fillId: "4242:71", fill: {
    orderId: 4242, price: 100, size: 0.004, txHash: "0xfirst", feeUsd: 0.01, closedPnl: 0.2,
  } });
  expect(fills[1]).toMatchObject({ decisionId: decision.decisionId, block: 1, fillId: "4242:72", fill: {
    orderId: 4242, price: 101, size: 0.006, txHash: "0xsecond", feeUsd: 0.02, closedPnl: 0.3,
  } });
  expect(trader.history[0]?.fill?.size).toBe(0.01);
});

test("drain waits for an in-flight placement and cleans up the late order", async () => {
  const model = new ScriptModel();
  model.next = packed({ intent: "open", bias: "long", action: "buy" });
  const market = new FakeMarket();
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Quote>();
  market.send = async () => {
    started.resolve();
    return response.promise;
  };
  const events: DecisionJournalEvent[] = [];
  const trader = new Trader(market as unknown as Market, model, () => {}, undefined, undefined, {
    enqueue: (event) => events.push(event),
  });
  await trader.onBlock(1);
  await started.promise;
  trader.invalidate();
  let drained = false;
  const draining = trader.drain().then(() => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(false);
  response.resolve({
    decisionId: crypto.randomUUID(), side: "buy", price: 100, size: 0.01, cancel: [],
    orderId: 4242, txHash: null, status: "placed", capped: false, reduceOnly: false, taker: false,
  });
  await draining;
  expect(market.cleanupCalls).toBe(1);
  expect(events.some((event) => event.type === "quote")).toBe(true);
});

test("fills received before order acknowledgement survive long delay and HTTP reconciliation deduplicates them", async () => {
  const model = new ScriptModel();
  model.next = packed({ intent: "open", bias: "long", action: "buy" });
  const market = new FakeMarket();
  Object.defineProperty(market, "wallet", { value: {} });
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Quote>();
  market.send = async (side, size, _book, cancel, decisionId) => {
    started.resolve();
    return response.promise.then(() => ({
      decisionId, side, size, price: 100, cancel, orderId: 4242, txHash: null,
      status: "placed" as const, capped: false, reduceOnly: false, taker: true,
    }));
  };
  const early: MakerFill = {
    block: 1, tid: 71, orderId: 4242, txHash: "0xfirst", price: 100,
    size: 0.004, updatedSize: -1, side: "buy", feeUsd: 0.01,
  };
  const reconciled: MakerFill = {
    block: 1, tid: 72, orderId: 4242, txHash: "0xsecond", price: 101,
    size: 0.006, updatedSize: -1, side: "buy", feeUsd: 0.02,
  };
  market.reconciledFills = [early, reconciled];
  const events: DecisionJournalEvent[] = [];
  const trader = new Trader(market as unknown as Market, model, () => {}, undefined, undefined, {
    enqueue: (event) => events.push(event),
  });
  const feed = new TradeFeed();
  trader.attachTradeFeed(feed);
  await trader.onBlock(1);
  await started.promise;
  feed.pushFill(early);
  const internals = trader as unknown as { harvest(): void };
  for (let attempt = 0; attempt < 6; attempt++) internals.harvest();
  response.resolve({} as Quote);
  await trader.drain();
  const decision = events.find((event) => event.type === "decision")!;
  const fills = events.filter((event) => event.type === "fill");
  expect(fills.map((event) => event.type === "fill" && event.fillId)).toEqual(["4242:71", "4242:72"]);
  expect(fills.every((event) => event.decisionId === decision.decisionId)).toBe(true);
  expect(fills[1]).toMatchObject({ type: "fill", position: { side: "long", size: 0.01 } });
});

test("hold and close markouts follow long and short bias rather than order direction", async () => {
  for (const intent of ["hold", "close"] as const) {
    for (const bias of ["long", "short"] as const) {
      const model = new ScriptModel();
      model.next = packed({ intent, bias, action: quoteAction(intent, bias) });
      const market = new FakeMarket();
      let mid = 100;
      market.readBook = () => ({ ...book, mid });
      const events: DecisionJournalEvent[] = [];
      const trader = new Trader(market as unknown as Market, model, () => {}, undefined, undefined, {
        enqueue: (event) => events.push(event),
      });
      await trader.onBlock(1);
      mid = 101;
      await trader.onBlock(2);
      const markout = events.find((event) => event.type === "markout" && event.block === 1);
      expect(markout).toMatchObject({ marketReturnBps: 100, signedReturnBps: bias === "long" ? 100 : -100 });
    }
  }
});
