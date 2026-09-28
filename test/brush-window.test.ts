import { describe, expect, test } from "bun:test";
import { clampWindow, ensureVisible, reconcileWindow, resizeTo } from "../web/src/lib/brush-window";

describe("brush window math", () => {
  test("clamps start and end while keeping the minimum span", () => {
    expect(clampWindow(100, -20, 20)).toEqual({ start: 0, end: 20 });
    expect(clampWindow(100, 95, 20)).toEqual({ start: 80, end: 100 });
    expect(clampWindow(100, 20, 2)).toEqual({ start: 20, end: 30 });
    expect(clampWindow(4, 3, 1)).toEqual({ start: 0, end: 4 });
    expect(clampWindow(0, 0, 10)).toEqual({ start: 0, end: 0 });
  });

  test("keeps a zoomed range bounded as history shrinks and restores full ranges as it grows", () => {
    expect(reconcileWindow(130, { start: 0, end: 100 }, 100)).toEqual({ start: 0, end: 130 });
    expect(reconcileWindow(80, { start: 70, end: 90 }, 100)).toEqual({ start: 60, end: 80 });
    expect(reconcileWindow(8, { start: 40, end: 60 }, 100)).toEqual({ start: 0, end: 8 });
    expect(reconcileWindow(150, { start: 40, end: 60 }, 100)).toEqual({ start: 40, end: 60 });
    expect(reconcileWindow(0, { start: 40, end: 60 }, 100)).toEqual({ start: 0, end: 0 });
  });

  test("normalizes invalid measurements without producing non-finite bounds", () => {
    expect(clampWindow(0, Number.NaN, Number.NaN)).toEqual({ start: 0, end: 0 });
    expect(clampWindow(Number.NaN, 0, 10)).toEqual({ start: 0, end: 0 });
    expect(resizeTo(100, { start: 20, end: 40 }, "end", Number.NaN)).toEqual({ start: 20, end: 40 });
  });


  test("resizeTo keeps the opposite edge fixed and enforces bounds and the minimum span", () => {
    const win = { start: 20, end: 40 };
    expect(resizeTo(100, win, "start", 10)).toEqual({ start: 10, end: 40 });
    expect(resizeTo(100, win, "end", 60)).toEqual({ start: 20, end: 60 });
    expect(resizeTo(100, win, "start", 60)).toEqual({ start: 30, end: 40 });
    expect(resizeTo(100, win, "end", 5)).toEqual({ start: 20, end: 30 });
    expect(resizeTo(100, win, "start", -50)).toEqual({ start: 0, end: 40 });
    expect(resizeTo(100, win, "end", 500)).toEqual({ start: 20, end: 100 });
    expect(resizeTo(4, { start: 0, end: 4 }, "start", 3)).toEqual({ start: 0, end: 4 });
  });

  test("moves a decision into view with minimal scrolling and leaves visible indices alone", () => {
    const win = { start: 20, end: 40 };
    expect(ensureVisible(100, win, 10)).toEqual({ start: 9, end: 29 });
    expect(ensureVisible(100, win, 50)).toEqual({ start: 32, end: 52 });
    expect(ensureVisible(100, win, 30)).toBe(win);
    expect(ensureVisible(100, win, 100)).toBe(win);
  });
});
