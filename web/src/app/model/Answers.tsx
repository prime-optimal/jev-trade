import type { GroupResult, GroupSnapshot, QuestionEvidence, ResolvedQuestion } from "@/lib/journal-types";
import { fmtInt } from "@/lib/format";
import { numberValue, objectValue, stringValue, tone } from "./record";
import styles from "./answers.module.css";

export default function AnswerGroup({ group, snapshot }: { group: GroupResult; snapshot: GroupSnapshot | null }) {
  const questions: Record<string, ResolvedQuestion> = Object.fromEntries((snapshot?.questions ?? []).map((question) => [question.key, question]));
  const required = group.answers.some((answer) => answer.role === "required");
  const usage = group.provider?.usage;
  return <section className={styles.group} aria-label={`Evaluation group ${group.groupId}`}>
    <header className={styles.groupHeader}>
      <h3>{required ? "Trade call" : "Observations"} <span>{group.groupId}</span></h3>
      <p><span data-status={group.status}>{group.status}</span>{group.timing?.latencyMs != null ? <span>{fmtInt(group.timing.latencyMs)} ms</span> : null}{usage?.inputTokens != null ? <span>{fmtInt(usage.inputTokens)} in {usage.outputTokens != null ? `/ ${fmtInt(usage.outputTokens)} out` : ""}</span> : null}</p>
    </header>
    {!required ? <p className={styles.note}>Recorded for study. These answers do not move orders.</p> : null}
    {group.failure ? <p className={styles.failure}>{group.failure.code.replaceAll("_", " ")}: {group.failure.message}</p> : null}
    {group.answers.map((answer) => <Question key={answer.key} evidence={answer} question={questions[answer.key]} />)}
    {group.unexpected?.length ? <p className={styles.note}>Unexpected keys returned: {group.unexpected.map((item) => item.key).join(", ")}</p> : null}
  </section>;
}

function Question({ evidence, question }: { evidence: QuestionEvidence; question: ResolvedQuestion | undefined }) {
  const instructions = typeof question?.instructions === "string" ? { question: question.instructions } : question?.instructions ?? {};
  const { question: prompt, ...context } = instructions;
  const answer = objectValue(evidence.answer);
  const confidence = numberValue(answer?.confidence);
  return <article className={styles.question}>
    <header>
      <h4>{evidence.key}</h4>
      <span className={styles.type}>{evidence.declaredType}</span>
      {evidence.status !== "answered" ? <span className={styles.status}>{evidence.status}</span> : null}
      {confidence !== null ? <span className={styles.confidence}>{pct(confidence)} confident</span> : null}
    </header>
    {prompt ? <p className={styles.prompt}>{prompt}</p> : null}
    {evidence.status === "answered" && answer ? <Answer answer={answer} criteria={question?.criteria ?? null} /> : <Unanswered evidence={evidence} />}
    {Object.keys(context).length ? <details className={styles.details}><summary>Instructions</summary><dl>{Object.entries(context).map(([key, text]) => <div key={key}><dt>{key}</dt><dd>{text}</dd></div>)}</dl></details> : null}
  </article>;
}

function Answer({ answer, criteria }: { answer: Record<string, unknown>; criteria: unknown }) {
  const probabilities = objectValue(answer.probabilities) ?? {};
  if (answer.type === "choice") {
    const selected = stringValue(answer.choice);
    const described = objectValue(criteria) ?? {};
    const labels = [...new Set([...Object.keys(described), ...Object.keys(probabilities), ...(selected ? [selected] : [])])];
    return <ol className={styles.choices}>{labels.map((label) => {
      const detail = stringValue(described[label]);
      return <Probability key={label} label={label} detail={detail !== label ? detail : null} value={numberValue(probabilities[label])} selected={label === selected} />;
    })}</ol>;
  }
  if (answer.type === "score") {
    const selected = numberValue(answer.score);
    const scale = Array.isArray(criteria) ? criteria : [];
    const legend = objectValue(answer.legend) ?? {};
    const steps = [...new Set([...scale.map((_, index) => index), ...Object.keys(probabilities).map(Number), ...(selected !== null ? [selected] : [])])].filter(Number.isFinite).sort((a, b) => a - b);
    const peak = Math.max(0.01, ...steps.map((step) => numberValue(probabilities[String(step)]) ?? 0));
    return <ol className={styles.scale} style={{ gridTemplateColumns: `repeat(${steps.length || 1}, minmax(0, 1fr))` }}>{steps.map((step) => {
      const value = numberValue(probabilities[String(step)]);
      const name = stringValue(scale[step]) ?? stringValue(legend[String(step)]);
      return <li key={step} data-selected={step === selected}>
        <span className={styles.column} aria-hidden="true"><span style={{ height: `${(value ?? 0) / peak * 100}%` }} /></span>
        <span className={styles.stepValue}>{value !== null ? pct(value) : "n/a"}</span>
        <span className={styles.stepLabel}><b>{step}</b> {name}</span>
      </li>;
    })}</ol>;
  }
  if (answer.type === "noul") return <Meter label="noul" value={numberValue(answer.noul)} />;
  if (answer.type === "boolean") return <Meter label="true" value={numberValue(answer.probability)} />;
  return <p className={styles.note}>Unrecognized answer type.</p>;
}

function Probability({ label, detail, value, selected }: { label: string; detail: string | null; value: number | null; selected: boolean }) {
  return <li className={styles.choice} data-selected={selected} data-tone={tone(label)}>
    <span className={styles.choiceLabel}>{detail && detail.length <= 12 ? detail : label}{selected ? <em className={styles.picked}>picked</em> : null}{detail && detail.length > 12 ? <small>{detail}</small> : null}</span>
    <span className={styles.track} aria-hidden="true">{value !== null ? <span style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%` }} /> : null}</span>
    <span className={styles.pct}>{value !== null ? pct(value) : "n/a"}</span>
  </li>;
}

function Meter({ label, value }: { label: string; value: number | null }) {
  const valid = value !== null && value >= 0 && value <= 1;
  return <div className={styles.meter}>
    <span className={styles.track} aria-hidden="true">{valid ? <span style={{ width: `${value * 100}%` }} /> : null}</span>
    <span className={styles.pct}>{valid ? value.toFixed(3) : "out of range"}</span>
    <span className={styles.meterScale} aria-hidden="true"><span>0</span><span>{label}</span><span>1</span></span>
  </div>;
}

function Unanswered({ evidence }: { evidence: QuestionEvidence }) {
  return <div className={styles.unanswered}>
    <p>{evidence.status === "missing" || evidence.status === "incomplete" ? "No answer was returned." : `Answer ${evidence.status}.`}{evidence.error ? ` ${evidence.error}` : ""}</p>
    {evidence.raw ? <details className={styles.details}><summary>Provider response, {fmtInt(evidence.raw.bytes)} bytes{evidence.raw.truncated ? ", truncated" : ""}</summary><pre>{evidence.raw.json}</pre></details> : null}
  </div>;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(value >= 0.995 || value < 0.1 ? 1 : 0)}%`;
}
