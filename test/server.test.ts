import { afterEach, expect, test } from "bun:test";
import { networkInterfaces } from "node:os";
import { config } from "../src/config";
import type { Model } from "../src/model";
import { startServer } from "../src/server";
import type { JevRequest, ModelDecision } from "../src/types";

const original = { ...config };
const servers: Bun.Server<undefined>[] = [];
const origin = "https://dashboard.example";
const decision: ModelDecision = {
  action: "hold", intent: "hold", bias: "long", leverage: 1,
  probabilities: { buy: 0, sell: 0, hold: 1, long: 1, short: 0, open: 0, close: 0 },
  upIn10: 0.5, latencyMs: 1, inputTokens: 10,
};

function fixture(): JevRequest {
  return {
    network: "testnet",
    state: {
      coin: "BTC", market: "BTC-USD", tick: 7, tickMs: 5000,
      mid: 77000, spreadBps: 1, bookImbalance: 0,
      depth: { "10bps": { bid: 0, ask: 0 }, "25bps": { bid: 0, ask: 0 }, "50bps": { bid: 0, ask: 0 } },
      book: { bids: [], asks: [] },
      returnsBps: { last1: 0, last5: 0, last20: 0, last100: 0 },
      recentMids: "", recentTrades: [],
      trades: { count: 0, buySz: 0, sellSz: 0, cvdSz: 0, vwap: null, lastPrice: null, lastSide: null },
      position: { coin: "BTC", side: "flat", size: 0, notionalUsd: 0, entry: null, leverage: null, liquidationPx: null, distanceBps: null, unrealizedUsd: 0 },
      indicators: { sma20: null, sma50: null, ema20: null, midVsSma20Bps: null, midVsSma50Bps: null, rsi14: null, vol20Bps: null, high20: null, low20: null, rangePos20: null },
      asset: { markPx: null, oraclePx: null, fundingBps: null, premiumBps: null, openInterest: null, dayNtlVlmUsd: null, dayChangeBps: null, maxLeverage: 40 },
      maxLeverage: 40,
    },
  };
}

function launch(decide: Model["decide"] = async () => decision) {
  config.webOrigins = [origin];
  config.production = true;
  const server = startServer({ name: "test", decide }, { port: 0 });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

function post(base: string, body: unknown = fixture(), headers: Record<string, string> = {}) {
  return fetch(`${base}/decide`, {
    method: "POST", credentials: "omit", referrerPolicy: "no-referrer",
    headers: { origin, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ error: code });
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
  Object.assign(config, original);
});

test("one validated tick calls the model once and echoes only its decision", async () => {
  const received: unknown[] = [];
  const base = launch(async (state) => { received.push(state); return decision; });
  const response = await post(base);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ tick: 7, decision });
  expect(received).toEqual([fixture().state]);
  expect(response.headers.get("access-control-allow-origin")).toBe(origin);
  expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("cache-control")).toBe("no-store");
});

test("health is origin-independent and legacy paths are gone", async () => {
  const base = launch();
  const health = await fetch(`${base}/health`);
  expect(await health.json()).toEqual({ ok: true });
  expect(health.headers.get("cache-control")).toBe("no-store");
  for (const path of ["/", "/events", "/snapshot", "/history", "/tape", "/run", "/sessions"]) {
    await expectError(await fetch(`${base}${path}`), 404, "not_found");
  }
  for (const [path, method] of [["/health", "POST"], ["/health", "OPTIONS"], ["/decide", "GET"], ["/decide", "PUT"]]) {
    await expectError(await fetch(`${base}${path}`, { method }), 405, "method_not_allowed");
  }
});

test("CORS requires an exact origin and narrowly scoped preflight", async () => {
  const base = launch();
  for (const rejected of ["null", `${origin}/`, `${origin}.attacker.example`, "http://localhost:3001"]) {
    const response = await post(base, fixture(), { origin: rejected });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    await expectError(response, 403, "origin_forbidden");
  }
  await expectError(await fetch(`${base}/decide`, { method: "POST" }), 403, "origin_forbidden");
  const allowed = await fetch(`${base}/decide`, {
    method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "Content-Type" },
  });
  expect(allowed.status).toBe(204);
  expect(allowed.headers.get("access-control-allow-methods")).toBe("POST");
  expect(allowed.headers.get("access-control-allow-headers")).toBe("Content-Type");
  expect(allowed.headers.get("cache-control")).toBe("no-store");
  expect(allowed.headers.get("access-control-allow-credentials")).toBeNull();
  const rejectedPreflights: Record<string, string>[] = [{ "access-control-request-method": "DELETE" }, { "access-control-request-headers": "authorization" }];
  for (const extra of rejectedPreflights) {
    await expectError(await fetch(`${base}/decide`, {
      method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", ...extra },
    }), 403, "origin_forbidden");
  }
});

test("development permits only local interface origins on port 3001", async () => {
  config.webOrigins = [];
  config.production = false;
  const server = startServer({ name: "test", decide: async () => decision }, { port: 0 });
  servers.push(server);
  const base = `http://127.0.0.1:${server.port}`;
  const local = ["http://localhost:3001", "http://127.0.0.1:3001"];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) local.push(`http://${address.address}:3001`);
    }
  }
  for (const allowed of local) expect((await post(base, fixture(), { origin: allowed })).status).toBe(200);
  for (const rejected of ["http://localhost:3002", "https://localhost:3001", "http://localhost.attacker.example:3001"]) {
    await expectError(await post(base, fixture(), { origin: rejected }), 403, "origin_forbidden");
  }
});

test("invalid bodies and credential headers never reach the model", async () => {
  let calls = 0;
  const base = launch(async () => { calls += 1; return decision; });
  await expectError(await post(base, {}, { "content-type": "text/plain" }), 415, "unsupported_media_type");
  const credentials: Record<string, string>[] = [{ cookie: "private=value" }, { authorization: "Bearer private" }];
  for (const headers of credentials) {
    await expectError(await post(base, fixture(), headers), 400, "invalid_request");
  }
  await expectError(await post(base, { ...fixture(), wallet: "private" }), 400, "invalid_request");
  for (const body of ["{", '{"__proto__":{}}', " ".repeat(32769)]) {
    await expectError(await fetch(`${base}/decide`, { method: "POST", headers: { origin, "content-type": "application/json" }, body }), body.length > 32768 ? 413 : 400, body.length > 32768 ? "payload_too_large" : "invalid_request");
  }
  expect(calls).toBe(0);
});

test("socket-peer burst cannot be bypassed with forwarded headers", async () => {
  config.inferenceBurst = 2;
  config.inferenceRatePerMinute = 1;
  const base = launch();
  expect((await post(base)).status).toBe(200);
  expect((await post(base)).status).toBe(200);
  const response = await post(base, fixture(), { "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.10" });
  expect(response.headers.get("retry-after")).toBe("60");
  await expectError(response, 429, "rate_limited");
  expect((await fetch(`${base}/health`)).status).toBe(200);
});

test("deadline retains a global permit until late provider rejection settles", async () => {
  config.inferenceConcurrency = 1;
  // Exercise the actual Bun HTTP deadline. Fake timers do not drive socket I/O.
  config.inferenceDeadlineMs = 25;
  let reject!: (reason: Error) => void;
  const provider = new Promise<ModelDecision>((_resolve, fail) => { reject = fail; });
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  const base = launch(() => {
    calls += 1;
    if (calls > 1) return Promise.resolve(decision);
    started();
    return provider;
  });
  const pending = post(base);
  await entered;
  await expectError(await post(base), 503, "busy");
  await expectError(await pending, 504, "deadline_exceeded");
  await expectError(await post(base), 503, "busy");
  expect(calls).toBe(1);
  reject(new Error("private provider payload"));
  await provider.catch(() => {});
  expect((await post(base)).status).toBe(200);
  expect(calls).toBe(2);
});

test("provider failure is fixed and releases its permit", async () => {
  config.inferenceConcurrency = 1;
  let calls = 0;
  const base = launch(async () => {
    if (++calls === 1) throw new Error("secret provider credential");
    return decision;
  });
  await expectError(await post(base), 502, "provider_error");
  expect((await post(base)).status).toBe(200);
});
