"use client";

import { useMemo, useState } from "react";
import Header from "@/components/Header/Header";
import { useSettings } from "@/lib/trading/SettingsProvider";
import { useDecisions } from "@/lib/useDecisions";
import DecisionRail from "./DecisionRail";
import RecordView from "./RecordView";
import Timeline from "./Timeline";
import { summarize, type Horizon } from "./record";
import styles from "./model.module.css";

export default function ModelView() {
  const { feed } = useSettings();
  const history = useDecisions();
  const [horizon, setHorizon] = useState<Horizon>(5);
  const summaries = useMemo(() => history.rows.map(summarize), [history.rows]);
  const selectedRow = history.rows.find((row) => row.decisionId === history.selectedId) ?? null;
  const selectedSummary = summaries.find((summary) => summary.id === history.selectedId) ?? null;
  return <div className={styles.page}>
    <Header connection={feed.connection} balance={null} unrealized={null} realized={null} />
    <main className={styles.main}>
      <header className={styles.toolbar}>
        <h1>Model</h1>
        <p>Every recorded Jev decision, what it saw, and what happened next.</p>
        <button type="button" className={styles.refresh} onClick={history.refresh}>Refresh</button>
      </header>
      <Timeline summaries={summaries} selectedId={history.selectedId} select={history.select} horizon={horizon} setHorizon={setHorizon} />
      <div className={styles.body}>
        <DecisionRail summaries={summaries} selectedId={history.selectedId} select={history.select} horizon={horizon} status={history.status} error={history.error}
          nextBefore={history.nextBefore} loadingMore={history.loadingMore} loadOlder={history.loadOlder} retry={history.retry} />
        <RecordView row={selectedRow} summary={selectedSummary} horizon={horizon} />
      </div>
    </main>
  </div>;
}
