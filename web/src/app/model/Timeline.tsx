"use client";

import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { ensureVisible, reconcileWindow, type BrushWindow } from "@/lib/brush-window";
import { fmtClock } from "@/lib/format";
import ActionMark from "./ActionMark";
import BrushStrip from "./BrushStrip";
import { fmtBps, HORIZONS, type Action, type DecisionSummary, type Horizon } from "./record";
import styles from "./timeline.module.css";

type Props = {
  summaries: DecisionSummary[];
  selectedId: string | null;
  select: (id: string) => void;
  horizon: Horizon;
  setHorizon: (horizon: Horizon) => void;
};

type BrushState = BrushWindow & { total: number };

const COUNTED: Action[] = ["buy", "sell", "hold", "no decision"];

export default function Timeline({ summaries, selectedId, select, horizon, setHorizon }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [brush, setBrush] = useState<BrushState | null>(null);
  const ordered = [...summaries].reverse();
  const total = ordered.length;
  const values = ordered.map((summary) => summary.markouts[horizon]?.signedBps ?? null);
  const measured = values.filter((value): value is number => value !== null);
  const scale = Math.max(1, ...measured.map(Math.abs));
  const right = measured.filter((value) => value > 0).length;
  const mean = measured.length ? measured.reduce((sum, value) => sum + value, 0) / measured.length : null;
  const selectedIndex = ordered.findIndex((summary) => summary.id === selectedId);

  const range = brush ? reconcileWindow(total, brush, brush.total) : { start: 0, end: total };

  const visible = ordered.slice(range.start, range.end);
  const shown = visible.length || 1;
  const selectedLocal = selectedIndex - range.start;
  const hoverVisible = hover !== null && hover >= range.start && hover < range.end ? hover : null;
  const focus = ordered[hoverVisible ?? selectedIndex] ?? null;
  const focusValue = focus?.markouts[horizon]?.signedBps ?? null;

  function indexAt(event: MouseEvent<SVGSVGElement>): number {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !visible.length) return 0;
    return Math.min(visible.length - 1, Math.max(0, Math.floor((event.clientX - box.left) / box.width * visible.length)));
  }

  function onWindow(next: BrushWindow) {
    setBrush({ total, ...next });
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (!total) return;
    const from = selectedIndex >= 0 ? selectedIndex : total - 1;
    let next: number;
    if (event.key === "ArrowLeft") next = Math.max(0, from - 1);
    else if (event.key === "ArrowRight") next = Math.min(total - 1, from + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = total - 1;
    else return;
    event.preventDefault();
    select(ordered[next]!.id);
    const adjusted = ensureVisible(total, range, next);
    if (adjusted.start !== range.start || adjusted.end !== range.end) onWindow(adjusted);
  }

  return <section className={styles.timeline} aria-label="Decision timeline">
    <div className={styles.summary}>
      <div className={styles.counts}>
        <strong>{summaries.length} decisions</strong>
        {COUNTED.map((action) => <span key={action} data-action={action}><ActionMark action={action} />{summaries.filter((summary) => summary.action === action).length} {action === "no decision" ? "none" : action}</span>)}
      </div>
      <div className={styles.horizon} role="group" aria-label="Markout horizon">
        {HORIZONS.map((option) => <button key={option} type="button" aria-pressed={option === horizon} onClick={() => setHorizon(option)}>{option}t</button>)}
      </div>
      <p className={styles.score}>
        <strong>{measured.length ? `${Math.round(right / measured.length * 100)}%` : "n/a"}</strong> right after {horizon} ticks
        <span>{measured.length} measured, mean {fmtBps(mean)}</span>
      </p>
    </div>
    <div className={styles.strip}>
      <p className={styles.readout} aria-live="polite">
        {focus ? <><span data-action={focus.action}><ActionMark action={focus.action} />{focus.action}</span>{fmtClock(focus.time, true)}<span>{[focus.intent, focus.bias, focus.leverage !== null ? `${focus.leverage}x` : null].filter(Boolean).join(" ")}</span><span data-sign={focusValue === null ? undefined : focusValue > 0 ? "pos" : "neg"}>{focusValue === null ? `${horizon}t pending` : `${fmtBps(focusValue)} at ${horizon}t`}</span></> : "No decision selected"}
      </p>
      <svg className={styles.chart} viewBox={`0 0 ${shown * 10} 100`} preserveAspectRatio="none"
        role="listbox" aria-orientation="horizontal" tabIndex={0}
        aria-label="Decision markout bars. Use arrow keys to move between decisions, Home and End to jump."
        aria-activedescendant={selectedLocal >= 0 && selectedLocal < visible.length ? `timeline-option-${selectedId}` : undefined}
        onKeyDown={onKeyDown}
        onMouseMove={(event) => visible.length && setHover(range.start + indexAt(event))} onMouseLeave={() => setHover(null)}
        onClick={(event) => visible.length && select(visible[indexAt(event)]!.id)}>
        {selectedLocal >= 0 && selectedLocal < visible.length ? <rect className={styles.selected} x={selectedLocal * 10} y={0} width={10} height={100} aria-hidden="true" /> : null}
        {hoverVisible !== null && hoverVisible !== selectedIndex && hoverVisible >= range.start && hoverVisible < range.end ? <rect className={styles.hovered} x={(hoverVisible - range.start) * 10} y={0} width={10} height={100} aria-hidden="true" /> : null}
        <line className={styles.zero} x1={0} x2={shown * 10} y1={50} y2={50} vectorEffect="non-scaling-stroke" aria-hidden="true" />
        {visible.map((summary, index) => {
          const value = values[range.start + index];
          const selected = range.start + index === selectedIndex;
          const common = {
            id: `timeline-option-${summary.id}`,
            "data-action": summary.action,
            role: "option" as const,
            "aria-selected": selected,
            "aria-label": `${summary.action}, ${fmtClock(summary.time, true)}`,
            "aria-posinset": range.start + index + 1,
            "aria-setsize": total,
          };
          if (value === null || value === undefined) return <rect key={summary.id} {...common} className={styles.pending} x={index * 10 + 3} y={48} width={4} height={4} />;
          const height = Math.max(1.5, Math.abs(value) / scale * 46);
          return <rect key={summary.id} {...common} className={styles.bar} x={index * 10} y={value > 0 ? 50 - height : 50} width={10} height={height} />;
        })}
      </svg>
      <div className={styles.axis} aria-hidden="true"><span>{visible[0] ? fmtClock(visible[0].time) : ""}</span><span>+{scale.toFixed(1)} / -{scale.toFixed(1)} bps</span><span>{visible.at(-1) ? fmtClock(visible.at(-1)!.time) : ""}</span></div>
      {total > 0 ? <BrushStrip summaries={ordered} values={values} scale={scale} window={range} onWindow={onWindow} /> : null}
    </div>
  </section>;
}
