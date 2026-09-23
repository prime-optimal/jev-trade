const workerEnv = process.env;
const rawVisitorEnv = workerEnv.JEV_VISITOR_ENV;
const inheritedSecrets: string[] = [];

const ALLOWED_ENV: Record<string, true> = {
  MODEL: true,
  JEV_PROVIDER: true,
  JEV_MODEL_ID: true,
  OPENROUTER_API_KEY: true,
  TYPESAFE_API_KEY: true,
  AI_GATEWAY_API_KEY: true,
};

function visitorEnvironment(raw: string | undefined): Record<string, string> {
  if (!raw) throw new Error("Missing visitor environment");
  const decoded = JSON.parse(raw) as unknown;
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) throw new Error("Visitor environment must be an object");
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(decoded)) {
    if (!ALLOWED_ENV[key]) throw new Error(`Visitor environment key is not allowed: ${key}`);
    if (typeof value !== "string") throw new Error(`Visitor environment value must be a string: ${key}`);
    safe[key] = value;
    if (/KEY$/.test(key) && value) inheritedSecrets.push(value);
  }
  return safe;
}

function safeStartupMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : "Visitor session failed to start";
  for (const secret of inheritedSecrets) message = message.split(secret).join("[redacted]");
  message = message.replace(/https?:\/\/[^\s]+/gi, "[redacted URL]");
  return message.slice(0, 300);
}

const workerGlobal = globalThis as typeof globalThis & { close(): void };
let closeSession: (() => Promise<void>) | null = null;

try {
  const safeEnv = visitorEnvironment(rawVisitorEnv);
  const safeRuntimeEnv: Record<string, string | undefined> = {
    ...safeEnv,
    DRY_RUN: "true",
    HL_TESTNET: "true",
    TICK_MS: "30000",
  };
  globalThis.__JEV_RUNTIME_ENV__ = safeRuntimeEnv;

  const [runtimeModule, operatorModule, guardModule, serverModule, settingsModule, sleevesModule] = await Promise.all([
    import("./execution-runtime"),
    import("./operator-control"),
    import("./paper-session-guard"),
    import("./server"),
    import("./settings"),
    import("./sleeves"),
  ]);
  const specs = settingsModule.SUPPORTED_COINS.map((coin) => ({
    coin,
    pair: sleevesModule.coinPair(coin),
    label: coin,
  }));
  const runtime = runtimeModule.createExecutionRuntime({ specs });
  const operator = operatorModule.createOperatorControl({
    lifecycle: runtime.lifecycle,
    rebuild: runtime.rebuild,
    env: safeRuntimeEnv,
    controlPort: 3002,
    controlHost: "127.0.0.1:3002",
    allowedOrigin: "http://localhost:3001",
  });
  const visitorFetch = guardModule.createPaperOperatorFetch(operator);
  await runtime.rebuild(operator.runtime.settings());
  runtime.lifecycle.applyDuration(operator.runtime.settings().runDurationMinutes);
  const server = serverModule.startServer(runtime.meta, runtime.views, runtime.lifecycle.snapshot, {
    hostname: "127.0.0.1",
    port: 0,
    fetch: visitorFetch,
  });
  runtime.attachSink(server);

  let closing = false;
  closeSession = async () => {
    if (closing) return;
    closing = true;
    operator.close();
    await runtime.dispose();
    server.close();
  };
  addEventListener("message", (event: MessageEvent<unknown>) => {
    if (typeof event.data !== "object" || event.data === null || !("type" in event.data) || event.data.type !== "close") return;
    void closeSession?.().finally(() => workerGlobal.close());
  });
  postMessage({ type: "ready", port: server.port });
} catch (error) {
  postMessage({ type: "error", message: safeStartupMessage(error) });
  await closeSession?.();
  workerGlobal.close();
}
