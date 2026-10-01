import { expect, test } from "bun:test";
import { ProgramRuntime } from "../src/program-runtime";
import { DEFAULT_PROGRAM, programRevision, validateProgram } from "../src/jev-program";
import { JevModel, MockModel, type TradeState } from "../src/model";
import type { GroupResult, GroupSnapshot } from "../src/jev-evidence";
import { createOperatorControl } from "../src/operator-control";
import { createPaperOperatorFetch } from "../src/paper-session-guard";
import { createPaperSessions } from "../src/paper-sessions";
import type { LifecycleControl } from "../src/settings-runtime";
import type { RunSnapshot } from "../src/settings";

function lifecycle() {
  const state: RunSnapshot = { runId: null, status: "off", startedAt: null, deadlineAt: null, stoppedAt: null, durationMs: 1800000, stopReason: null, serverNow: 0 };
  const control: LifecycleControl = {
    snapshot: () => ({ ...state }),
    start: async () => { state.status = "running"; return { ...state }; },
    stop: async () => { state.status = "off"; return { ...state }; },
    reconcile: async () => ({ ...state }), applyDuration() {},
  };
  return { state, control };
}
function definition(text = "Is the price rising?") {
  return {
    ...DEFAULT_PROGRAM,
    questions: [...DEFAULT_PROGRAM.questions, { key: "direction", type: "choice", role: "observational", instructions: { question: text }, criteria: { up: "Rising", down: "Falling" } }],
    groups: [{ id: "trade", features: ["mid"], questions: ["bias", "intent", "leverage"] }, { id: "observe", features: ["mid"], questions: ["direction"] }],
  };
}
const state: TradeState = {
  coin: "BTC", market: "BTC-USD", tick: 1, tickMs: 30000, mid: 77000, spreadBps: 1, bookImbalance: 0,
  depth: {}, book: { bids: [], asks: [] }, returnsBps: { last1: 0, last5: 0, last20: 8, last100: 0 }, recentMids: "",
  trades: { count: 0, buySz: 0, sellSz: 0, cvdSz: 0, vwap: null, lastPrice: null, lastSide: null }, recentTrades: [],
  position: { coin: "BTC", side: "flat", size: 0, notionalUsd: 0, entry: null, leverage: null, liquidationPx: null, distanceBps: null, unrealizedUsd: 0 },
  indicators: { sma20: null, sma50: null, ema20: null, midVsSma20Bps: null, midVsSma50Bps: null, rsi14: null, vol20Bps: null, high20: null, low20: null, rangePos20: null },
  asset: { markPx: null, oraclePx: null, fundingBps: null, premiumBps: null, openInterest: null, dayNtlVlmUsd: null, dayChangeBps: null, maxLeverage: 40 }, maxLeverage: 40,
};
function request(path: string, body?: unknown) {
  return new Request(`http://127.0.0.1:49152${path}`, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

test("validates provider capabilities, code-owned projection, bounded text and catalog subsets without changing current revision", () => {
  const run = lifecycle();
  const program = new ProgramRuntime(run.control, "local");
  const initial = program.snapshot();
  const invalid = [
    { ...definition(), schema: "old" },
    { ...definition(), catalogVersion: "old" },
    { ...definition(), projection: { version: DEFAULT_PROGRAM.projection.version, keys: ["direction"] } },
    { ...definition(), questions: definition().questions.map((q) => q.key === "bias" ? { ...q, instructions: "override" } : q) },
    { ...definition(), questions: definition().questions.map((q) => q.key === "bias" ? { ...q, type: "score" } : q) },
    { ...definition(), questions: definition().questions.map((q) => q.key === "intent" ? { ...q, resolver: { id: "custom", version: 1 } } : q) },
    { ...definition(), questions: definition().questions.map((q) => q.key === "leverage" ? { ...q, criteria: { huge: "Huge", small: "Small" } } : q) },
    { ...definition(), questions: definition().questions.map((q) => q.key === "direction" ? { ...q, type: "score", criteria: ["low", "high"] } : q) },
    { ...definition(), questions: definition().questions.map((q) => q.key === "direction" ? { ...q, instructions: "x".repeat(2001) } : q) },
    { ...definition(), questions: definition().questions.map((q) => q.key === "direction" ? { ...q, instructions: " " } : q) },
    { ...definition(), groups: [{ id: "trade", features: ["secret"], questions: ["bias", "intent", "leverage"] }] },
  ];
  for (const candidate of invalid) {
    expect(() => program.apply(candidate)).toThrow();
    expect(program.snapshot()).toEqual(initial);
  }
  for (const provider of ["gateway", "typesafe", "openrouter", "local"] as const) {
    const presets = new ProgramRuntime(run.control, provider).presets;
    for (const preset of presets) expect(validateProgram(preset.definition, provider)).toEqual([]);
  }
  const selected = program.apply(definition());
  expect(selected.revision).toBe(programRevision(selected.definition));
  expect(selected.revision).not.toBe(initial.revision);
  expect(program.apply({ ...definition(), groups: definition().groups.map((group) => ({ ...group, features: ["coin", "mid"] })) }).revision).not.toBe(selected.revision);
  expect(program.apply(definition("Is liquidity improving?")).revision).not.toBe(selected.revision);
});

test("program endpoint rejects client hashes, malformed configs and running/transitional updates", async () => {
  const run = lifecycle();
  const program = new ProgramRuntime(run.control, "local");
  const operator = createOperatorControl({ lifecycle: run.control, program, env: { MODEL: "mock", DRY_RUN: "true", TICK_MS: "30000" }, rebuild: async () => {} });
  const fetch = createPaperOperatorFetch(operator);
  expect((await fetch(request("/program", { definition: definition(), revision: "forged" })))?.status).toBe(400);
  const invalid = await fetch(request("/program", { definition: {} }));
  expect(invalid?.status).toBe(400);
  expect((await invalid!.json()).issues.some((issue: { path: string }) => issue.path === "schema")).toBe(true);
  for (const status of ["running", "starting", "paused", "stopping", "attention-required"] as const) {
    run.state.status = status;
    expect((await fetch(request("/program", { definition: definition() })))?.status).toBe(409);
  }
  run.state.status = "expired";
  const saved = await fetch(request("/program", { definition: definition() }));
  expect(saved?.status).toBe(200);
  expect(await saved!.json()).toEqual(program.snapshot());
  const read = await fetch(request("/program"));
  expect(await read!.json()).toEqual({ ...program.snapshot(), presets: program.presets });
  await run.control.start();
  expect((await fetch(request("/program", { definition: DEFAULT_PROGRAM })))?.status).toBe(409);
  expect((await fetch(request("/stop", {})))?.status).toBe(200);
  expect((await fetch(request("/program", { definition: DEFAULT_PROGRAM })))?.status).toBe(200);
});

test("program mutation cannot race pending start, validation, or settings rebuild", async () => {
  for (const path of ["/start", "/validate", "/settings"]) {
    const run = lifecycle();
    const program = new ProgramRuntime(run.control, "local");
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const operator = createOperatorControl({
      lifecycle: run.control, program, env: { DRY_RUN: "true", TICK_MS: "30000" },
      rebuild: async () => { entered.resolve(); await gate.promise; },
      validate: async () => {
        entered.resolve();
        await gate.promise;
        return { ok: true, realAllowed: false, message: "Connected", apiUrl: "https://api.hyperliquid-testnet.xyz", wsUrl: "wss://api.hyperliquid-testnet.xyz/ws", rpcUrl: "https://rpc.hyperliquid-testnet.xyz", checkedAt: 1 };
      },
    });
    const fetch = createPaperOperatorFetch(operator);
    const body = path === "/settings" ? { settings: operator.runtime.settings() } : {};
    const pending = fetch(request(path, body));
    await entered.promise;
    expect((await fetch(request("/program", { definition: definition() })))?.status).toBe(409);
    gate.resolve();
    await pending;
  }
});

test("real model provider sees selected fields and text; in-flight evidence retains the captured revision", async () => {
  const run = lifecycle();
  const program = new ProgramRuntime(run.control, "gateway");
  const before = program.apply(definition());
  const snapshots: GroupSnapshot[] = [];
  const gate = Promise.withResolvers<void>();
  const model = new JevModel({ program: program.active, target: { provider: "gateway", modelId: "fixture" }, callGroup: async (snapshot): Promise<GroupResult> => {
    snapshots.push(snapshot);
    await gate.promise;
    return { groupId: snapshot.groupId, status: "complete", answers: snapshot.questions.map((q) => {
      const choice = q.key === "bias" ? "long" : q.key === "intent" ? "hold" : q.key === "leverage" ? "1" : "up";
      return { key: q.key, declaredType: q.type, groupId: snapshot.groupId, role: q.role, status: "answered", raw: null, answer: { type: "choice", choice } };
    }), unexpected: [], provider: { name: "gateway" }, timing: { startedAt: 0, completedAt: 1, latencyMs: 1 } };
  } });
  const pending = model.decide(state);
  expect(snapshots.map((group) => group.state)).toEqual([{ mid: 77000 }, { mid: 77000 }]);
  expect(snapshots[1]!.questions[0]!.instructions).toEqual({ question: "Is the price rising?" });
  const next = program.apply(definition("New question"));
  gate.resolve();
  const oldEvaluation = await pending;
  expect(oldEvaluation.evidence.capture.revision).toBe(before.revision);
  expect(oldEvaluation.decision?.intent).toBe("hold");
  expect((await oldEvaluation.observations)[0]!.answers[0]!.answer).toEqual({ type: "choice", choice: "up" });
  expect((await model.decide(state)).evidence.capture.revision).toBe(next.revision);
});

test("mock model captures configured groups, answers supplemental questions and ignores excluded trading inputs", async () => {
  const run = lifecycle();
  const program = new ProgramRuntime(run.control, "local");
  const saved = program.apply(definition());
  const model = new MockModel({ program: program.active });
  const result = await model.decide(state);
  expect(result.evidence.capture.revision).toBe(saved.revision);
  expect(result.evidence.capture.groups.map((group) => group.state)).toEqual([{ mid: 77000 }, { mid: 77000 }]);
  const observation = (await result.observations)[0]!;
  expect(observation.answers[0]!.key).toBe("direction");
  const answer = observation.answers[0]!.answer;
  expect(answer?.type).toBe("choice");
  if (answer?.type !== "choice") throw new Error("Expected a mock choice answer");
  expect(["up", "down"]).toContain(answer.choice);
  const changed = await model.decide({ ...state, tick: 500, bookImbalance: 100, returnsBps: { ...state.returnsBps, last20: -1000 } });
  expect(changed.decision?.bias).toBe(result.decision?.bias);
  expect(changed.decision?.intent).toBe(result.decision?.intent);
  program.apply(DEFAULT_PROGRAM);
  expect((await model.decide(state)).evidence.capture.revision).toBe(program.snapshot().revision);
});

class WorkerStub {
  listeners = new Set<EventListener>();
  constructor(readonly port: number) { queueMicrotask(() => this.emit({ type: "ready", port })); }
  emit(data: unknown) { for (const listener of this.listeners) listener(new MessageEvent("message", { data })); }
  postMessage(value: unknown) {
    if (value && typeof value === "object" && "type" in value && value.type === "close") {
      queueMicrotask(() => this.emit({ type: "closed" }));
    }
  }
  terminate() {}
  addEventListener(type: "message" | "error", listener: EventListener) { if (type === "message") this.listeners.add(listener); }
  removeEventListener(type: "message" | "error", listener: EventListener) { if (type === "message") this.listeners.delete(listener); }
}

test("capability-protected session program endpoints isolate two owners and preserve paper-only guards", async () => {
  const handlers = new Map<number, (request: Request) => Promise<Response | undefined>>();
  const programs: ProgramRuntime[] = [];
  let port = 4100;
  const broker = createPaperSessions({ workerFactory: () => {
    const run = lifecycle();
    const program = new ProgramRuntime(run.control, "local");
    programs.push(program);
    const operator = createOperatorControl({ lifecycle: run.control, program, env: { DRY_RUN: "true", TICK_MS: "30000" }, rebuild: async () => {} });
    handlers.set(++port, createPaperOperatorFetch(operator));
    return new WorkerStub(port);
  }, proxyFetch: async (url, init) => (await handlers.get(Number(url.port))!(new Request(url, init)))! });
  const call = (token: string, body?: unknown) => broker.fetch(new Request("http://bot/sessions/program", { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
  try {
    const a = await (await broker.fetch(new Request("http://bot/sessions", { method: "POST" })))!.json();
    const b = await (await broker.fetch(new Request("http://bot/sessions", { method: "POST" })))!.json();
    expect(a.ownerToken).not.toBe(b.ownerToken);
    expect((await broker.fetch(new Request("http://bot/sessions/program")))?.status).toBe(401);
    expect((await call("unknown"))?.status).toBe(410);
    expect((await call(a.token, { definition: definition() }))?.status).toBe(200);
    expect((await (await call(a.token))!.json()).revision).toBe(programs[0]!.snapshot().revision);
    expect((await (await call(b.token))!.json()).definition).toEqual(DEFAULT_PROGRAM);
    expect((await call(b.token, { definition: definition("Owner B question") }))?.status).toBe(200);
    expect(programs[0]!.snapshot().revision).not.toBe(programs[1]!.snapshot().revision);
    expect((await call(a.token, { definition: definition(), apiKey: "secret" }))?.status).toBe(400);
    expect((await broker.fetch(new Request("http://bot/sessions/program", { method: "DELETE", headers: { authorization: `Bearer ${a.token}` } })))?.status).toBe(405);
  } finally { await broker.close(); }
});
