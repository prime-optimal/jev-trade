import { expect, test } from "bun:test";
import { bookFromLevels, planQuote, quotePrice, takerPrice } from "../web/src/lib/trading/book";
import { candleOhlc, loadCandleHistory, VenueChart } from "../web/src/lib/trading/chart";
import { ema, rangeWindow, rsi, sma } from "../web/src/lib/trading/indicators";
import { accountFill, takeLiveFills, takeSimFills, type AccountFill, type Resting } from "../web/src/lib/trading/trades";

test("normalized action determines entry while position sign determines exit", () => {
  expect(planQuote({ intent: "open", action: "sell", positionSz: 3, quoteSz: 2 })).toEqual({ side: "sell", size: 2, reduceOnly: false, taker: false });
  expect(planQuote({ intent: "close", action: "sell", positionSz: -3, quoteSz: 2 })).toEqual({ side: "buy", size: 3, reduceOnly: true, taker: true });
  expect(planQuote({ intent: "hold", action: "buy", positionSz: 3, quoteSz: 2 })).toBeNull();
  expect(() => planQuote({ intent: "open", action: "hold", positionSz: 0, quoteSz: 2 })).toThrow();
});

test("book math keeps post-only and crossing prices on their respective sides", () => {
  const book = bookFromLevels(1, [{ px: "100", sz: "2" }], [{ px: "101", sz: "1" }])!;
  expect(book.imbalance).toBeCloseTo(1 / 3);
  expect(quotePrice("buy", book, 5, 20)).toBe(100);
  expect(takerPrice("sell", book, 5, 10)).toBeLessThanOrEqual(99.9);
  expect(bookFromLevels(1, [], [{ px: "101", sz: "1" }])).toBeNull();
});

test("indicator warmup and constant series retain numerical behavior", () => {
  expect(sma([1, 2], 3)).toBeNull();
  expect(ema([1, 2, 3], 2)).toBe(2.5);
  expect(rsi(Array(15).fill(10))).toBe(50);
  expect(rangeWindow([10, 10], 2)).toEqual({ high: 10, low: 10, pos: 0.5 });
});

test("account fills do not establish ownership or mutate unrelated journal orders", () => {
  const fill: AccountFill = { block: 1, txHash: "hash", orderId: 7, price: 100, size: 1, updatedSize: 0, side: "buy" };
  const orders = new Map<number, Resting>([[8, { side: "buy", price: 100, size: 2, block: 0 }]]);
  expect(accountFill(fill).orderId).toBe(7);
  expect(takeLiveFills(orders, [fill])).toEqual([]);
  expect(orders.get(8)?.size).toBe(2);
});

test("paper matching cannot spend one public print twice", () => {
  const orders = new Map<number, Resting>([
    [1, { side: "buy", price: 100, size: 2, block: 0 }],
    [2, { side: "buy", price: 100, size: 2, block: 0 }],
  ]);
  const fills = takeSimFills(orders, [{ side: "sell", price: 99, size: 3, block: 1 }]);
  expect(fills.map((fill) => fill.size)).toEqual([2, 1]);
  expect(orders.get(2)?.size).toBe(1);
});

test("candle history uses selected venue transport and preserves requested intervals", async () => {
  const urls: string[] = [];
  const requests: string[] = [];
  const rows = await loadCandleHistory("BTC", {
    network: "testnet", now: () => 1_000_000, timeoutMs: 1000,
    fetch: (async (url, init) => {
      urls.push(String(url));
      requests.push(String(init?.body));
      return Response.json([{ t: 60_000, o: "10", h: "12", l: "9", c: "11" }]);
    }) as typeof fetch,
  }, new AbortController().signal);
  expect(urls).toEqual(["https://api.hyperliquid-testnet.xyz/info", "https://api.hyperliquid-testnet.xyz/info"]);
  expect(requests.map((body) => JSON.parse(body).req.interval)).toEqual(["15m", "1m"]);
  expect(rows.map((row) => row.i)).toEqual(["15m", "1m"]);
});

test("chart candles include the opening price in their range and keep distinct venue fills", () => {
  expect(candleOhlc({ t: 1000, o: 10, h: 9, l: 11, c: 12 })).toEqual({ ts: 1000, open: 10, high: 12, low: 10, close: 12 });
  const chart = new VenueChart();
  chart.addMid(10, 1000);
  chart.addMid(12, 2000);
  expect(chart.points[1]).toMatchObject({ open: 10, high: 12, low: 10, close: 12 });
  const fill = { ts: 2000, side: "buy" as const, size: 1, price: 12 };
  expect(chart.addFill({ ...fill, tid: 1 })).toBe(true);
  expect(chart.addFill({ ...fill, tid: 2 })).toBe(true);
  expect(chart.addFill({ ...fill, tid: 1 })).toBe(false);
});
