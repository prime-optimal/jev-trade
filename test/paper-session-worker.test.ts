import { describe, expect, test } from "bun:test";
import { createOperatorControl } from "../src/operator-control";
import { createPaperOperatorFetch } from "../src/paper-session-guard";
import { DEFAULT_SETTINGS, type RunSnapshot } from "../src/settings";
import type { LifecycleControl } from "../src/settings-runtime";

function lifecycle(): LifecycleControl {
  const state: RunSnapshot = {
    runId: null,
    status: "off",
    startedAt: null,
    deadlineAt: null,
    stoppedAt: null,
    durationMs: 30 * 60_000,
    stopReason: null,
    serverNow: Date.now(),
  };
  return {
    snapshot: () => ({ ...state, serverNow: Date.now() }),
    start: async () => ({ ...state, status: "running" }),
    stop: async () => state,
    reconcile: async () => state,
    applyDuration: () => {},
  };
}

function request(path: string, body?: unknown): Request {
  return new Request(`http://127.0.0.1:49152${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("paper session operator guard", () => {
  test("rejects real trading, credentials, custom transports, and fast ticks before rebuild", async () => {
    let rebuilds = 0;
    const operator = createOperatorControl({
      lifecycle: lifecycle(),
      env: { DRY_RUN: "true", TICK_MS: "30000" },
      rebuild: async () => { rebuilds++; },
    });
    const guarded = createPaperOperatorFetch(operator);
    const settings = { ...DEFAULT_SETTINGS, enabledCoins: ["BTC"] as const };

    const attempts = [
      { settings: { ...settings, mode: "real" } },
      { settings, apiKey: "secret" },
      { settings: { ...settings, hyperliquidApiUrl: "https://example.com" } },
      { settings: { ...settings, tickMs: 29_999 } },
      { settings, clearedEndpoints: ["hyperliquidApiUrl"] },
    ];
    for (const body of attempts) {
      const response = await guarded(request("/settings", body));
      expect(response?.status).toBe(400);
    }
    expect(rebuilds).toBe(0);
  });

  test("marks safe operator snapshots and accepts paper settings", async () => {
    const operator = createOperatorControl({
      lifecycle: lifecycle(),
      env: { DRY_RUN: "true", TICK_MS: "30000" },
      rebuild: async () => {},
    });
    const guarded = createPaperOperatorFetch(operator);

    const snapshot = await guarded(request("/operator"));
    expect(snapshot?.status).toBe(200);
    expect((await snapshot?.json())?.paperOnly).toBe(true);

    const saved = await guarded(request("/settings", {
      settings: { ...DEFAULT_SETTINGS, enabledCoins: ["BTC"], quoteUsd: 25 },
    }));
    expect(saved?.status).toBe(200);
    const body = await saved?.json();
    expect(body.paperOnly).toBe(true);
    expect(body.settings.quoteUsd).toBe(25);
  });
});
