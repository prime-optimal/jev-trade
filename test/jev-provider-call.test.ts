import { describe, expect, test } from "bun:test";
import type { GroupSnapshot, ProviderTarget } from "../src/jev-evidence";

const providerUrl = new URL("../src/jev-provider.ts", import.meta.url).href;
const gatewaySnapshot: GroupSnapshot = {
  groupId: "trade",
  capturedAt: 100,
  catalogVersion: "test-catalog",
  state: { coin: "BTC", mid: 100 },
  features: [],
  questions: [
    { key: "bias", type: "choice", role: "required", instructions: "Choose a side", criteria: { long: "buy", short: "sell" }, resolver: null },
    { key: "ready", type: "boolean", role: "observational", instructions: "Is the signal ready?", criteria: { true: "ready", false: "not ready" }, resolver: null },
  ],
};
const typesafeSnapshot: GroupSnapshot = {
  groupId: "trade",
  capturedAt: 100,
  catalogVersion: "test-catalog",
  state: { coin: "BTC", mid: 100 },
  features: [],
  questions: [
    { key: "bias", type: "choice", role: "required", instructions: "Choose a side", criteria: { long: "buy", short: "sell" }, resolver: null },
  ],
};

async function callInChild(
  provider: ProviderTarget["provider"],
  snapshot: GroupSnapshot,
  fetchSource: string,
): Promise<{ readonly result: Record<string, unknown>; readonly elapsedMs: number; readonly requestBody?: Record<string, unknown>; readonly aborted: boolean }> {
  const script = `
    globalThis.__JEV_RUNTIME_ENV__ = {
      MODEL: "jev", JEV_PROVIDER: ${JSON.stringify(provider)}, JEV_MODEL_ID: "test-model",
      AI_GATEWAY_API_KEY: "gateway-secret-key", TYPESAFE_API_KEY: "typesafe-secret-key",
      OPENROUTER_API_KEY: "openrouter-secret-key", DRY_RUN: "true", HL_TESTNET: "true"
    };
    let requestBody;
    let aborted = false;
    globalThis.fetch = ${fetchSource};
    const module = await import(${JSON.stringify(providerUrl)});
    const snapshot = JSON.parse(${JSON.stringify(JSON.stringify(snapshot))});
    const started = performance.now();
    const result = await module.callProviderGroup(snapshot, { provider: ${JSON.stringify(provider)}, modelId: "test-model" });
    console.log(JSON.stringify({ result, elapsedMs: performance.now() - started, requestBody, aborted }));
  `;
  const child = Bun.spawn([process.execPath, "--eval", script], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr || `isolated provider process exited ${exitCode}`);
  return JSON.parse(stdout) as {
    readonly result: Record<string, unknown>;
    readonly elapsedMs: number;
    readonly requestBody?: Record<string, unknown>;
    readonly aborted: boolean;
  };
}

describe("callProviderGroup", () => {
  test("maps Gateway model and usage while preserving boolean probability", async () => {
    const { result, requestBody } = await callInChild("gateway", gatewaySnapshot, `async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        answers: {
          bias: { type: "choice", choice: "long", probabilities: { long: 0.8, short: 0.2 } },
          ready: { type: "boolean", probability: 0.72 }
        },
        usage: { inputTokens: 12, outputTokens: 3 }
      });
    }`);
    const provider = result.provider as Record<string, unknown>;
    const usage = provider.usage as Record<string, unknown>;
    const answers = result.answers as readonly Record<string, unknown>[];
    const booleanAnswer = answers[1]?.answer as Record<string, unknown>;

    expect(result.status).toBe("complete");
    expect(provider).toMatchObject({ name: "gateway", model: "test-model" });
    expect(usage).toEqual({ inputTokens: 12, outputTokens: 3, totalTokens: 15 });
    expect(booleanAnswer).toEqual({ type: "boolean", probability: 0.72 });
    expect("confidence" in booleanAnswer).toBe(false);
    expect(requestBody?.state).toEqual(gatewaySnapshot.state);
    expect(requestBody?.questions).toEqual({
      bias: { type: "choice", instructions: "Choose a side", criteria: { long: "buy", short: "sell" } },
      ready: { type: "boolean", instructions: "Is the signal ready?", criteria: { true: "ready", false: "not ready" } },
    });
  });

  test("maps TypeSafe model and snake-case usage without deriving confidence", async () => {
    const { result } = await callInChild("typesafe", typesafeSnapshot, `async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        model: "typesafe-resolved-model",
        answers: { bias: { type: "choice", choice: "long", confidence: 0.91, probabilities: { long: 0.3333333, short: 0.6666667 } } },
        usage: { input_tokens: 19, output_tokens: 5 }
      });
    }`);
    const provider = result.provider as Record<string, unknown>;
    const answers = result.answers as readonly Record<string, unknown>[];

    expect(result.status).toBe("complete");
    expect(provider).toMatchObject({
      name: "typesafe",
      model: "typesafe-resolved-model",
      usage: { inputTokens: 19, outputTokens: 5 },
    });
    expect(answers[0]?.answer).toEqual({
      type: "choice",
      choice: "long",
      confidence: 0.91,
      probabilities: { long: 0.3333333, short: 0.6666667 },
    });
  });

  test("returns a sanitized failed result for provider HTTP errors", async () => {
    const { result } = await callInChild("typesafe", typesafeSnapshot, `async () => new Response(
      JSON.stringify({ error: "private response body and typesafe-secret-key" }),
      { status: 500, headers: { "content-type": "application/json", "x-private-header": "header-secret" } }
    )`);
    const serialized = JSON.stringify(result);
    const failure = result.failure as Record<string, unknown>;
    const answers = result.answers as readonly Record<string, unknown>[];

    expect(result.status).toBe("failed");
    expect(failure).toMatchObject({ code: "provider_error", message: "provider request failed", status: 500 });
    expect(answers[0]?.status).toBe("failed");
    expect(serialized).not.toContain("typesafe-secret-key");
    expect(serialized).not.toContain("private response body");
    expect(serialized).not.toContain("header-secret");
  });

  test("aborts a hung provider at the 4000ms deadline and returns timeout evidence", async () => {
    const { result, elapsedMs, aborted } = await callInChild("typesafe", typesafeSnapshot, `(_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { aborted = true; reject(init.signal.reason); });
    })`);
    const failure = result.failure as Record<string, unknown>;

    expect(result.status).toBe("timeout");
    expect(failure).toEqual({ code: "timeout", message: "jev timeout 4000ms" });
    expect(aborted).toBe(true);
    expect(elapsedMs).toBeGreaterThanOrEqual(3500);
    expect(elapsedMs).toBeLessThan(6500);
  }, 10000);
});
