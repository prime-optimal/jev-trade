import { describe, expect, test } from "bun:test";
import { mergeEvents, mergeTape, reducer, type FeedAction, type State } from "../web/src/lib/useFeed";
import type { BlockEvent, Meta, PricePoint } from "../src/types";

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

describe("mergeTape", () => {
  const pt = (ts: number, mid = 1, extra: Partial<PricePoint> = {}) => ({ ts, mid, ...extra }) as PricePoint;

  test("an equal-length response still replaces updated bars and adds missed fills", () => {
    const held = [pt(1), pt(2), pt(3, 10), pt(4)];
    const fresh = [pt(2), pt(3, 99), pt(3.5, 99, { fill: { side: "buy", price: 99, size: 1 } } as Partial<PricePoint>), pt(4)];
    const merged = mergeTape(held, fresh);
    expect(merged.find((p) => p.ts === 3)!.mid).toBe(99);
    expect(merged.some((p) => p.fill)).toBe(true);
    expect(merged.map((p) => p.ts)).toEqual([1, 2, 3, 3.5, 4]);
  });

  test("keeps older history and newer live candles outside the response range", () => {
    const merged = mergeTape([pt(1), pt(5), pt(9)], [pt(4), pt(6)]);
    expect(merged.map((p) => p.ts)).toEqual([1, 4, 6, 9]);
  });
});

describe("reconnect after a bot restart", () => {
  const ev = (block: number, ts: number) => ({ coin: "BTC", block, ts, mid: 1, bestBid: 1, bestAsk: 1, spreadBps: 0, decision: null, position: { side: "flat" } }) as unknown as BlockEvent;
  const meta = (startedAt: number) => ({ startedAt, coin: "BTC", sleeves: [] }) as unknown as Meta;
  const snap = (startedAt: number, events: BlockEvent[]): FeedAction => ({ type: "snapshot", meta: meta(startedAt), historyByCoin: { BTC: events }, tapeByCoin: {} });

  test("a new run replaces the old history instead of merging by block", () => {
    let state: State = { meta: null, connection: "connecting", sleeves: {} };
    state = reducer(state, snap(100, [ev(50, 1), ev(51, 2)]));
    state = reducer(state, snap(200, [ev(1, 10), ev(2, 11)]));
    expect(state.sleeves.BTC!.events.map((e) => e.block)).toEqual([1, 2]);
    // A new tick with a low block number is kept, not dropped as stale.
    state = reducer(state, { type: "block", event: ev(3, 12) });
    expect(state.sleeves.BTC!.latest!.block).toBe(3);
  });

  test("the same run merges, and a stale-run /history response is ignored", () => {
    let state: State = { meta: null, connection: "connecting", sleeves: {} };
    state = reducer(state, snap(100, [ev(1, 1), ev(2, 2), ev(3, 3)]));
    state = reducer(state, snap(100, [ev(3, 3), ev(4, 4)]));
    expect(state.sleeves.BTC!.events).toHaveLength(4);
    const before = state;
    state = reducer(state, { type: "histories", historyByCoin: { BTC: [ev(90, 9)] }, startedAt: 50 });
    expect(state).toBe(before);
  });
});
