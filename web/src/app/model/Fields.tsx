import { objectValue } from "./record";
import styles from "./inputs.module.css";

const LABELS: Record<string, string> = {
  coin: "Asset", market: "Market", tick: "Tick", tickMs: "Tick time of day", maxLeverage: "Max leverage",
  promptRevision: "Prompt revision", prompt: "Prompt", upIn10: "Up in 10", latencyMs: "Latency", inputTokens: "Input tokens",
};

export function label(key: string): string {
  return LABELS[key] ?? key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (first) => first.toUpperCase());
}

export default function Fields({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value);
  if (!entries.length) return <p className={styles.note}>Nothing recorded.</p>;
  return <dl className={styles.fields}>{entries.map(([key, entry]) => <div key={key}><dt>{label(key)}</dt><dd><FieldValue value={entry} /></dd></div>)}</dl>;
}

function FieldValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className={styles.note}>not recorded</span>;
  if (typeof value === "number") return <>{Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 6 }) : "not finite"}</>;
  if (typeof value === "boolean") return <>{value ? "yes" : "no"}</>;
  if (typeof value === "string") return <span className={styles.prose}>{value}</span>;
  if (Array.isArray(value)) return value.length ? <ol className={styles.list}>{value.map((item, index) => <li key={index}><FieldValue value={item} /></li>)}</ol> : <span className={styles.note}>empty</span>;
  const record = objectValue(value);
  return record ? <Fields value={record} /> : <span className={styles.note}>unsupported value</span>;
}
