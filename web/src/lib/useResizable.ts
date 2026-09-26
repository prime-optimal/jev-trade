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
  useEffect(() => setSize(read(key, fallback)), [key, fallback]);

  const startDrag = useCallback(
    (e: React.PointerEvent, axis: "x" | "y" = "y") => {
      e.preventDefault();
      const start = axis === "y" ? e.clientY : e.clientX;
      const base = sizeRef.current;
      const move = (ev: PointerEvent) => {
        const delta = ((axis === "y" ? ev.clientY : ev.clientX) - start) * sign;
        setSize(Math.round(Math.max(min, Math.min(max(), base + delta))));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        write(key, sizeRef.current);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [key, min, max, sign],
  );
  return [size, startDrag, setSize] as const;
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
  const reset = useCallback(() => {
    setWidths(Array(count).fill(null));
    write(key, []);
  }, [key, count]);
  return { widths, startResize, reset };
}
