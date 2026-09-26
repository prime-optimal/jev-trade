import { describe, expect, test } from "bun:test";
import { mergeEvents } from "../web/src/lib/useFeed";
import type { BlockEvent } from "../src/types";

describe("mergeEvents", () => {
  const ev = (block: number, tag = "a") => ({ block, ts: block, tag }) as unknown as BlockEvent;
  const tagOf = (e: BlockEvent | undefined) => (e as unknown as { tag: string } | undefined)?.tag;

  test("keeps events a short reconnect snapshot does not carry", () => {
    const held = Array.from({ length: 100 }, (_, i) => ev(i + 1));
    const snapshot = Array.from({ length: 12 }, (_, i) => ev(95 + i, "b"));
    const merged = mergeEvents(held, snapshot);
    expect(merged).toHaveLength(106);
    expect(merged[0]!.block).toBe(1);
    expect(merged.at(-1)!.block).toBe(106);
    expect(tagOf(merged.find((e) => e.block === 95))).toBe("b");
  });

  test("caps to the newest events and handles empty sides", () => {
    expect(mergeEvents([ev(1), ev(2)], [ev(3)], 2).map((e) => e.block)).toEqual([2, 3]);
    expect(mergeEvents([], [ev(1)])).toHaveLength(1);
    expect(mergeEvents([ev(1)], [])).toHaveLength(1);
  });
});
