import { afterEach, expect, test } from "bun:test";

const children: Bun.Subprocess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

async function unusedPort(): Promise<number> {
  const listener = Bun.serve({ port: 0, fetch: () => new Response("unavailable", { status: 503 }) });
  const port = listener.port!;
  listener.stop(true);
  return port;
}

async function waitForJson<T>(url: string, child: Bun.Subprocess, accept: (body: unknown) => body is T, init?: RequestInit): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`bot exited during bootstrap with code ${child.exitCode}`);
    try {
      const response = await fetch(url, init);
      if (response.ok) {
        const body = await response.json();
        if (accept(body)) return body;
      }
    } catch {}
    // A child process exposes readiness only by accepting the HTTP request.
    await Bun.sleep(25);
  }
  throw new Error(`timed out waiting for ${url}`);
}

type BootstrapMeta = { sleeves: Array<{ coin: string; status: string; error: string; retryAt: number }> };
type RunBody = { status: string };
type OperatorBody = { run: { status: string }; settings: { mode: string } };

function isBootstrapMeta(body: unknown): body is BootstrapMeta {
  if (!body || typeof body !== "object" || !(("sleeves") in body) || !Array.isArray(body.sleeves)) return false;
  const sleeve = body.sleeves[0];
  return body.sleeves.length === 1 && sleeve != null && typeof sleeve === "object"
    && "coin" in sleeve && "status" in sleeve && "error" in sleeve && "retryAt" in sleeve;
}

function isRunBody(body: unknown): body is RunBody {
  return !!body && typeof body === "object" && "status" in body && typeof body.status === "string";
}

function isOperatorBody(body: unknown): body is OperatorBody {
  if (!body || typeof body !== "object" || !("run" in body) || !body.run || typeof body.run !== "object") return false;
  return "status" in body.run && typeof body.run.status === "string"
    && "settings" in body && !!body.settings && typeof body.settings === "object"
    && "mode" in body.settings && typeof body.settings.mode === "string";
}
test("unavailable startup transport leaves the control plane Off with a visible retryable sleeve", async () => {
  const [apiPort, publicPort, controlPort] = await Promise.all([unusedPort(), unusedPort(), unusedPort()]);
  const child = Bun.spawn([process.execPath, "--no-env-file", "run", "src/index.ts"], {
    cwd: import.meta.dir + "/..",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      MODEL: "mock",
      DRY_RUN: "true",
      HL_TESTNET: "true",
      HL_COINS: "BTC",
      TICK_MS: "30000",
      PRICE_MS: "1000",
      PORT: String(publicPort),
      CONTROL_PORT: String(controlPort),
      HL_API_URL: `http://127.0.0.1:${apiPort}`,
      HL_WS_URL: `ws://127.0.0.1:${apiPort}/ws`,
      HL_RPC_URL: `http://127.0.0.1:${apiPort}/rpc`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(child);

  const [meta, run, operator] = await Promise.all([
    waitForJson(`http://127.0.0.1:${publicPort}/`, child, isBootstrapMeta),
    waitForJson(`http://127.0.0.1:${publicPort}/run`, child, isRunBody),
    waitForJson(`http://127.0.0.1:${controlPort}/operator`, child, isOperatorBody, {
      headers: { origin: "http://localhost:3001" },
    }),
  ]);

  expect(run.status).toBe("off");
  expect(meta.sleeves).toHaveLength(1);
  expect(meta.sleeves[0]).toMatchObject({ coin: "BTC", status: "retrying" });
  expect(meta.sleeves[0].error.length).toBeGreaterThan(0);
  expect(meta.sleeves[0].retryAt).toBeGreaterThan(Date.now());
  expect(child.exitCode).toBeNull();
  expect(operator.run.status).toBe("off");
  expect(operator.settings.mode).toBe("paper");
});
