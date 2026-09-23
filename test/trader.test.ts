import { expect, test } from "bun:test";
import type { Market } from "../src/market";
import type { Model, ModelDecision, TradeState } from "../src/model";
import { leverageRungs, liveIntent, parseLeverage, planQuote, quoteAction } from "../src/plan";
import { jevUnavailable, Trader } from "../src/trader";
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
  async decide(): Promise<ModelDecision> {
    if (this.delayMs) await Bun.sleep(this.delayMs);
    if (this.next instanceof Error) throw this.next;
    return this.next;
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
  candleCloses() { return []; }
  refresh() { return Promise.resolve(); }
  readBook() { return book; }
  quoteSize() { return 0.01; }
  setLeverage(n: number) { return Promise.resolve(n); }
  setRunGuard() {}
  async send(side: Side, size: number, _book: Book, cancel: number[]): Promise<Quote> {
    this.sentSides.push(side);
    this.onSend?.();
    if (this.sendDelayMs) await Bun.sleep(this.sendDelayMs);
    this.lastOid = 4242;
    return {
      side, price: 99.9, size, txHash: null, cancel, status: "placed",
      orderId: 4242, capped: false, reduceOnly: false, taker: false,
    };
  }
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
        return packed({ intent: "open", bias: "short", action: "sell" });
      }
      return packed({ intent: "open", bias: "long", action: "buy" });
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
  model.decide = () => { calls++; return decide(); };
  const { events, trader } = desk(model);
  await trader.onBlock(1);
  model.next = packed({ intent: "hold", bias: "long", action: "hold" });
  await trader.onBlock(2);
  expect(calls).toBe(2);
  expect(events.find((e) => e.block === 2)?.decision?.late).toBe(false);
});

test("invalidation drops an inference result before it can submit", async () => {
  const model = new ScriptModel();
  const { trader, market } = desk(model);
  model.delayMs = 30;
  model.next = packed({ intent: "open", bias: "long", action: "buy" });
  const pending = trader.onBlock(1);
  await Bun.sleep(5);
  trader.invalidate();
  await pending;
  expect(market.lastOid).toBeNull();
});

test("BTC simulated fill preserves the exact quoted size", () => {
  const model = new ScriptModel();
  const market = new FakeMarket();
  let observed = Number.NaN;
  const trader = new Trader(
    market as unknown as Market,
    model,
    () => {},
    (_block, fill) => { observed = fill.size; },
  );
  const quoteSize = 0.00045;
  trader.attachTradeFeed({
    drainPrints: () => [{ block: 2, price: 99, size: quoteSize, side: "sell" }],
    drainFills: () => [],
  } as never);
  const internals = trader as unknown as {
    orders: Map<number, { side: Side; price: number; size: number; block: number }>;
    harvest(): void;
  };
  internals.orders.set(-1, { side: "buy", price: 100, size: quoteSize, block: 1 });
  internals.harvest();
  expect(observed).toBe(quoteSize);
});
