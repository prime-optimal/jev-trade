"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Header from "@/components/Header/Header";
import { useSettings } from "@/lib/trading/SettingsProvider";
import { useDecisionRecord } from "@/lib/useDecisionRecord";
import { useDecisions } from "@/lib/useDecisions";
import { useModelUrlState } from "@/lib/useModelUrlState";
import DecisionRail from "./DecisionRail";
import Performance from "./Performance";
import RailFilters, { NoMatchingDecisions } from "./RailFilters";
import RecordView from "./RecordView";
import Timeline from "./Timeline";
import { applyFilters, DEFAULT_FILTERS, listCoins, type RailFilter } from "./filters";
import { summarize } from "./record";
import performanceStyles from "./performance.module.css";
import styles from "./model.module.css";

export default function ModelView() {
  const { feed } = useSettings();
  const urlState = useModelUrlState();
  let liveSignal = "";
  for (const coin in feed.byCoin) {
    const latest = feed.byCoin[coin]?.events.at(-1);
    if (latest) liveSignal += `${coin}:${latest.block}:${latest.ts};`;
  }
  const history = useDecisions({ initialSelectedId: urlState.decisionId, liveSignal });
  const previousDecisionId = useRef(urlState.decisionId);
  useEffect(() => {
    if (urlState.decisionId !== null) {
      if (history.selectedId !== urlState.decisionId) history.select(urlState.decisionId);
    } else if (previousDecisionId.current !== null || history.selectedId === null) {
      if (history.rows[0] && history.selectedId !== history.rows[0].decisionId) {
        history.select(history.rows[0].decisionId);
      }
    }
    previousDecisionId.current = urlState.decisionId;
  }, [history.rows, history.selectedId, history.select, urlState.decisionId]);
  const [view, setView] = useState<"decisions" | "performance">("decisions");
  const [filters, setFilters] = useState<RailFilter>(DEFAULT_FILTERS);
  const summaries = useMemo(() => history.rows.map(summarize), [history.rows]);
  const filteredSummaries = useMemo(() => applyFilters(summaries, filters, urlState.horizon), [summaries, filters, urlState.horizon]);
  const coins = useMemo(() => listCoins(summaries), [summaries]);
  const selectedId = urlState.decisionId ?? history.selectedId;
  const missing = urlState.decisionId !== null
    && !history.rows.some((row) => row.decisionId === urlState.decisionId)
    && history.status !== "loading";
  const linked = useDecisionRecord(urlState.decisionId, missing);
  const selectedSummary = urlState.decisionId !== null
    ? summaries.find((summary) => summary.id === urlState.decisionId) ?? (linked.row ? summarize(linked.row) : null)
    : filteredSummaries.find((summary) => summary.id === selectedId) ?? filteredSummaries[0] ?? null;
  const selectedRow = selectedSummary
    ? history.rows.find((row) => row.decisionId === selectedSummary.id)
      ?? (linked.row?.decisionId === selectedSummary.id ? linked.row : null)
    : null;
  const noMatches = summaries.length > 0 && filteredSummaries.length === 0;
  return <div className={styles.page}>
    <Header connection={feed.connection} balance={null} unrealized={null} realized={null} />
    <main className={`${styles.main} ${view === "performance" ? styles.performanceMain : ""}`}>
      <header className={styles.toolbar}>
        <h1>Model</h1>
        <p>Every recorded Jev decision, what it saw, and what happened next.</p>
        <div className={performanceStyles.switch} role="group" aria-label="Model view">
          <button type="button" aria-pressed={view === "decisions"} onClick={() => setView("decisions")}>Decisions</button>
          <button type="button" aria-pressed={view === "performance"} onClick={() => setView("performance")}>Performance</button>
        </div>
        <button type="button" className={styles.refresh} onClick={history.refresh}>Refresh</button>
      </header>
      {view === "performance" ? <Performance summaries={summaries} canLoadOlder={history.nextBefore !== null} loadingMore={history.loadingMore} loadOlder={history.loadOlder} /> : <>
        <Timeline summaries={filteredSummaries} selectedId={selectedSummary?.id ?? null} select={urlState.setDecision} horizon={urlState.horizon} setHorizon={urlState.setHorizon} />
        <RailFilters filters={filters} coins={coins} horizon={urlState.horizon} onChange={setFilters} />
        <div className={styles.body}>
          {noMatches && urlState.decisionId === null ? <NoMatchingDecisions clear={() => setFilters(DEFAULT_FILTERS)} /> : <>
            {noMatches ? <NoMatchingDecisions clear={() => setFilters(DEFAULT_FILTERS)} /> : (
              <DecisionRail summaries={filteredSummaries} selectedId={selectedSummary?.id ?? null} select={urlState.setDecision} horizon={urlState.horizon} status={history.status} error={history.error}
                newIds={history.newIds} nextBefore={history.nextBefore} loadingMore={history.loadingMore} loadOlder={history.loadOlder} retry={history.retry} />
            )}
            {linked.status === "not-found" ? (
              <section className={styles.recordState} role="alert"><p>Decision not found for this account.</p></section>
            ) : linked.status === "error" ? (
              <section className={styles.recordState}><p role="alert">Could not load the linked decision record.</p><button type="button" className={styles.refresh} onClick={linked.retry}>Retry</button></section>
            ) : linked.status === "loading" && missing ? (
              <section className={styles.recordState}><p>Loading decision record.</p></section>
            ) : (
              <RecordView row={selectedRow} summary={selectedSummary} horizon={urlState.horizon} />
            )}
          </>}
        </div>
      </>}
    </main>
  </div>;
}
