import { assertJevCredentials, config, runtimeEnv } from "./config";
import { marketFacing } from "./jev-features";
import { boundedRaw } from "./jev-answers";
import { activateProgram, captureProgram, DEFAULT_PROGRAM } from "./jev-program";
import { callProviderGroup, failedGroupResult } from "./jev-provider";
import type {
  ActiveProgram,
  EvaluationEvidence,
  GroupResult,
  GroupSnapshot,
  ProgramCapture,
  ProviderAnswer,
  ProviderTarget,
  QuestionEvidence,
} from "./jev-evidence";
import { liveIntent, parseLeverage, quoteAction, type Bias, type Intent } from "./plan";
import type { Action, Side } from "./types";

export interface TradeState {
  coin: string;
  market: string;
  tick: number;
  tickMs: number;
  mid: number;
  spreadBps: number;
  bookImbalance: number;
  depth: { [band: string]: { bid: number; ask: number } };
  book: { bids: string[]; asks: string[] };
  returnsBps: { last1: number; last5: number; last20: number; last100: number };
  recentMids: string;
  trades: { count: number; buySz: number; sellSz: number; cvdSz: number; vwap: number | null; lastPrice: number | null; lastSide: Side | null };
  recentTrades: string[];
  position: {
    coin: string;
    side: "long" | "short" | "flat";
    size: number;
    notionalUsd: number;
    entry: number | null;
    leverage: number | null;
    liquidationPx: number | null;
    distanceBps: number | null;
    unrealizedUsd: number;
  };
  indicators: {
    sma20: number | null;
    sma50: number | null;
    ema20: number | null;
    midVsSma20Bps: number | null;
    midVsSma50Bps: number | null;
    rsi14: number | null;
    vol20Bps: number | null;
    high20: number | null;
    low20: number | null;
    rangePos20: number | null;
  };
  asset: {
    markPx: number | null;
    oraclePx: number | null;
    fundingBps: number | null;
    premiumBps: number | null;
    openInterest: number | null;
    dayNtlVlmUsd: number | null;
    dayChangeBps: number | null;
    maxLeverage: number;
  };
  maxLeverage: number;
}

export interface ModelDecision {
  action: Action;
  intent: Intent;
  bias: Bias;
  leverage: number;
  probabilities: {
    buy: number;
    sell: number;
    hold: number;
    long: number;
    short: number;
    open: number;
    close: number;
  };
  upIn10: number;
  latencyMs: number;
  inputTokens: number;
}

export interface ModelEvaluation {
  decision: ModelDecision | null;
  evidence: EvaluationEvidence;
  observations: Promise<readonly GroupResult[]>;
}

export interface Model {
  readonly name: string;
  decide(state: TradeState): Promise<ModelEvaluation>;
}

export type CallGroup = (snapshot: GroupSnapshot, target: ProviderTarget) => Promise<GroupResult>;

export interface JevModelOptions {
  program?: ActiveProgram;
  callGroup?: CallGroup;
  target?: ProviderTarget;
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

function projectedChoice(answer: ProviderAnswer): ChoiceAnswer | undefined {
  if (answer.type !== "choice") return undefined;
  return {
    choice: answer.choice,
    ...(answer.probabilities ? { probabilities: answer.probabilities } : {}),
  };
}

function projectRequiredAnswers(result: GroupResult): JevAnswers {
  const projected: JevAnswers = {};
  for (const row of result.answers) {
    if (row.role !== "required" || row.status !== "answered" || !row.answer) continue;
    const answer = projectedChoice(row.answer);
    if (!answer) continue;
    if (row.key === "bias" || row.key === "intent" || row.key === "leverage") projected[row.key] = answer;
  }
  return projected;
}

export class JevModel implements Model {
  readonly name = "jev";
  private readonly target: ProviderTarget;
  private readonly callGroup: CallGroup;
  private program: ActiveProgram;

  constructor(options: JevModelOptions = {}) {
    this.target = options.target ?? { provider: config.jevProvider, modelId: config.jevModelId };
    this.callGroup = options.callGroup ?? callProviderGroup;
    this.program = activateProgram(
      options.program?.definition ?? DEFAULT_PROGRAM,
      this.target.provider,
      options.program?.revision,
    );
  }

  setProgram(program: ActiveProgram): void {
    this.program = activateProgram(program.definition, this.target.provider, program.revision);
  }

  private startGroup(snapshot: GroupSnapshot): Promise<GroupResult> {
    const startedAt = Date.now();
    const startedPerf = performance.now();
    try {
      return this.callGroup(snapshot, this.target).catch(() =>
        failedGroupResult(snapshot, this.target.provider, "provider_error", startedAt, startedPerf));
    } catch {
      return Promise.resolve(failedGroupResult(snapshot, this.target.provider, "provider_error", startedAt, startedPerf));
    }
  }

  async decide(state: TradeState): Promise<ModelEvaluation> {
    const program = this.program;
    const capture = captureProgram(program, state, Date.now());
    const side = state.position.side;
    const maxLeverage = state.maxLeverage;
    const currentLeverage = state.position.leverage;
    const pending = capture.groups.map((snapshot) => ({ snapshot, result: this.startGroup(snapshot) }));
    const requiredCall = pending.find(({ snapshot }) => snapshot.groupId === capture.requiredGroupId);
    if (!requiredCall) throw new Error("required Jev group is missing from captured program");
    const observations = Promise.all(
      pending.filter(({ snapshot }) => snapshot.groupId !== capture.requiredGroupId).map(({ result }) => result),
    );
    const required = await requiredCall.result;
    if (required.status === "failed" || required.status === "timeout") {
      return {
        decision: null,
        evidence: { recordType: capture.recordType, capture, required, status: "failed" },
        observations,
      };
    }
    const decision = decideFromJevAnswers(
      projectRequiredAnswers(required),
      side,
      maxLeverage,
      currentLeverage,
      required.timing.latencyMs,
      required.provider.usage?.inputTokens ?? 0,
    );
    return {
      decision,
      evidence: {
        recordType: capture.recordType,
        capture,
        required,
        status: required.status === "complete" ? "complete" : "invalid",
      },
      observations,
    };
  }
}

function mockEvidence(
  capture: ProgramCapture,
  answers: Record<string, { choice: string; probabilities: Record<string, number> }>,
  inputTokens: number,
  startedAt: number,
  startedPerf: number,
): EvaluationEvidence {
  const trade = capture.groups.find(({ groupId }) => groupId === capture.requiredGroupId)!;
  const rows: QuestionEvidence[] = trade.questions.map((question) => {
    const answer = { type: "choice" as const, ...answers[question.key]! };
    return {
      key: question.key,
      declaredType: question.type,
      groupId: trade.groupId,
      role: question.role,
      status: "answered",
      raw: boundedRaw(answer),
      answer,
    };
  });
  const completedAt = Date.now();
  const required: GroupResult = {
    groupId: trade.groupId,
    status: "complete",
    answers: rows,
    unexpected: [],
    provider: { name: "local", model: "mock", usage: { inputTokens } },
    timing: { startedAt, completedAt, latencyMs: performance.now() - startedPerf },
  };
  return { recordType: capture.recordType, capture, required, status: "complete" };
}

export class MockModel implements Model {
  readonly name = "mock";
  private readonly program = activateProgram(DEFAULT_PROGRAM, "local");

  async decide(state: TradeState): Promise<ModelEvaluation> {
    const capture = captureProgram(this.program, state, Date.now());
    const trade = capture.groups.find(({ groupId }) => groupId === capture.requiredGroupId)!;
    const seen = marketFacing(state);
    const startedAt = Date.now();
    const startedPerf = performance.now();
    const flow = seen.trades.buySz + seen.trades.sellSz ? seen.trades.cvdSz / (seen.trades.buySz + seen.trades.sellSz) : 0;
    const signal = seen.returnsBps.last20 / 8 + seen.bookImbalance * 1.5 + flow * 2 + this.noise(seen.tick);
    const longP = 1 / (1 + Math.exp(-signal));
    const bias: Bias = longP >= 0.5 ? "long" : "short";
    const against = (bias === "long" && seen.position.side === "short") || (bias === "short" && seen.position.side === "long");
    const weak = Math.abs(signal) < 0.35;
    const picked: Intent = against ? "close" : weak ? "hold" : "open";
    const intent = liveIntent(seen.position.side, picked);
    const holdP = intent === "hold" ? 0.7 : 0.15;
    const closeP = intent === "close" ? 0.7 : 0.15;
    const leverage = parseLeverage(1 + Math.abs(signal) * 8, seen.maxLeverage, seen.position.leverage ?? 1);
    const longProbabilities = { long: longP, short: 1 - longP };
    const intentProbabilities: Record<string, number> = {
      open: Math.max(0, 1 - holdP - closeP),
      hold: holdP,
    };
    const intentQuestion = trade.questions.find(({ key }) => key === "intent");
    if (intentQuestion?.criteria && !Array.isArray(intentQuestion.criteria) && "close" in intentQuestion.criteria) {
      intentProbabilities.close = closeP;
    }
    const leverageQuestion = trade.questions.find(({ key }) => key === "leverage")!;
    const leverageProbabilities = Object.fromEntries(
      Object.keys(leverageQuestion.criteria ?? {}).map((key) => [key, key === String(leverage) ? 1 : 0]),
    );
    const answers = {
      bias: { choice: bias, probabilities: longProbabilities },
      intent: { choice: intent, probabilities: intentProbabilities },
      leverage: { choice: String(leverage), probabilities: leverageProbabilities },
    };
    const inputTokens = Math.round(JSON.stringify(trade.state).length / 4);
    await Bun.sleep(80);
    const decision = pack({
      intent,
      bias,
      leverage,
      longP,
      shortP: 1 - longP,
      openP: Math.max(0, 1 - holdP - closeP),
      closeP,
      holdP,
      latencyMs: performance.now() - startedPerf,
      inputTokens,
    });
    return {
      decision,
      evidence: mockEvidence(capture, answers, inputTokens, startedAt, startedPerf),
      observations: Promise.resolve([]),
    };
  }

  private noise(tick: number): number {
    let h = tick * 2654435761 >>> 0;
    h ^= h >>> 15; h = (h * 2246822519) >>> 0; h ^= h >>> 13;
    return ((h % 1000) / 1000 - 0.5) * 3;
  }
}

export const createModel = (): Model => {
  if (config.model !== "jev") return new MockModel();
  assertJevCredentials(config.model, config.jevProvider, runtimeEnv);
  return new JevModel();
};
