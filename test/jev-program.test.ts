import { expect, test } from "bun:test";
import {
  activateProgram,
  captureProgram,
  DEFAULT_PROGRAM,
  PROGRAM_SCHEMA,
  PROJECTION_VERSION,
  PROVIDER_QUESTION_TYPES,
  REQUIRED_KEYS,
  programRevision,
  validateProgram,
  type ValidationIssue,
} from "../src/jev-program";
import { FEATURE_CATALOG_VERSION, marketFacing } from "../src/jev-features";
import type { ProgramDefinition, QuestionType, ResolvedQuestion } from "../src/jev-evidence";
import type { TradeState } from "../src/model";

type MutableQuestion = {
  key: string;
  type: QuestionType;
  role?: "required" | "observational";
  instructions?: string | Record<string, string>;
  criteria?: Record<string, string | null> | (string | null)[];
  resolver?: { id: string; version: number };
};
type MutableProgram = {
  schema: string;
  catalogVersion: string;
  questions: MutableQuestion[];
  groups: Array<{ id: string; features: string[]; questions: string[] }>;
  projection: { version: string; keys: string[] };
  [key: string]: unknown;
};

function mutableDefault(): MutableProgram {
  return structuredClone(DEFAULT_PROGRAM) as unknown as MutableProgram;
}

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
      leverage: side === "flat" ? null : 3,
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

function observationProgram(type: QuestionType = "score"): MutableProgram {
  const program = mutableDefault();
  const extra: MutableQuestion = {
    key: "score",
    type,
    instructions: { question: "rate the market" },
  };
  if (type === "choice") extra.criteria = { low: "low", high: "high" };
  if (type === "score") extra.criteria = ["low", "high"];
  program.questions.push(extra);
  program.groups.push({ id: "observe", features: ["mid"], questions: ["score"] });
  return program;
}

function expectIssue(program: unknown, path: string, provider: "gateway" | "typesafe" | "openrouter" | "local" = "gateway"): readonly ValidationIssue[] {
  const issues = validateProgram(program, provider);
  expect(issues.some((issue) => issue.path === path)).toBe(true);
  return issues;
}

function resolved(key: string, instructions: ResolvedQuestion["instructions"], criteria: ResolvedQuestion["criteria"]): ResolvedQuestion {
  return {
    key,
    type: "choice",
    role: "required",
    instructions,
    criteria,
    resolver: { id: `jev.${key}`, version: 1 },
  };
}

const inputs = "BTC BTC-USD. position has side/size/entry. indicators are 1m sma/ema/rsi/vol. asset is mark/oracle/funding/oi. trades and book are the tape.";
const leverageCriteria = { "1": "1x", "2": "2x", "3": "3x", "5": "5x", "10": "10x", "20": "20x", "40": "40x" };

test("program constants and provider type allowlists match the contract", () => {
  expect(PROGRAM_SCHEMA).toBe("jev-program-2026-09-24.1");
  expect(PROJECTION_VERSION).toBe("jev-trade-projection-1");
  expect(FEATURE_CATALOG_VERSION).toBe("jev-features-2026-09-24.1");
  expect(REQUIRED_KEYS).toEqual(["bias", "intent", "leverage"]);
  expect(PROVIDER_QUESTION_TYPES).toEqual({
    openrouter: ["choice", "score", "noul"],
    typesafe: ["choice", "score", "noul"],
    gateway: ["choice", "score", "boolean"],
    local: ["choice"],
  });
});

const flatQuestions = [
  resolved("bias", {
    question: "long or short BTC?",
    goal: "BTC-USD",
    timing: "tickMs=500. position=flat BTC.",
    inputs,
  }, { long: "long", short: "short" }),
  resolved("intent", {
    question: "open or hold BTC?",
    goal: "position=flat BTC.",
    timing: "tickMs=500",
    inputs,
  }, { open: "open", hold: "hold" }),
  resolved("leverage", {
    question: "cross leverage for BTC?",
    goal: "current unset. max 40x.",
    timing: "rungs 1 2 3 5 10 20 40",
    inputs,
  }, leverageCriteria),
];

const longQuestions = [
  resolved("bias", {
    question: "long or short BTC?",
    goal: "BTC-USD",
    timing: "tickMs=500. position=long 0.001 BTC @ 77000.",
    inputs,
  }, { long: "long", short: "short" }),
  resolved("intent", {
    question: "open, close, or hold BTC?",
    goal: "position=long 0.001 BTC @ 77000.",
    timing: "tickMs=500",
    inputs,
  }, { open: "open", close: "close", hold: "hold" }),
  resolved("leverage", {
    question: "cross leverage for BTC?",
    goal: "current 3x. max 40x.",
    timing: "rungs 1 2 3 5 10 20 40",
    inputs,
  }, leverageCriteria),
];

const shortQuestions = [
  resolved("bias", {
    question: "long or short BTC?",
    goal: "BTC-USD",
    timing: "tickMs=500. position=short 0.001 BTC @ 77000.",
    inputs,
  }, { long: "long", short: "short" }),
  resolved("intent", {
    question: "open, close, or hold BTC?",
    goal: "position=short 0.001 BTC @ 77000.",
    timing: "tickMs=500",
    inputs,
  }, { open: "open", close: "close", hold: "hold" }),
  resolved("leverage", {
    question: "cross leverage for BTC?",
    goal: "current 3x. max 40x.",
    timing: "rungs 1 2 3 5 10 20 40",
    inputs,
  }, leverageCriteria),
];

test("default capture matches literal flat, long, and short Jev questions", () => {
  const active = activateProgram(DEFAULT_PROGRAM, "gateway");
  for (const [side, expected] of [["flat", flatQuestions], ["long", longQuestions], ["short", shortQuestions]] as const) {
    const state = fixture(side);
    const capture = captureProgram(active, state, 1234);
    expect(capture.groups[0]!.questions).toEqual(expected);
    expect(capture.groups[0]!.state).toEqual(marketFacing(state));
    expect(JSON.stringify(capture.groups[0]!.state)).toBe(JSON.stringify(marketFacing(state)));
  }
});

test("capture is deeply frozen and detached from later tick mutation", () => {
  const state = fixture("long");
  const capture = captureProgram(activateProgram(DEFAULT_PROGRAM, "gateway"), state, 1234);
  expect(Object.isFrozen(capture)).toBe(true);
  expect(Object.isFrozen(capture.groups)).toBe(true);
  expect(Object.isFrozen(capture.groups[0]!.state)).toBe(true);
  expect(Object.isFrozen(capture.groups[0]!.questions[0]!.instructions)).toBe(true);
  state.mid = 1;
  state.position.size = 5;
  state.position.leverage = 10;
  expect(capture.groups[0]!.state.mid).toBe(77000);
  expect(capture.groups[0]!.state.position).toEqual({
    coin: "BTC", side: "long", size: 0.001, notionalUsd: 77, entry: 77000, leverage: 3,
    liquidationPx: null, distanceBps: null, unrealizedUsd: -1.25,
  });
  expect(capture.groups[0]!.questions[0]!.instructions).toEqual(longQuestions[0]!.instructions);
});

test("program revisions are canonical, stable, and include every semantic input", () => {
  const revision = programRevision(DEFAULT_PROGRAM);
  expect(revision).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(programRevision(structuredClone(DEFAULT_PROGRAM))).toBe(revision);

  const variants: MutableProgram[] = [];
  const instruction = observationProgram();
  instruction.questions[3]!.instructions = "changed instruction";
  variants.push(instruction);
  const criteria = observationProgram();
  criteria.questions[3]!.criteria = ["changed", "high"];
  variants.push(criteria);
  const role = observationProgram();
  role.questions[3]!.role = "required";
  variants.push(role);
  const membership = observationProgram();
  membership.groups[1]!.questions = [];
  variants.push(membership);
  const features = observationProgram();
  features.groups[1]!.features.push("tick");
  variants.push(features);
  const projection = mutableDefault();
  projection.projection.version = "jev-trade-projection-next";
  variants.push(projection);
  for (const variant of variants) expect(programRevision(variant as unknown as ProgramDefinition)).not.toBe(revision);
});

test("activation checks expected revisions and freezes a valid observational score group", () => {
  const revision = programRevision(DEFAULT_PROGRAM);
  expect(() => activateProgram(DEFAULT_PROGRAM, "gateway", "sha256:" + "0".repeat(64))).toThrow("revision");
  const active = activateProgram(observationProgram(), "gateway");
  const capture = captureProgram(active, fixture("flat"), 1234);
  expect(capture.groups.map((group) => group.groupId)).toEqual(["trade", "observe"]);
  expect(capture.groups[1]!.questions[0]!.role).toBe("observational");
  expect(active.revision).not.toBe(revision);
  expect(Object.isFrozen(active.definition)).toBe(true);
});

test("validation rejects non-object and non-serializable definitions", () => {
  expectIssue(null, "$", "gateway");
  const badValues: unknown[] = [() => 1, Symbol("x"), 1n, undefined, Number.NaN, Number.POSITIVE_INFINITY];
  for (const value of badValues) {
    const program = mutableDefault();
    program.extra = value;
    expectIssue(program, "$", "gateway");
  }
  const cyclic = mutableDefault();
  cyclic.self = cyclic;
  expectIssue(cyclic, "$", "gateway");
});

test("validation rejects unknown fields, wrong versions, and projection references", () => {
  const unknown = mutableDefault();
  unknown.extra = true;
  expectIssue(unknown, "extra");
  const schema = mutableDefault();
  schema.schema = "old";
  expectIssue(schema, "schema");
  const catalog = mutableDefault();
  catalog.catalogVersion = "old";
  expectIssue(catalog, "catalogVersion");
  const projectionVersion = mutableDefault();
  projectionVersion.projection.version = "old";
  expectIssue(projectionVersion, "projection.version");
  const projectionKeys = mutableDefault();
  projectionKeys.projection.keys = ["bias", "intent"];
  expectIssue(projectionKeys, "projection.keys");
});

test("validation rejects question and group identity and size violations", () => {
  const keyFormat = mutableDefault();
  keyFormat.questions[0]!.key = "1bias";
  expectIssue(keyFormat, "questions[0].key");
  const duplicateKey = mutableDefault();
  duplicateKey.questions.push({ ...duplicateKey.questions[0]! });
  expectIssue(duplicateKey, "questions[3].key");
  const duplicateGroup = mutableDefault();
  duplicateGroup.groups.push({ id: "trade", features: ["mid"], questions: ["bias"] });
  expectIssue(duplicateGroup, "groups[1].id");
  const tooManyQuestions = mutableDefault();
  for (let index = 0; index < 14; index += 1) {
    tooManyQuestions.questions.push({ key: `q${index}`, type: "score", instructions: "score", criteria: ["low", "high"] });
  }
  expectIssue(tooManyQuestions, "questions");
  const tooManyGroups = mutableDefault();
  for (let index = 0; index < 4; index += 1) tooManyGroups.groups.push({ id: `extra${index}`, features: ["mid"], questions: ["unknown"] });
  expectIssue(tooManyGroups, "groups");
});

test("validation enforces group question membership and feature bounds", () => {
  const unassigned = mutableDefault();
  unassigned.groups[0]!.questions = ["intent", "leverage"];
  expectIssue(unassigned, "questions.bias");
  const missingReference = mutableDefault();
  missingReference.groups[0]!.questions.push("missing");
  expectIssue(missingReference, "groups[0].questions");
  const emptyGroup = mutableDefault();
  emptyGroup.groups.push({ id: "empty", features: ["mid"], questions: [] });
  expectIssue(emptyGroup, "groups[1].questions");
  const unknownFeature = mutableDefault();
  unknownFeature.groups[0]!.features.push("marketState");
  expectIssue(unknownFeature, "groups[0].features");
  const duplicateFeature = mutableDefault();
  duplicateFeature.groups[0]!.features.push("mid");
  expectIssue(duplicateFeature, "groups[0].features");
});

test("validation requires the three code-owned required resolvers in one isolated group", () => {
  const missing = mutableDefault();
  missing.questions = missing.questions.filter((question) => question.key !== "bias");
  expectIssue(missing, "questions");
  const wrongType = mutableDefault();
  wrongType.questions[0]!.type = "score";
  expectIssue(wrongType, "questions[0].type");
  const wrongRole = mutableDefault();
  wrongRole.questions[0]!.role = "observational";
  expectIssue(wrongRole, "questions[0].role");
  const wrongResolver = mutableDefault();
  wrongResolver.questions[0]!.resolver = { id: "jev.intent", version: 1 };
  expectIssue(wrongResolver, "questions[0].resolver");
  const extraRequired = observationProgram();
  extraRequired.questions[3]!.role = "required";
  expectIssue(extraRequired, "questions[3].role");
  const mixedRequiredGroup = observationProgram();
  mixedRequiredGroup.groups[0]!.questions.push("score");
  mixedRequiredGroup.groups[1]!.questions = [];
  expectIssue(mixedRequiredGroup, "groups.trade.questions");
  const wrongGroup = mutableDefault();
  wrongGroup.groups[0]!.questions = ["bias", "intent"];
  wrongGroup.groups.push({ id: "leverage", features: ["maxLeverage"], questions: ["leverage"] });
  expectIssue(wrongGroup, "groups");
});

test("validation checks provider types, observational criteria, and text limits", () => {
  for (const provider of ["typesafe", "openrouter"] as const) {
    expectIssue(observationProgram("boolean"), "questions[3].type", provider);
  }
  expectIssue(observationProgram("noul"), "questions[3].type", "gateway");
  const noInstructions = observationProgram();
  delete noInstructions.questions[3]!.instructions;
  expectIssue(noInstructions, "questions[3].instructions");
  const noCriteria = observationProgram();
  delete noCriteria.questions[3]!.criteria;
  expectIssue(noCriteria, "questions[3].criteria");
  const wrongChoiceCriteria = observationProgram("choice");
  wrongChoiceCriteria.questions[3]!.criteria = { one: "only one" };
  expectIssue(wrongChoiceCriteria, "questions[3].criteria");
  const wrongScoreCriteria = observationProgram();
  wrongScoreCriteria.questions[3]!.criteria = Array.from({ length: 12 }, () => "level");
  expectIssue(wrongScoreCriteria, "questions[3].criteria");
  const badBooleanCriteria = observationProgram("boolean");
  badBooleanCriteria.questions[3]!.criteria = { yes: "yes" };
  expectIssue(badBooleanCriteria, "questions[3].criteria.yes");
  const longText = observationProgram();
  longText.questions[3]!.instructions = "x".repeat(2001);
  expectIssue(longText, "questions[3].instructions");
});

test("validation rejects definitions larger than 32768 bytes", () => {
  const program = mutableDefault();
  for (let index = 0; index < 6; index += 1) {
    const key = `score${index}`;
    program.questions.push({
      key,
      type: "score",
      instructions: { question: "x".repeat(2000) },
      criteria: ["a".repeat(2000), "b".repeat(2000)],
    });
  }
  program.groups.push({ id: "observe", features: ["mid"], questions: program.questions.slice(3).map((question) => question.key) });
  expectIssue(program, "$");
});

test("default questions avoid wallet scoreboard and execution-advice terms", () => {
  const questions = captureProgram(activateProgram(DEFAULT_PROGRAM, "gateway"), fixture("flat"), 1234).groups[0]!.questions;
  const text = JSON.stringify(questions).toLowerCase();
  for (const phrase of [
    "recentfills", "this wallet", "realized", "feesusd", "pnlusd", "pnlpct", "pnl $", "equity=", "withdrawable",
    "worth paying", "not worth trading", "most ticks", "clears the spread", "round trip", "by more than the spread",
    "only when", "pick this when", "stay flat", "you are flat", "leave it alone", "ignored on a hold", "horizonticks",
    "post-only", "no order", "spread=",
  ]) expect(text).not.toContain(phrase);
});
