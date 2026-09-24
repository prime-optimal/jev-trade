import { expect, test } from "bun:test";
import {
  decideFromJevAnswers,
  JevModel,
  MockModel,
  type TradeState,
} from "../src/model";
import { parseGroupAnswers } from "../src/jev-answers";
import { activateProgram, captureProgram, DEFAULT_PROGRAM } from "../src/jev-program";
import { failedGroupResult } from "../src/jev-provider";
import type { GroupResult, GroupSnapshot, ProviderTarget } from "../src/jev-evidence";

function fixture(side: TradeState["position"]["side"]): TradeState {
  return {
    coin: "BTC",
    market: "BTC-USD",
    tick: 1,
    tickMs: 500,
    mid: 77000,
    spreadBps: 0.13,
    bookImbalance: 0,
    depth: {},
    book: { bids: [], asks: [] },
    returnsBps: { last1: 0, last5: 0, last20: 0, last100: 0 },
    recentMids: "",
    trades: { count: 0, buySz: 0, sellSz: 0, cvdSz: 0, vwap: null, lastPrice: null, lastSide: null },
    recentTrades: [],
    position: {
      coin: "BTC",
      side,
      size: side === "flat" ? 0 : 0.001,
      notionalUsd: side === "flat" ? 0 : 77,
      entry: side === "flat" ? null : 77000,
      leverage: 1,
      liquidationPx: null,
      distanceBps: null,
      unrealizedUsd: side === "flat" ? 0 : -1.25,
    },
    indicators: {
      sma20: null, sma50: null, ema20: null, midVsSma20Bps: null, midVsSma50Bps: null,
      rsi14: null, vol20Bps: null, high20: null, low20: null, rangePos20: null,
    },
    asset: {
      markPx: null, oraclePx: null, fundingBps: null, premiumBps: null,
      openInterest: null, dayNtlVlmUsd: null, dayChangeBps: null, maxLeverage: 40,
    },
    maxLeverage: 40,
  };
}

const gatewayTarget: ProviderTarget = { provider: "gateway", modelId: "test-model" };

function programWithObservation(provider: "gateway" | "typesafe" = "gateway", instructions = "Report market tone.") {
  return activateProgram({
    ...DEFAULT_PROGRAM,
    questions: [
      ...DEFAULT_PROGRAM.questions,
      {
        key: "sentiment",
        type: "boolean",
        role: "observational",
        instructions,
        criteria: { true: "Positive", false: "Negative" },
      },
    ],
    groups: [
      ...DEFAULT_PROGRAM.groups,
      { id: "observation", features: ["mid"], questions: ["sentiment"] },
    ],
  }, provider);
}

function requiredAnswers(snapshot: GroupSnapshot, bias = "long", intent = "open", leverage = "2") {
  const intentQuestion = snapshot.questions.find(({ key }) => key === "intent")!;
  const leverageQuestion = snapshot.questions.find(({ key }) => key === "leverage")!;
  const intentProbabilities = Object.fromEntries(
    Object.keys(intentQuestion.criteria ?? {}).map((key) => [key, key === intent ? 0.8 : 0.2]),
  );
  const leverageProbabilities = Object.fromEntries(
    Object.keys(leverageQuestion.criteria ?? {}).map((key) => [key, key === leverage ? 1 : 0]),
  );
  return {
    bias: { type: "choice", choice: bias, probabilities: { long: 0.8, short: 0.2 } },
    intent: { type: "choice", choice: intent, probabilities: intentProbabilities },
    leverage: { type: "choice", choice: leverage, probabilities: leverageProbabilities },
  };
}

function groupResult(snapshot: GroupSnapshot, answers: Record<string, unknown>): GroupResult {
  const parsed = parseGroupAnswers(snapshot, answers);
  return {
    groupId: snapshot.groupId,
    status: parsed.status,
    answers: parsed.answers,
    unexpected: parsed.unexpected,
    provider: { name: "gateway", model: "test-model", usage: { inputTokens: 7 } },
    timing: { startedAt: 10, completedAt: 15, latencyMs: 5 },
  };
}

function resultFor(snapshot: GroupSnapshot): GroupResult {
  return snapshot.groupId === "trade"
    ? groupResult(snapshot, requiredAnswers(snapshot))
    : groupResult(snapshot, { sentiment: { type: "boolean", probability: 0.75 } });
}

test("required and observational groups start before decide resolves, which waits only for required", async () => {
  const program = programWithObservation();
  const starts: string[] = [];
  let finishObservation!: (result: GroupResult) => void;
  let observationSnapshot: GroupSnapshot | undefined;
  const observation = new Promise<GroupResult>((resolve) => { finishObservation = resolve; });
  const model = new JevModel({
    program,
    target: gatewayTarget,
    callGroup: (snapshot) => {
      starts.push(snapshot.groupId);
      if (snapshot.groupId === "observation") {
        observationSnapshot = snapshot;
        return observation;
      }
      return Promise.resolve(resultFor(snapshot));
    },
  });

  const decisionPromise = model.decide(fixture("flat"));
  expect(starts).toEqual(["trade", "observation"]);
  const evaluation = await decisionPromise;
  let observationsSettled = false;
  evaluation.observations.then(() => { observationsSettled = true; });
  await Promise.resolve();
  expect(evaluation.decision?.action).toBe("buy");
  expect(observationsSettled).toBe(false);

  finishObservation(resultFor(observationSnapshot!));
  expect((await evaluation.observations).map(({ groupId }) => groupId)).toEqual(["observation"]);
});

test("observational timeout, rejection, and invalid answers leave required evidence unchanged", async () => {
  const program = programWithObservation();
  const outcomes: Array<"timeout" | "rejection" | "invalid"> = ["timeout", "rejection", "invalid"];
  for (const outcome of outcomes) {
    const model = new JevModel({
      program,
      target: gatewayTarget,
      callGroup: (snapshot, target) => {
        if (snapshot.groupId === "trade") return Promise.resolve(resultFor(snapshot));
        if (outcome === "timeout") return Promise.resolve(failedGroupResult(snapshot, target.provider, "timeout", 10, 1));
        if (outcome === "rejection") return Promise.reject(new Error("private transport response"));
        return Promise.resolve(groupResult(snapshot, { sentiment: { type: "boolean", probability: 2 } }));
      },
    });
    const evaluation = await model.decide(fixture("flat"));
    const observations = await evaluation.observations;
    expect(evaluation.decision?.action).toBe("buy");
    expect(evaluation.evidence.status).toBe("complete");
    expect(evaluation.evidence.required.status).toBe("complete");
    expect(observations).toHaveLength(1);
    if (outcome === "timeout") expect(observations[0]?.status).toBe("timeout");
    if (outcome === "rejection") {
      expect(observations[0]?.status).toBe("failed");
      expect(observations[0]?.failure?.message).not.toContain("private transport response");
    }
    if (outcome === "invalid") expect(observations[0]?.status).toBe("invalid");
  }
});

test("required provider failure and timeout return no decision", async () => {
  for (const outcome of ["provider_error", "timeout"] as const) {
    const model = new JevModel({
      target: gatewayTarget,
      callGroup: (snapshot, target) => Promise.resolve(failedGroupResult(snapshot, target.provider, outcome, 10, 1)),
    });
    const evaluation = await model.decide(fixture("flat"));
    expect(evaluation.decision).toBeNull();
    expect(evaluation.evidence.status).toBe("failed");
    expect(evaluation.evidence.required.status).toBe(outcome === "timeout" ? "timeout" : "failed");
    expect(await evaluation.observations).toEqual([]);
  }
});

test("an explicit hold is complete, while an unreadable bias safely holds as invalid", async () => {
  const holdModel = new JevModel({
    target: gatewayTarget,
    callGroup: (snapshot) => Promise.resolve(groupResult(snapshot, requiredAnswers(snapshot, "long", "hold"))),
  });
  const hold = await holdModel.decide(fixture("flat"));
  expect(hold.decision?.action).toBe("hold");
  expect(hold.decision?.intent).toBe("hold");
  expect(hold.evidence.status).toBe("complete");

  const invalidModel = new JevModel({
    target: gatewayTarget,
    callGroup: (snapshot) => Promise.resolve(groupResult(snapshot, requiredAnswers(snapshot, "unreadable"))),
  });
  const invalid = await invalidModel.decide(fixture("flat"));
  expect(invalid.decision?.action).toBe("hold");
  expect(invalid.evidence.status).toBe("invalid");
});

test("captured group evidence is frozen and detached from later state mutation", async () => {
  let frozenSnapshot = false;
  const model = new JevModel({
    target: gatewayTarget,
    callGroup: (snapshot) => {
      frozenSnapshot = Object.isFrozen(snapshot) && Object.isFrozen(snapshot.state) && Object.isFrozen(snapshot.state.position);
      return Promise.resolve(groupResult(snapshot, requiredAnswers(snapshot)));
    },
  });
  const state = fixture("flat");
  const pending = model.decide(state);
  state.mid = 1;
  state.position.side = "short";
  const evaluation = await pending;
  const capturedTrade = evaluation.evidence.capture.groups.find(({ groupId }) => groupId === "trade")!;
  expect(frozenSnapshot).toBe(true);
  expect(capturedTrade.state.mid).toBe(77000);
  expect(capturedTrade.state.position).toMatchObject({ side: "flat", size: 0 });
  expect(evaluation.decision?.action).toBe("buy");
});

test("setProgram selects a new revision and rejects a program unsupported by its provider", async () => {
  const firstProgram = programWithObservation("gateway", "Report market tone.");
  const secondProgram = programWithObservation("gateway", "Report market tone using the latest tick.");
  const model = new JevModel({
    program: firstProgram,
    target: gatewayTarget,
    callGroup: (snapshot) => Promise.resolve(resultFor(snapshot)),
  });
  const first = await model.decide(fixture("flat"));
  model.setProgram(secondProgram);
  const second = await model.decide(fixture("flat"));
  expect(second.evidence.capture.revision).not.toBe(first.evidence.capture.revision);

  const typesafe = new JevModel({
    target: { provider: "typesafe", modelId: "test-model" },
    callGroup: (snapshot) => Promise.resolve(resultFor(snapshot)),
  });
  expect(() => typesafe.setProgram(firstProgram)).toThrow();
});

test("mock model returns complete typed evidence and snapshot-based token usage", async () => {
  const state = fixture("long");
  const evaluation = await new MockModel().decide(state);
  const active = activateProgram(DEFAULT_PROGRAM, "local");
  const capture = captureProgram(active, state, 0);
  const trade = capture.groups.find(({ groupId }) => groupId === capture.requiredGroupId)!;
  const inputTokens = Math.round(JSON.stringify(trade.state).length / 4);

  expect(evaluation.evidence.status).toBe("complete");
  expect(evaluation.evidence.required.status).toBe("complete");
  expect(evaluation.evidence.required.answers).toHaveLength(3);
  expect(evaluation.evidence.required.answers.map(({ key, status, declaredType, answer }) => [key, status, declaredType, answer?.type])).toEqual([
    ["bias", "answered", "choice", "choice"],
    ["intent", "answered", "choice", "choice"],
    ["leverage", "answered", "choice", "choice"],
  ]);
  expect(evaluation.evidence.required.answers[2]?.answer).toMatchObject({
    type: "choice",
    choice: String(evaluation.decision?.leverage),
  });
  expect(evaluation.decision?.inputTokens).toBe(inputTokens);
  expect(evaluation.evidence.required.provider.usage?.inputTokens).toBe(inputTokens);
  expect(await evaluation.observations).toEqual([]);
});

test("a short answer keeps its case and still sells", () => {
  for (const choice of ["SHORT", "Short", " short "]) {
    const decision = decideFromJevAnswers(
      { bias: { choice }, intent: { choice: "open" }, leverage: { choice: "2" } },
      "flat",
      40,
      1,
    );
    expect(decision.bias).toBe("short");
    expect(decision.intent).toBe("open");
    expect(decision.action).toBe("sell");
  }
});

test("an unrecognised bias stands down instead of opening long", () => {
  const decision = decideFromJevAnswers(
    { bias: { choice: "up" }, intent: { choice: "open" }, leverage: { choice: "5" } },
    "flat",
    40,
    1,
  );
  expect(decision.intent).toBe("hold");
  expect(decision.action).toBe("hold");
  expect(decision.probabilities.long).toBe(decision.probabilities.short);
  expect(decision.probabilities.long).toBeLessThan(1);
});
