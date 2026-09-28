import { describe, expect, test } from "bun:test";
import type { DecisionRow } from "../web/src/lib/journal-types";
import { mergeNewestPage } from "../web/src/lib/decisionMerge";

function row(decisionId: string, createdAt: number, markouts: Record<string, unknown> = {}): DecisionRow {
  return {
    decisionId,
    createdAt,
    updatedAt: createdAt,
    decision: null,
    recordType: "legacy",
    evidence: null,
    observations: {},
    programMetadata: "unavailable",
    quote: null,
    fills: [],
    markouts,
  };
}

describe("mergeNewestPage", () => {
  test("adds new rows newest first and keeps previously loaded older pages", () => {
    const existing = [row("shared", 200), row("older", 100)];
    const incoming = [row("latest", 300), row("shared", 200)];

    const result = mergeNewestPage(existing, incoming);

    expect(result.rows.map((item) => item.decisionId)).toEqual(["latest", "shared", "older"]);
    expect(result.newIds).toEqual(["latest"]);
  });

  test("deduplicates both pages and prefers the newest journal copy of an overlap", () => {
    const result = mergeNewestPage(
      [row("same", 200, { 1: { signedReturnBps: 2 } }), row("same", 200), row("old", 100)],
      [row("same", 200, { 1: { signedReturnBps: 5 } }), row("same", 200)],
    );

    expect(result.rows.map((item) => item.decisionId)).toEqual(["same", "old"]);
    expect(result.rows[0]?.markouts).toEqual({ 1: { signedReturnBps: 5 } });
    expect(result.newIds).toEqual([]);
  });

  test("uses decision id as the stable descending tie break and accepts empty pages", () => {
    expect(mergeNewestPage([row("a", 100)], [row("z", 100)]).rows.map((item) => item.decisionId)).toEqual(["z", "a"]);
    expect(mergeNewestPage([row("kept", 100)], []).rows.map((item) => item.decisionId)).toEqual(["kept"]);
    expect(mergeNewestPage([], [row("first", 100)]).rows.map((item) => item.decisionId)).toEqual(["first"]);
  });
});
