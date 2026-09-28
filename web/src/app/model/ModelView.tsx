"use client";

import { useMemo, useState } from "react";
import Header from "@/components/Header/Header";
import { useSettings } from "@/lib/trading/SettingsProvider";
import { useDecisions } from "@/lib/useDecisions";
import DecisionRail from "./DecisionRail";
import Performance from "./Performance";
import RailFilters, { NoMatchingDecisions } from "./RailFilters";
import RecordView from "./RecordView";
import Timeline from "./Timeline";
import { applyFilters, DEFAULT_FILTERS, listCoins, type RailFilter } from "./filters";
import { summarize, type Horizon } from "./record";
import performanceStyles from "./performance.module.css";
import styles from "./model.module.css";

export default function ModelView() {
  const { feed } = useSettings();
  const history = useDecisions();
  const [horizon, setHorizon] = useState<Horizon>(5);
  const [view, setView] = useState<"decisions" | "performance">("decisions");
  const [filters, setFilters] = useState<RailFilter>(DEFAULT_FILTERS);
  const summaries = useMemo(() => history.rows.map(summarize), [history.rows]);
  const filteredSummaries = useMemo(() => applyFilters(summaries, filters, horizon), [summaries, filters, horizon]);
  const coins = useMemo(() => listCoins(summaries), [summaries]);
  const selectedSummary = filteredSummaries.find((summary) => summary.id === history.selectedId) ?? filteredSummaries[0] ?? null;
  const selectedRow = selectedSummary ? history.rows.find((row) => row.decisionId === selectedSummary.id) ?? null : null;
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
        <Timeline summaries={filteredSummaries} selectedId={selectedSummary?.id ?? null} select={history.select} horizon={horizon} setHorizon={setHorizon} />
        <RailFilters filters={filters} coins={coins} horizon={horizon} onChange={setFilters} />
        <div className={styles.body}>
          {noMatches ? <NoMatchingDecisions clear={() => setFilters(DEFAULT_FILTERS)} /> : <>
            <DecisionRail summaries={filteredSummaries} selectedId={selectedSummary?.id ?? null} select={history.select} horizon={horizon} status={history.status} error={history.error}
              nextBefore={history.nextBefore} loadingMore={history.loadingMore} loadOlder={history.loadOlder} retry={history.retry} />
            <RecordView row={selectedRow} summary={selectedSummary} horizon={horizon} />
          </>}
        </div>
      </>}
    </main>
  </div>;
}
