import { describe, expect, test } from "bun:test";
import { createLogBuffer } from "../src/log-buffer";
import { startServer } from "../src/server";
import type { RunSnapshot } from "../src/settings";
import type { Meta } from "../src/types";

const meta: Meta = {
  model: "test",
  wallet: null,
  dryRun: true,
  market: "test",
  startedAt: 1,
  venue: "test",
  coin: "BTC",
  pair: "BTC/USDC",
  explorerTx: "",
  tickMs: 30_000,
  sleeves: [],
};

const runSnapshot = (): RunSnapshot => ({
  runId: null,
  status: "off",
  startedAt: null,
  deadlineAt: null,
  stoppedAt: null,
  durationMs: 30 * 60_000,
  stopReason: null,
  serverNow: Date.now(),
});

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string,
  timeoutMs = 2_000,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(marker)) {
    let timer: Timer | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${marker}`)), timeoutMs);
    });
    try {
      const result = await Promise.race([reader.read(), timeout]);
      if (result.done) throw new Error("Log stream closed unexpectedly");
      text += decoder.decode(result.value);
    } finally {
      clearTimeout(timer);
    }
  }
  return text;
}

describe("visitor log stream", () => {
  test("replays after Last-Event-ID, then streams live records", async () => {
    const logs = createLogBuffer(10, () => 1000);
    logs.append("log", "first");
    logs.append("warn", "second");
    logs.append("error", "third");
    const server = startServer(meta, [], runSnapshot, {
      hostname: "127.0.0.1",
      port: 0,
      logs,
    });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/logs`, {
        headers: { "last-event-id": "1" },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const reader = response.body!.getReader();
      const replay = await readUntil(reader, '"seq":3');
      expect(replay).toContain('id: 2\ndata: {"seq":2,"ts":1000,"level":"warn","line":"second"}\n\n');
      expect(replay).toContain('id: 3\ndata: {"seq":3,"ts":1000,"level":"error","line":"third"}\n\n');
      expect(replay).not.toContain('"seq":1');

      logs.append("log", "live line");
      const live = await readUntil(reader, '"line":"live line"');
      expect(live).toContain('id: 4\ndata: {"seq":4,"ts":1000,"level":"log","line":"live line"}\n\n');
      await reader.cancel();
    } finally {
      server.close();
    }
  });

  test("sends periodic ping comments", async () => {
    const server = startServer(meta, [], runSnapshot, {
      hostname: "127.0.0.1",
      port: 0,
      logs: createLogBuffer(),
      logPingMs: 10,
    });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/logs`);
      const reader = response.body!.getReader();
      expect(await readUntil(reader, ": ping\n\n")).toContain(": ping\n\n");
      await reader.cancel();
    } finally {
      server.close();
    }
  });

  test("does not register /logs without a buffer", async () => {
    const server = startServer(meta, [], runSnapshot, { hostname: "127.0.0.1", port: 0 });
    try {
      expect((await fetch(`http://127.0.0.1:${server.port}/logs`)).status).toBe(404);
    } finally {
      server.close();
    }
  });
});
