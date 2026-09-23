import { describe, expect, test } from "bun:test";
import { resolveHyperliquidEnv } from "../src/config";
import { createOperatorControl } from "../src/operator-control";
import { DEFAULT_SETTINGS, type ConnectionValidation, type RunSnapshot, type TradingSettings } from "../src/settings";
import type { LifecycleControl } from "../src/settings-runtime";

function snapshot(status: RunSnapshot["status"] = "off"): RunSnapshot {
  return {
    runId: null,
    status,
    startedAt: null,
    deadlineAt: null,
    stoppedAt: null,
    durationMs: 30 * 60_000,
    stopReason: null,
    serverNow: Date.now(),
  };
}

function lifecycle(initial: RunSnapshot["status"] = "off"): LifecycleControl & { starts: number } {
  let state = snapshot(initial);
  return {
    starts: 0,
    snapshot: () => ({ ...state, serverNow: Date.now() }),
    applyDuration(minutes) {
      state = { ...state, durationMs: minutes * 60_000 };
    },
    async start() {
      this.starts++;
      state = { ...state, status: "running", runId: "run-1", serverNow: Date.now() };
      return this.snapshot();
    },
    async stop(reason) {
      state = { ...state, status: "off", stopReason: reason ?? null, serverNow: Date.now() };
      return this.snapshot();
    },
    async reconcile() {
      return this.snapshot();
    },
  };
}

function request(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:3002${path}`, {
    method: "POST",
    headers: {
      host: "127.0.0.1:3002",
      origin: "http://localhost:3001",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const validConnection: ConnectionValidation = {
  ok: true,
  realAllowed: true,
  message: "Connected",
  apiUrl: "https://api.hyperliquid-testnet.xyz",
  wsUrl: "wss://api.hyperliquid-testnet.xyz/ws",

  rpcUrl: "https://rpc.hyperliquid-testnet.xyz",
  checkedAt: 1,
};
test("preserves credential queries while appending the info path", () => {
  const transport = resolveHyperliquidEnv({ HL_API_URL: "https://provider.example/base?token=secret" }, true);
  expect(transport.infoUrl).toBe("https://provider.example/base/info?token=secret");
});

describe("private operator control", () => {
  test("rejects hostile Origin, Host, originless mutations, and non-loopback peers", async () => {
    const control = createOperatorControl({ lifecycle: lifecycle(), rebuild: async () => {}, validate: async () => validConnection, env: {} });

    expect((await control.fetch(request("/stop", {}, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await control.fetch(request("/stop", {}, { host: "localhost:3000" }))).status).toBe(403);
    expect((await control.fetch(request("/stop", {}, { origin: "" }))).status).toBe(403);
    expect((await control.fetch(request("/stop", {}), "192.168.1.9")).status).toBe(403);

    const publicLike = new Request("http://127.0.0.1:3002/operator", { headers: { host: "127.0.0.1:3002" } });
    expect((await control.fetch(publicLike, "10.0.0.12")).status).toBe(403);
  });

  test("applies only after rebuild succeeds and only while stopped", async () => {
    const run = lifecycle();
    let rebuilds = 0;
    const control = createOperatorControl({
      lifecycle: run,
      env: {},
      rebuild: async () => {
        rebuilds++;
        throw new Error("executor could not rebuild");
      },
      validate: async () => validConnection,
    });
    const changed = { ...DEFAULT_SETTINGS, quoteUsd: 77 };
    const failed = await control.fetch(request("/settings", { settings: changed }));
    expect(failed.status).toBe(400);
    expect(control.runtime.settings().quoteUsd).toBe(40);
    expect(rebuilds).toBe(1);

    const running = lifecycle("running");
    let runningRebuilds = 0;
    const blocked = createOperatorControl({
      lifecycle: running,
      env: {},
      rebuild: async () => { runningRebuilds++; },
      validate: async () => validConnection,
    });
    expect((await blocked.fetch(request("/settings", { settings: changed }))).status).toBe(409);
    expect(runningRebuilds).toBe(0);
  });


  test("stop returns without waiting for a slow stopped rebuild", async () => {
    const rebuilt = Promise.withResolvers<void>();
    const run = lifecycle();
    const control = createOperatorControl({
      lifecycle: run,
      env: {},
      rebuild: async () => rebuilt.promise,
      validate: async () => validConnection,
    });
    const applying = control.fetch(request("/settings", {
      settings: { ...DEFAULT_SETTINGS, quoteUsd: 88 },
    }));
    expect((await control.fetch(request("/stop", {}))).status).toBe(200);
    rebuilt.resolve();
    expect((await applying).status).toBe(200);
    expect(control.runtime.settings().quoteUsd).toBe(88);
  });
  test("retains a memory key on the same host and clears it on host change", async () => {
    const rebuilt: { settings: TradingSettings; key?: string }[] = [];
    const validatedKeys: (string | undefined)[] = [];
    const control = createOperatorControl({
      lifecycle: lifecycle(),
      env: { HL_API_URL: "https://provider.example/base?token=endpoint-secret", HL_API_KEY: "top-secret" },
      rebuild: async (settings, key) => { rebuilt.push({ settings, key }); },
      validate: async (_settings, key) => {
        validatedKeys.push(key);
        return validConnection;
      },
    });
    expect(control.runtime.snapshot().overrides).toEqual([]);
    expect(control.runtime.snapshot().redactedEndpoints).toEqual(["hyperliquidApiUrl"]);
    const validationCandidate = { ...control.runtime.settings(), hyperliquidApiUrl: "https://other.example" };
    await control.fetch(request("/validate", { settings: validationCandidate }));
    expect(validatedKeys.at(-1)).toBeUndefined();

    const sameHost = { ...control.runtime.snapshot().settings, quoteUsd: 41 };
    const retained = await control.fetch(request("/settings", { settings: sameHost }));
    expect(control.runtime.snapshot().overrides).toEqual(["quoteUsd"]);
    expect(rebuilt.at(-1)?.key).toBe("top-secret");
    expect(rebuilt.at(-1)?.settings.hyperliquidApiUrl).toContain("endpoint-secret");
    expect(await retained.text()).not.toContain("endpoint-secret");

    const anotherHost = { ...sameHost, hyperliquidApiUrl: "https://other.example" };
    const result = await control.fetch(request("/settings", { settings: anotherHost }));
    expect(result.status).toBe(200);
    expect(rebuilt.at(-1)?.key).toBeUndefined();
    const body = await result.text();
    expect(body).not.toContain("top-secret");
    expect(JSON.parse(body).apiKeyConfigured).toBe(false);
  });


  test("clears a hidden endpoint only when clearedEndpoints explicitly names it", async () => {
    const rebuilt: { settings: TradingSettings; key?: string }[] = [];
    const control = createOperatorControl({
      lifecycle: lifecycle(),
      env: { HL_API_URL: "https://provider.example/base?token=secret", HL_API_KEY: "key" },
      rebuild: async (settings, key) => { rebuilt.push({ settings, key }); },
      validate: async () => validConnection,
    });
    const hidden = control.runtime.snapshot().settings;
    const result = await control.fetch(request("/settings", {
      settings: hidden,
      clearedEndpoints: ["hyperliquidApiUrl"],
    }));
    expect(result.status).toBe(200);
    expect(rebuilt.at(-1)?.settings.hyperliquidApiUrl).toBeNull();
    expect(rebuilt.at(-1)?.key).toBeUndefined();
    expect(control.runtime.snapshot().redactedEndpoints).toEqual([]);
  });
  test("requires explicit confirmation before a real start", async () => {
    const run = lifecycle();
    const control = createOperatorControl({
      lifecycle: run,
      env: { DRY_RUN: "false" },
      rebuild: async () => {},
      validate: async () => validConnection,
    });

    const denied = await control.fetch(request("/start", { confirmReal: false }));
    expect(denied.status).toBe(400);
    expect(run.starts).toBe(0);

    const started = await control.fetch(request("/start", { confirmReal: true }));
    expect(started.status).toBe(200);
    expect((await started.json() as RunSnapshot).status).toBe("running");
    expect(run.starts).toBe(1);
  });

  test("coalesces concurrent starts and stop cancels an outstanding preflight", async () => {
    const run = lifecycle();
    const pending = Promise.withResolvers<ConnectionValidation>();
    let validations = 0;
    const control = createOperatorControl({
      lifecycle: run,
      env: {},
      rebuild: async () => {},
      validate: async () => {
        validations++;
        return pending.promise;
      },
    });

    const first = control.fetch(request("/start", { confirmReal: false }));
    const second = control.fetch(request("/start", { confirmReal: false }));
    const save = await control.fetch(request("/settings", { settings: { ...DEFAULT_SETTINGS, quoteUsd: 50 } }));
    expect(save.status).toBe(409);
    expect((await control.fetch(request("/stop", {}))).status).toBe(200);
    pending.resolve(validConnection);

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.status).toBe(409);
    expect(secondResult.status).toBe(409);
    expect(validations).toBe(1);
    expect(run.starts).toBe(0);
  });
});
