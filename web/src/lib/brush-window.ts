export interface BrushWindow { start: number; end: number }

export const MIN_WINDOW = 10;

function countOf(total: number): number {
  return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
}

function rounded(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.round(value) : fallback;
}


export function spanOf(win: BrushWindow): number {
  const span = win.end - win.start;
  return Number.isFinite(span) ? Math.max(0, span) : 0;
}

export function isFull(total: number, win: BrushWindow): boolean {
  const count = countOf(total);
  return Number.isFinite(win.start) && Number.isFinite(win.end) && win.start <= 0 && win.end >= count;
}

export function contains(win: BrushWindow, index: number): boolean {
  return Number.isFinite(win.start) && Number.isFinite(win.end) && Number.isFinite(index) &&
    index >= win.start && index < win.end;
}

export function clampWindow(total: number, start: number, size: number, min = MIN_WINDOW): BrushWindow {
  const count = countOf(total);
  if (count === 0) return { start: 0, end: 0 };
  const requestedMin = Number.isFinite(min) ? Math.floor(min) : MIN_WINDOW;
  const minimum = Math.min(Math.max(1, requestedMin), count);
  const clamped = Math.min(count, Math.max(minimum, rounded(size)));
  const offset = Math.min(count - clamped, Math.max(0, rounded(start)));
  return { start: offset, end: offset + clamped };
}

export function reconcileWindow(total: number, previous: BrushWindow, previousTotal: number, min = MIN_WINDOW): BrushWindow {
  const count = countOf(total);
  if (count === 0) return { start: 0, end: 0 };
  if (isFull(previousTotal, previous)) return { start: 0, end: count };
  return clampWindow(count, previous.start, spanOf(previous), min);
}

export function resizeTo(total: number, win: BrushWindow, edge: "start" | "end", index: number, min = MIN_WINDOW): BrushWindow {
  const count = countOf(total);
  if (count === 0) return { start: 0, end: 0 };
  const normalized = clampWindow(count, win.start, spanOf(win), min);
  const requestedMin = Number.isFinite(min) ? Math.floor(min) : MIN_WINDOW;
  const minimum = Math.min(Math.max(1, requestedMin), count);
  const at = Math.max(0, Math.min(count, rounded(index, edge === "start" ? normalized.start : normalized.end)));
  if (edge === "start") {
    return { start: Math.min(at, normalized.end - minimum), end: normalized.end };
  }
  return { start: normalized.start, end: Math.max(at, normalized.start + minimum) };
}

export function ensureVisible(total: number, win: BrushWindow, index: number, min = MIN_WINDOW): BrushWindow {
  const count = countOf(total);
  if (count === 0) return { start: 0, end: 0 };
  const span = spanOf(win);
  const normalized = clampWindow(count, win.start, span, min);
  const at = Number.isFinite(index) ? Math.floor(index) : -1;
  if (at < 0 || at >= count) {
    return normalized.start === win.start && normalized.end === win.end ? win : normalized;
  }
  if (contains(normalized, at)) {
    return normalized.start === win.start && normalized.end === win.end ? win : normalized;
  }
  const start = at < normalized.start ? at - 1 : at - spanOf(normalized) + 2;
  return clampWindow(count, start, spanOf(normalized), min);
}
