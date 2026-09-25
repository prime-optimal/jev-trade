"use client";

import { useMemo, useState } from "react";
import type { BlockEvent, Meta } from "@/lib/types";
import { fmtCall } from "@/lib/format";
import { CATEGORIES, fmtSpan, summarizeDecisions, wholePercents, type DecisionCategory } from "@/lib/decision-summary";
import { Bone } from "@/components/Skeleton/Skeleton";
import styles from "./DecisionPanel.module.css";

export interface DecisionPanelProps {
  events: BlockEvent[];
  latest: BlockEvent | null;
  meta?: Meta | null;
  waiting?: boolean;
}

function Pie({ shares }: { shares: Record<DecisionCategory, number> }) {
  const r = 15.9155; // circumference 100
  let offset = 25;
  return (
    <svg className={styles.pie} viewBox="0 0 42 42" role="img" aria-label="Decision share pie chart">
      <circle cx="21" cy="21" r={r} fill="none" stroke="var(--track)" strokeWidth="10" />
      {CATEGORIES.map((c) => {
        const pct = shares[c.key] * 100;
        if (pct <= 0) return null;
        const el = (
          <circle
            key={c.key}
            cx="21"
            cy="21"
            r={r}
            fill="none"
            stroke={c.color}
            strokeWidth="10"
            strokeDasharray={`${pct} ${100 - pct}`}
            strokeDashoffset={offset}
          />
        );
        offset -= pct;
        return el;
      })}
    </svg>
  );
}

export default function DecisionPanel({ events, latest, waiting = false }: DecisionPanelProps) {
  const [pie, setPie] = useState(false);
  const [info, setInfo] = useState<DecisionCategory | null>(null);
  const summary = useMemo(() => summarizeDecisions(latest && events.at(-1) !== latest ? [...events, latest] : events), [events, latest]);

  if (waiting && !latest) {
    return (
      <div className={styles.panel} aria-busy="true" aria-label="Loading recent decisions">
        <section className={styles.section}>
          <div className={styles.railHead}>RECENT DECISIONS</div>
          <div className={styles.body}>
            <div className={styles.headline}>
              <Bone w={72} h={22} />
              <span className={styles.metaLine}>
                <Bone w={40} h={10} />
              </span>
            </div>
            <div className={styles.bars}>
              {CATEGORIES.map((c) => (
                <div key={c.key} className={styles.row}>
                  <span className={styles.label} style={{ opacity: 0.38 }}>
                    {c.label}
                  </span>
                  <div className={styles.track} />
                  <span className={styles.pct}>
                    <Bone w={28} h={10} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    );
  }

  const decision = latest?.decision ?? null;
  const decided = decision !== null && !decision.late;
  const held = decision?.intent === "hold";
  const headline = decided ? fmtCall(decision) || "LATE" : "LATE";
  const headlineColor = !decided
    ? "var(--late-ink)"
    : held
      ? "var(--ink-2)"
      : decision?.bias === "short" || decision?.action === "sell"
        ? "var(--sell-ink)"
        : "var(--buy-ink)";

  const { total, counts, shares, spanMs } = summary;
  const percents = wholePercents(counts);
  const infoCat = CATEGORIES.find((c) => c.key === info) ?? null;

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.railHead}>
          <span>RECENT DECISIONS</span>
          <span className={styles.railMeta}>
            {total ? `last ${total}${spanMs ? ` over ${fmtSpan(spanMs)}` : ""}` : ""}
          </span>
        </div>
        <div className={styles.body}>
          <div className={styles.headline}>
            <span className={styles.headlineWord} style={{ color: headlineColor }} title="Jev's latest call">
              {headline}
            </span>
            {decided && decision ? <span className={styles.metaLine}>{decision.latencyMs} ms</span> : null}
          </div>

          <button
            type="button"
            className={`${styles.bars} ${styles.chartButton}`}
            onClick={() => setPie((p) => !p)}
            title={pie ? "Show as bars" : "Show as pie"}
            aria-label={pie ? "Switch to bar chart" : "Switch to pie chart"}
          >
            {pie ? (
              <div className={styles.pieWrap}>
                <Pie shares={shares} />
              </div>
            ) : (
              CATEGORIES.map((c) => (
                <div key={c.key} className={styles.row}>
                  <span className={styles.label}>{c.label}</span>
                  <div className={styles.track}>
                    <div className={styles.fill} style={{ width: `${shares[c.key] * 100}%`, background: c.color }} />
                  </div>
                  <span className={styles.pct}>{total ? `${percents[c.key]}%` : "-"}</span>
                </div>
              ))
            )}
          </button>

          <div className={styles.legend}>
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`${styles.legendItem}${info === c.key ? ` ${styles.legendOn}` : ""}`}
                title={c.info}
                aria-expanded={info === c.key}
                onClick={() => setInfo((k) => (k === c.key ? null : c.key))}
              >
                <span className={styles.swatch} style={{ background: c.color }} />
                {c.label} {counts[c.key]}
              </button>
            ))}
          </div>
          {infoCat ? <p className={styles.info}>{infoCat.info}</p> : null}
        </div>
      </section>
    </div>
  );
}
