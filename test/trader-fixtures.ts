import type { DecisionJournalEvent } from "../src/decision-events";
import { PROGRAM_RECORD_TYPE, type GroupResult } from "../src/jev-evidence";
import type { Market } from "../src/market";
import { activateProgram, captureProgram, DEFAULT_PROGRAM } from "../src/jev-program";
import { type Model, type ModelDecision, type ModelEvaluation, type TradeState } from "../src/model";
import { Trader } from "../src/trader";
import type { MakerFill } from "../src/trades";
import type { BlockEvent, Book, Quote, Side } from "../src/types";

export const book: Book = {
  block: 1,
  bid: 99.9,
  ask: 100.1,
  mid: 100,
  spreadBps: 20,
  imbalance: 0,
  levels: { bids: [[99.9, 1]], asks: [[100.1, 1]] },
  depthBps: { "10": { bid: 1, ask: 1 } },
};

export function packed(partial: Partial<ModelDecision> & Pick<ModelDecision, "intent" | "bias" | "action">): ModelDecision {
  return {
    leverage: 1,
    probabilities: { buy: 0, sell: 0, hold: 1, long: 0.5, short: 0.5, open: 0, close: 0 },
    upIn10: 0.5,
    latencyMs: 1,
    inputTokens: 0,
    ...partial,
  };
}

export function evaluationFor(
  state: TradeState,
  decision: ModelDecision | null,
  observations: Promise<readonly GroupResult[]> = Promise.resolve([]),
): ModelEvaluation {
  const capture = captureProgram(activateProgram(DEFAULT_PROGRAM, "local"), state, Date.now());
  const required: GroupResult = {
    groupId: capture.requiredGroupId,
    status: decision === null ? "failed" : "complete",
    answers: [],
    unexpected: [],
    provider: { name: "local", model: "script" },
    timing: { startedAt: capture.capturedAt, completedAt: capture.capturedAt, latencyMs: 1 },
    ...(decision === null ? { failure: { code: "provider_error", message: "provider request failed" } } : {}),
  };
  return {
    decision,
    evidence: { recordType: PROGRAM_RECORD_TYPE, capture, required, status: decision === null ? "failed" : "complete" },
    observations,
  };
}

export function observationResult(): GroupResult {
  return {
    groupId: "watch", status: "complete",
    answers: [{
      key: "watch", declaredType: "choice", groupId: "watch", role: "observational",
      status: "answered", raw: null, answer: { type: "choice", choice: "open" },
    }],
    unexpected: [], provider: { name: "local", model: "script" },
    timing: { startedAt: 1, completedAt: 2, latencyMs: 1 },
  };
}

export class ScriptModel implements Model {
  readonly name = "script";
  next: ModelDecision | null | Error = packed({ intent: "hold", bias: "long", action: "hold" });
  delayMs = 0;
  observations: Promise<readonly GroupResult[]> = Promise.resolve([]);
  async decide(state: TradeState): Promise<ModelEvaluation> {
    if (this.delayMs) await Bun.sleep(this.delayMs);
    if (this.next instanceof Error) throw this.next;
    return evaluationFor(state, this.next, this.observations);
  }
}

export class FakeMarket {
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

export function desk(model: Model, market = new FakeMarket(), journal?: { enqueue(event: DecisionJournalEvent): void }) {
  const events: BlockEvent[] = [];
  const trader = new Trader(market as unknown as Market, model, (e) => events.push(e), undefined, undefined, journal);
  return { trader, market, events };
}
