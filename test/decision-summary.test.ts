import { describe, expect, test } from "bun:test";
import { fmtSpan, summarizeDecisions, wholePercents } from "../web/src/lib/decision-summary";
import type { BlockEvent } from "../src/types";

function ev(ts: number, decision: Partial<NonNullable<BlockEvent["decision"]>> | null): BlockEvent {
  return {
    ts,
    decision: decision && { id: String(ts), action: "hold", probabilities: { buy: 0, sell: 0, hold: 1 }, upIn10: 0.5, latencyMs: 1, late: false, ...decision },
  } as BlockEvent;
}

describe("summarizeDecisions", () => {
  test("puts each decision in one category so shares sum to 1", () => {
    const events = [
      ev(1000, { intent: "open", bias: "long", action: "buy" }),
      ev(2000, { intent: "open", bias: "short", action: "sell" }),
      ev(3000, { intent: "close", bias: "long", action: "sell" }),
      ev(4000, { intent: "hold" }),
      ev(5000, { late: true }),
      ev(6000, null),
    ];
    const s = summarizeDecisions(events);
    expect(s.total).toBe(5);
    expect(s.counts).toEqual({ openLong: 1, openShort: 1, close: 1, hold: 1, late: 1 });
    expect(Object.values(s.shares).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(s.spanMs).toBe(4000);
  });

  test("covers only the newest window", () => {
    const events = Array.from({ length: 150 }, (_, i) => ev(i * 1000, { intent: "hold" }));
    const s = summarizeDecisions(events, 100);
    expect(s.total).toBe(100);
    expect(s.spanMs).toBe(99_000);
  });
});

test("wholePercents always sums to 100", () => {
  const p = wholePercents({ openLong: 1, openShort: 1, close: 1, hold: 0, late: 0 });
  expect(Object.values(p).reduce((a, b) => a + b, 0)).toBe(100);
});

test("fmtSpan", () => {
  expect(fmtSpan(45_000)).toBe("45s");
  expect(fmtSpan(95_000)).toBe("1m 35s");
  expect(fmtSpan(7_260_000)).toBe("2h 1m");
});
