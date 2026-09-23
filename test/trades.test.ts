import { expect, test } from "bun:test";
import { aggregateFills, takeLiveFills, takeSimFills, type Resting } from "../src/trades";

test("takeSimFills hits a resting bid when a sell print crosses", () => {
  const orders = new Map<number, Resting>([[1, { decisionId: "decision-1", side: "buy", price: 100, size: 0.002, block: 1 }]]);
  const fills = takeSimFills(orders, [{ block: 2, price: 99.9, size: 0.001, side: "sell" }]);
  expect(fills).toHaveLength(1);
  expect(fills[0]!.side).toBe("buy");
  expect(fills[0]!.size).toBeCloseTo(0.001, 8);
  expect(orders.get(1)!.size).toBeCloseTo(0.001, 8);
});

test("takeSimFills ignores prints before the quote tick", () => {
  const orders = new Map<number, Resting>([[1, { decisionId: "decision-1", side: "sell", price: 100, size: 0.001, block: 5 }]]);
  expect(takeSimFills(orders, [{ block: 4, price: 101, size: 1, side: "buy" }])).toHaveLength(0);
});

test("aggregateFills keeps the heavier side", () => {
  const fill = aggregateFills([
    { decisionId: "decision-1", side: "buy", size: 0.001, price: 10, txHash: "0x1", orderId: 1, simulated: true },
    { decisionId: "decision-1", side: "sell", size: 0.003, price: 11, txHash: "0x2", orderId: 2, simulated: true },
  ]);
  expect(fill.side).toBe("sell");
  expect(fill.size).toBeCloseTo(0.003, 8);
  expect(fill.price).toBe(11);
});

test("live fill identities survive redelivery without an order correlation", () => {
  const raw = { block: 2, orderId: 42, tid: 7, txHash: "0xfill", price: 100, size: 0.001, updatedSize: 0, side: "buy" as const };
  const orders = new Map<number, Resting>([[42, { decisionId: "decision-1", side: "buy", price: 100, size: 0.001, block: 1 }]]);
  const first = takeLiveFills(orders, [raw])[0]!;
  const retry = takeLiveFills(orders, [{ ...raw, block: 3 }])[0]!;
  expect(first.fillId).toBe("42:7");
  expect(retry.fillId).toBe(first.fillId);
  const missingTid = { ...raw, tid: undefined };
  expect(takeLiveFills(new Map(), [missingTid])[0]!.fillId).toBe(
    takeLiveFills(new Map(), [{ ...missingTid, block: 99 }])[0]!.fillId,
  );
});

test("identical simulated partial fills have distinct deterministic identities", () => {
  const replay = () => {
    const orders = new Map<number, Resting>([[-1, { decisionId: "decision-1", side: "buy", price: 100, size: 0.002, block: 1 }]]);
    const print = { block: 2, price: 99, size: 0.001, side: "sell" as const };
    return takeSimFills(orders, [print, print]).map((fill) => fill.fillId);
  };
  const ids = replay();
  expect(ids).toHaveLength(2);
  expect(ids[0]).not.toBe(ids[1]);
  expect(replay()).toEqual(ids);
});
