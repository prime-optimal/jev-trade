import { afterEach, expect, test } from "bun:test";
import type { Cloid } from "../web/src/lib/trading/journal";
import type { DirectExchange, ExchangeOrder, OrderEvidence } from "../web/src/lib/trading/exchange";
import { createOwnerLocks, type LockProvider } from "../web/src/lib/trading/locks";
import { createBrowserSession, type BrowserSession, type SessionAccount } from "../web/src/lib/trading/session";
import { DEFAULT_SETTINGS, type TradingSettings } from "../web/src/lib/trading/settings";

const OWNER = `0x${"ab".repeat(20)}`;
const OTHER = `0x${"cd".repeat(20)}`;
const UNRELATED: Cloid = `0x${"ff".repeat(16)}`;
const NOW = 1_000_000;
const markets = [
  { coin: "BTC", asset: 0, szDecimals: 3, maxLeverage: 20, enabled: true },
  { coin: "ETH", asset: 1, szDecimals: 3, maxLeverage: 20, enabled: true },
];
const sessions: BrowserSession[] = [];
const releases: Array<() => void> = [];
const venues: Venue[] = [];

interface Deferred { promise: Promise<void>; resolve(): void }
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  releases.push(resolve);
  return { promise, resolve };
}

// Model the browser's atomic exclusive-lock callback, not session lock policy.
function lockManager(): LockManager {
  const held = new Set<string>();
  return {
    async request(name: string, _options: unknown, callback: (lock: { name: string; mode: "exclusive" } | null) => Promise<void>) {
      if (held.has(name)) return callback(null);
      held.add(name);
      try { await callback({ name, mode: "exclusive" }); }
      finally { held.delete(name); }
    },
  } as LockManager;
}

class Venue implements DirectExchange {
  orders = new Map<Cloid, OrderEvidence>();
  placements: Array<ExchangeOrder & { cloid: Cloid }> = [];
  cancellations: Cloid[] = [];
  lookups: Cloid[] = [];
  leverages: number[] = [];
  losePlacement = false;
  failCancel = false;
  hideEvidence = false;
  beforePlace?: (cloid: Cloid) => void;
  leverageGate?: Deferred;
  leverageEntered = deferred();
  lookupGate?: Deferred;
  lookupEntered = deferred();

  async updateLeverage(input: Parameters<DirectExchange["updateLeverage"]>[0]) {
    this.leverages.push(input.asset);
    this.leverageEntered.resolve();
    await this.leverageGate?.promise;
  }
  async place(order: Parameters<DirectExchange["place"]>[0]) {
    this.beforePlace?.(order.cloid);
    this.placements.push(order);
    const evidence: OrderEvidence = { cloid: order.cloid, state: "open", oid: this.placements.length };
    this.orders.set(order.cloid, evidence);
    if (this.losePlacement) throw new Error("Response lost after acceptance");
    return evidence;
  }
  async cancel(input: Parameters<DirectExchange["cancel"]>[0]) {
    this.cancellations.push(input.cloid);
    if (this.failCancel) throw new Error("Cancellation response lost");
    const order = this.orders.get(input.cloid);
    if (!order) throw new Error("Unknown venue order");
    this.orders.set(input.cloid, { ...order, state: "canceled" });
  }
  async lookup(cloid: Cloid) {
    this.lookups.push(cloid);
    this.lookupEntered.resolve();
    await this.lookupGate?.promise;
    return this.hideEvidence ? null : this.orders.get(cloid) ?? null;
  }
}

function order(coin: "BTC" | "ETH" = "BTC", patch: Partial<ExchangeOrder> = {}): ExchangeOrder {
  return { coin, asset: coin === "BTC" ? 0 : 1, buy: true, price: "100", size: "1", reduceOnly: false, ...patch };
}

function setup(options: { settings?: Partial<TradingSettings>; owner?: string; locks?: LockProvider; account?: SessionAccount } = {}) {
  const venue = new Venue();
  venues.push(venue);
  const owner = options.owner ?? OWNER;
  const settings = { ...DEFAULT_SETTINGS, mode: "real" as const, enabledCoins: ["BTC", "ETH"] as TradingSettings["enabledCoins"], ...options.settings };
  let cleared = 0;
  let authorized = 0;
  let subscribed = true;
  const session = createBrowserSession({
    owner, settings, markets, now: () => NOW,
    locks: options.locks ?? createOwnerLocks(lockManager()),
    authorize: async () => {
      authorized++;
      return { owner, network: settings.network, exchange: venue, expiresAt: NOW + 3_600_000, clear: () => { cleared++; } };
    },
    subscribeAccount: (_owner, listener) => {
      listener(options.account ?? { accountValue: 200, withdrawable: 200, receivedAt: NOW, positions: {} });
      // No live producer remains in this synchronous account fixture.
      return () => { subscribed = false; };
    },
  });
  sessions.push(session);
  return { session, venue, cleared: () => cleared, authorized: () => authorized, subscribed: () => subscribed };
}

async function start(session: BrowserSession) {
  await session.start({ wholeNetPosition: true });
}

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const venue of venues.splice(0)) {
    venue.failCancel = false;
    venue.hideEvidence = false;
  }
  for (const session of sessions.splice(0)) await session.stop();
});

test("paper assets reserve and realize against one shared bankroll", async () => {
  const { session } = setup({ settings: { mode: "paper" } });
  await start(session);
  const btc = await session.submit(order("BTC", { size: "1.5" }), 1, NOW);
  expect(session.snapshot().account.withdrawable).toBe(50);
  await expect(session.submit(order("ETH"), 1, NOW)).rejects.toThrow();
  const eth = await session.submit(order("ETH", { size: "0.5" }), 1, NOW);
  expect(session.snapshot().reservedMargin).toBe(200);
  session.paperFill(btc, 1.5, 100);
  session.paperFill(eth, 0.5, 100);
  expect(session.snapshot().account.accountValue).toBe(200);
  expect(session.snapshot().account.withdrawable).toBe(0);
  const exit = await session.submit(order("BTC", { buy: false, size: "1.5", price: "110", reduceOnly: true }), 1, NOW);
  session.paperFill(exit, 1.5, 110, 1);
  expect(session.snapshot().account.accountValue).toBe(214);
  expect(session.snapshot().account.withdrawable).toBe(164);
  expect(session.snapshot().account.positions.ETH?.size).toBe(0.5);
  await session.submit(order("ETH", { size: "1.64" }), 1, NOW);
  expect(session.snapshot().account.withdrawable).toBe(0);
});

test("disabled exposure stays visible but cannot submit even a reducing order", async () => {
  const { session, venue } = setup({ settings: { enabledCoins: ["BTC"] }, account: {
    accountValue: 200, withdrawable: 150, receivedAt: NOW,
    positions: { ETH: { size: 1, entryPrice: 100, leverage: 2 } },
  } });
  await start(session);
  expect(session.snapshot().account.positions.ETH).toEqual({ size: 1, entryPrice: 100, leverage: 2 });
  await expect(session.submit(order("ETH", { buy: false, reduceOnly: true }), 2, NOW)).rejects.toThrow();
  expect(venue.placements).toEqual([]);
  expect(venue.leverages).toEqual([]);
});

test("placement is journaled before transport and lost acceptance reconciles only its exact cloid", async () => {
  const { session, venue } = setup();
  venue.orders.set(UNRELATED, { cloid: UNRELATED, state: "open", oid: 99 });
  venue.losePlacement = true;
  const atSubmission: Array<{ cloid: Cloid; state: string }> = [];
  venue.beforePlace = cloid => {
    atSubmission.push(...session.snapshot().orders.filter(entry => entry.cloid === cloid));
  };
  await start(session);
  const cloid = await session.submit(order(), 2, NOW) as Cloid;
  expect(atSubmission).toMatchObject([{ cloid, state: "pending" }]);
  expect(session.snapshot().orders).toMatchObject([{ cloid, state: "open" }]);
  expect(venue.lookups).toEqual([cloid]);
  await expect(session.submit(order(), 2, NOW)).rejects.toThrow();
  await expect(session.cancel(UNRELATED)).rejects.toThrow();
  expect(venue.placements.map(entry => entry.cloid)).toEqual([cloid]);
  await session.stop();
  expect(venue.cancellations).toEqual([cloid]);
  expect(venue.orders.get(UNRELATED)).toEqual({ cloid: UNRELATED, state: "open", oid: 99 });
});

test("absent placement evidence never authorizes retry, but terminal exact evidence does", async () => {
  const { session, venue } = setup();
  venue.losePlacement = true;
  venue.hideEvidence = true;
  await start(session);
  const cloid = await session.submit(order(), 2, NOW) as Cloid;
  expect(session.snapshot().orders).toMatchObject([{ cloid, state: "unknown" }]);
  await session.reconcile();
  await expect(session.submit(order(), 2, NOW)).rejects.toThrow();
  expect(venue.placements.map(entry => entry.cloid)).toEqual([cloid]);
  expect(venue.lookups).toEqual([cloid, cloid]);
  venue.hideEvidence = false;
  venue.losePlacement = false;
  venue.orders.set(cloid, { cloid, state: "filled" });
  await session.reconcile();
  const next = await session.submit(order(), 2, NOW) as Cloid;
  expect(next).not.toBe(cloid);
  expect(venue.placements.map(entry => entry.cloid)).toEqual([cloid, next]);
});

test("failed cancellation with missing evidence blocks replacement and retains cleanup authority", async () => {
  const fixture = setup();
  const { session, venue } = fixture;
  await start(session);
  const cloid = await session.submit(order(), 2, NOW) as Cloid;
  venue.failCancel = true;
  venue.hideEvidence = true;
  await session.cancel(cloid);
  await expect(session.submit(order(), 2, NOW)).rejects.toThrow();
  await session.stop();
  expect(session.snapshot().status).toBe("attention-required");
  expect(fixture.cleared()).toBe(0);
  expect(fixture.subscribed()).toBe(true);
  expect(venue.placements.map(entry => entry.cloid)).toEqual([cloid]);
  venue.hideEvidence = false;
  venue.orders.set(cloid, { cloid, state: "canceled" });
  await session.reconcile();
  expect(session.snapshot().status).toBe("off");
  expect(fixture.cleared()).toBe(1);
  expect(fixture.subscribed()).toBe(false);
});

test("a cancellation acknowledgment without terminal evidence still blocks replacement", async () => {
  const { session, venue } = setup();
  await start(session);
  const cloid = await session.submit(order(), 2, NOW) as Cloid;
  venue.hideEvidence = true;
  await session.cancel(cloid);
  await expect(session.submit(order(), 2, NOW)).rejects.toThrow();
  expect(venue.placements.map(entry => entry.cloid)).toEqual([cloid]);
  venue.hideEvidence = false;
  await session.reconcile();
  await session.submit(order(), 2, NOW);
  expect(venue.placements).toHaveLength(2);
});

test("stop invalidates a submission awaiting leverage before it can place", async () => {
  const { session, venue } = setup();
  venue.leverageGate = deferred();
  await start(session);
  const result = session.submit(order(), 2, NOW).then(() => "placed", () => "rejected");
  await venue.leverageEntered.promise;
  const epoch = session.snapshot().epoch;
  const stopped = session.stop();
  expect(session.snapshot().epoch).toBeGreaterThan(epoch);
  venue.leverageGate.resolve();
  expect(await result).toBe("rejected");
  await stopped;
  expect(venue.placements).toEqual([]);
  expect(session.snapshot().orders).toEqual([]);
  await expect(session.submit(order(), 2, NOW)).rejects.toThrow();
});

test("exchange work for another asset cannot overtake unresolved reconciliation", async () => {
  const { session, venue } = setup();
  venue.losePlacement = true;
  venue.lookupGate = deferred();
  await start(session);
  const first = session.submit(order(), 2, NOW);
  await venue.lookupEntered.promise;
  const second = session.submit(order("ETH"), 2, NOW);
  // The second operation has been queued; one microtask would start an unqueued transport.
  await Promise.resolve();
  expect(venue.leverages).toEqual([0]);
  expect(venue.placements.map(entry => entry.coin)).toEqual(["BTC"]);
  venue.lookupGate.resolve();
  await Promise.all([first, second]);
  expect(venue.leverages).toEqual([0, 1]);
  expect(venue.placements.map(entry => entry.coin)).toEqual(["BTC", "ETH"]);
});

test("same owner and network exclude a second session before authorization, independently of case", async () => {
  const locks = createOwnerLocks(lockManager());
  const first = setup({ locks });
  const second = setup({ locks, owner: `0x${"AB".repeat(20)}` });
  const otherOwner = setup({ locks, owner: OTHER });
  const otherNetwork = setup({ locks, settings: { network: "mainnet" } });
  await start(first.session);
  await expect(start(second.session)).rejects.toThrow();
  expect(second.authorized()).toBe(0);
  await start(otherOwner.session);
  await start(otherNetwork.session);
  expect(otherOwner.session.snapshot().status).toBe("running");
  expect(otherNetwork.session.snapshot().status).toBe("running");
  await first.session.stop();
  await start(second.session);
  expect(second.authorized()).toBe(1);
});
