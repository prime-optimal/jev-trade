import type { DecisionRow } from "@/lib/journal-types";
import { fmtInt } from "@/lib/format";
import ActionMark from "./ActionMark";
import AnswerGroup from "./Answers";
import Execution from "./Execution";
import Fields from "./Fields";
import Inputs from "./Inputs";
import { evaluationGroups, fmtBps, objectValue, signOf, tone, type DecisionSummary, type Horizon } from "./record";
import styles from "./record.module.css";

export default function RecordView({ row, summary, horizon }: { row: DecisionRow | null; summary: DecisionSummary | null; horizon: Horizon }) {
  if (!row || !summary) return <section className={styles.record}><p className={styles.empty}>Select a decision to inspect its record.</p></section>;
  const snapshots = row.evidence?.capture?.groups ?? [];
  const groups = evaluationGroups(row);
  const envelope = objectValue(row.decision);
  const decision = objectValue(envelope && "decision" in envelope ? envelope.decision : row.decision);
  const markout = summary.markouts[horizon]?.signedBps ?? null;
  const plan = [summary.intent, summary.bias, summary.leverage !== null ? `${summary.leverage}x` : null].filter((part): part is string => Boolean(part));
  return <section className={styles.record} aria-label="Selected decision record">
    <header className={styles.header}>
      <div className={styles.call}>
        <h2 data-tone={tone(summary.action)}><ActionMark action={summary.action} size={20} />{summary.action}</h2>
        {plan.length ? <p className={styles.plan}>{plan.map((part) => <span key={part}>{part}</span>)}</p> : null}
        {summary.late ? <p className={styles.late}>Late tick</p> : null}
      </div>
      <dl className={styles.stats}>
        <div><dt>{horizon} tick markout</dt><dd data-sign={signOf(markout)}>{markout !== null ? fmtBps(markout) : "pending"}</dd></div>
        <div><dt>Latency</dt><dd>{summary.latencyMs !== null ? `${fmtInt(summary.latencyMs)} ms` : "n/a"}</dd></div>
        <div><dt>Tokens</dt><dd>{summary.inputTokens !== null ? fmtInt(summary.inputTokens) : "n/a"}{summary.outputTokens !== null ? ` / ${fmtInt(summary.outputTokens)}` : ""}</dd></div>
        <div><dt>Model</dt><dd>{summary.modelId ?? "n/a"}</dd></div>
      </dl>
      <p className={styles.meta}>
        <span>{new Date(summary.time).toLocaleString()}</span>
        {summary.coin ? <span>{summary.coin}</span> : null}
        {summary.block !== null ? <span>block {summary.block}</span> : null}
        {summary.provider ? <span>via {summary.provider}</span> : null}
        {summary.runId ? <span>{summary.runId}</span> : null}
        <span title={summary.id}>{summary.id}</span>
        {summary.revision ? <span className={styles.revision} title={summary.revision}>{summary.revision}</span> : null}
      </p>
    </header>
    <div className={styles.columns}>
      <div className={styles.answers}>
        {summary.legacy || !row.evidence ? <section className={styles.panel}><h3>Stored decision</h3><p className={styles.meta}>Program metadata unavailable for this record.</p>{decision ? <Fields value={decision} /> : null}</section> : null}
        {groups.map((group) => <AnswerGroup key={group.groupId} group={group} snapshot={snapshots.find((snapshot) => snapshot.groupId === group.groupId) ?? null} />)}
      </div>
      <div className={styles.inputs}>
        <h3 className={styles.columnTitle}>What Jev saw</h3>
        {snapshots.length ? <Inputs snapshots={snapshots} summary={summary} /> : <p className={styles.meta}>No input snapshot recorded.</p>}
      </div>
      <div className={styles.outcome}><Execution summary={summary} /></div>
    </div>
  </section>;
}
