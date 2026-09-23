import { createGateway } from "@ai-sdk/gateway";
import { experimental_evaluate as evaluate } from "ai";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { assertJevCredentials, config, OPENROUTER_BASE_URL, runtimeEnv, type JevProvider } from "./config";
import { leverageRungs, liveIntent, parseLeverage, quoteAction } from "./plan";
import type { Bias, Intent, ModelDecision, TradeState } from "./types";

export interface Model {
  readonly name: string;
  decide(state: TradeState): Promise<ModelDecision>;
}

/** Book, tape, and the open position. Wallet fills and lifetime PnL stay off this object. */
export function marketFacing(state: TradeState) {
  const pos = state.position;
  return {
    coin: state.coin,
    market: state.market,
    tick: state.tick,
    tickMs: state.tickMs,
    mid: state.mid,
    spreadBps: state.spreadBps,
    bookImbalance: state.bookImbalance,
    depth: state.depth,
    book: state.book,
    returnsBps: state.returnsBps,
    recentMids: state.recentMids,
    trades: state.trades,
    recentTrades: state.recentTrades,
    position: {
      coin: pos.coin,
      side: pos.side,
      size: pos.size,
      notionalUsd: pos.notionalUsd,
      entry: pos.entry,
      leverage: pos.leverage,
      liquidationPx: pos.liquidationPx,
      distanceBps: pos.distanceBps,
      ...(pos.side === "flat" ? {} : { unrealizedUsd: pos.unrealizedUsd }),
    },
    indicators: state.indicators,
    asset: state.asset,
    maxLeverage: state.maxLeverage,
  };
}

/** Labels and live fields only. No advice about when to pick an action. */
export function jevQuestions(state: TradeState) {
  const asset = state.coin;
  const pos = state.position;
  const stance = pos.side === "flat"
    ? `flat ${asset}`
    : `${pos.side} ${pos.size} ${asset} @ ${pos.entry ?? "?"}`;
  const levNow = pos.leverage != null ? `${pos.leverage}x` : "unset";
  const rungs = leverageRungs(state.maxLeverage);
  const levCriteria: Record<string, string> = {};
  for (const n of rungs) {
    levCriteria[String(n)] = `${n}x`;
  }
  const ctx = `${asset} ${state.market}. position has side/size/entry. indicators are 1m sma/ema/rsi/vol. asset is mark/oracle/funding/oi. trades and book are the tape.`;
  const bias = {
    type: "choice" as const,
    instructions: {
      question: `long or short ${asset}?`,
      goal: `${state.market}`,
      timing: `tickMs=${state.tickMs}. position=${stance}.`,
      inputs: ctx,
    },
    criteria: {
      long: "long",
      short: "short",
    },
  };
  const leverage = {
    type: "choice" as const,
    instructions: {
      question: `cross leverage for ${asset}?`,
      goal: `current ${levNow}. max ${state.maxLeverage}x.`,
      timing: `rungs ${rungs.join(" ")}`,
      inputs: ctx,
    },
    criteria: levCriteria,
  };
  if (pos.side === "flat") {
    return {
      bias,
      intent: {
        type: "choice" as const,
        instructions: {
          question: `open or hold ${asset}?`,
          goal: `position=${stance}.`,
          timing: `tickMs=${state.tickMs}`,
          inputs: ctx,
        },
        criteria: {
          open: "open",
          hold: "hold",
        } as Record<string, string>,
      },
      leverage,
    };
  }
  return {
    bias,
    intent: {
      type: "choice" as const,
      instructions: {
        question: `open, close, or hold ${asset}?`,
        goal: `position=${stance}.`,
        timing: `tickMs=${state.tickMs}`,
        inputs: ctx,
      },
      criteria: {
        open: "open",
        close: "close",
        hold: "hold",
      } as Record<string, string>,
    },
    leverage,
  };
}

interface Packed {
  intent: Intent;
  bias: Bias;
  leverage: number;
  longP: number;
  shortP: number;
  openP: number;
  closeP: number;
  holdP: number;
  latencyMs: number;
  inputTokens: number;
}

function pack(o: Packed): ModelDecision {
  const action = quoteAction(o.intent, o.bias);
  // long/short and open/close/hold are each a distribution. buy/sell are the legacy
  // pair: the mass behind the order actually being sent, discounted by the hold mass.
  const conviction = action === "buy"
    ? Math.max(o.longP, o.openP)
    : action === "sell"
      ? Math.max(o.shortP, o.closeP)
      : 0;
  const sized = conviction * (1 - o.holdP);
  return {
    action,
    intent: o.intent,
    bias: o.bias,
    leverage: o.leverage,
    probabilities: {
      buy: action === "buy" ? sized : 0,
      sell: action === "sell" ? sized : 0,
      hold: o.holdP,
      long: o.longP,
      short: o.shortP,
      open: o.openP,
      close: o.closeP,
    },
    upIn10: o.longP,
    latencyMs: o.latencyMs,
    inputTokens: o.inputTokens,
  };
}

function normChoice(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function pick<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  const n = normChoice(raw);
  return (allowed as readonly string[]).includes(n) ? n as T : fallback;
}

function pickKnown<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  const n = normChoice(raw);
  return (allowed as readonly string[]).includes(n) ? n as T : null;
}

/** Normalize a choice answer over `keys`. Missing probabilities fall back to the pick. */
function choiceProbs(answer: ChoiceAnswer | undefined, keys: readonly string[]): Record<string, number> {
  const choice = normChoice(answer?.choice);
  const p = answer?.probabilities ?? {};
  const raw = keys.map((k) => Math.max(0, p[k] ?? (choice === k ? 1 : 0)));
  const sum = raw.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  if (sum <= 0) {
    const at = keys.indexOf(choice);
    if (at < 0) {
      keys.forEach((k) => { out[k] = 1 / keys.length; });
      return out;
    }
    keys.forEach((k, i) => { out[k] = i === at ? 1 : 0; });
    return out;
  }
  keys.forEach((k, i) => { out[k] = raw[i]! / sum; });
  return out;
}

type ChoiceAnswer = { choice?: string; probabilities?: Record<string, number> };
type JevAnswers = { bias?: ChoiceAnswer; intent?: ChoiceAnswer; leverage?: ChoiceAnswer };

/** Map a Jev answer set onto one tick. A side we cannot read is a hold, not a long. */
export function decideFromJevAnswers(
  answers: JevAnswers,
  positionSide: "long" | "short" | "flat",
  maxLeverage: number,
  currentLeverage: number | null,
  latencyMs = 0,
  inputTokens = 0,
): ModelDecision {
  const flat = positionSide === "flat";
  const biasPick = pickKnown(answers.bias?.choice, ["long", "short"] as const);
  const choices = flat ? (["open", "hold"] as const) : (["open", "close", "hold"] as const);
  const intent = liveIntent(positionSide, biasPick ? pick(answers.intent?.choice, choices, "hold") : "hold");
  const dir = choiceProbs(answers.bias, ["long", "short"]);
  const act = choiceProbs(answers.intent, choices);
  return pack({
    intent,
    bias: biasPick ?? "long",
    leverage: parseLeverage(answers.leverage?.choice, maxLeverage, currentLeverage ?? 1),
    longP: dir.long!,
    shortP: dir.short!,
    openP: act.open!,
    closeP: act.close ?? 0,
    holdP: act.hold!,
    latencyMs,
    inputTokens,
  });
}

const gateway = createGateway({ apiKey: runtimeEnv.AI_GATEWAY_API_KEY });
let typesafe: TypeSafeClient | undefined;
let openrouter: TypeSafeClient | undefined;

function sdkClient(provider: Exclude<JevProvider, "gateway">): TypeSafeClient {
  if (provider === "openrouter") {
    return (openrouter ??= new TypeSafeClient({
      apiKey: runtimeEnv.OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
      defaultModel: config.jevModelId,
      retry: { maxRetries: 0 },
    }));
  }
  return (typesafe ??= new TypeSafeClient({
    apiKey: runtimeEnv.TYPESAFE_API_KEY,
    defaultModel: config.jevModelId,
    retry: { maxRetries: 0 },
  }));
}

async function callJev(state: TradeState): Promise<{ answers: JevAnswers; inputTokens: number }> {
  const seen = marketFacing(state);
  const qs = jevQuestions(state);
  const run = async () => {
    if (config.jevProvider === "gateway") {
      const r = await evaluate({
        model: gateway.evaluationModel(config.jevModelId),
        state: seen as never,
        questions: qs,
        maxRetries: 0,
      });
      return { answers: r.answers, inputTokens: r.usage?.inputTokens ?? 0 };
    }
    const r = await sdkClient(config.jevProvider).systemOne(
      {
        model: config.jevModelId,
        state: seen as never,
        questions: qs,
      },
      { retry: { maxRetries: 0 } },
    );
    return { answers: r.answers, inputTokens: r.usage.input_tokens ?? 0 };
  };
  // The server may time out its response, but owns the permit until this settles.
  return run();
}

/** Real Jev. JEV_PROVIDER selects OpenRouter, official TypeSafe, or Vercel AI Gateway. */
export class JevModel implements Model {
  readonly name = "jev";

  async decide(state: TradeState): Promise<ModelDecision> {
    const t0 = performance.now();
    const r = await callJev(state);
    return decideFromJevAnswers(
      r.answers,
      state.position.side,
      state.maxLeverage,
      state.position.leverage,
      performance.now() - t0,
      r.inputTokens,
    );
  }
}

/** Deterministic stand-in: momentum + imbalance. Jev-shaped open/close/hold/long/short/leverage. */
export class MockModel implements Model {
  readonly name = "mock";

  async decide(state: TradeState): Promise<ModelDecision> {
    const t0 = performance.now();
    const flow = state.trades.buySz + state.trades.sellSz ? state.trades.cvdSz / (state.trades.buySz + state.trades.sellSz) : 0;
    const signal = state.returnsBps.last20 / 8 + state.bookImbalance * 1.5 + flow * 2 + this.noise(state.tick);
    const longP = 1 / (1 + Math.exp(-signal));
    const bias: Bias = longP >= 0.5 ? "long" : "short";
    const against = (bias === "long" && state.position.side === "short") || (bias === "short" && state.position.side === "long");
    // A weak signal is not worth a round trip, so stand down instead of forcing a side.
    const weak = Math.abs(signal) < 0.35;
    const picked: Intent = against ? "close" : weak ? "hold" : "open";
    const intent = liveIntent(state.position.side, picked);
    const holdP = intent === "hold" ? 0.7 : 0.15;
    const closeP = intent === "close" ? 0.7 : 0.15;
    const leverage = parseLeverage(1 + Math.abs(signal) * 8, state.maxLeverage, state.position.leverage ?? 1);
    await Bun.sleep(80);
    return pack({
      intent,
      bias,
      leverage,
      longP,
      shortP: 1 - longP,
      openP: Math.max(0, 1 - holdP - closeP),
      closeP,
      holdP,
      latencyMs: performance.now() - t0,
      inputTokens: Math.round(JSON.stringify(state).length / 4),
    });
  }

  private noise(tick: number) {
    let h = tick * 2654435761 >>> 0;
    h ^= h >>> 15; h = (h * 2246822519) >>> 0; h ^= h >>> 13;
    return ((h % 1000) / 1000 - 0.5) * 3;
  }
}

export const createModel = (): Model => {
  if (config.model === "mock" && !config.production) return new MockModel();
  assertJevCredentials(config.model, config.jevProvider, runtimeEnv);
  return new JevModel();
};
