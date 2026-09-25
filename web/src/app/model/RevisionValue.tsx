import styles from "./model.module.css";

export default function RevisionValue({ value, expandable = false }: { value: string; expandable?: boolean }) {
  const preview = value.length > 24 ? `${value.slice(0, 14)}...${value.slice(-5)}` : value;
  const chip = <span className={styles.revision} title={value}>{preview}</span>;
  return expandable && preview !== value ? <details className={styles.expandValue}><summary aria-label="Expand full revision">{chip}</summary><code>{value}</code></details> : chip;
}
