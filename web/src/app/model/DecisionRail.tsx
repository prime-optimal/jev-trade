"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Bone } from "@/components/Skeleton/Skeleton";
import TokenIcon from "@/components/TokenIcon/TokenIcon";
import { displayCoin, fmtClock } from "@/lib/format";
import type { DecisionHistoryStatus } from "@/lib/useDecisions";
import { fmtBps, tone, type DecisionSummary, type Horizon } from "./record";
import ActionMark from "./ActionMark";
import styles from "./rail.module.css";

type Props = {
  summaries: DecisionSummary[];
  selectedId: string | null;
  select: (id: string) => void;
  horizon: Horizon;
  status: DecisionHistoryStatus;
  error: string | null;
  newIds: ReadonlySet<string>;
  nextBefore: string | null;
  loadingMore: boolean;
  loadOlder: () => void;
  retry: () => void;
};

export default function DecisionRail({ summaries, selectedId, select, horizon, status, error, newIds, nextBefore, loadingMore, loadOlder, retry }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-decision-id="${CSS.escape(selectedId ?? "")}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  function moveSelection(event: KeyboardEvent<HTMLElement>, index: number) {
    const last = summaries.length - 1;
    const target = event.key === "Home" ? 0 : event.key === "End" ? last : event.key === "ArrowUp" ? Math.max(0, index - 1) : event.key === "ArrowDown" ? Math.min(last, index + 1) : -1;
    if (target < 0 || last < 0) return;
    event.preventDefault();
    select(summaries[target]!.id);
    listRef.current?.querySelector<HTMLElement>(`[data-index="${target}"]`)?.focus();
  }

  const days: { day: string; items: { summary: DecisionSummary; index: number }[] }[] = [];
  summaries.forEach((summary, index) => {
    const day = new Date(summary.time).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    if (days.at(-1)?.day !== day) days.push({ day, items: [] });
    days.at(-1)!.items.push({ summary, index });
  });

  return <section className={styles.rail} aria-label="Decisions history">
    <div className={styles.columns} aria-hidden="true"><span>Time</span><span>Coin</span><span>Call</span><span>Plan</span><span>{horizon}t</span></div>
    <div className={styles.scroll} ref={listRef} role="listbox" aria-label="Recorded decisions">
      {status === "loading" && summaries.length === 0 ? Array.from({ length: 12 }, (_, index) => <div className={styles.skeleton} key={index}><Bone w="58px" /><Bone w="28px" /><Bone w="44px" /><Bone w="76px" /><Bone w="36px" /></div>) : null}
      {days.map(({ day, items }) => <div role="group" aria-label={day} key={day}>
        <div className={styles.day} aria-hidden="true">{day}</div>
        {items.map(({ summary, index }) => {
          const selected = summary.id === selectedId;
          const markout = summary.markouts[horizon]?.signedBps ?? null;
          const plan = [summary.intent, summary.bias, summary.leverage !== null ? `${summary.leverage}x` : null].filter(Boolean).join(" ");
          return <div key={summary.id} role="option" aria-selected={selected} data-decision-id={summary.id} data-index={index} tabIndex={selected || (selectedId === null && index === 0) ? 0 : -1}
            className={styles.row} onClick={() => select(summary.id)} onKeyDown={(event) => moveSelection(event, index)}>
            <span className={styles.time}>{fmtClock(summary.time, true)}</span>
            <span className={styles.coin}>{summary.coin ? <><TokenIcon coin={summary.coin} size={14} /><span>{displayCoin(summary.coin)}</span></> : "n/a"}</span>
            <span className={styles.call} data-tone={tone(summary.action)} data-action={summary.action}><ActionMark action={summary.action} /><span className={styles.callLabel}>{summary.action === "no decision" ? "none" : summary.action}</span></span>
            <span className={styles.plan}>{newIds.has(summary.id) ? <em className={styles.fresh}>new</em> : null}{plan}{summary.late ? <em className={styles.late}>late</em> : null}</span>
            <span className={styles.markout} data-sign={markout === null ? undefined : markout > 0 ? "pos" : markout < 0 ? "neg" : "flat"} title={markout === null ? `No ${horizon} tick markout recorded` : `${horizon} tick bias-signed return`}>{markout === null ? "n/a" : fmtBps(markout).replace(" bps", "")}</span>
          </div>;
        })}
      </div>)}
      {status === "empty" ? <p className={styles.state}>No decisions recorded yet.</p> : null}
      {status === "error" || status === "expired" ? <div className={styles.state}><p role="alert">{status === "expired" ? "Session expired." : error ?? "Could not load decision history."}</p><button type="button" className={styles.button} onClick={retry}>Retry</button></div> : null}
      {summaries.length > 0 && nextBefore !== null ? <button className={styles.more} type="button" disabled={loadingMore} onClick={loadOlder}>{loadingMore ? "Loading" : "Load older"}</button> : null}
      {summaries.length > 0 && nextBefore === null && status !== "loading" ? <p className={styles.state}>End of recorded history.</p> : null}
    </div>
  </section>;
}
