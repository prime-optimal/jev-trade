import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  backendBaseUrl,
  bootstrapSession,
  closeSession,
  proxySession,
  readSessionCookie,
} from "../web/src/lib/trading/session-gateway";
const originalFetch = globalThis.fetch;
const originalBotUrl = process.env.BOT_API_URL;

function browserRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET" && !headers.has("Origin")) headers.set("Origin", "https://trade.example");
  return new Request(`https://trade.example${path}`, { ...init, headers });
}

function withSession(request: Request, token = "visitor-a"): Request {
  const headers = new Headers(request.headers);
  headers.set("Cookie", `jev-paper-session=${token}`);
  return new Request(request, { headers });
}

beforeEach(() => {
  process.env.BOT_API_URL = "https://bot.example";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBotUrl === undefined) delete process.env.BOT_API_URL;
  else process.env.BOT_API_URL = originalBotUrl;
});

describe("visitor session gateway", () => {
  test("requires the exact public origin for every mutation", async () => {
    globalThis.fetch = (async () => Response.json({ token: "must-not-be-created" })) as typeof fetch;
    const absent = new Request("https://trade.example/api/session", { method: "POST" });
    const hostile = browserRequest("/api/session/start", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: "{}",
    });

    expect((await bootstrapSession(absent)).status).toBe(403);
    expect((await proxySession(withSession(hostile), ["start"])).status).toBe(403);
  });

  test("uses the public Host when Next exposes its internal listener URL", async () => {
    process.env.BOT_API_URL = "bot-production-17bd.up.railway.app";
    expect(backendBaseUrl().href).toBe("https://bot-production-17bd.up.railway.app/");
    const request = new Request("http://0.0.0.0:3101/api/session", {
      method: "POST",
      headers: {
        Host: "visitor.localhost:3101",
        Origin: "http://visitor.localhost:3101",
        "X-Forwarded-Proto": "http",
      },
    });
    globalThis.fetch = (async (input) => String(input).endsWith("/sessions")
      ? Response.json({ token: "created" })
      : Response.json({ run: { status: "off" } })) as typeof fetch;

    expect((await bootstrapSession(request)).status).toBe(200);
    const internalOrigin = new Request("http://0.0.0.0:3101/api/session", {
      method: "POST",
      headers: {
        Host: "visitor.localhost:3101",
        Origin: "http://0.0.0.0:3101",
        "X-Forwarded-Host": "0.0.0.0:3101",
        "X-Forwarded-Proto": "http",
      },
    });
    expect((await bootstrapSession(internalOrigin)).status).toBe(403);
  });

  test("resumes a cookie without exposing its capability", async () => {
    let authorization = "";
    globalThis.fetch = (async (_input, init) => {
      authorization = new Headers(init?.headers).get("Author" + "ization") ?? "";
      return Response.json({ status: "off", token: "leak", apiKey: "leak" });
    }) as typeof fetch;
    const response = await bootstrapSession(withSession(browserRequest("/api/session", { method: "POST" }), "private-capability"));

    expect(response.status).toBe(200);
    expect(authorization).toBe("Bearer private-capability");
    expect(await response.json()).toEqual({ status: "off", paperOnly: true });
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
  });

  test("creates after an expired cookie and returns only a replacement HttpOnly cookie", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/sessions/operator") && calls.length === 1) return Response.json({ error: "gone" }, { status: 410 });
      if (url.endsWith("/sessions")) return Response.json({ token: "replacement" });
      return Response.json({ run: { status: "off" } });
    }) as typeof fetch;
    const response = await bootstrapSession(withSession(browserRequest("/api/session", { method: "POST" }), "expired"));
    const cookie = response.headers.get("Set-Cookie") ?? "";

    expect(response.status).toBe(200);
    expect(cookie).toContain("jev-paper-session=replacement");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(await response.json()).toEqual({ run: { status: "off" }, paperOnly: true });
    expect(calls).toHaveLength(3);
  });

  test("isolates cookies, paths, methods, queries, content type, and body size", async () => {
    let forwardedAuth = "";
    globalThis.fetch = (async (_input, init) => {
      forwardedAuth = new Headers(init?.headers).get("Author" + "ization") ?? "";
      return Response.json({ ok: true });
    }) as typeof fetch;

    expect((await proxySession(browserRequest("/api/session/run"), ["run"])).status).toBe(401);
    expect((await proxySession(withSession(browserRequest("/api/session/operator", { method: "POST", body: "{}" })), ["operator"])).status).toBe(405);
    expect((await proxySession(withSession(browserRequest("/api/session/nope")), ["nope"])).status).toBe(404);
    expect((await proxySession(withSession(browserRequest("/api/session/run?target=https://evil.example")), ["run"])).status).toBe(400);
    expect((await proxySession(withSession(browserRequest("/api/session/events?lite=no")), ["events"])).status).toBe(400);

    const wrongType = withSession(browserRequest("/api/session/start", { method: "POST", body: "{}" }));
    expect((await proxySession(wrongType, ["start"])).status).toBe(415);
    const oversized = withSession(browserRequest("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(65 * 1024) }),
    }));
    expect((await proxySession(oversized, ["start"])).status).toBe(413);

    const valid = withSession(browserRequest("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }), "visitor-b");
    expect((await proxySession(valid, ["start"])).status).toBe(200);
    expect(forwardedAuth).toBe("Bearer visitor-b");
  });

  test("sends the durable owner token only while creating a capability", async () => {
    const requestBodies: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.endsWith("/sessions")) {
        requestBodies.push(String(init?.body ?? ""));
        return Response.json({ token: "new-capability", ownerToken: "fresh-owner-token" });
      }
      return Response.json({ status: "off" });
    }) as typeof fetch;
    const request = browserRequest("/api/session", {
      method: "POST",
      headers: { Cookie: "jev-paper-owner=signed-owner-token" },
    });
    const response = await bootstrapSession(request);

    expect(requestBodies).toEqual([JSON.stringify({ ownerToken: "signed-owner-token" })]);
    expect(response.headers.get("Set-Cookie")).toContain("jev-paper-session=new-capability");
    expect(response.headers.getSetCookie()).toContainEqual(expect.stringContaining("jev-paper-owner=fresh-owner-token"));
  });

  test("clears expired and deleted capabilities", async () => {
    globalThis.fetch = (async () => Response.json({ error: "gone" }, { status: 410 })) as typeof fetch;
    const expired = await proxySession(withSession(browserRequest("/api/session/run")), ["run"]);
    expect(expired.status).toBe(410);
    expect(expired.headers.get("Set-Cookie")).toContain("Max-Age=0");

    const closed = await closeSession(withSession(browserRequest("/api/session", { method: "DELETE" })));
    expect(closed.status).toBe(204);
    expect(closed.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(readSessionCookie(browserRequest("/", { headers: { Cookie: "jev-paper-session=%GG" } }))).toBeNull();
  });

  test("streams visitor logs like events and forwards Last-Event-ID", async () => {
    const upstreamCalls: { url: string; lastEventId: string | null }[] = [];
    globalThis.fetch = (async (input, init) => {
      upstreamCalls.push({
        url: String(input),
        lastEventId: (init?.headers as Headers).get("Last-Event-ID"),
      });
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: {\"seq\":1}\n\n"));
        },
        cancel() {},
      }), { headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;

    const resumed = withSession(browserRequest("/api/session/logs", { headers: { "Last-Event-ID": "41" } }));
    const response = await proxySession(resumed, ["logs"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    expect(response.headers.get("Cache-Control")).toContain("no-transform");
    expect(upstreamCalls).toEqual([{ url: "https://bot.example/sessions/logs", lastEventId: "41" }]);

    let cancelled = false;
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start() {},
      cancel() { cancelled = true; },
    }), { headers: { "Content-Type": "text/event-stream" } })) as typeof fetch;
    const live = await proxySession(withSession(browserRequest("/api/session/logs")), ["logs"]);
    const reader = live.body!.getReader();
    await reader.cancel();
    expect(cancelled).toBe(true);

    expect((await proxySession(withSession(browserRequest("/api/session/logs", { method: "POST", body: "{}" })), ["logs"])).status).toBe(405);
    expect((await proxySession(withSession(browserRequest("/api/session/logs?level=warn")), ["logs"])).status).toBe(400);
  });

  test("cancelling an SSE response cancels the upstream stream", async () => {
    let cancelled = false;
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: ready\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    }), { headers: { "Content-Type": "text/event-stream" } })) as typeof fetch;

    const response = await proxySession(withSession(browserRequest("/api/session/events?lite=1")), ["events"]);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(cancelled).toBe(true);
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    expect(response.headers.get("Cache-Control")).toContain("no-transform");
  });
});
