"use client";

import { DEFAULT_FILTERS, filtersActive, type RailFilter } from "./filters";
import type { Action, Horizon } from "./record";
import TokenIcon from "@/components/TokenIcon/TokenIcon";
import styles from "./railfilters.module.css";

const CALLS: { action: Action; label: string }[] = [
  { action: "buy", label: "Buy" },
  { action: "sell", label: "Sell" },
  { action: "hold", label: "Hold" },
  { action: "no decision", label: "No decision" },
];

export default function RailFilters({ filters, coins, horizon, onChange }: {
  filters: RailFilter;
  coins: string[];
  horizon: Horizon;
  onChange: (filters: RailFilter) => void;
}) {
  function toggleCall(action: Action) {
    onChange({ ...filters, calls: filters.calls.includes(action) ? filters.calls.filter((value) => value !== action) : [...filters.calls, action] });
  }

  function toggleCoin(coin: string) {
    onChange({ ...filters, coins: filters.coins.includes(coin) ? filters.coins.filter((value) => value !== coin) : [...filters.coins, coin] });
  }

  return <section className={styles.filters} aria-label="Decision filters">
    <div className={styles.group} role="group" aria-label="Call">
      <span className={styles.label}>Call</span>
      {CALLS.map(({ action, label }) => <button key={action} type="button" aria-pressed={filters.calls.includes(action)} onClick={() => toggleCall(action)}>{label}</button>)}
    </div>
    <div className={styles.group} role="group" aria-label="Decision status">
      <span className={styles.label}>Status</span>
      <button type="button" aria-pressed={filters.late} onClick={() => onChange({ ...filters, late: !filters.late })}>Late only</button>
      <button type="button" aria-pressed={filters.invalid} onClick={() => onChange({ ...filters, invalid: !filters.invalid })}>Invalid or failed</button>
    </div>
    <div className={styles.group} role="group" aria-label={`Outcome at ${horizon} ticks`}>
      <span className={styles.label}>{horizon} tick outcome</span>
      {(["right", "wrong"] as const).map((outcome) => <button key={outcome} type="button" aria-pressed={filters.outcome === outcome} onClick={() => onChange({ ...filters, outcome: filters.outcome === outcome ? null : outcome })}>{outcome === "right" ? "Right" : "Wrong"}</button>)}
    </div>
    {coins.length ? <div className={styles.group} role="group" aria-label="Coin">
      <span className={styles.label}>Coin</span>
      {coins.map((coin) => <button key={coin} type="button" aria-pressed={filters.coins.includes(coin)} onClick={() => toggleCoin(coin)}><TokenIcon coin={coin} size={14} />{coin}</button>)}
    </div> : null}
    {filtersActive(filters) ? <button className={styles.clear} type="button" onClick={() => onChange(DEFAULT_FILTERS)}>Clear filters</button> : null}
  </section>;
}

export function NoMatchingDecisions({ clear }: { clear: () => void }) {
  return <div className={styles.noMatches}>
    <p>No decisions match these filters.</p>
    <button className={styles.clear} type="button" onClick={clear}>Clear filters</button>
  </div>;
}
