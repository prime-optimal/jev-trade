"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BlockEvent, Meta } from "@/lib/types";
import { fmtCall, fmtClock, fmtPct, fmtPosition, fmtPrice, shortTx, txUrl } from "@/lib/format";
import { Bone } from "@/components/Skeleton/Skeleton";
import styles from "./Feed.module.css";

const ROW_H = 26;
const MAX_ROWS = 40;

type Kind = "buy" | "sell" | "hold" | "late";

function kindOf(event: BlockEvent): Kind {
  const d = event.decision;
  if (!d || d.late) return "late";
  if (d.intent === "hold" || d.action === "hold") return "hold";
  if (d.bias === "short" || d.action === "sell") return "sell";
  if (d.bias === "long" || d.action === "buy") return "buy";
  return "late";
}

function fmtSize(size: number): string {
  if (size > 0 && size < 0.01) {
    return size.toLocaleString("en-US", { maximumFractionDigits: 5, minimumFractionDigits: 3 });
  }
  return size.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const KIND_CLASS: Record<Kind, string> = {
  buy: styles.kindBuy,
  sell: styles.kindSell,
  hold: styles.kindHold,
  late: styles.kindLate,
};

function wordOf(event: BlockEvent, kind: Kind): string {
  const d = event.decision;
  if (kind === "late") return "LATE";
  if (kind === "hold") return "HOLD";
  if (d?.intent === "close") return "CLOSE";
  if (d?.intent === "open") return "OPEN";
  if (d?.action === "buy") return "BUY";
  if (d?.action === "sell") return "SELL";
  return "LATE";
}

function isCallRow(event: BlockEvent): boolean {
  return Boolean(event.decision && !event.decision.late);
}

export default function Feed({
  events,
  meta,
  waiting = false,
}: {
  events: BlockEvent[];
  meta?: Meta | null;
  waiting?: boolean;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [capacity, setCapacity] = useState(MAX_ROWS);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const measure = () => {
      const fits = Math.max(1, Math.min(MAX_ROWS, Math.floor(el.clientHeight / ROW_H)));
      setCapacity((prev) => (prev === fits ? prev : fits));
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const callRows = useMemo(() => events.filter(isCallRow), [events]);
  const [openBlock, setOpenBlock] = useState<number | null>(null);
  const opened = openBlock === null ? null : callRows.find((e) => e.block === openBlock) ?? null;

  if (opened) {
    return (
      <section className={styles.feed}>
        <div className={styles.railHead}>
          <span>HISTORY</span>
          <button type="button" className={styles.tab} style={{ opacity: 1 }} onClick={() => setOpenBlock(null)}>
            BACK
          </button>
        </div>
        <DecisionDetail event={opened} meta={meta} />
      </section>
    );
  }

  return (
    <section className={styles.feed}>
      <div className={styles.railHead}>HISTORY</div>
      <div className={styles.list} ref={listRef}>
        {waiting && callRows.length === 0 ? (
          <div aria-busy="true" aria-label="Loading history">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className={styles.row}>
                <span className={`${styles.cell} ${styles.time}`}>
                  <Bone w={56} h={8} />
                </span>
                <span className={`${styles.cell} ${styles.word}`}>
                  <Bone w={40} h={8} />
                </span>
                <span className={`${styles.cell} ${styles.lat}`}>
                  <Bone w={28} h={8} />
                </span>
                <span className={`${styles.cell} ${styles.detail}`}>
                  <Bone w={i % 2 ? 88 : 120} h={8} />
                </span>
              </div>
            ))}
          </div>
        ) : callRows.length === 0 ? (
          <div className={styles.empty}>no calls yet</div>
        ) : (
          callRows.slice(-capacity).reverse().map((event, i) => {
            const kind = kindOf(event);
            const decision = event.decision;
            const quote = event.quote;
            const fill = event.fill;
            const decided = kind !== "late";
            const kindClass = KIND_CLASS[kind];

            const lat = !decided || !decision ? "" : `${decision.latencyMs}ms`;

            let detail = "";
            let detailMuted = false;
            if (fill && fill.size > 0) {
              detail = `${fmtSize(fill.size)} @ ${fmtPrice(fill.price)}`;
            } else if (decided && quote) {
              const word = quote.taker ? "cross" : quote.side === "buy" ? "bid" : "ask";
              const lev = quote.taker || decision?.leverage == null ? "" : ` ${decision.leverage}x`;
              const bias = quote.taker || !decision?.bias ? "" : ` ${decision.bias}`;
              detail = `${word} ${fmtSize(quote.size)} @ ${fmtPrice(quote.price)}${bias}${lev}${quote.reduceOnly ? " reduce" : ""}`;
              detailMuted = quote.status === "reverted";
            } else if (decided && kind === "hold") {
              detail = event.position.side === "flat" ? "flat, no order" : "position held";
              detailMuted = true;
            } else if (decided && decision?.intent === "close" && event.position.side === "flat") {
              detail = "already flat";
              detailMuted = true;
            }

            const rowClass = [styles.row, kindClass, i === 0 ? styles.newest : "", fill ? styles.filled : ""]
              .filter(Boolean)
              .join(" ");

            return (
              <div
                key={event.block}
                className={`${rowClass} ${styles.clickable}`}
                role="button"
                tabIndex={0}
                title="Show decision detail"
                onClick={() => setOpenBlock(event.block)}
                onKeyDown={(e) => {
                  // Links inside the row keep their native Enter.
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpenBlock(event.block);
                  }
                }}
              >
                <span className={`${styles.cell} ${styles.time}`}>{fmtClock(event.ts, true)}</span>
                <span className={`${styles.cell} ${styles.word}`}>{wordOf(event, kind)}</span>
                <span className={`${styles.cell} ${styles.lat}`}>{lat}</span>
                <span
                  className={`${styles.cell} ${styles.detail}${detailMuted ? ` ${styles.muted}` : ""}`}
                >
                  {detail}
                </span>
                <span className={`${styles.cell} ${styles.tx}`}>
                  {fill && !fill.simulated && fill.txHash ? (
                    <a onClick={(e) => e.stopPropagation()} href={txUrl(fill.txHash, meta?.explorerTx)} target="_blank" rel="noreferrer" title="the taker's transaction">
                      {shortTx(fill.txHash)}
                    </a>
                  ) : quote && quote.status === "sim" ? (
                    <span className={styles.muted}>sim</span>
                  ) : quote && quote.txHash ? (
                    <a
                      onClick={(e) => e.stopPropagation()}
                      className={quote.status === "placed" ? undefined : styles.muted}
                      title={quote.status}
                      href={txUrl(quote.txHash, meta?.explorerTx)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {quote.status === "reverted" ? "rev" : shortTx(quote.txHash)}
                    </a>
                  ) : null}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

const KIND_COLOR: Record<Kind, string> = { buy: "var(--buy)", sell: "var(--sell)", hold: "var(--ink-2)", late: "var(--late)" };

function Prob({ label, value, color }: { label: string; value: number | undefined; color: string }) {
  if (value == null) return null;
  return (
    <div className={styles.probRow}>
      <span className={styles.probLabel}>{label}</span>
      <div className={styles.probTrack}>
        <div className={styles.probFill} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
      </div>
      <span className={styles.probPct}>{fmtPct(value)}</span>
    </div>
  );
}

function DecisionDetail({ event, meta }: { event: BlockEvent; meta?: Meta | null }) {
  const d = event.decision;
  const q = event.quote;
  const f = event.fill;
  const p = d?.probabilities;
  const hasBias = p?.long != null || p?.short != null;
  const hasIntent = p?.open != null || p?.close != null;
  const coin = meta?.coin ?? event.coin;
  return (
    <div className={styles.detailBody} aria-label="Decision detail">
      <div className={styles.detailHead}>
        <span className={styles.detailWord} style={{ color: KIND_COLOR[kindOf(event)] }}>{fmtCall(d) || "LATE"}</span>
        <span className={styles.muted}>{fmtClock(event.ts, true)}</span>
      </div>
      <dl className={styles.detailGrid}>
        <dt>block</dt><dd>{event.block}</dd>
        <dt>latency</dt><dd>{d ? `${d.latencyMs} ms` : "-"}</dd>
        <dt>mid</dt><dd>{fmtPrice(event.mid)}</dd>
        <dt>bid / ask</dt><dd>{fmtPrice(event.bestBid)} / {fmtPrice(event.bestAsk)}</dd>
        <dt>spread</dt><dd>{event.spreadBps.toFixed(2)} bps</dd>
        {d ? (<><dt>up in 10</dt><dd>{fmtPct(d.upIn10)}</dd></>) : null}
      </dl>

      {p ? (
        <div className={styles.detailSection}>
          <div className={styles.detailTitle}>confidence</div>
          {hasBias ? (
            <>
              <Prob label="long" value={p.long} color="var(--buy-bar)" />
              <Prob label="short" value={p.short} color="var(--sell-bar)" />
            </>
          ) : (
            <>
              <Prob label="buy" value={p.buy} color="var(--buy-bar)" />
              <Prob label="sell" value={p.sell} color="var(--sell-bar)" />
            </>
          )}
          {hasIntent ? (
            <>
              <Prob label="open" value={p.open} color="var(--ink-2)" />
              <Prob label="close" value={p.close} color="var(--ink-2)" />
            </>
          ) : null}
          <Prob label="hold" value={p.hold} color="var(--hold-cell)" />
        </div>
      ) : null}

      <div className={styles.detailSection}>
        <div className={styles.detailTitle}>execution</div>
        <dl className={styles.detailGrid}>
          <dt>order</dt>
          <dd>
            {q
              ? `${q.taker ? "cross" : q.side === "buy" ? "bid" : "ask"} ${fmtSize(q.size)} @ ${fmtPrice(q.price)}${q.reduceOnly ? " reduce" : ""}`
              : "no order"}
          </dd>
          {q ? (<><dt>status</dt><dd>{q.status}</dd></>) : null}
          <dt>fill</dt>
          <dd>{f && f.size > 0 ? `${fmtSize(f.size)} @ ${fmtPrice(f.price)}${f.simulated ? " sim" : ""}` : "none"}</dd>
          {(f?.txHash && !f.simulated) || q?.txHash ? (
            <>
              <dt>tx</dt>
              <dd>
                <a href={txUrl((f?.txHash && !f.simulated ? f.txHash : q?.txHash)!, meta?.explorerTx)} target="_blank" rel="noreferrer">
                  {shortTx((f?.txHash && !f.simulated ? f.txHash : q?.txHash)!)}
                </a>
              </dd>
            </>
          ) : null}
          <dt>position</dt><dd>{fmtPosition(event.position, coin)}</dd>
          {d?.leverage != null ? (<><dt>leverage</dt><dd>{d.leverage}x</dd></>) : null}
        </dl>
      </div>
      <a className={styles.detailLink} href="/model">full record on /model</a>
    </div>
  );
}
