"use client";

import { useState, type MouseEvent } from "react";
import { fmtClock } from "@/lib/format";
import ActionMark from "./ActionMark";
import { fmtBps, HORIZONS, type Action, type DecisionSummary, type Horizon } from "./record";
import styles from "./timeline.module.css";

type Props = {
  summaries: DecisionSummary[];
  selectedId: string | null;
  select: (id: string) => void;
  horizon: Horizon;
  setHorizon: (horizon: Horizon) => void;
};

const COUNTED: Action[] = ["buy", "sell", "hold", "no decision"];

export default function Timeline({ summaries, selectedId, select, horizon, setHorizon }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const ordered = [...summaries].reverse();
  const values = ordered.map((summary) => summary.markouts[horizon]?.signedBps ?? null);
  const measured = values.filter((value): value is number => value !== null);
  const scale = Math.max(1, ...measured.map(Math.abs));
  const right = measured.filter((value) => value > 0).length;
  const mean = measured.length ? measured.reduce((sum, value) => sum + value, 0) / measured.length : null;
  const selectedIndex = ordered.findIndex((summary) => summary.id === selectedId);
  const focus = ordered[hover ?? selectedIndex] ?? null;
  const focusValue = focus?.markouts[horizon]?.signedBps ?? null;
  const count = ordered.length || 1;

  function indexAt(event: MouseEvent<SVGSVGElement>): number {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.min(ordered.length - 1, Math.max(0, Math.floor((event.clientX - box.left) / box.width * ordered.length)));
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
      <svg className={styles.chart} viewBox={`0 0 ${count * 10} 100`} preserveAspectRatio="none" role="img"
        aria-label={`Bias-signed ${horizon} tick markout for ${ordered.length} decisions, oldest on the left`}
        onMouseMove={(event) => ordered.length && setHover(indexAt(event))} onMouseLeave={() => setHover(null)}
        onClick={(event) => ordered.length && select(ordered[indexAt(event)]!.id)}>
        {selectedIndex >= 0 ? <rect className={styles.selected} x={selectedIndex * 10} y={0} width={10} height={100} /> : null}
        {hover !== null && hover !== selectedIndex ? <rect className={styles.hovered} x={hover * 10} y={0} width={10} height={100} /> : null}
        <line className={styles.zero} x1={0} x2={count * 10} y1={50} y2={50} vectorEffect="non-scaling-stroke" />
        {ordered.map((summary, index) => {
          const value = values[index];
          if (value === null || value === undefined) return <rect key={summary.id} className={styles.pending} data-action={summary.action} x={index * 10 + 3} y={48} width={4} height={4} />;
          const height = Math.max(1.5, Math.abs(value) / scale * 46);
          return <rect key={summary.id} className={styles.bar} data-action={summary.action} x={index * 10 + 1.5} y={value > 0 ? 50 - height : 50} width={7} height={height} />;
        })}
      </svg>
      <div className={styles.axis} aria-hidden="true"><span>{ordered[0] ? fmtClock(ordered[0].time) : ""}</span><span>+{scale.toFixed(1)} / -{scale.toFixed(1)} bps</span><span>{ordered.at(-1) ? fmtClock(ordered.at(-1)!.time) : ""}</span></div>
    </div>
  </section>;
}
