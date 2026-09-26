"use client";

import { useEffect, useState } from "react";
import type { BlockEvent, PricePoint, SleeveMeta } from "@/lib/types";
import { displayCoin, fmtCoin, fmtPct, fmtSignedUsd } from "@/lib/format";
import { coinColor, fmtAgo, fmtUsdPrice, quoteOf, sleeveMetrics, sparkPoints } from "@/lib/sleeve-metrics";
import TokenIcon from "@/components/TokenIcon/TokenIcon";
import { Bone } from "@/components/Skeleton/Skeleton";
import styles from "./SleeveStrip.module.css";

export default function SleeveStrip({
  sleeves,
  latestByCoin,
  lastCallByCoin,
  eventsByCoin = {},
  tapeByCoin = {},
  selected,
  onSelect,
  waiting = false,
}: {
  sleeves: SleeveMeta[];
  latestByCoin: Record<string, BlockEvent | null>;
  lastCallByCoin: Record<string, string>;
  eventsByCoin?: Record<string, BlockEvent[]>;
  tapeByCoin?: Record<string, PricePoint[]>;
  selected: string;
  onSelect: (coin: string) => void;
  waiting?: boolean;
}) {
  const now = useNow();
  if (!sleeves.length) {
    if (!waiting) return null;
    return (
      <div className={styles.strip} aria-busy="true" aria-label="Loading markets" style={{ pointerEvents: "none" }}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={styles.card}>
            <span className={styles.top}>
              <Bone w={52} h={12} />
              <Bone w={44} h={10} />
            </span>
            <Bone w={72} h={18} />
            <Bone w={88} h={10} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.strip}>
      {sleeves.map((sleeve) => {
        const latest = latestByCoin[sleeve.coin] ?? null;
        const pos = latest?.position ?? null;
        const open = Boolean(pos && pos.side !== "flat");
        const pnl = openPnl(latest);
        const active = sleeve.coin === selected;
        const accent = coinColor(sleeve.coin);
        const cardStyle = active ? ({ "--accent": accent } as React.CSSProperties) : undefined;
        const pnlColor = open ? (pnl >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)") : undefined;
        const side = (pos?.side ?? "flat").toUpperCase();
        const sideColor =
          pos?.side === "long" ? "var(--buy-ink)" : pos?.side === "short" ? "var(--sell-ink)" : undefined;
        const lev = pos?.leverage != null ? `${pos.leverage}x` : "";
        const size =
          pos && pos.side !== "flat" ? fmtCoin(pos.size, sleeve.coin, 4) : "";
        const call = lastCallByCoin[sleeve.coin] || (latest?.decision?.late ? "LATE" : "");
        if (sleeve.status !== "live" || !latest) {
          const retrying = sleeve.status === "retrying";
          const statusLine = retrying
            ? sleeve.retryAt == null ? "Retrying" : `Retrying ${retryTime(sleeve.retryAt)}`
            : sleeve.status === "starting" ? "Starting" : "Waiting for market data";
          const detail = retrying ? sleeve.error || "Initialization failed" : "Market data unavailable";
          return (
            <button
              key={sleeve.coin}
              type="button"
              className={`${styles.card} ${styles.degraded} ${active ? styles.active : ""}`}
              style={cardStyle}
              onClick={() => onSelect(sleeve.coin)}
              aria-pressed={active}
              aria-label={`${displayCoin(sleeve.coin)} unavailable. ${statusLine}. ${detail}`}
            >
              <span className={styles.top}>
                <span className={styles.name}>
                  <TokenIcon coin={sleeve.coin} />
                  <span className={styles.label}>{sleeve.label}</span>
                </span>
                <span className={styles.mid}>Unavailable</span>
              </span>
              <span className={styles.unavailable}>Unavailable</span>
              <span className={styles.book}>{statusLine}</span>
              <span className={styles.call} title={detail}>{detail}</span>
            </button>
          );
        }
        const m = sleeveMetrics(eventsByCoin[sleeve.coin] ?? [], latest);
        const quote = quoteOf(sleeve.pair);
        const spark = sparkPoints(tapeByCoin[sleeve.coin] ?? [], 100, 32);
        return (
          <button
            key={sleeve.coin}
            type="button"
            className={`${styles.card} ${styles.live} ${active ? styles.active : ""}`}
            style={cardStyle}
            onClick={() => onSelect(sleeve.coin)}
            aria-pressed={active}
            aria-label={`${displayCoin(sleeve.coin)} ${sleeve.pair} ${side}${open ? ` unrealized ${fmtSignedUsd(pnl, 2)}` : ""}`}
          >
            <span className={styles.info}>
              <span className={styles.name}>
                <TokenIcon coin={sleeve.coin} size={22} />
                <span className={styles.label}>{sleeve.label}</span>
              </span>
              <span className={styles.pnl} style={pnlColor ? { color: pnlColor } : undefined}>
                {open ? fmtSignedUsd(pnl, 2) : "-"}
              </span>
              <span className={styles.book} style={sideColor ? { color: sideColor } : undefined}>
                {side}
                {lev ? ` ${lev}` : ""}
                {size ? ` ${size}` : ""}
              </span>
              <span className={styles.call}>{call || " "}</span>
            </span>
            <span className={styles.side}>
              <span className={styles.price}>{fmtUsdPrice(latest.mid)}</span>
              <span className={styles.quote}>{quote ? `${sleeve.coin}/${quote}` : sleeve.pair}</span>
              {spark ? (
                <svg className={styles.spark} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
                  <polyline points={spark} fill="none" stroke={accent} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                </svg>
              ) : (
                <span className={styles.spark} />
              )}
            </span>
            <span className={styles.metrics}>
              {m.entryTs != null ? (
                <span title="Time since the bot entered this position" className={styles.held}>
                  in position <b>{fmtAgo(now - m.entryTs)}</b>
                </span>
              ) : null}
              <span title="Time since Jev's last call">
                last call <b>{m.lastCallTs != null ? fmtAgo(now - m.lastCallTs) : "-"}</b>
              </span>
              <span title="Share of decisions that sent an order">
                orders <b>{m.decisions ? fmtPct(m.orderRate) : "-"}</b>
              </span>
              <span title={m.orders ? "Share of orders that filled" : "No orders sent yet"}>
                filled <b>{m.fillRate != null ? fmtPct(m.fillRate) : "-"}</b>
              </span>
              <span title="Average Jev response time">
                avg <b>{m.avgLatencyMs ? `${Math.round(m.avgLatencyMs)}ms` : "-"}</b>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function retryTime(retryAt: number): string {
  const date = new Date(retryAt);
  if (!Number.isFinite(date.getTime())) return "soon";
  return `at ${date.toISOString().slice(11, 16)} UTC`;
}

function openPnl(latest: BlockEvent | null | undefined): number {
  const pos = latest?.position;
  if (!pos || pos.side === "flat") return 0;
  return pos.unrealizedUsd ?? 0;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}
