import { describe, expect, spyOn, test } from "bun:test";
import { captureConsoleLogs, createLogBuffer } from "../src/log-buffer";

describe("log buffer", () => {
  test("evicts the oldest records beyond capacity with monotonic sequence numbers", () => {
    const buffer = createLogBuffer(3, () => 1000);
    for (let i = 1; i <= 5; i++) buffer.append("log", `line ${i}`);
    expect(buffer.latestSeq()).toBe(5);
    expect(buffer.replay(0).map((record) => record.seq)).toEqual([3, 4, 5]);
    expect(buffer.replay(3).map((record) => record.line)).toEqual(["line 4", "line 5"]);
    expect(buffer.replay(5)).toEqual([]);
    expect(buffer.replay(0)[0]).toEqual({ seq: 3, ts: 1000, level: "log", line: "line 3" });
  });

  test("notifies subscribers of live records until they unsubscribe", () => {
    const buffer = createLogBuffer();
    const seen: number[] = [];
    const stop = buffer.subscribe((record) => seen.push(record.seq));
    buffer.append("log", "one");
    stop();
    buffer.append("log", "two");
    expect(seen).toEqual([1]);
  });

  test("flattens multi-line input into a single line", () => {
    const buffer = createLogBuffer();
    buffer.append("warn", "a\nb\r\nc");
    expect(buffer.replay(0)[0].line).toBe("a b c");
  });

  test("captures console calls, keeps the original console behavior, and restores it on demand", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const buffer = createLogBuffer(10, () => 7);
    const restore = captureConsoleLogs(buffer);
    try {
      console.log("alpha", { b: 1 }, 7);
      console.warn("careful");
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      console.error("boom", circular, undefined);
    } finally {
      restore();
    }
    expect(logSpy).toHaveBeenCalledWith("alpha", { b: 1 }, 7);
    expect(warnSpy).toHaveBeenCalledWith("careful");
    expect(buffer.replay(0)).toEqual([
      { seq: 1, ts: 7, level: "log", line: 'alpha {"b":1} 7' },
      { seq: 2, ts: 7, level: "warn", line: "careful" },
      { seq: 3, ts: 7, level: "error", line: "boom [object Object] undefined" },
    ]);
    console.log("after restore");
    expect(buffer.latestSeq()).toBe(3);
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("applies the sanitize hook before buffering", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const buffer = createLogBuffer(10, () => 7);
    const restore = captureConsoleLogs(buffer, (line) => line.split("secret-value").join("[redacted]").slice(0, 20));
    try {
      console.log("key is secret-value ok");
      console.log("a line that is clearly far too long to keep");
    } finally {
      restore();
    }
    expect(buffer.replay(0).map((record) => record.line)).toEqual(["key is [redacted] ok", "a line that is clear"]);
    logSpy.mockRestore();
  });

  test("formats Error arguments with their message instead of an empty object", () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const buffer = createLogBuffer(10, () => 7);
    const restore = captureConsoleLogs(buffer);
    try {
      console.error("journal write failed", new Error("connection refused"));
    } finally {
      restore();
    }
    const line = buffer.replay(0)[0].line;
    expect(line).toContain("journal write failed");
    expect(line).toContain("Error: connection refused");
    expect(line).not.toContain("{}");
    errorSpy.mockRestore();
  });
});
