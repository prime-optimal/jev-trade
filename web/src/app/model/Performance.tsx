"use client";

import { useMemo } from "react";
import { fmtClock, fmtSignedUsd } from "@/lib/format";
import { computePerformance, type HitMetric, type PerformanceReport } from "./performance-metrics";
import { fmtBps, type DecisionSummary } from "./record";
import styles from "./performance.module.css";

type Props = {
  summaries: DecisionSummary[];
  canLoadOlder: boolean;
  loadingMore: boolean;
  loadOlder: () => void;
};

export default function Performance({ summaries, canLoadOlder, loadingMore, loadOlder }: Props) {
  const report = useMemo(() => computePerformance(summaries), [summaries]);
  const smallSample = report.measuredAtFiveTicks > 0 && report.measuredAtFiveTicks < 10;
  const horizonRows = report.byHorizon.map((metric) => ({ ...metric, key: `${metric.horizon}`, label: `${metric.horizon}t` }));
  return <section className={styles.view} aria-label="Performance view">
    <header className={styles.header}>
      <div>
        <h2>Performance</h2>
        <p>Numbers cover {report.totalLoaded} loaded decisions. Load older extends the sample.</p>
        <p>{report.measuredAtFiveTicks} decisions have measured 5t markouts; pending markouts are excluded. Calibration uses {report.calibratedAtFiveTicks} of those with picked bias confidence.</p>
        <p>Rows marked small sample contain fewer than 10 measured decisions.</p>
        {smallSample ? <p className={styles.smallSample}>Small sample. Rates are descriptive, not a guarantee.</p> : null}
        {report.totalLoaded > 0 && report.measuredAtFiveTicks === 0 ? <p className={styles.empty}>No measured 5t markouts are loaded yet.</p> : null}
      </div>
      {canLoadOlder ? <button type="button" className={styles.loadOlder} onClick={loadOlder} disabled={loadingMore}>{loadingMore ? "Loading older" : "Load older"}</button> : null}
    </header>
    <div className={styles.grid}>
      <MetricTable title="Hit rate by horizon" description="Bias-signed markouts. Positive values count as hits." label="Horizon" rows={horizonRows} />
      <MetricTable title="Hit rate by intent at 5t" description="Groups include only decisions with a measured 5t markout." label="Intent" rows={report.byIntent} />
      <MetricTable title="Hit rate by leverage at 5t" description="Groups include only decisions with a measured 5t markout." label="Leverage" rows={report.byLeverage} />
      <PnlChart report={report} />
      <Calibration report={report} />
    </div>
  </section>;
}

function MetricTable({ title, description, label, rows }: { title: string; description: string; label: string; rows: HitMetric[] }) {
  return <section className={styles.panel} aria-label={title}>
    <header className={styles.panelHeader}><h3>{title}</h3><p>{description}</p></header>
    {rows.length ? <div className={styles.tableScroll}><table>
      <thead><tr><th scope="col">{label}</th><th scope="col">n</th><th scope="col">Hit rate</th><th scope="col">Mean bps</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key}>
        <th scope="row">{row.label}</th><td>{row.n}{row.n > 0 && row.n < 10 ? <small className={styles.smallN}>small sample</small> : null}</td><td>{formatRate(row.hitRate)}</td><td>{row.meanBps === null ? "n/a" : fmtBps(row.meanBps)}</td>
      </tr>)}</tbody>
    </table></div> : <p className={styles.empty}>No measured 5t markouts in this group.</p>}
  </section>;
}

function PnlChart({ report }: { report: PerformanceReport }) {
  const points = report.pnlCurve;
  if (!points.length) return <section className={styles.panel} aria-label="Closed PnL curve">
    <header className={styles.panelHeader}><h3>Closed PnL over time</h3><p>Recorded closed PnL, oldest to newest.</p></header>
    <p className={styles.empty}>No closed PnL is recorded in loaded history.</p>
  </section>;

  const width = 600;
  const height = 200;
  const padX = 16;
  const padY = 16;
  const values = [0, ...points.map((point) => point.pnl)];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const firstTime = points[0]!.time;
  const lastTime = points.at(-1)!.time;
  const xAt = (point: typeof points[number], index: number) => lastTime === firstTime
    ? padX + index / Math.max(1, points.length - 1) * (width - 2 * padX)
    : padX + (point.time - firstTime) / (lastTime - firstTime) * (width - 2 * padX);
  const yAt = (value: number) => padY + (max - value) / (max - min) * (height - 2 * padY);
  const coordinates = points.map((point, index) => `${xAt(point, index)},${yAt(point.pnl)}`).join(" ");
  const zeroY = yAt(0);
  return <section className={styles.panel} aria-label="Closed PnL curve">
    <header className={styles.panelHeader}><h3>Closed PnL over time</h3><p>{points.length} recorded outcomes, cumulative total {fmtSignedUsd(points.at(-1)!.pnl)}.</p></header>
    <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Cumulative closed PnL for ${points.length} recorded outcomes, oldest to newest`}>
      <line className={styles.zero} x1={padX} x2={width - padX} y1={zeroY} y2={zeroY} vectorEffect="non-scaling-stroke" />
      <polyline className={styles.pnlLine} points={coordinates} vectorEffect="non-scaling-stroke" />
      {points.map((point, index) => <circle key={`${point.time}-${index}`} className={styles.pnlPoint} cx={xAt(point, index)} cy={yAt(point.pnl)} r="3" />)}
    </svg>
    <div className={styles.axis}><span>{fmtClock(firstTime)}</span><span>Zero baseline</span><span>{fmtClock(lastTime)}</span></div>
  </section>;
}

function Calibration({ report }: { report: PerformanceReport }) {
  const total = report.calibratedAtFiveTicks;
  const width = 600;
  const height = 230;
  const left = 48;
  const right = 584;
  const top = 14;
  const bottom = 184;
  const plotWidth = right - left;
  const plotHeight = bottom - top;
  const yAt = (value: number) => top + (1 - value) * plotHeight;
  return <section className={styles.panel} aria-label="Confidence calibration">
    <header className={styles.panelHeader}><h3>Confidence calibration at 5t</h3><p>Picked bias confidence compared with realized hit rate. The diagonal is perfect calibration.</p></header>
    {total ? <>
      <p className={styles.sampleCount}>{total} measured decisions with picked bias confidence.</p>
      <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Picked bias confidence buckets compared with realized 5 tick hit rate. The diagonal shows perfect calibration.">
        {[0, 0.5, 1].map((tick) => <g key={tick}>
          <line className={styles.gridLine} x1={left} x2={right} y1={yAt(tick)} y2={yAt(tick)} />
          <text className={styles.axisText} x={left - 8} y={yAt(tick) + 4} textAnchor="end">{Math.round(tick * 100)}%</text>
        </g>)}
        <line className={styles.ideal} x1={left} x2={right} y1={bottom} y2={top} vectorEffect="non-scaling-stroke" />
        {report.calibration.map((bucket, index) => {
          const center = left + (bucket.lower + bucket.upper) / 2 * plotWidth;
          const rate = bucket.hitRate ?? 0;
          const barHeight = bucket.n ? Math.max(1, rate * plotHeight) : 0;
          return <g key={bucket.lower}>
            {bucket.n ? <rect className={styles.calibrationBar} x={center - 27} y={bottom - barHeight} width={54} height={barHeight} /> : null}
            <text className={styles.axisText} x={center} y={height - 24} textAnchor="middle">{Math.round(bucket.lower * 100)} to {Math.round(bucket.upper * 100)}%</text>
          </g>;
        })}
      </svg>
      <div className={styles.legend}><span><i className={styles.legendBar} /> Realized hit rate</span><span><i className={styles.legendLine} /> Perfect calibration</span></div>
      <div className={styles.tableScroll}><table>
        <thead><tr><th scope="col">Picked confidence</th><th scope="col">n</th><th scope="col">Mean confidence</th><th scope="col">Hit rate</th></tr></thead>
        <tbody>{report.calibration.map((bucket) => <tr key={bucket.lower}>
          <th scope="row">{Math.round(bucket.lower * 100)} to {Math.round(bucket.upper * 100)}%</th>
          <td>{bucket.n}{bucket.n > 0 && bucket.n < 10 ? <small className={styles.smallN}>small sample</small> : null}</td><td>{formatRate(bucket.meanConfidence)}</td><td>{formatRate(bucket.hitRate)}</td>
        </tr>)}</tbody>
      </table></div>
    </> : <p className={styles.empty}>No measured 5t markouts with picked bias confidence are loaded.</p>}
  </section>;
}

function formatRate(rate: number | null): string {
  return rate === null ? "n/a" : `${Math.round(rate * 100)}%`;
}
