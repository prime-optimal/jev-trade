import type { ReactNode } from "react";
import type { CapturedFeature } from "./record";
import styles from "./inputs.module.css";

type Props = { title: string; features: (CapturedFeature | undefined)[]; wide?: boolean; children: ReactNode };

export default function InputCard({ title, features, wide = false, children }: Props) {
  const present = features.filter((feature): feature is CapturedFeature => feature !== undefined);
  const meanings = present.map((feature) => `${feature.id}: ${feature.meta?.meaning ?? "no catalog entry"}${feature.meta?.units ? ` (${feature.meta.units})` : ""}`).join("\n");
  const ageUnknown = present.some((feature) => feature.meta?.freshness === "unknown");
  return <section className={styles.card} data-wide={wide} aria-label={title}>
    <header className={styles.cardHeader} title={meanings}>
      <h4>{title}</h4>
      <span>{present.map((feature) => feature.id).join(", ")}{ageUnknown ? ", age unknown" : ""}</span>
    </header>
    {children}
  </section>;
}
