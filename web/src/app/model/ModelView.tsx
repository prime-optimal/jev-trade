"use client";

import Header from "@/components/Header/Header";
import { useSettings } from "@/lib/trading/SettingsProvider";
import { useDecisions } from "@/lib/useDecisions";
import DecisionDetail from "./DecisionDetail";
import DecisionsTable from "./DecisionsTable";
import styles from "./model.module.css";

export default function ModelView() {
  const { feed } = useSettings();
  const history = useDecisions();
  return <div className={styles.page}>
    <Header connection={feed.connection} balance={null} unrealized={null} realized={null} />
    <main className={styles.main}>
      <header className={styles.intro}>
        <div><p className={styles.eyebrow}>Decisions</p><h1>Model</h1><p>Browse recorded Jev decisions and their outcomes.</p></div>
        <button type="button" className={styles.refresh} onClick={history.refresh}>Refresh</button>
      </header>
      <div className={styles.layout}>
        <DecisionsTable {...history} />
        <DecisionDetail row={history.rows.find((row) => row.decisionId === history.selectedId) ?? null} />
      </div>
    </main>
  </div>;
}
