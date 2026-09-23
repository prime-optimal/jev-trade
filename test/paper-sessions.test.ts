import { describe, expect, spyOn, test } from "bun:test";
import { createDecisionStore, type DecisionPage, type DecisionStore } from "../src/decision-store";
import { createOwnerTokens } from "../src/owner-token";
import { createPaperSessions, paperSessionEnv } from "../src/paper-sessions";

class FakeWorker {
  readonly messages: unknown[] = [];
  terminated = 0;
  autoClose = true;
  terminateGate?: Promise<void>;
  private readonly listeners: Record<"message" | "error", Set<EventListener>> = {
    message: new Set(),
    error: new Set(),
  };

  postMessage(value: unknown) {
    this.messages.push(value);
    if (this.autoClose && value && typeof value === "object" && "type" in value && value.type === "close") {
      queueMicrotask(() => this.emit({ type: "closed" }));
    }
  }
  emit(data: unknown) {
    for (const listener of this.listeners.message) listener(new MessageEvent("message", { data }));
  }
  terminate() { this.terminated++; return this.terminateGate; }
  addEventListener(type: "message" | "error", listener: EventListener) { this.listeners[type].add(listener); }
  removeEventListener(type: "message" | "error", listener: EventListener) { this.listeners[type].delete(listener); }
  ready(port: number) {
    const event = new MessageEvent("message", { data: { type: "ready", port } });
    for (const listener of this.listeners.message) listener(event);
  }
  fail(message = "secret stack PRIVATE_KEY=leak") {
    const event = new MessageEvent("message", { data: { type: "error", message } });
    for (const listener of this.listeners.message) listener(event);
  }
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function tokenFrom(response: Response): Promise<string> {
  return (await response.json() as { token: string }).token;
}

function autoWorkers(ports: number[]) {
  const workers: FakeWorker[] = [];
  const envs: Record<string, string>[] = [];
  return {
    workers,
    envs,
    factory(_url: string, options: { env: Record<string, string> }) {
      const worker = new FakeWorker();
      workers.push(worker);
      envs.push(options.env);
      const port = ports.shift();
      if (port) queueMicrotask(() => worker.ready(port));
      return worker;
    },
  };
}
function manualWorkers() {
  const workers: FakeWorker[] = [];
  const waiters: Array<(worker: FakeWorker) => void> = [];
  return {
    workers,
    factory() {
      const worker = new FakeWorker();
      workers.push(worker);
      waiters.shift()?.(worker);
      return worker;
    },
    next: () => new Promise<FakeWorker>((resolve) => waiters.push(resolve)),
  };
}


describe("paper session broker", () => {
  test("isolates opaque capabilities and requires Bearer authentication", async () => {
    const fakes = autoWorkers([4101, 4102]);
    const proxied: string[] = [];
    const broker = createPaperSessions({
      workerFactory: fakes.factory,
      randomToken: (() => { const tokens = ["capability-a", "capability-b"]; return () => tokens.shift()!; })(),
      proxyFetch: async (input) => {
        proxied.push(String(input));
        return Response.json({ ok: true });
      },
    });
    try {
      const a = await tokenFrom((await broker.fetch(new Request("http://bot/sessions", { method: "POST" })))!);
      const b = await tokenFrom((await broker.fetch(new Request("http://bot/sessions", { method: "POST" })))!);
      expect((await broker.fetch(new Request("http://bot/sessions/operator")))?.status).toBe(401);
      expect((await broker.fetch(new Request("http://bot/sessions/operator", { headers: auth("unknown") })))?.status).toBe(410);

      expect((await broker.fetch(new Request("http://bot/sessions/operator", { headers: auth(a) })))?.status).toBe(200);
      expect((await broker.fetch(new Request("http://bot/sessions/operator", { headers: auth(b) })))?.status).toBe(200);
      expect(proxied).toEqual(["http://127.0.0.1:4101/operator", "http://127.0.0.1:4102/operator"]);

      expect((await broker.fetch(new Request("http://bot/sessions", { method: "DELETE", headers: auth(a) })))?.status).toBe(204);
      expect((await broker.fetch(new Request("http://bot/sessions/operator", { headers: auth(a) })))?.status).toBe(410);
      expect((await broker.fetch(new Request("http://bot/sessions/operator", { headers: auth(b) })))?.status).toBe(200);
    } finally {
      await broker.close();
    }
  });

  test("reserves capacity before worker readiness and rolls back startup failure", async () => {
    const manual = manualWorkers();
    const broker = createPaperSessions({
      capacity: 1,
      workerFactory: manual.factory,
      randomToken: () => "only-token",
    });
    try {
      const firstWorker = manual.next();
      const first = broker.fetch(new Request("http://bot/sessions", { method: "POST" }));
      const worker = await firstWorker;
      expect((await broker.fetch(new Request("http://bot/sessions", { method: "POST" })))?.status).toBe(503);
      worker.fail();
      const failed = (await first)!;
      expect(failed.status).toBe(503);
      expect(await failed.text()).not.toContain("PRIVATE_KEY");

      const nextWorker = manual.next();
      const retry = broker.fetch(new Request("http://bot/sessions", { method: "POST" }));
      (await nextWorker).ready(4201);
      expect((await retry)?.status).toBe(201);
    } finally {
      await broker.close();
    }
  });

  test("expires idle sessions and frees their capacity", async () => {
    let now = 1_000;
    const fakes = autoWorkers([4301, 4302]);
    const tokens = ["old-token", "new-token"];
    const broker = createPaperSessions({
      capacity: 1,
      idleMs: 100,
      sweepIntervalMs: 60_000,
      now: () => now,
      randomToken: () => tokens.shift()!,
      workerFactory: fakes.factory,
    });
    try {
      const oldToken = await tokenFrom((await broker.fetch(new Request("http://bot/sessions", { method: "POST" })))!);
      now += 101;
      expect((await broker.fetch(new Request("http://bot/sessions", { method: "POST" })))?.status).toBe(201);
      expect((await broker.fetch(new Request("http://bot/sessions/run", { headers: auth(oldToken) })))?.status).toBe(410);
      expect(fakes.workers[0]!.messages).toContainEqual({ type: "close" });
    } finally {
      await broker.close();
    }
  });

  test("limits streams and releases the slot when a client cancels", async () => {
    const fakes = autoWorkers([4401]);
    let upstreamCancels = 0;
    const broker = createPaperSessions({
      maxStreams: 1,
      randomToken: () => "stream-token",
      workerFactory: fakes.factory,
      proxyFetch: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode("event: ping\n\n")); },
        cancel() { upstreamCancels++; },
      }), { headers: { "content-type": "text/event-stream" } }),
    });
    try {
      const token = await tokenFrom((await broker.fetch(new Request("http://bot/sessions", { method: "POST" })))!);
      const firstPending = broker.fetch(new Request("http://bot/sessions/events", { headers: auth(token) }));
      const secondPending = broker.fetch(new Request("http://bot/sessions/events", { headers: auth(token) }));
      const [first, second] = await Promise.all([firstPending, secondPending]);
      expect(first!.headers.get("cache-control")).toBe("no-cache");
      expect(second?.status).toBe(429);
      await first!.body!.cancel();
      expect(upstreamCancels).toBe(1);
      expect((await broker.fetch(new Request("http://bot/sessions/events", { headers: auth(token) })))?.status).toBe(200);
    } finally {
      await broker.close();
    }
  });

  test("passes only the sealed visitor environment and rejects oversized chunked bodies", async () => {
    const fakes = autoWorkers([4501]);
    const broker = createPaperSessions({
      env: {
        MODEL: "jev",
        OPENROUTER_API_KEY: "model-key",
        PRIVATE_KEY: "wallet-secret",
        WALLETS_JSON: "wallets",
        HL_API_URL: "https://evil.example",
        SHARE_ENV: "1",
      },
      randomToken: () => "env-token",
      workerFactory: fakes.factory,
    });
    try {
      const token = await tokenFrom((await broker.fetch(new Request("http://bot/sessions", { method: "POST" })))!);
      expect(Object.keys(fakes.envs[0]!)).toEqual(["JEV_VISITOR_ENV"]);
      expect(JSON.parse(fakes.envs[0]!.JEV_VISITOR_ENV!)).toEqual(paperSessionEnv({ MODEL: "jev", OPENROUTER_API_KEY: "model-key" }));

      const oversized = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(64 * 1024));
          controller.enqueue(new Uint8Array(1));
          controller.close();
        },
      });
      const init: RequestInit & { duplex: "half" } = {
        method: "POST",
        headers: auth(token),
        body: oversized,
        duplex: "half",
      };
      const response = await broker.fetch(new Request("http://bot/sessions/settings", init));
      expect(response?.status).toBe(413);
    } finally {
      await broker.close();
    }
  });

  test("does not refund the bounded global creation budget on cleanup", async () => {
    const fakes = autoWorkers([4601, 4602, 4603, 4604, 4605, 4606, 4607, 4608]);
    let tokenNumber = 0;
    const broker = createPaperSessions({
      randomToken: () => `rate-token-${++tokenNumber}`,
      workerFactory: fakes.factory,
    });
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        const created = (await broker.fetch(new Request("http://bot/sessions", { method: "POST" })))!;
        const token = await tokenFrom(created);
        expect((await broker.fetch(new Request("http://bot/sessions", {
          method: "DELETE",
          headers: auth(token),
        })))?.status).toBe(204);
      }
      const denied = (await broker.fetch(new Request("http://bot/sessions", { method: "POST" })))!;
      expect(denied.status).toBe(429);
      expect(denied.headers.get("retry-after")).not.toBeNull();
      expect(fakes.workers).toHaveLength(8);
    } finally {
      await broker.close();
    }
  });

  test("rate limits starts per capability without blocking stop", async () => {
    let now = 1_000;
    const fakes = autoWorkers([4701]);
    const forwarded: string[] = [];
    const broker = createPaperSessions({
      now: () => now,
      randomToken: () => "start-token",
      workerFactory: fakes.factory,
      proxyFetch: async (url) => {
        forwarded.push(url.pathname);
        return Response.json({ ok: true });
      },
    });
    try {
      const token = await tokenFrom((await broker.fetch(new Request("http://bot/sessions", { method: "POST" })))!);
      const request = (route: string) => new Request(`http://bot/sessions/${route}`, {
        method: "POST",
        headers: auth(token),
      });
      expect((await broker.fetch(request("start")))?.status).toBe(200);
      const denied = (await broker.fetch(request("start")))!;
      expect(denied.status).toBe(429);
      expect(denied.headers.get("retry-after")).toBe("30");
      expect((await broker.fetch(request("stop")))?.status).toBe(200);
      expect(forwarded).toEqual(["/start", "/stop"]);
      now += 30_000;
      expect((await broker.fetch(request("start")))?.status).toBe(200);
      expect(forwarded).toEqual(["/start", "/stop", "/start"]);
    } finally {
      await broker.close();
    }
  });

  test("close resolves outstanding readiness without exposing worker errors", async () => {
    const manual = manualWorkers();
    const broker = createPaperSessions({ workerFactory: manual.factory });
    const created = manual.next();
    const pending = broker.fetch(new Request("http://bot/sessions", { method: "POST" }));
    const worker = await created;
    await broker.close();
    const response = (await pending)!;
    expect(response.status).toBe(503);
    expect(worker.messages).toContainEqual({ type: "close" });
  });
  test("restores signed ownership while capability remains the only query authority", async () => {
    const fakes = autoWorkers([4801, 4802, 4803]);
    const listedOwners: string[] = [];
    const store: DecisionStore = {
      enabled: true,
      ready: async () => {},
      enqueue() {},
      async list(ownerId): Promise<DecisionPage> {
        listedOwners.push(ownerId);
        return { rows: [], nextBefore: null };
      },
      close: async () => {},
    };
    let seed = 1;
    const owners = createOwnerTokens({
      secret: "test-owner-secret-at-least-32-bytes",
      now: () => 1_000,
      randomBytes(length) {
        const bytes = new Uint8Array(length);
        bytes.fill(seed++);
        return bytes;
      },
    });
    const capabilities = ["cap-a", "cap-b", "cap-c"];
    const broker = createPaperSessions({
      store,
      ownerTokens: owners,
      workerFactory: fakes.factory,
      randomToken: () => capabilities.shift()!,
    });
    try {
      const create = async (ownerToken?: string) => {
        const response = (await broker.fetch(new Request("http://bot/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(ownerToken ? { ownerToken } : {}),
        })))!;
        return await response.json() as { token: string; ownerToken: string };
      };
      const first = await create();
      expect((await broker.fetch(new Request("http://bot/sessions/decisions", { headers: auth(first.ownerToken) })))?.status).toBe(410);
      expect((await broker.fetch(new Request("http://bot/sessions/decisions", { headers: auth(first.token) })))?.status).toBe(200);
      await broker.fetch(new Request("http://bot/sessions", { method: "DELETE", headers: auth(first.token) }));

      const resumed = await create(first.ownerToken);
      await broker.fetch(new Request("http://bot/sessions/decisions", { headers: auth(resumed.token) }));
      const replaced = await create(`${first.ownerToken}edited`);
      await broker.fetch(new Request("http://bot/sessions/decisions", { headers: auth(replaced.token) }));

      expect(listedOwners[0]).toBe(listedOwners[1]);
      expect(listedOwners[2]).not.toBe(listedOwners[0]);
    } finally {
      await broker.close();
    }
  });

  test("shutdown drains journal messages before the store closes and awaits every worker", async () => {
    const fakes = autoWorkers([4901, 4902]);
    const order: string[] = [];
    const store: DecisionStore = {
      enabled: true,
      ready: async () => {},
      enqueue() { order.push("journal"); },
      list: async () => ({ rows: [], nextBefore: null }),
      close: async () => { order.push("store closed"); },
    };
    let sequence = 0;
    const broker = createPaperSessions({
      workerFactory: fakes.factory, store, ownerSecret: "shutdown-test-secret-at-least-32-bytes",
      randomToken: () => `drain-${sequence++}`,
    });
    for (let index = 0; index < 2; index++) await broker.fetch(new Request("http://bot/sessions", { method: "POST" }));
    for (const worker of fakes.workers) worker.autoClose = false;
    const closing = broker.close().then(() => store.close());
    fakes.workers[0]!.emit({ type: "journal", event: { type: "decision" } });
    fakes.workers[0]!.emit({ type: "closed" });
    await Promise.resolve();
    expect(order).toEqual(["journal"]);
    fakes.workers[1]!.emit({ type: "journal", event: { type: "fill" } });
    fakes.workers[1]!.emit({ type: "closed" });
    await closing;
    expect(order).toEqual(["journal", "journal", "store closed"]);
    expect(fakes.workers.map((worker) => worker.terminated)).toEqual([0, 0]);
  });

  test("shutdown awaits forced Worker termination before completing", async () => {
    const fakes = autoWorkers([4903]);
    const { promise: terminateGate, resolve: finishTermination } = Promise.withResolvers<void>();
    const broker = createPaperSessions({ workerFactory: fakes.factory, shutdownTimeoutMs: 1 });
    await broker.fetch(new Request("http://bot/sessions", { method: "POST" }));
    fakes.workers[0]!.autoClose = false;
    fakes.workers[0]!.terminateGate = terminateGate;
    let closed = false;
    const closing = broker.close().then(() => { closed = true; });
    await Bun.sleep(5);
    expect(fakes.workers[0]!.terminated).toBe(1);
    expect(closed).toBe(false);
    finishTermination();
    await closing;
    expect(closed).toBe(true);
  });

  test("authorized decision paging refreshes idle activity", async () => {
    let now = 1_000;
    const fakes = autoWorkers([4904]);
    const broker = createPaperSessions({ workerFactory: fakes.factory, now: () => now, idleMs: 100 });
    const token = await tokenFrom((await broker.fetch(new Request("http://bot/sessions", { method: "POST" })))!);
    const page = () => broker.fetch(new Request("http://bot/sessions/decisions", { headers: auth(token) }));
    try {
      now += 90;
      expect((await page())?.status).toBe(200);
      now += 90;
      expect((await page())?.status).toBe(200);
      now += 101;
      expect((await page())?.status).toBe(410);
    } finally {
      await broker.close();
    }
  });

  test("pagination mistakes return 400 while database failures are logged and redacted", async () => {
    const failure = new Error("database password=private-secret relation internal_table missing");
    const log = spyOn(console, "error").mockImplementation(() => {});
    const store = createDecisionStore({
      sql: {
        async unsafe(query) {
          if (query.startsWith("SELECT")) throw failure;
          return [];
        },
        close() {},
      },
    });
    const fakes = autoWorkers([4905]);
    const broker = createPaperSessions({ workerFactory: fakes.factory, store, ownerSecret: "paging-test-secret-at-least-32-bytes" });
    try {
      const token = await tokenFrom((await broker.fetch(new Request("http://bot/sessions", { method: "POST" })))!);
      const page = (query: string) => broker.fetch(new Request(`http://bot/sessions/decisions${query}`, { headers: auth(token) }));
      expect((await page("?limit=0"))?.status).toBe(400);
      expect((await page("?before=invalid"))?.status).toBe(400);
      const response = (await page(""))!;
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "Decision history is unavailable" });
      expect(log).toHaveBeenCalledWith("Could not list paper session decisions", failure);
    } finally {
      await broker.close();
      await store.close();
      log.mockRestore();
    }
  });

});
