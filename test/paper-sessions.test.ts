import { describe, expect, test } from "bun:test";
import { createPaperSessions, paperSessionEnv } from "../src/paper-sessions";

class FakeWorker {
  readonly messages: unknown[] = [];
  terminated = 0;
  private readonly listeners: Record<"message" | "error", Set<EventListener>> = {
    message: new Set(),
    error: new Set(),
  };

  postMessage(value: unknown) { this.messages.push(value); }
  terminate() { this.terminated++; }
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
      broker.close();
    }
  });

  test("reserves capacity before worker readiness and rolls back startup failure", async () => {
    const workers: FakeWorker[] = [];
    const broker = createPaperSessions({
      capacity: 1,
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      randomToken: () => "only-token",
    });
    try {
      const first = broker.fetch(new Request("http://bot/sessions", { method: "POST" }));
      await Promise.resolve();
      expect((await broker.fetch(new Request("http://bot/sessions", { method: "POST" })))?.status).toBe(503);
      workers[0]!.fail();
      const failed = (await first)!;
      expect(failed.status).toBe(503);
      expect(await failed.text()).not.toContain("PRIVATE_KEY");

      const retry = broker.fetch(new Request("http://bot/sessions", { method: "POST" }));
      await Promise.resolve();
      workers[1]!.ready(4201);
      expect((await retry)?.status).toBe(201);
    } finally {
      broker.close();
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
      broker.close();
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
      broker.close();
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
      broker.close();
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
      broker.close();
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
      broker.close();
    }
  });

  test("close resolves outstanding readiness without exposing worker errors", async () => {
    const worker = new FakeWorker();
    const broker = createPaperSessions({ workerFactory: () => worker });
    const pending = broker.fetch(new Request("http://bot/sessions", { method: "POST" }));
    await Promise.resolve();
    broker.close();
    const response = (await pending)!;
    expect(response.status).toBe(503);
    expect(worker.messages).toContainEqual({ type: "close" });
  });
});
