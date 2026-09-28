import { HORIZONS, type DecisionSummary, type Horizon } from "./record";

export const CONFIDENCE_BUCKETS = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;

export interface HitMetric {
  key: string;
  label: string;
  n: number;
  hits: number;
  hitRate: number | null;
  meanBps: number | null;
}

export interface CalibrationBucket {
  lower: number;
  upper: number;
  n: number;
  hits: number;
  hitRate: number | null;
  meanConfidence: number | null;
}

export interface PnlPoint { time: number; pnl: number }

export interface PerformanceReport {
  totalLoaded: number;
  byHorizon: Array<HitMetric & { horizon: Horizon }>;
  byIntent: HitMetric[];
  byLeverage: HitMetric[];
  pnlCurve: PnlPoint[];
  calibration: CalibrationBucket[];
  measuredAtFiveTicks: number;
  calibratedAtFiveTicks: number;
}

export function confidenceBucket(confidence: number): number | null {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  for (let index = 0; index < CONFIDENCE_BUCKETS.length - 1; index++) {
    if (confidence >= CONFIDENCE_BUCKETS[index]! && confidence < CONFIDENCE_BUCKETS[index + 1]!) return index;
  }
  return CONFIDENCE_BUCKETS.length - 2;
}

export function computePerformance(summaries: readonly DecisionSummary[]): PerformanceReport {
  const byHorizon = HORIZONS.map((horizon) => ({
    ...metricFor(summaries, (summary) => summary.markouts[horizon]?.signedBps),
    horizon,
  }));
  const fiveTickRows = summaries.filter((summary) => measured(summary.markouts[5]?.signedBps));
  const byIntent = grouped(fiveTickRows, (summary) => summary.intent, "Unspecified");
  const byLeverage = grouped(fiveTickRows, (summary) => summary.leverage === null ? null : `${summary.leverage}x`, "Unspecified");
  const calibration = CONFIDENCE_BUCKETS.slice(0, -1).map((lower, index) => {
    const upper = CONFIDENCE_BUCKETS[index + 1]!;
    const rows = fiveTickRows.filter((summary) => summary.confidence !== null && confidenceBucket(summary.confidence) === index);
    const hits = rows.filter((summary) => summary.markouts[5]!.signedBps! > 0).length;
    const confidenceTotal = rows.reduce((sum, summary) => sum + summary.confidence!, 0);
    return {
      lower,
      upper,
      n: rows.length,
      hits,
      hitRate: rows.length ? hits / rows.length : null,
      meanConfidence: rows.length ? confidenceTotal / rows.length : null,
    };
  });

  return {
    totalLoaded: summaries.length,
    byHorizon,
    byIntent,
    byLeverage,
    pnlCurve: summaries.filter((summary) => summary.closedPnl !== null && Number.isFinite(summary.closedPnl))
      .toSorted((a, b) => a.time - b.time)
      .reduce<PnlPoint[]>((points, summary) => {
        points.push({ time: summary.time, pnl: (points.at(-1)?.pnl ?? 0) + summary.closedPnl! });
        return points;
      }, []),
    calibration,
    measuredAtFiveTicks: fiveTickRows.length,
    calibratedAtFiveTicks: fiveTickRows.filter((summary) => summary.confidence !== null && confidenceBucket(summary.confidence) !== null).length,
  };
}

function metricFor(summaries: readonly DecisionSummary[], valueOf: (summary: DecisionSummary) => number | null | undefined): HitMetric {
  const values = summaries.map((summary) => valueOf(summary)).filter(measured);
  const hits = values.filter((value) => value > 0).length;
  return {
    key: "all",
    label: "All",
    n: values.length,
    hits,
    hitRate: values.length ? hits / values.length : null,
    meanBps: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
  };
}

function grouped(summaries: readonly DecisionSummary[], keyOf: (summary: DecisionSummary) => string | null, missingLabel: string): HitMetric[] {
  const groups = new Map<string, number[]>();
  for (const summary of summaries) {
    const key = keyOf(summary) ?? missingLabel;
    const value = summary.markouts[5]?.signedBps;
    if (!measured(value)) continue;
    const values = groups.get(key);
    if (values) values.push(value);
    else groups.set(key, [value]);
  }
  return [...groups].map(([key, values]) => {
    const hits = values.filter((value) => value > 0).length;
    return {
      key,
      label: key,
      n: values.length,
      hits,
      hitRate: hits / values.length,
      meanBps: values.reduce((sum, value) => sum + value, 0) / values.length,
    };
  }).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

function measured(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}
