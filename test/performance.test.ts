import { expect, test } from "bun:test";
import { computePerformance, confidenceBucket } from "../web/src/app/model/performance-metrics";
import { summarize, type DecisionSummary } from "../web/src/app/model/record";
import type { DecisionRow } from "../web/src/lib/journal-types";

function summary(overrides: Partial<DecisionSummary> = {}): DecisionSummary {
  return {
    id: "decision",
    time: 1,
    coin: "BTC",
    action: "buy",
    bias: "long",
    intent: "open",
    leverage: 2,
    late: false,
    legacy: false,
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
    confidence: null,
    ...overrides,
  };
}

test("confidence buckets include lower bounds and include 1 in the final bucket", () => {
  expect([0, 0.1999, 0.2, 0.4, 0.6, 0.8, 1].map(confidenceBucket)).toEqual([0, 0, 1, 2, 3, 4, 4]);
  expect(confidenceBucket(-0.01)).toBeNull();
  expect(confidenceBucket(1.01)).toBeNull();
  expect(confidenceBucket(Number.NaN)).toBeNull();
});

test("empty history has empty samples and no undefined rates", () => {
  const report = computePerformance([]);
  expect(report.totalLoaded).toBe(0);
  expect(report.byHorizon.every(({ n, hitRate, meanBps }) => n === 0 && hitRate === null && meanBps === null)).toBe(true);
  expect(report.byIntent).toEqual([]);
  expect(report.byLeverage).toEqual([]);
  expect(report.pnlCurve).toEqual([]);
  expect(report.calibration.every(({ n, hitRate, meanConfidence }) => n === 0 && hitRate === null && meanConfidence === null)).toBe(true);
  expect(report.measuredAtFiveTicks).toBe(0);
  expect(report.calibratedAtFiveTicks).toBe(0);
});

test("pending markouts do not enter horizon, intent, leverage, or calibration samples", () => {
  const report = computePerformance([
    summary({ id: "pending", time: 2, markouts: { 1: { signedBps: 4, marketBps: 4, observedMid: 10, observedTimestamp: 2, observedBlock: 2 }, 5: { signedBps: null, marketBps: null, observedMid: null, observedTimestamp: null, observedBlock: null } }, confidence: 0.9, closedPnl: 10 }),
    summary({ id: "loss", time: 3, markouts: { 5: { signedBps: -2, marketBps: -2, observedMid: 10, observedTimestamp: 3, observedBlock: 3 } }, confidence: 0.2, closedPnl: -3 }),
    summary({ id: "flat", time: 4, intent: "close", leverage: 5, markouts: { 5: { signedBps: 0, marketBps: 0, observedMid: 10, observedTimestamp: 4, observedBlock: 4 } }, confidence: 1 }),
  ]);

  expect(report.totalLoaded).toBe(3);
  expect(report.byHorizon.find(({ horizon }) => horizon === 1)).toMatchObject({ n: 1, hits: 1, meanBps: 4 });
  expect(report.byHorizon.find(({ horizon }) => horizon === 5)).toMatchObject({ n: 2, hits: 0, meanBps: -1 });
  expect(report.byIntent).toEqual([{ key: "close", label: "close", n: 1, hits: 0, hitRate: 0, meanBps: 0 }, { key: "open", label: "open", n: 1, hits: 0, hitRate: 0, meanBps: -2 }]);
  expect(report.byLeverage.map(({ label, n }) => [label, n])).toEqual([["2x", 1], ["5x", 1]]);
  expect(report.calibration.map(({ n }) => n)).toEqual([0, 1, 0, 0, 1]);
  expect(report.measuredAtFiveTicks).toBe(2);
  expect(report.calibratedAtFiveTicks).toBe(2);
  expect(report.pnlCurve).toEqual([{ time: 2, pnl: 10 }, { time: 3, pnl: 7 }]);
});

test("summary takes confidence from the picked required bias answer", () => {
  const row = {
    decisionId: "picked",
    createdAt: 1,
    updatedAt: 1,
    decision: { timestamp: 1, decision: { action: "buy", bias: "long", intent: "open" } },
    recordType: "program",
    evidence: {
      recordType: "program",
      capture: { groups: [] },
      required: { groupId: "trade", status: "complete", answers: [
        { key: "bias", role: "required", status: "answered", answer: { type: "choice", choice: "short", confidence: 0.9 } },
        { key: "bias", role: "required", status: "answered", answer: { type: "choice", choice: "long", confidence: 0.73 } },
      ] },
      status: "complete",
    },
    observations: {},
    programMetadata: "available",
    quote: null,
    fills: [],
    markouts: {},
  } as unknown as DecisionRow;
  expect(summarize(row).confidence).toBe(0.73);
});
