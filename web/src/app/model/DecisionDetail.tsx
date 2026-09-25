"use client";

import type { DecisionRow, GroupResult, GroupSnapshot, QuestionEvidence, ResolvedQuestion } from "@/lib/journal-types";
import RevisionValue from "./RevisionValue";
import styles from "./model.module.css";

type ObjectValue = Record<string, unknown>;

export default function DecisionDetail({ row }: { row: DecisionRow | null }) {
  if (!row) return <aside className={styles.detail}><p className={styles.emptyDetail}>Select a decision to inspect its record.</p></aside>;
  const envelope = objectValue(row.decision);
  const decision = objectValue(envelope && "decision" in envelope ? envelope.decision : row.decision);
  const failedEvaluation = row.decision === null || envelope !== null && "decision" in envelope && envelope.decision === null;
  const legacy = row.recordType === "legacy" || row.programMetadata === "unavailable";
  const action = typeof decision?.action === "string" ? decision.action.toLowerCase() : failedEvaluation ? "no decision" : "unavailable";
  const revision = legacy
    ? stringValue(decision?.promptRevision) ?? "unavailable"
    : row.evidence?.capture?.revision ?? "unavailable";
  const provider = row.evidence?.required?.provider;
  const modelId = stringValue(envelope?.modelId) ?? provider?.model ?? stringValue(decision?.modelId) ?? stringValue(decision?.model) ?? "unavailable";
  const groups: GroupResult[] = (row.evidence ? [row.evidence.required, ...Object.values(row.observations)] : Object.values(row.observations))
    .filter((group): group is GroupResult => typeof group?.groupId === "string" && Array.isArray(group.answers));
  const snapshots = row.evidence?.capture?.groups ?? [];
  return <aside className={styles.detail} aria-label="Selected decision details">
    <header className={styles.detailHeader}><p className={styles.eyebrow}>Decision record</p><h2>{action}</h2><dl className={styles.summary}>
      <div><dt>Provider</dt><dd>{stringValue(envelope?.provider) ?? provider?.name ?? stringValue(decision?.provider) ?? "unavailable"}</dd></div>
      <div><dt>Model</dt><dd>{modelId}</dd></div>
      <div className={styles.answerField}><dt>Revision</dt><dd><RevisionValue value={revision} expandable /></dd></div>
      <div><dt>Evaluation time</dt><dd>{numberValue(envelope?.timestamp) !== null ? timestamp(numberValue(envelope?.timestamp)!) : timestamp(row.createdAt)}</dd></div>
      <div><dt>Evaluation duration</dt><dd>{row.evidence?.required?.timing?.latencyMs != null ? `${row.evidence.required.timing.latencyMs} ms` : numberValue(decision?.latencyMs) != null ? `${numberValue(decision?.latencyMs)} ms` : "unavailable"}</dd></div>
      <div><dt>Run ID</dt><dd>{stringValue(envelope?.runId) ?? stringValue(decision?.runId) ?? "unavailable"}</dd></div>
      <div><dt>Tick or block</dt><dd>{numberValue(envelope?.block) ?? numberValue(decision?.block) ?? numberValue(decision?.tick) ?? "unavailable"}</dd></div>
    </dl></header>
    <section className={styles.detailSection}><h3>Model evidence</h3>
      {legacy ? <div className={styles.unavailable}><p>Program metadata unavailable for this record.</p><dl className={styles.summary}><div><dt>Action</dt><dd>{action}</dd></div><div><dt>Prompt revision</dt><dd>{revision}</dd></div><div><dt>Prompt</dt><dd>{stringValue(decision?.prompt) ?? "unavailable"}</dd></div><div><dt>Stored decision</dt><dd><Value value={row.decision} /></dd></div></dl></div>
        : row.evidence ? <div className={styles.evidenceGroups}>{groups.map((group) => <EvidenceGroup key={group.groupId} group={group} snapshot={snapshots.find((snapshot) => snapshot.groupId === group.groupId) ?? null} />)}</div>
          : <p className={styles.unavailable}>Program metadata unavailable for this record.</p>}
    </section>
    <section className={styles.detailSection}><h3>Execution</h3><Execution row={row} /></section>
    <section className={styles.detailSection}><h3>Outcome</h3><Outcome row={row} /></section>
  </aside>;
}

function EvidenceGroup({ group, snapshot }: { group: GroupResult; snapshot: GroupSnapshot | null }) {
  const questionByKey: Record<string, ResolvedQuestion> = Object.fromEntries((snapshot?.questions ?? []).map((question) => [question.key, question]));
  const required = group.answers.filter((answer) => answer.role === "required");
  const observational = group.answers.filter((answer) => answer.role !== "required");
  return <article className={styles.group}>
    <header><h4>Evaluation group: {group.groupId}</h4><span>Group status: {group.status}</span></header>
    {group.failure ? <p className={styles.failure}>Group failure: {group.failure.code}. {group.failure.message}</p> : null}
    {snapshot ? <Snapshot snapshot={snapshot} /> : <p className={styles.unavailable}>Input snapshot unavailable.</p>}
    <div className={styles.questionRole}><h5>Required</h5>{required.length ? required.map((answer) => <Question key={answer.key} answer={answer} question={questionByKey[answer.key]} />) : <p>No required answers recorded.</p>}</div>
    <div className={styles.questionRole}><h5>Observational</h5>{observational.length ? observational.map((answer) => <Question key={answer.key} answer={answer} question={questionByKey[answer.key]} />) : <p>No observational answers recorded.</p>}</div>
  </article>;
}

function Snapshot({ snapshot }: { snapshot: GroupSnapshot }) {
  const values = Object.entries(objectValue(snapshot.state) ?? {});
  return <section className={styles.snapshot}><h5>Captured input snapshot</h5><dl className={styles.snapshotMeta}><div><dt>Captured at</dt><dd>{timestamp(snapshot.capturedAt)}</dd></div><div><dt>Catalog version</dt><dd>{snapshot.catalogVersion}</dd></div></dl>
    {values.length ? <dl className={styles.featureList}>{values.map(([id, value]) => {
      const metadata = Array.isArray(snapshot.features) ? snapshot.features.find((feature) => feature?.id === id) : undefined;
      return <div key={id} className={styles.answerField}><dt>{id}</dt><dd><FeatureValue value={value} />{metadata ? <div className={styles.featureMeta}><span>{metadata.meaning}</span><span>Type: {metadata.type}</span><span>Freshness: {metadata.freshness}</span><span>Availability: {metadata.availability}</span><span>Captured at: {timestamp(snapshot.capturedAt)}</span><span>{metadata.freshness === "unknown" ? "Age unknown" : "Captured with this decision"}</span>{value === null ? <span>Value is null</span> : null}{metadata.units ? <span>Units: {metadata.units}</span> : null}{metadata.maxItems != null ? <span>Max items: {metadata.maxItems}</span> : null}</div> : <small>Feature metadata unavailable.</small>}</dd></div>;
    })}</dl> : <p>No captured feature values.</p>}
  </section>;
}

function Question({ answer, question }: { answer: QuestionEvidence; question: ResolvedQuestion | undefined }) {
  return <article className={styles.question}><h6>{answer.key}</h6><dl className={styles.questionFields}>
    <div><dt>Declared type</dt><dd>{answer.declaredType}</dd></div><div><dt>Role</dt><dd>{answer.role}</dd></div><div><dt>Evaluation group</dt><dd>{answer.groupId}</dd></div><div><dt>Status</dt><dd>{answer.status}</dd></div>
    <div className={styles.answerField}><dt>Instructions</dt><dd><Instructions value={question?.instructions} /></dd></div><div className={styles.answerField}><dt>Criteria or scale</dt><dd><Criteria value={question?.criteria} selected={selectedAnswer(answer)} /></dd></div>
    <div className={styles.answerField}><dt>Recorded answer</dt><dd><RecordedAnswer evidence={answer} /></dd></div>
    {answer.error ? <div><dt>Error</dt><dd>{answer.error}</dd></div> : null}
  </dl></article>;
}

function selectedAnswer(evidence: QuestionEvidence): string | undefined {
  const answer = objectValue(evidence.answer);
  const value = answer?.type === "choice" ? stringValue(answer.choice) : answer?.type === "score" ? numberValue(answer.score) : null;
  return value == null ? undefined : String(value);
}

function RecordedAnswer({ evidence }: { evidence: QuestionEvidence }) {
  if (evidence.status === "missing" || evidence.status === "incomplete") return <>answer unavailable</>;
  if (evidence.status === "invalid" || evidence.status === "failed") return <>{evidence.status}</>;
  const answer = objectValue(evidence.answer);
  if (!answer) return <>{evidence.raw === null ? "raw null" : "answer unavailable"}</>;
  const selected = selectedAnswer(evidence);
  if (answer.type === "boolean") return <Probability label="Boolean probability" value={answer.probability} />;
  if (answer.type === "noul") return <span className={styles.chip}>noul: {numberValue(answer.noul) ?? "unavailable"}</span>;
  if (answer.type !== "choice" && answer.type !== "score") return <>answer unavailable</>;
  return <div className={styles.answerValue}>
    <span className={styles.chip} data-tone={tone(selected)}>{answer.type}: {selected ?? "unavailable"}</span>
    {answer.legend !== undefined ? <Criteria value={answer.legend} selected={selected} /> : null}
    {answer.confidence !== undefined ? <Probability label="Confidence" value={answer.confidence} /> : null}
    {answer.probabilities !== undefined ? <Probabilities value={answer.probabilities} selected={selected} /> : null}
  </div>;
}

function Instructions({ value }: { value: unknown }) {
  if (typeof value === "string") return <p>{value}</p>;
  const record = objectValue(value);
  if (!record || !Object.keys(record).length) return <>unavailable</>;
  return <dl className={styles.valueRows}>{Object.entries(record).map(([key, text]) => <div key={key} className={key === "question" ? styles.questionText : undefined}><dt>{key}</dt><dd>{typeof text === "string" ? text : "unavailable"}</dd></div>)}</dl>;
}

function Criteria({ value, selected }: { value: unknown; selected?: string }) {
  const record = Array.isArray(value) ? value : objectValue(value);
  if (!record || !Object.keys(record).length) return <>unavailable</>;
  return <dl className={styles.criteria}>{Object.entries(record).map(([label, description]) => <div key={label} className={styles.chip} data-tone={label === selected ? tone(label) : undefined} data-selected={label === selected} data-empty={description === null}><dt>{label}</dt><dd>{description === null ? "null" : <Value value={description} />}</dd></div>)}</dl>;
}

function Probability({ label, value, selected = false }: { label: string; value: unknown; selected?: boolean }) {
  const number = numberValue(value);
  const valid = number !== null && number >= 0 && number <= 1;
  return <div className={styles.probability} data-tone={selected ? tone(label) : undefined} data-selected={selected}>
    <span>{label}</span><span className={styles.probabilityTrack} aria-hidden="true">{valid ? <span style={{ width: `${number * 100}%` }} /> : null}</span>
    <span title={json(value)}>{valid ? `${Number((number * 100).toFixed(2))}%` : "unavailable"}</span>
  </div>;
}

function Probabilities({ value, selected }: { value: unknown; selected?: string }) {
  const record = objectValue(value);
  if (!record || !Object.keys(record).length) return <>Probabilities unavailable</>;
  const entries = Object.entries(record).sort(([a, av], [b, bv]) => (numberValue(bv) ?? -1) - (numberValue(av) ?? -1) || a.localeCompare(b));
  return <div className={styles.probabilities} aria-label="Recorded probabilities">{entries.map(([label, probability]) => <Probability key={label} label={label} value={probability} selected={label === selected} />)}</div>;
}

function tone(label: string | undefined): string | undefined {
  return label === "buy" || label === "long" ? "buy" : label === "sell" || label === "short" ? "sell" : undefined;
}

const venueLabels: Record<string, string> = {
  markPx: "Mark price", oraclePx: "Oracle price", fundingBps: "Funding (bps)", premiumBps: "Premium (bps)",
  maxLeverage: "Max leverage", dayChangeBps: "Day change (bps)", dayNtlVlmUsd: "Day volume (USD)", openInterest: "Open interest",
};

function FeatureValue({ value }: { value: unknown }) {
  const record = objectValue(value);
  if (!record) return <Value value={value} />;
  if ("asks" in record || "bids" in record) return <Depth value={record} />;
  if (!Object.keys(record).some((key) => key in venueLabels)) return <Value value={value} />;
  return <dl className={styles.venueRows}>{Object.entries(record).map(([key, entry]) => {
    const number = numberValue(entry);
    const formatted = number !== null && key.endsWith("Bps") ? `${number > 0 ? "+" : ""}${number}` : number !== null && key === "dayNtlVlmUsd" ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(number) : null;
    return <div key={key}><dt>{venueLabels[key] ?? key}</dt><dd title={json(entry)}>{formatted ?? <Value value={entry} />}</dd></div>;
  })}</dl>;
}

type DepthLevel = { price: string; size: string; amount: number };

function depthLevels(value: unknown): DepthLevel[] | null {
  if (!Array.isArray(value)) return null;
  const levels: DepthLevel[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const parts = item.trim().split(/\s+x\s+/);
    const price = parts[0], size = parts[1];
    if (parts.length !== 2 || !price || !size || !Number.isFinite(Number(price)) || !Number.isFinite(Number(size)) || Number(price) <= 0 || Number(size) < 0) return null;
    levels.push({ price, size, amount: Number(size) });
  }
  return levels;
}

function Depth({ value }: { value: ObjectValue }) {
  const asks = depthLevels(value.asks), bids = depthLevels(value.bids);
  if (!asks || !bids) return <div><p>Depth ladder unavailable.</p><Value value={value} /></div>;
  const maximum = Math.max(0, ...asks.map((level) => level.amount), ...bids.map((level) => level.amount));
  const extras = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "asks" && key !== "bids"));
  return <div className={styles.depth}>
    <DepthSide label="Asks" levels={asks} maximum={maximum} side="sell" />
    <DepthSide label="Bids" levels={bids} maximum={maximum} side="buy" />
    {Object.keys(extras).length ? <Value value={extras} /> : null}
  </div>;
}

function DepthSide({ label, levels, maximum, side }: { label: string; levels: DepthLevel[]; maximum: number; side: string }) {
  const rows = (items: DepthLevel[]) => items.map((level, index) => <div className={styles.depthLevel} key={index}><span className={styles.depthBar} aria-hidden="true" style={{ width: `${maximum ? level.amount / maximum * 100 : 0}%` }} /><span>{level.price}</span><span>x {level.size}</span></div>);
  return <section data-tone={side}><h6>{label} <span>Price x size</span></h6>{levels.length ? rows(levels.slice(0, 5)) : <p>No recorded levels.</p>}{levels.length > 5 ? <details className={styles.expandValue}><summary>Show {levels.length - 5} more levels</summary>{rows(levels.slice(5))}</details> : null}</section>;
}

function Value({ value }: { value: unknown }) {
  if (value === null) return <>null</>;
  if (typeof value === "string") return <span className={styles.prose}>{value}</span>;
  if (typeof value === "number") return <>{Number.isFinite(value) ? value : "unavailable"}</>;
  if (typeof value === "boolean") return <>{String(value)}</>;
  if (typeof value !== "object") return <>unavailable</>;
  const text = json(value);
  const preview = text.length > 160 ? `${text.slice(0, 160)}...` : text;
  return <details className={styles.expandValue}><summary title={text}><span className={styles.valuePreview}>{preview}</span><span>Expand stored value</span></summary><pre><code>{JSON.stringify(value, null, 2)}</code></pre></details>;
}

function Execution({ row }: { row: DecisionRow }) {
  const quoteEvent = objectValue(row.quote);
  const quote = objectValue(quoteEvent && "quote" in quoteEvent ? quoteEvent.quote : row.quote);
  const recordedAction = objectValue(row.decision);
  return <div className={styles.execution}>
    <section><h4>Quote</h4>{quote ? <dl className={styles.summary}>
      <div><dt>Side</dt><dd>{stringValue(quote.side) ?? recordedNull(quote.side)}</dd></div><div><dt>Price</dt><dd>{numberValue(quote.price) ?? recordedNull(quote.price)}</dd></div><div><dt>Size</dt><dd>{numberValue(quote.size) ?? recordedNull(quote.size)}</dd></div><div><dt>Status</dt><dd>{stringValue(quote.status) ?? recordedNull(quote.status)}</dd></div><div><dt>Order ID</dt><dd>{numberValue(quote.orderId) ?? recordedNull(quote.orderId)}</dd></div><div><dt>Transaction hash</dt><dd>{stringValue(quote.txHash) ?? recordedNull(quote.txHash)}</dd></div><div><dt>Capped</dt><dd>{boolValue(quote.capped) ?? recordedNull(quote.capped)}</dd></div><div><dt>Taker</dt><dd>{boolValue(quote.taker) ?? recordedNull(quote.taker)}</dd></div>
    </dl> : <p>No quote recorded.</p>}</section>
    <section><h4>Fills</h4>{row.fills.length ? <div className={styles.fills}>{row.fills.map((entry, index) => {
      const fillEvent = objectValue(entry);
      const fill = objectValue(fillEvent && "fill" in fillEvent ? fillEvent.fill : entry);
      return <article key={`${stringValue(fillEvent?.fillId) ?? stringValue(fill?.decisionId) ?? "fill"}-${numberValue(fill?.orderId) ?? index}`}><h5>Fill {index + 1}</h5><dl className={styles.summary}>
        <div><dt>Identity</dt><dd>{stringValue(fillEvent?.fillId) ?? stringValue(fill?.decisionId) ?? "unavailable"}</dd></div><div><dt>Order ID</dt><dd>{numberValue(fill?.orderId) ?? "unavailable"}</dd></div><div><dt>Side</dt><dd>{stringValue(fill?.side) ?? "unavailable"}</dd></div><div><dt>Size</dt><dd>{numberValue(fill?.size) ?? "unavailable"}</dd></div><div><dt>Price</dt><dd>{numberValue(fill?.price) ?? "unavailable"}</dd></div><div><dt>Fee USD</dt><dd>{numberValue(fill?.feeUsd) ?? "unavailable"}</dd></div><div><dt>Simulated</dt><dd>{boolValue(fill?.simulated) ?? "unavailable"}</dd></div><div><dt>Direction</dt><dd>{stringValue(fill?.dir) ?? "unavailable"}</dd></div><div><dt>Closed PnL</dt><dd>{numberValue(fill?.closedPnl) ?? "unavailable"}</dd></div>
      </dl></article>;
    })}</div> : <p>No fills recorded.</p>}</section>
    {recordedAction && ("decision" in recordedAction && objectValue(recordedAction.decision)?.action === "hold" || recordedAction.action === "hold") ? <p className={styles.noOrder}>No order for this decision.</p> : null}
  </div>;
}

function Outcome({ row }: { row: DecisionRow }) {
  const closedPnls = row.fills.map((entry) => {
    const event = objectValue(entry);
    const fill = objectValue(event && "fill" in event ? event.fill : entry);
    return numberValue(fill?.closedPnl);
  }).filter((value): value is number => value !== null);
  const closedPnl = closedPnls.reduce((sum, value) => sum + value, 0);
  const horizons = [1, 5, 20, 100] as const;
  return <div><p className={styles.pnl}><strong>Closed PnL from recorded fills</strong> {closedPnls.length ? closedPnl : "unavailable"}</p><div className={styles.markouts}>{horizons.map((horizon) => {
    const markout = objectValue(row.markouts[String(horizon)]);
    return <article key={horizon}><h4>{horizon} tick</h4>{markout ? <dl className={styles.summary}><div><dt>Observation time</dt><dd>{numberValue(markout.observedTimestamp) !== null ? timestamp(numberValue(markout.observedTimestamp)!) : "unavailable"}</dd></div><div><dt>Observed block</dt><dd>{numberValue(markout.observedBlock) ?? "unavailable"}</dd></div><div><dt>Market return (bps)</dt><dd>{numberValue(markout.marketReturnBps) ?? "unavailable"}</dd></div><div><dt>Bias-signed return (bps)</dt><dd>{numberValue(markout.signedReturnBps) ?? "unavailable"}</dd></div></dl> : <p>Pending or unavailable.</p>}</article>;
  })}</div></div>;
}

function objectValue(value: unknown): ObjectValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as ObjectValue : null;
}
function stringValue(value: unknown): string | null { return typeof value === "string" ? value : null; }
function numberValue(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function boolValue(value: unknown): string | null { return typeof value === "boolean" ? String(value) : null; }
function recordedNull(value: unknown): string { return value === null ? "null" : "unavailable"; }
function timestamp(value: number): string { return new Date(value).toLocaleString(); }
function json(value: unknown): string {
  try { const text = JSON.stringify(value); return text === undefined ? "unavailable" : text; } catch { return "unavailable"; }
}
