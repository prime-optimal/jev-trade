"use client";

import type { DecisionRow, GroupResult, GroupSnapshot, ProviderAnswer, QuestionEvidence, ResolvedQuestion } from "@/lib/journal-types";
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
      <div><dt>Revision</dt><dd>{revision}</dd></div>
      <div><dt>Evaluation time</dt><dd>{numberValue(envelope?.timestamp) !== null ? timestamp(numberValue(envelope?.timestamp)!) : timestamp(row.createdAt)}</dd></div>
      <div><dt>Evaluation duration</dt><dd>{row.evidence?.required?.timing?.latencyMs != null ? `${row.evidence.required.timing.latencyMs} ms` : numberValue(decision?.latencyMs) != null ? `${numberValue(decision?.latencyMs)} ms` : "unavailable"}</dd></div>
      <div><dt>Run ID</dt><dd>{stringValue(envelope?.runId) ?? stringValue(decision?.runId) ?? "unavailable"}</dd></div>
      <div><dt>Tick or block</dt><dd>{numberValue(envelope?.block) ?? numberValue(decision?.block) ?? numberValue(decision?.tick) ?? "unavailable"}</dd></div>
    </dl></header>
    <section className={styles.detailSection}><h3>Model evidence</h3>
      {legacy ? <div className={styles.unavailable}><p>Program metadata unavailable for this record.</p><dl className={styles.summary}><div><dt>Action</dt><dd>{action}</dd></div><div><dt>Prompt revision</dt><dd>{revision}</dd></div><div><dt>Prompt</dt><dd>{stringValue(decision?.prompt) ?? "unavailable"}</dd></div><div><dt>Stored decision</dt><dd><code>{json(row.decision)}</code></dd></div></dl></div>
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
  const values = Object.entries(snapshot.state);
  return <section className={styles.snapshot}><h5>Captured input snapshot</h5><dl className={styles.snapshotMeta}><div><dt>Captured at</dt><dd>{timestamp(snapshot.capturedAt)}</dd></div><div><dt>Catalog version</dt><dd>{snapshot.catalogVersion}</dd></div></dl>
    {values.length ? <dl className={styles.featureList}>{values.map(([id, value]) => {
      const metadata = snapshot.features.find((feature) => feature.id === id);
      return <div key={id}><dt>{id}</dt><dd><code>{json(value)}</code>{metadata ? <small>{metadata.meaning}; type {metadata.type}; freshness {metadata.freshness}; availability {metadata.availability}; captured at {timestamp(snapshot.capturedAt)}{metadata.freshness === "unknown" ? "; age unknown" : "; captured with this decision"}{value === null ? "; value is null" : ""}{metadata.units ? `; units ${metadata.units}` : ""}{metadata.maxItems != null ? `; max items ${metadata.maxItems}` : ""}</small> : <small>Feature metadata unavailable.</small>}</dd></div>;
    })}</dl> : <p>No captured feature values.</p>}
  </section>;
}

function Question({ answer, question }: { answer: QuestionEvidence; question: ResolvedQuestion | undefined }) {
  return <article className={styles.question}><h6>{answer.key}</h6><dl className={styles.questionFields}>
    <div><dt>Declared type</dt><dd>{answer.declaredType}</dd></div><div><dt>Role</dt><dd>{answer.role}</dd></div><div><dt>Evaluation group</dt><dd>{answer.groupId}</dd></div><div><dt>Status</dt><dd>{answer.status}</dd></div>
    <div><dt>Instructions</dt><dd>{question ? json(question.instructions) : "unavailable"}</dd></div><div><dt>Criteria or scale</dt><dd>{question?.criteria == null ? "unavailable" : json(question.criteria)}</dd></div>
    <div className={styles.answerField}><dt>Recorded answer</dt><dd>{renderAnswer(answer)}</dd></div>
    {answer.error ? <div><dt>Error</dt><dd>{answer.error}</dd></div> : null}
  </dl></article>;
}

function renderAnswer(evidence: QuestionEvidence): string {
  if (evidence.status === "missing" || evidence.status === "incomplete") return "answer unavailable";
  if (evidence.status === "invalid") return "invalid";
  if (evidence.status === "failed") return "failed";
  const answer: ProviderAnswer | undefined = evidence.answer;
  if (!answer) return evidence.raw === null ? "raw null" : "answer unavailable";
  switch (answer.type) {
    case "choice": return `choice: ${answer.choice}${answer.confidence === undefined ? "" : `; confidence ${answer.confidence}`}${answer.probabilities === undefined ? "" : `; probabilities ${json(answer.probabilities)}`}`;
    case "score": return `score: ${answer.score}${answer.legend === undefined ? "" : `; legend ${json(answer.legend)}`}${answer.confidence === undefined ? "" : `; confidence ${answer.confidence}`}${answer.probabilities === undefined ? "" : `; probabilities ${json(answer.probabilities)}`}`;
    case "boolean": return `boolean probability: ${answer.probability}`;
    case "noul": return `noul: ${answer.noul}`;
  }
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
