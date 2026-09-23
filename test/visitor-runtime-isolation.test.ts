import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const directory = mkdtempSync(`${tmpdir()}/jev-visitor-runtime-`);
const configUrl = pathToFileURL(resolve("src/config.ts")).href;
const modelUrl = pathToFileURL(resolve("src/model.ts")).href;

afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function isolated(script: string): Promise<Record<string, unknown>> {
  const child = Bun.spawn([process.execPath, "--eval", script], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr || `isolated Bun process exited ${exitCode}`);
  return JSON.parse(stdout) as Record<string, unknown>;
}

describe("visitor runtime environment isolation", () => {
  test("imported config ignores hostile dotenv wallet and transport values", async () => {
    await Bun.write(`${directory}/.env`, [
      "PRIVATE_KEY=0xhostile-wallet",
      "WALLETS_JSON={\"BTC\":\"0xhostile-wallet\"}",
      "HL_API_URL=https://hostile.example?token=secret",
      "HL_API_KEY=hostile-transport-key",
    ].join("\n"));
    const result = await isolated(`
      // Runtime-selected file URL exercises config's import-time isolation boundary.
      globalThis.__JEV_RUNTIME_ENV__ = { MODEL: "mock", DRY_RUN: "true", HL_TESTNET: "true", TICK_MS: "30000" };
      const { config, runtimeEnv } = await import(${JSON.stringify(configUrl)});
      console.log(JSON.stringify({
        privateKey: config.privateKey ?? null,
        walletEnv: runtimeEnv.WALLETS_JSON ?? null,
        apiUrl: config.hyperliquid.apiUrl,
        headers: config.hyperliquid.headers,
        dryRun: config.dryRun,
      }));
    `);

    expect(result).toEqual({
      privateKey: null,
      walletEnv: null,
      apiUrl: "https://api.hyperliquid-testnet.xyz",
      headers: {},
      dryRun: true,
    });
  });

  test("gateway requests use the injected visitor credential", async () => {
    await Bun.write(`${directory}/.env`, "AI_GATEWAY_API_KEY=hostile-gateway-key\n");
    const state = {
      coin: "BTC", market: "BTC-USD", tick: 1, tickMs: 30_000, mid: 100,
      spreadBps: 1, bookImbalance: 0, depth: {}, book: { bids: [], asks: [] },
      returnsBps: { last1: 0, last5: 0, last20: 0, last100: 0 }, recentMids: "100",
      trades: { count: 0, buySz: 0, sellSz: 0, cvdSz: 0, vwap: null, lastPrice: null, lastSide: null },
      recentTrades: [],
      position: { coin: "BTC", side: "flat", size: 0, notionalUsd: 0, entry: null, leverage: null, liquidationPx: null, distanceBps: null, unrealizedUsd: 0 },
      indicators: { sma20: null, sma50: null, ema20: null, midVsSma20Bps: null, midVsSma50Bps: null, rsi14: null, vol20Bps: null, high20: null, low20: null, rangePos20: null },
      asset: { markPx: null, oraclePx: null, fundingBps: null, premiumBps: null, openInterest: null, dayNtlVlmUsd: null, dayChangeBps: null, maxLeverage: 5 },
      maxLeverage: 5,
    };
    const result = await isolated(`
      globalThis.__JEV_RUNTIME_ENV__ = {
        MODEL: "jev", JEV_PROVIDER: "gateway", JEV_MODEL_ID: "typesafe-ai/jev-latest",
        AI_GATEWAY_API_KEY: "visitor-gateway-key", DRY_RUN: "true", HL_TESTNET: "true",
      };
      let authorization = null;
      globalThis.fetch = async (_input, init) => {
        const headers = new Headers(init?.headers);
        authorization = headers.get("authorization");
        return Response.json({
          answers: {
            bias: { type: "choice", choice: "long", probabilities: { long: 0.8, short: 0.2 } },
            intent: { type: "choice", choice: "hold", probabilities: { open: 0.2, hold: 0.8 } },
            leverage: { type: "choice", choice: "1", probabilities: { "1": 1, "2": 0, "3": 0, "5": 0 } },
          },
          usage: { inputTokens: 7, outputTokens: 3 },
        });
      };
      // Runtime-selected file URL keeps this model import isolated from the test process module cache.
      const { JevModel } = await import(${JSON.stringify(modelUrl)});
      const decision = await new JevModel().decide(${JSON.stringify(state)});
      console.log(JSON.stringify({ authorization, action: decision.action, inputTokens: decision.inputTokens }));
    `);

    expect(result).toEqual({ authorization: "Bearer visitor-gateway-key", action: "hold", inputTokens: 7 });
  });
});
