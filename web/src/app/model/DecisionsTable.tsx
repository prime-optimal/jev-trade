"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Bone } from "@/components/Skeleton/Skeleton";
import type { DecisionRow } from "@/lib/journal-types";
import type { DecisionHistoryStatus } from "@/lib/useDecisions";
import styles from "./model.module.css";

type Props = {
  rows: DecisionRow[];
  selectedId: string | null;
  select: (id: string) => void;
  status: DecisionHistoryStatus;
  error: string | null;
  nextBefore: string | null;
  loadingMore: boolean;
  loadOlder: () => void;
  retry: () => void;
};

export default function DecisionsTable({ rows, selectedId, select, status, error, nextBefore, loadingMore, loadOlder, retry }: Props) {
  const tableRef = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const selected = tableRef.current?.querySelector<HTMLElement>(`[data-decision-id="${CSS.escape(selectedId ?? "")}"]`);
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  function moveSelection(event: KeyboardEvent<HTMLTableRowElement>, index: number) {
    if (!rows.length) return;
    const targetIndex = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : event.key === "ArrowUp" ? Math.max(0, index - 1) : event.key === "ArrowDown" ? Math.min(rows.length - 1, index + 1) : -1;
    if (targetIndex < 0) return;
    event.preventDefault();
    select(rows[targetIndex]!.decisionId);
    tableRef.current?.querySelector<HTMLElement>(`[data-index="${targetIndex}"]`)?.focus();
  }

  return <section className={styles.tablePanel} aria-label="Decisions history">
    <div className={styles.tableScroll}>
      <table className={styles.table} ref={tableRef}>
        <thead><tr><th scope="col">Time</th><th scope="col">Asset</th><th scope="col">Decision ID</th><th scope="col">Revision</th><th scope="col">Decision</th></tr></thead>
        <tbody>
          {status === "loading" && rows.length === 0 ? Array.from({ length: 6 }, (_, index) => <tr className={styles.skeletonRow} key={index}><td><Bone w="92px" /></td><td><Bone w="45px" /></td><td><Bone w="80px" /></td><td><Bone w="60px" /></td><td><Bone w="48px" /></td></tr>) : null}
          {rows.map((row, index) => {
            const envelope = objectValue(row.decision);
            const decision = objectValue(envelope && "decision" in envelope ? envelope.decision : row.decision);
            const action = typeof decision?.action === "string" ? decision.action.toLowerCase() : row.decision === null || envelope !== null && "decision" in envelope && envelope.decision === null ? "no decision" : "unavailable";
            const capturedCoin = row.evidence?.capture?.groups?.find((group) => typeof group.state.coin === "string")?.state.coin;
            const coin = typeof envelope?.coin === "string" ? envelope.coin : typeof envelope?.market === "string" ? envelope.market : typeof decision?.coin === "string" ? decision.coin : typeof decision?.market === "string" ? decision.market : typeof capturedCoin === "string" ? capturedCoin : "unavailable";
            const revision = row.recordType === "legacy"
              ? typeof decision?.promptRevision === "string" ? decision.promptRevision : "unavailable"
              : row.programMetadata === "available" && typeof row.evidence?.capture?.revision === "string" ? row.evidence.capture.revision : "unavailable";
            const selected = row.decisionId === selectedId;
            return <tr key={row.decisionId} data-decision-id={row.decisionId} data-index={index} aria-selected={selected} tabIndex={selected || (selectedId === null && index === 0) ? 0 : -1} className={selected ? styles.selectedRow : undefined} onClick={() => select(row.decisionId)} onKeyDown={(event) => moveSelection(event, index)}>
              <td>{new Date(row.createdAt).toLocaleString()}</td><td>{coin}</td><td title={row.decisionId}>{truncate(row.decisionId)}</td><td title={revision}>{revision}</td><td>{action}</td>
            </tr>;
          })}
          {status === "empty" ? <tr><td className={styles.stateCell} colSpan={5}>No decisions recorded yet.</td></tr> : null}
          {status === "error" || status === "expired" ? <tr><td className={styles.stateCell} colSpan={5}><p role="alert">{status === "expired" ? "Session expired." : error ?? "Could not load decision history."}</p><button type="button" onClick={retry}>Retry</button></td></tr> : null}
        </tbody>
      </table>
    </div>
    {rows.length > 0 && nextBefore !== null ? <button className={styles.loadButton} type="button" disabled={loadingMore} onClick={loadOlder}>{loadingMore ? "Loading" : "Load older"}</button> : null}
    {rows.length > 0 && nextBefore === null && status !== "loading" ? <p className={styles.endMarker}>End of recorded history.</p> : null}
  </section>;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function truncate(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}
