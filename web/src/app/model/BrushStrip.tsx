"use client";

import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { clampWindow, isFull, resizeTo, type BrushWindow } from "@/lib/brush-window";
import { fmtClock } from "@/lib/format";
import type { DecisionSummary } from "./record";
import styles from "./timeline.module.css";

type Props = {
  summaries: DecisionSummary[];
  values: (number | null)[];
  scale: number;
  window: BrushWindow;
  onWindow: (window: BrushWindow) => void;
};

type Drag = {
  pointerId: number;
  mode: "pan" | "start" | "end";
  start: number;
  end: number;
  offset: number;
};

export default function BrushStrip({ summaries, values, scale, window, onWindow }: Props) {
  const drag = useRef<Drag | null>(null);
  const total = summaries.length;
  if (!total) return null;

  const width = 1000;
  const height = 40;
  const left = window.start / total * width;
  const right = window.end / total * width;

  function position(clientX: number, rect: DOMRect): number {
    return Math.max(0, Math.min(total, (clientX - rect.left) / rect.width * total));
  }

  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!event.isPrimary) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const x = event.clientX - rect.left;
    const at = position(event.clientX, rect);
    const startX = window.start / total * rect.width;
    const endX = window.end / total * rect.width;
    let mode: Drag["mode"] = "pan";
    let offset = at - window.start;
    if (Math.abs(x - startX) <= 8) mode = "start";
    else if (Math.abs(x - endX) <= 8) mode = "end";
    else if (at < window.start || at > window.end) offset = (window.end - window.start) / 2;
    drag.current = { pointerId: event.pointerId, mode, start: window.start, end: window.end, offset };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === "pan" && (at < window.start || at > window.end)) {
      onWindow(clampWindow(total, at - offset, window.end - window.start));
    }
    event.preventDefault();
  }

  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const at = position(event.clientX, rect);
    if (active.mode === "pan") {
      onWindow(clampWindow(total, at - active.offset, active.end - active.start));
    } else if (active.mode === "start") {
      onWindow(resizeTo(total, { start: active.start, end: active.end }, "start", Math.floor(at)));
    } else {
      onWindow(resizeTo(total, { start: active.start, end: active.end }, "end", Math.ceil(at)));
    }
  }

  function pointerEnd(event: PointerEvent<SVGSVGElement>) {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  }

  function keyHandle(event: KeyboardEvent<SVGRectElement>, edge: "start" | "end") {
    const at = edge === "start" ? window.start : window.end;
    const page = Math.max(1, Math.floor(total / 10));
    let target: number | null = null;
    if (event.key === "ArrowLeft") target = at - 1;
    else if (event.key === "ArrowRight") target = at + 1;
    else if (event.key === "PageDown") target = at - page;
    else if (event.key === "PageUp") target = at + page;
    else if (event.key === "Home") target = edge === "start" ? 0 : window.start;
    else if (event.key === "End") target = edge === "start" ? window.end : total;
    if (target === null) return;
    event.preventDefault();
    onWindow(resizeTo(total, window, edge, target));
  }

  const startSummary = summaries[window.start];
  const endSummary = summaries[Math.max(window.start, window.end - 1)];

  return <div className={styles.overviewRow} role="group" aria-label="History range brush">
    <svg className={styles.overview} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
      role="group" aria-label={`Overview of ${total} decisions. Drag the range or its edges to choose visible decisions.`}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd}
      onPointerCancel={pointerEnd} onLostPointerCapture={() => { drag.current = null; }} onDoubleClick={() => onWindow({ start: 0, end: total })}>
      <g aria-hidden="true">
        {summaries.map((summary, index) => {
          const value = values[index];
          const magnitude = value === null || value === undefined ? 2 : Math.max(1, Math.abs(value) / scale * 17);
          return <rect key={summary.id} className={value === null || value === undefined ? styles.pending : styles.bar}
            data-action={summary.action} x={index / total * width} y={value !== null && value !== undefined && value > 0 ? 20 - magnitude : 20}
            width={Math.max(1, width / total - 0.5)} height={value === null || value === undefined ? 2 : magnitude} />;
        })}
        <rect className={styles.shade} x={0} y={0} width={left} height={height} />
        <rect className={styles.shade} x={right} y={0} width={Math.max(0, width - right)} height={height} />
        <rect className={styles.brush} x={left} y={1} width={Math.max(0, right - left)} height={height - 2} vectorEffect="non-scaling-stroke" />
      </g>
      <rect className={styles.brushHandle} x={left - 4} y={0} width={8} height={height} role="slider" tabIndex={0}
        aria-label="Visible range start" aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={total} aria-valuenow={window.start}
        aria-valuetext={startSummary ? `From ${fmtClock(startSummary.time)}` : "Start of history"}
        onKeyDown={(event) => keyHandle(event, "start")} />
      <rect className={styles.brushHandle} x={right - 4} y={0} width={8} height={height} role="slider" tabIndex={0}
        aria-label="Visible range end" aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={total} aria-valuenow={window.end}
        aria-valuetext={endSummary ? `Through ${fmtClock(endSummary.time)}` : "End of history"}
        onKeyDown={(event) => keyHandle(event, "end")} />
    </svg>
    {!isFull(total, window) ? <button type="button" className={styles.reset} onClick={() => onWindow({ start: 0, end: total })}>Show all decisions</button> : <span className={styles.rangeHint}>Drag the range or its edges</span>}
  </div>;
}
