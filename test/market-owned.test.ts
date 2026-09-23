import { ApiRequestError } from "@nktkas/hyperliquid";
import { expect, test } from "bun:test";
import { Market } from "../src/market";
import type { Quote } from "../src/legacy-types";
import type { Side } from "../src/types";
import { discoverOwnedOrders, type OwnedOrder } from "../src/owned-orders";

const OWNED = "0x4a455654000000000000000000000001" as const;
const CROSS_COIN = "0x4a455654000100000000000000000003" as const;
const OTHER = "0x00000000000000000000000000000002" as const;

function cleanupHarness(cancel: (cloids: string[]) => Promise<void>) {
  const market = Object.create(Market.prototype) as Market;
  let canceled = false;
  const fields: Record<string, unknown> = {
    label: "BTC",
    wallet: { address: "0x0000000000000000000000000000000000000001" },
    assetId: 0,
    placementsInFlight: 0,
    owned: new Map([[OWNED, { cloid: OWNED, oid: null, state: "unknown" }]]),
    info: {
      orderStatus: async () => canceled
        ? { status: "order", order: { status: "canceled", statusTimestamp: 2, order: { oid: 11 } } }
        : { status: "order", order: { status: "open", statusTimestamp: 1, order: { oid: 11 } } },
    },
    cleanupEx: {
      cancelByCloid: async ({ cancels }: { cancels: { cloid: string }[] }) => {
        await cancel(cancels.map(({ cloid }) => cloid));
        canceled = true;
      },
    },
    lastOid: null,
    lastCloid: null,
    lastSide: null,
    lastPrice: 0,
    lastSize: 0,
    lastReduce: false,
  };
  Object.assign(market, fields);
  return market;
}

test("owned cleanup leaves unrelated wallet orders untouched", async () => {
  const cancelled: string[] = [];
  const market = cleanupHarness(async (cloids) => { cancelled.push(...cloids); });
  await market.cleanupOwned();
  expect(cancelled).toEqual([OWNED]);
});

test("startup discovery recovers only Jev namespaced orders", async () => {
  const owned = new Map<`0x${string}`, OwnedOrder>();
  const info = {
    openOrders: async () => [
      { coin: "BTC", oid: 11, cloid: OWNED },
      { coin: "ETH", oid: 33, cloid: CROSS_COIN },
      { coin: "BTC", oid: 22, cloid: OTHER },
    ],
  };
  const unidentified = await discoverOwnedOrders(
    info as never,
    "0x0000000000000000000000000000000000000001",
    "BTC",
    owned,
  );
  expect([...owned.keys()]).toEqual([OWNED]);
  expect(unidentified).toBe(1);
});

test("owned cleanup reports cancellation failure and remains retryable", async () => {
  let fail = true;
  const market = cleanupHarness(async () => {
    if (fail) throw new Error("venue unavailable");
  });
  try {
    await market.cleanupOwned();
    throw new Error("cleanup unexpectedly succeeded");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("failed to cancel owned orders");
  }
  fail = false;
  await market.cleanupOwned();
});

function placementHarness(result: unknown) {
  let calls = 0;
  const market = Object.create(Market.prototype) as Market;
  const fields: Record<string, unknown> = {
    assetId: 0,
    coin: "BTC",
    label: "BTC",
    szDecimals: 5,
    ex: {
      async order() {
        calls++;
        if (result instanceof Error) throw result;
        return { response: { data: { statuses: [result] } } };
      },
    },
    wallet: { address: "0x0000000000000000000000000000000000000001" },
    info: { orderStatus: async () => ({ status: "unknownOid" }) },
    runGuard: { runId: "run", isLive: () => true, assertLive: () => {} },
    owned: new Map(),
    placementsInFlight: 0,
    lastOid: null,
    lastCloid: null,
    lastSide: null,
    lastPrice: 0,
    lastSize: 0,
    lastReduce: false,
  };
  Object.assign(market, fields);
  return { market, calls: () => calls };
}

test("pending exchange acknowledgement remains owned for reconciliation", async () => {
  const { market, calls } = placementHarness("waitingForFill");
  const maker = market as unknown as {
    sendMaker(size: number, px: number, cancel: number[], base: {
      side: Side; reduceOnly: boolean; capped: boolean; taker: boolean;
    }): Promise<Quote>;
    owned: Map<string, OwnedOrder>;
  };
  await maker.sendMaker(1, 100, [], { side: "buy", reduceOnly: false, capped: false, taker: false });
  await maker.sendMaker(1, 100, [], { side: "buy", reduceOnly: false, capped: false, taker: false });
  expect(calls()).toBe(1);
  expect([...maker.owned.values()].map(({ state }) => state)).toEqual(["unknown"]);
});

test("definite SDK rejection does not become permanent cleanup ambiguity", async () => {
  const { market } = placementHarness(new ApiRequestError({ status: "err" }, "rejected"));
  const maker = market as unknown as {
    sendMaker(size: number, px: number, cancel: number[], base: {
      side: Side; reduceOnly: boolean; capped: boolean; taker: boolean;
    }): Promise<Quote>;
    owned: Map<string, OwnedOrder>;
  };
  await maker.sendMaker(1, 100, [], { side: "buy", reduceOnly: false, capped: false, taker: false });
  expect(maker.owned.size).toBe(0);
});
