import { networkInterfaces } from "node:os";
import { config } from "./config";
import { JevRequestError, readJevRequest } from "./jev-request";
import type { Model } from "./model";
import type { JevResponse } from "./types";

function approvedOrigins(): Set<string> {
  const origins = new Set(config.webOrigins);
  if (!config.production) {
    origins.add("http://localhost:3001");
    origins.add("http://127.0.0.1:3001");
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === "IPv4" && !address.internal) {
          origins.add(`http://${address.address}:3001`);
        }
      }
    }
  }
  return origins;
}

/** Address-free inference only. Provider permits survive HTTP response deadlines. */
export function startServer(model: Model, options: { port?: number } = {}) {
  const origins = approvedOrigins();
  const buckets = new Map<string, { tokens: number; at: number }>();
  const refillPerMs = config.inferenceRatePerMinute / 60_000;
  let active = 0;
  let nextSweep = 0;

  function admit(peer: string): boolean {
    const now = performance.now();
    if (now >= nextSweep) {
      for (const [key, bucket] of buckets) {
        if (bucket.tokens + (now - bucket.at) * refillPerMs >= config.inferenceBurst) buckets.delete(key);
      }
      nextSweep = now + 60_000;
    }
    const bucket = buckets.get(peer) ?? { tokens: config.inferenceBurst, at: now };
    bucket.tokens = Math.min(config.inferenceBurst, bucket.tokens + (now - bucket.at) * refillPerMs);
    bucket.at = now;
    buckets.set(peer, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  return Bun.serve({
    port: options.port ?? config.port,
    async fetch(request, server) {
      const origin = request.headers.get("origin");
      const allowed = origin !== null && origins.has(origin);
      const headers = new Headers({
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        vary: "Origin",
      });
      if (allowed) headers.set("access-control-allow-origin", origin);
      const json = (body: unknown, status = 200) => {
        headers.set("content-type", "application/json");
        return new Response(JSON.stringify(body), { status, headers });
      };
      const error = (code: string, status: number) => json({ error: code }, status);
      const path = new URL(request.url).pathname;
      if (path !== "/health" && path !== "/decide") return error("not_found", 404);
      if (path === "/health") {
        if (request.method === "GET") return json({ ok: true });
        headers.set("allow", "GET");
        return error("method_not_allowed", 405);
      }
      if (request.method !== "POST" && request.method !== "OPTIONS") {
        headers.set("allow", "POST, OPTIONS");
        return error("method_not_allowed", 405);
      }
      if (!allowed) return error("origin_forbidden", 403);
      if (request.method === "OPTIONS") {
        const method = request.headers.get("access-control-request-method");
        const requested = request.headers.get("access-control-request-headers") ?? "";
        if (method !== "POST" || requested.split(",").some((name) => name.trim() && name.trim().toLowerCase() !== "content-type")) {
          return error("origin_forbidden", 403);
        }
        headers.set("vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers");
        headers.set("access-control-allow-methods", "POST");
        headers.set("access-control-allow-headers", "Content-Type");
        return new Response(null, { status: 204, headers });
      }
      if (request.headers.has("cookie") || request.headers.has("authorization")) return error("invalid_request", 400);
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
        return error("unsupported_media_type", 415);
      }
      // Only the socket peer counts. Forwarded headers are neither trusted nor retained.
      if (!admit(server.requestIP(request)?.address ?? "unknown")) {
        headers.set("retry-after", String(Math.ceil(60 / config.inferenceRatePerMinute)));
        return error("rate_limited", 429);
      }
      if (active >= config.inferenceConcurrency) return error("busy", 503);
      active += 1;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let expired = false;
      const work = (async () => {
        try {
          const input = await readJevRequest(request);
          if (expired) return error("deadline_exceeded", 504);
          const decision = await model.decide(input.state);
          const result: JevResponse = { tick: input.state.tick, decision };
          return json(result);
        } catch (cause) {
          if (cause instanceof JevRequestError) return error(cause.code, cause.status);
          return error("provider_error", 502);
        } finally {
          active -= 1;
          clearTimeout(timer);
        }
      })();
      const deadline = new Promise<Response>((resolve) => {
        timer = setTimeout(() => {
          expired = true;
          resolve(error("deadline_exceeded", 504));
        }, config.inferenceDeadlineMs);
      });
      return Promise.race([work, deadline]);
    },
    error() {
      return Response.json({ error: "internal_error" }, {
        status: 500,
        headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
      });
    },
  });
}
