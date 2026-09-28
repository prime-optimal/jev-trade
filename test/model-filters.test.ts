import { describe, expect, test } from "bun:test";
import { applyFilters, DEFAULT_FILTERS, isInvalid, listCoins, outcomeAt, type RailFilter } from "../web/src/app/model/filters";
import { summarize, type Action, type DecisionRow, type DecisionSummary, type Horizon } from "../web/src/app/model/record";

function decision(overrides: Partial<DecisionSummary> = {}): DecisionSummary {
  return {
    id: "row",
    time: 1,
    coin: "BTC",
    action: "buy",
    bias: null,
    intent: null,
    leverage: null,
    late: false,
    legacy: false,
    hasInvalidAnswers: false,
    revision: null,
    provider: null,
    modelId: null,
    runId: null,
    block: null,
    latencyMs: null,
    inputTokens: null,
    outputTokens: null,
    markouts: {},
    quote: null,
    fills: [],
    closedPnl: null,
    ...overrides,
  };
}

function withMarkout(action: Action, signedBps: number | null, horizon: Horizon = 5, overrides: Partial<DecisionSummary> = {}): DecisionSummary {
  return decision({ action, markouts: { [horizon]: { signedBps, marketBps: null, observedMid: null, observedTimestamp: null, observedBlock: null } }, ...overrides });
}

describe("model rail filters", () => {
  test("classifies right, wrong, flat, and pending markouts at the selected horizon", () => {
    expect(outcomeAt(withMarkout("buy", 0.1), 5)).toBe("right");
    expect(outcomeAt(withMarkout("sell", -0.1), 5)).toBe("wrong");
    expect(outcomeAt(withMarkout("hold", 0), 5)).toBe("wrong");
    expect(outcomeAt(decision({ markouts: { 5: { signedBps: null, marketBps: null, observedMid: null, observedTimestamp: null, observedBlock: null } } }), 5)).toBeNull();
    expect(outcomeAt(decision({ markouts: { 1: { signedBps: 1, marketBps: null, observedMid: null, observedTimestamp: null, observedBlock: null } } }), 5)).toBeNull();
  });

  test("keeps legacy and hold rows eligible when their selected-horizon markout is measured", () => {
    const legacy = withMarkout("sell", 2, 5, { legacy: true });
    const hold = withMarkout("hold", 1);
    expect(outcomeAt(legacy, 5)).toBe("right");
    expect(outcomeAt(hold, 5)).toBe("right");
    expect(applyFilters([legacy, hold], { ...DEFAULT_FILTERS, outcome: "right" }, 5)).toEqual([legacy, hold]);
    const legacyPending = decision({ legacy: true });
    expect(outcomeAt(legacyPending, 5)).toBeNull();
    expect(applyFilters([legacyPending], { ...DEFAULT_FILTERS, outcome: "wrong" }, 5)).toEqual([]);
    expect(isInvalid(legacyPending)).toBe(false);
  });

  test("matches unavailable, failed, and invalid answer rows as invalid or failed", () => {
    expect(isInvalid(decision({ action: "unavailable" }))).toBe(true);
    expect(isInvalid(decision({ action: "no decision" }))).toBe(true);
    expect(isInvalid(decision({ action: "unavailable", legacy: true }))).toBe(true);
    expect(isInvalid(decision({ action: "buy" }))).toBe(false);
    expect(isInvalid(decision({ action: "sell" }))).toBe(false);
    expect(isInvalid(decision({ action: "hold" }))).toBe(false);

    const group = {
      groupId: "required",
      status: "invalid",
      answers: [{ key: "trade", declaredType: "choice", groupId: "required", role: "required", status: "invalid", raw: null }],
      unexpected: [],
      provider: { name: "local" },
      timing: { startedAt: 1, completedAt: 1, latencyMs: 0 },
    };
    const row = {
      decisionId: "invalid-answer",
      createdAt: 1,
      updatedAt: 1,
      decision: { coin: "BTC", action: "buy" },
      recordType: "jev-program-v1",
      evidence: { recordType: "jev-program-v1", capture: { groups: [] }, required: group, status: "invalid" },
      observations: {},
      programMetadata: "available",
      quote: null,
      fills: [],
      markouts: {},
    } as unknown as DecisionRow;
    const invalidAnswer = summarize(row);
    expect(invalidAnswer.action).toBe("buy");
    expect(invalidAnswer.hasInvalidAnswers).toBe(true);
    expect(applyFilters([invalidAnswer], { ...DEFAULT_FILTERS, invalid: true }, 5)).toEqual([invalidAnswer]);
  });

  test("combines call, late, invalid, coin, and outcome filters with AND semantics", () => {
    const rows = [
      withMarkout("buy", 1, 5, { id: "btc-buy-late", late: true }),
      decision({ id: "btc-buy-early", late: false }),
      decision({ id: "eth-buy-late", coin: "ETH", late: true }),
      withMarkout("unavailable", 1, 5, { id: "btc-invalid", late: true }),
      withMarkout("buy", 0, 5, { id: "btc-flat", late: true }),
      decision({ id: "btc-sell", action: "sell", late: true }),
    ];
    const filter: RailFilter = { ...DEFAULT_FILTERS, calls: ["buy"], coins: ["BTC"], late: true, outcome: "right" };
    expect(applyFilters(rows, filter, 5).map((row) => row.id)).toEqual(["btc-buy-late"]);
    expect(applyFilters(rows, { ...filter, invalid: true }, 5)).toEqual([]);
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, invalid: true }, 5).map((row) => row.id)).toEqual(["btc-invalid"]);
  });

  test("applies right and wrong only to measured markouts at the current horizon", () => {
    const rows = [
      withMarkout("buy", 1, 1, { id: "one-right" }),
      withMarkout("buy", -1, 5, { id: "five-wrong" }),
      decision({ id: "pending" }),
    ];
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, outcome: "right" }, 1).map((row) => row.id)).toEqual(["one-right"]);
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, outcome: "wrong" }, 5).map((row) => row.id)).toEqual(["five-wrong"]);
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, outcome: "wrong" }, 1)).toEqual([]);
  });

  test("treats empty call and coin selections as all and lists available coins once", () => {
    const rows = [decision({ coin: "ETH" }), decision({ id: "btc", coin: "BTC" }), decision({ id: "eth-2", coin: "ETH" }), decision({ id: "missing", coin: null })];
    expect(listCoins(rows)).toEqual(["BTC", "ETH"]);
    expect(applyFilters(rows, DEFAULT_FILTERS, 5)).toBe(rows);
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, calls: ["buy", "hold"], coins: ["ETH"] }, 5).map((row) => row.id)).toEqual(["row", "eth-2"]);
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, coins: ["SOL"] }, 5)).toEqual([]);
  });
});
