import { fmtPrice } from "@/lib/format";
import type { DecisionRow, FeatureMetadata, GroupResult, GroupSnapshot } from "@/lib/journal-types";

export type ObjectValue = Record<string, unknown>;
export type Action = "buy" | "sell" | "hold" | "no decision" | "unavailable";
export type Tone = "buy" | "sell" | undefined;

export const HORIZONS = [1, 5, 20, 100] as const;
export type Horizon = (typeof HORIZONS)[number];

export interface Markout { signedBps: number | null; marketBps: number | null; observedMid: number | null; observedTimestamp: number | null; observedBlock: number | null }
export interface QuoteRecord { side: string | null; price: number | null; size: number | null; status: string | null; orderId: number | null; txHash: string | null; capped: boolean | null; taker: boolean | null; reduceOnly: boolean | null; raw: ObjectValue }
export interface FillRecord { id: string | null; orderId: number | null; side: string | null; size: number | null; price: number | null; feeUsd: number | null; closedPnl: number | null; dir: string | null; simulated: boolean | null; txHash: string | null }
export interface CapturedFeature { id: string; value: unknown; meta: FeatureMetadata | null }

export interface DecisionSummary {
  id: string;
  time: number;
  coin: string | null;
  action: Action;
  bias: string | null;
  intent: string | null;
  leverage: number | null;
  late: boolean;
  legacy: boolean;
  revision: string | null;
  provider: string | null;
  modelId: string | null;
  runId: string | null;
  block: number | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  markouts: Partial<Record<Horizon, Markout>>;
  quote: QuoteRecord | null;
  fills: FillRecord[];
  closedPnl: number | null;
}

export function objectValue(value: unknown): ObjectValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as ObjectValue : null;
}
export function stringValue(value: unknown): string | null { return typeof value === "string" ? value : null; }
export function numberValue(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
export function boolValue(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }

export function tone(label: string | null | undefined): Tone {
  const normalized = label?.toLowerCase();
  if (normalized === "buy" || normalized === "long" || normalized === "buyers") return "buy";
  if (normalized === "sell" || normalized === "short" || normalized === "sellers") return "sell";
  return undefined;
}

export function fmtBps(value: number | null, digits = 1): string {
  if (value === null) return "n/a";
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${Math.abs(value).toFixed(digits)} bps`;
}

export function fmtNumber(value: number | null, digits = 2): string {
  if (value === null) return "n/a";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function fmtPx(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : fmtPrice(value);
}

export function signOf(value: number | null): "pos" | "neg" | undefined {
  return value === null || value === 0 ? undefined : value > 0 ? "pos" : "neg";
}

export function summarize(row: DecisionRow): DecisionSummary {
  const envelope = objectValue(row.decision);
  const decision = objectValue(envelope && "decision" in envelope ? envelope.decision : row.decision);
  const failed = row.decision === null || envelope !== null && "decision" in envelope && envelope.decision === null;
  const legacy = row.recordType === "legacy" || row.programMetadata === "unavailable";
  const rawAction = stringValue(decision?.action)?.toLowerCase();
  const action: Action = rawAction === "buy" || rawAction === "sell" || rawAction === "hold" ? rawAction : failed ? "no decision" : "unavailable";
  const capturedCoin = row.evidence?.capture?.groups?.find((group) => typeof group.state?.coin === "string")?.state.coin;
  const required = row.evidence?.required;
  const fills = row.fills.map(fillRecord);
  const closedPnls = fills.map((fill) => fill.closedPnl).filter((value): value is number => value !== null);
  const markouts: Partial<Record<Horizon, Markout>> = {};
  for (const horizon of HORIZONS) {
    const markout = objectValue(row.markouts[String(horizon)]);
    if (markout) markouts[horizon] = {
      signedBps: numberValue(markout.signedReturnBps),
      marketBps: numberValue(markout.marketReturnBps),
      observedMid: numberValue(markout.observedMid),
      observedTimestamp: numberValue(markout.observedTimestamp),
      observedBlock: numberValue(markout.observedBlock),
    };
  }
  return {
    id: row.decisionId,
    time: numberValue(envelope?.timestamp) ?? row.createdAt,
    coin: stringValue(envelope?.coin) ?? stringValue(envelope?.market) ?? stringValue(decision?.coin) ?? stringValue(decision?.market) ?? stringValue(capturedCoin),
    action,
    bias: stringValue(decision?.bias),
    intent: stringValue(decision?.intent),
    leverage: numberValue(decision?.leverage),
    late: envelope?.late === true,
    legacy,
    revision: legacy ? stringValue(decision?.promptRevision) : stringValue(row.evidence?.capture?.revision),
    provider: stringValue(envelope?.provider) ?? stringValue(required?.provider?.name) ?? stringValue(decision?.provider),
    modelId: stringValue(envelope?.modelId) ?? stringValue(required?.provider?.model) ?? stringValue(decision?.modelId) ?? stringValue(decision?.model),
    runId: stringValue(envelope?.runId) ?? stringValue(decision?.runId),
    block: numberValue(envelope?.block) ?? numberValue(decision?.block) ?? numberValue(decision?.tick),
    latencyMs: numberValue(required?.timing?.latencyMs) ?? numberValue(decision?.latencyMs),
    inputTokens: numberValue(required?.provider?.usage?.inputTokens) ?? numberValue(decision?.inputTokens),
    outputTokens: numberValue(required?.provider?.usage?.outputTokens),
    markouts,
    quote: quoteRecord(row.quote),
    fills,
    closedPnl: closedPnls.length ? closedPnls.reduce((sum, value) => sum + value, 0) : null,
  };
}

function quoteRecord(value: unknown): QuoteRecord | null {
  const event = objectValue(value);
  const quote = objectValue(event && "quote" in event ? event.quote : value);
  if (!quote) return null;
  return {
    side: stringValue(quote.side),
    price: numberValue(quote.price),
    size: numberValue(quote.size),
    status: stringValue(quote.status),
    orderId: numberValue(quote.orderId),
    txHash: stringValue(quote.txHash),
    capped: boolValue(quote.capped),
    taker: boolValue(quote.taker),
    reduceOnly: boolValue(quote.reduceOnly),
    raw: quote,
  };
}

function fillRecord(value: unknown): FillRecord {
  const event = objectValue(value);
  const fill = objectValue(event && "fill" in event ? event.fill : value);
  return {
    id: stringValue(event?.fillId) ?? stringValue(fill?.decisionId),
    orderId: numberValue(fill?.orderId),
    side: stringValue(fill?.side),
    size: numberValue(fill?.size),
    price: numberValue(fill?.price),
    feeUsd: numberValue(fill?.feeUsd),
    closedPnl: numberValue(fill?.closedPnl),
    dir: stringValue(fill?.dir),
    simulated: boolValue(fill?.simulated),
    txHash: stringValue(fill?.txHash),
  };
}

export function evaluationGroups(row: DecisionRow): GroupResult[] {
  const groups = row.evidence ? [row.evidence.required, ...Object.values(row.observations)] : Object.values(row.observations);
  return groups.filter((group): group is GroupResult => typeof group?.groupId === "string" && Array.isArray(group.answers));
}

export function capturedFeatures(snapshots: readonly GroupSnapshot[]): Map<string, CapturedFeature> {
  const features = new Map<string, CapturedFeature>();
  for (const snapshot of snapshots) {
    const state = objectValue(snapshot.state);
    if (!state) continue;
    for (const [id, value] of Object.entries(state)) {
      if (features.has(id)) continue;
      const meta = Array.isArray(snapshot.features) ? snapshot.features.find((feature) => feature?.id === id) ?? null : null;
      features.set(id, { id, value, meta });
    }
  }
  return features;
}
