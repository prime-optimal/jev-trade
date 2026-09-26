import { expect, test } from "bun:test";
import { fmtAgo, fmtUsdPrice, quoteOf, sleeveMetrics, sparkPoints } from "../web/src/lib/sleeve-metrics";
import type { BlockEvent } from "../src/types";

function ev(ts: number, o: { late?: boolean; quote?: boolean; fill?: boolean; side?: "long" | "short" | "flat" } = {}): BlockEvent {
  return {
    ts,
    decision: { id: String(ts), action: "buy", probabilities: { buy: 1, sell: 0, hold: 0 }, upIn10: 0.5, latencyMs: 100, late: !!o.late },
    quote: o.quote ? { size: 1 } : null,
    fill: o.fill ? { size: 1 } : null,
    position: { side: o.side ?? "flat" },
  } as unknown as BlockEvent;
}

test("sleeveMetrics computes rates, last call, and entry time", () => {
  const events = [
    ev(1000, { quote: true, fill: true, side: "flat" }),
    ev(2000, { quote: true, side: "long" }),
    ev(3000, { side: "long" }),
    ev(4000, { late: true, side: "long" }),
  ];
  const m = sleeveMetrics(events, null);
  expect(m.decisions).toBe(4);
  expect(m.orderRate).toBe(0.5);
  expect(m.fillRate).toBe(0.5);
  expect(m.lastCallTs).toBe(3000);
  expect(m.avgLatencyMs).toBe(100);
  expect(m.entryTs).toBe(2000);
});

test("flat position has no entry time", () => {
  expect(sleeveMetrics([ev(1)], null).entryTs).toBeNull();
});

test("formatters", () => {
  expect(fmtUsdPrice(105416.2)).toBe("$105,416.20");
  expect(fmtUsdPrice(0.1234)).toBe("$0.1234");
  expect(quoteOf("BTC-USD")).toBe("USD");
  expect(quoteOf("ETH/USDC")).toBe("USDC");
  expect(fmtAgo(3_900_000)).toBe("1h 5m");
  expect(sparkPoints([{ ts: 0, mid: 1 }, { ts: 1, mid: 2 }], 10, 10)).toBe("0.0,10.0 10.0,0.0");
});
