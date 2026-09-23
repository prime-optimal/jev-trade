import { describe, expect, test } from "bun:test";
import { createSleeveLifecycle, RETRY_DELAY_MS } from "../src/sleeve-lifecycle";
import type { Meta, SleeveMeta } from "../src/types";
import type { SleeveConfig } from "../src/sleeves";

const specs: SleeveConfig[] = [
  { coin: "BTC", pair: "BTC-USD", label: "BTC" },
  { coin: "ETH", pair: "ETH-USD", label: "ETH" },
];

function metadata(): Meta {
  return {
    model: "test",
    wallet: null,
    dryRun: true,
    market: "BTC-USD",
    startedAt: 0,
    venue: "hyperliquid",
    coin: "BTC",
    pair: "BTC-USD",
    explorerTx: "",
    tickMs: 1,
    sleeves: [],
  };
}

describe("per-sleeve lifecycle", () => {
  test("keeps failed sleeves registered and retries only the failed sleeve", async () => {
    let now = 10_000;
    const timers: Array<{ delay: number; run: () => void }> = [];
    const attempts = new Map<string, number>();
    const transitions: SleeveMeta[] = [];
    const started: string[] = [];
    let activeInitializations = 0;
    let maxActiveInitializations = 0;
    const meta = metadata();

    const lifecycle = createSleeveLifecycle({
      specs,
      meta,
      now: () => now,
      schedule: (run, delay) => {
        timers.push({ delay, run });
        return 0;
      },
      initialize: async (spec) => {
        activeInitializations++;
        maxActiveInitializations = Math.max(maxActiveInitializations, activeInitializations);
        try {
          await Promise.resolve();
          const attempt = (attempts.get(spec.coin) ?? 0) + 1;
          attempts.set(spec.coin, attempt);
          if (spec.coin === "ETH" && attempt === 1) throw new Error("HTTP 429: rate limited\nsecret detail");
          return {
            wallet: `${spec.coin}-wallet`,
            view: { coin: spec.coin, history: () => [], tape: () => [] },
            start: () => started.push(spec.coin),
          };
        } finally {
          activeInitializations--;
        }
      },
      onStatus: (sleeve) => transitions.push({ ...sleeve }),
    });

    expect(meta.sleeves.map((s) => [s.coin, s.status])).toEqual([
      ["BTC", "starting"],
      ["ETH", "starting"],
    ]);

    await lifecycle.initializeAll();

    expect(meta.sleeves[0]).toMatchObject({ coin: "BTC", status: "live", error: null, retryAt: null });
    expect(meta.sleeves[1]).toMatchObject({
      coin: "ETH",
      status: "retrying",
      error: "HTTP 429: rate limited secret detail",
      retryAt: now + RETRY_DELAY_MS,
    });
    expect(lifecycle.views.map((view) => view.coin)).toEqual(["BTC"]);
    expect(started).toEqual(["BTC"]);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.delay).toBe(1_800_000);
    expect(maxActiveInitializations).toBe(1);

    now += RETRY_DELAY_MS;
    timers[0]!.run();
    await lifecycle.settled();

    expect(attempts).toEqual(new Map([["BTC", 1], ["ETH", 2]]));
    expect(meta.sleeves[0]!.status).toBe("live");
    expect(meta.sleeves[1]).toMatchObject({ status: "live", error: null, retryAt: null, wallet: "ETH-wallet" });
    expect(lifecycle.views.map((view) => view.coin)).toEqual(["BTC", "ETH"]);
    expect(started).toEqual(["BTC", "ETH"]);
    expect(transitions.map((s) => [s.coin, s.status])).toEqual([
      ["BTC", "live"],
      ["ETH", "retrying"],
      ["ETH", "starting"],
      ["ETH", "live"],
    ]);
  });
});

test("retries a committed sleeve while Off without starting it and defers during replacement", async () => {
  const timers: Array<() => void> = [];
  const started: string[] = [];
  let attempts = 0;
  let committed = true;
  const meta = metadata();
  const lifecycle = createSleeveLifecycle({
    specs: [specs[0]!],
    meta,
    autoStart: false,
    retryDelayMs: 1,
    canRetry: () => committed,
    schedule: (run) => {
      timers.push(run);
      return 0;
    },
    initialize: async (spec) => {
      attempts++;
      if (attempts === 1) throw new Error("endpoint unavailable");
      return {
        wallet: null,
        view: { coin: spec.coin, history: () => [], tape: () => [] },
        start: () => started.push(spec.coin),
      };
    },
    onStatus: () => {},
  });

  await lifecycle.initializeAll();
  expect(meta.sleeves[0]).toMatchObject({ status: "retrying", error: "endpoint unavailable" });

  committed = false;
  timers.shift()!();
  expect(attempts).toBe(1);
  expect(timers).toHaveLength(1);

  committed = true;
  timers.shift()!();
  await lifecycle.settled();
  expect(meta.sleeves[0]).toMatchObject({ status: "live", error: null });
  expect(started).toEqual([]);
});

test("starts ready sleeves and joins a recovered sleeve to the running executor", async () => {
  const timers: Array<() => void> = [];
  const attempts = new Map<string, number>();
  const started: string[] = [];
  const lifecycle = createSleeveLifecycle({
    specs,
    meta: metadata(),
    autoStart: false,
    retryDelayMs: 1,
    schedule: (run) => {
      timers.push(run);
      return 0;
    },
    initialize: async (spec) => {
      const attempt = (attempts.get(spec.coin) ?? 0) + 1;
      attempts.set(spec.coin, attempt);
      if (spec.coin === "ETH" && attempt === 1) throw new Error("ETH feed unavailable");
      return {
        wallet: null,
        view: { coin: spec.coin, history: () => [], tape: () => [] },
        start: () => started.push(spec.coin),
      };
    },
    onStatus: () => {},
  });

  await lifecycle.initializeAll();
  expect(lifecycle.anyReady()).toBe(true);
  expect(lifecycle.allReady()).toBe(false);

  lifecycle.startAll();
  expect(started).toEqual(["BTC"]);

  timers.shift()!();
  await lifecycle.settled();
  expect(lifecycle.allReady()).toBe(true);
  expect(started).toEqual(["BTC", "ETH"]);
});
