"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be blocked; the layout still works for this visit.
  }
}

/** Drag from `startDrag` to change a remembered size. `sign` -1 grows when dragging up or left. */
export function useDragSize(key: string, fallback: number, min: number, max: () => number, sign: 1 | -1 = 1) {
  const [size, setSize] = useState(fallback);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  // Callers pass `max` inline; a ref keeps clamp stable so the restore effect runs once per key.
  const maxRef = useRef(max);
  maxRef.current = max;
  const clamp = useCallback((n: number) => Math.round(Math.max(min, Math.min(maxRef.current(), n))), [min]);
  // Known only in the browser, so it starts undefined to match server HTML.
  const [maxNow, setMaxNow] = useState<number | undefined>(undefined);
  // A size saved on a taller window must still fit this one.
  useEffect(() => {
    setMaxNow(maxRef.current());
    setSize(clamp(read(key, fallback)));
  }, [key, fallback, clamp]);

  const startDrag = useCallback(
    (e: React.PointerEvent, axis: "x" | "y" = "y") => {
      e.preventDefault();
      const start = axis === "y" ? e.clientY : e.clientX;
      const base = sizeRef.current;
      const move = (ev: PointerEvent) => {
        const delta = ((axis === "y" ? ev.clientY : ev.clientX) - start) * sign;
        setSize(clamp(base + delta));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        write(key, sizeRef.current);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [key, clamp, sign],
  );
  /** Keyboard resize: positive `delta` grows the size. */
  const nudge = useCallback(
    (delta: number) => {
      const next = clamp(sizeRef.current + delta);
      setSize(next);
      write(key, next);
    },
    [key, clamp],
  );
  return { size, startDrag, nudge, min, max: maxNow } as const;
}

/** Column widths in px for one table, remembered per table key. `null` means auto. */
export function useColumnWidths(key: string, count: number) {
  const [widths, setWidths] = useState<(number | null)[]>(() => Array(count).fill(null));
  const ref = useRef(widths);
  ref.current = widths;
  useEffect(() => {
    const saved = read<(number | null)[]>(key, []);
    setWidths(Array.from({ length: count }, (_, i) => (typeof saved[i] === "number" ? saved[i]! : null)));
  }, [key, count]);

  const startResize = useCallback(
    (i: number, e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const th = e.currentTarget.parentElement as HTMLElement | null;
      const table = th?.closest("table");
      // Freeze every column at its rendered width so only the dragged one moves.
      const cells = table ? Array.from(table.querySelectorAll("thead th")) as HTMLElement[] : [];
      const frozen = cells.map((c) => c.offsetWidth);
      const base = th?.offsetWidth ?? 80;
      const start = e.clientX;
      const move = (ev: PointerEvent) => {
        const next = frozen.length === count ? [...frozen] : [...ref.current];
        next[i] = Math.max(40, Math.round(base + ev.clientX - start));
        setWidths(next);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        write(key, ref.current);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [key, count],
  );
  /** Keyboard resize of column `i` by `delta` px, freezing the others at their rendered widths. */
  const nudge = useCallback(
    (i: number, delta: number, th: HTMLElement | null) => {
      const table = th?.closest("table");
      const cells = table ? (Array.from(table.querySelectorAll("thead th")) as HTMLElement[]) : [];
      const next = cells.length === count ? cells.map((c) => c.offsetWidth) : [...ref.current];
      next[i] = Math.max(40, Math.round((next[i] ?? th?.offsetWidth ?? 80) + delta));
      setWidths(next);
      write(key, next);
    },
    [key, count],
  );
  const reset = useCallback(() => {
    setWidths(Array(count).fill(null));
    write(key, []);
  }, [key, count]);
  return { widths, startResize, nudge, reset };
}
