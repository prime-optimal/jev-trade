"use client";

import { useState } from "react";
import { displayCoin, fmtClock, fmtPrice, fmtSignedUsd } from "@/lib/format";
import { useSettings } from "@/lib/trading/SettingsProvider";
import styles from "./Book.module.css";

const TABS = ["positions", "fills", "orders", "history"] as const;
type Tab = typeof TABS[number];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
function numeric(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export default function Book({ selected, onSelect }: { selected: string; onSelect: (coin: string) => void }) {
  const { wallet, account, fills, session, settings } = useSettings();
  const [tab, setTab] = useState<Tab>("positions");
  const positions = account ? Object.entries(account.positions).filter(([, position]) => position.size !== 0) : [];
  const journal = session?.orders ?? [];
  const orders = tab === "orders" ? journal.filter((order) => ["pending", "open", "unknown"].includes(order.state)) : journal;
  const market = (coin: string) => <button type="button" className={styles.scopeBtn} aria-pressed={selected === coin} onClick={() => onSelect(coin)}>{displayCoin(coin)}{settings.enabledCoins.some((enabled) => enabled === coin) ? "" : " (disabled)"}</button>;
  const labels: Record<Tab, string> = { positions: "Account positions", fills: "Account fills", orders: "Session orders", history: "Session history" };

  return <section className={styles.wrap}>
    <div className={styles.tabs} role="tablist" aria-label="Account and session book">
      {TABS.map((item, index) => <button key={item} id={`book-tab-${item}`} type="button" role="tab" aria-selected={tab === item} aria-controls={`book-panel-${item}`} tabIndex={tab === item ? 0 : -1} className={tab === item ? styles.tabOn : styles.tab} onClick={() => setTab(item)} onKeyDown={(event) => {
        const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
        if (next === null) return;
        event.preventDefault(); setTab(TABS[next]); document.getElementById(`book-tab-${TABS[next]}`)?.focus();
      }}>{labels[item]}</button>)}
    </div>
    <div role="tabpanel" id={`book-panel-${tab}`} aria-labelledby={`book-tab-${tab}`} tabIndex={0} className={styles.scroller}>
      {!wallet.connected ? <p className={styles.empty}>Connect Brave Wallet to view account data. No session is running.</p> : tab === "positions" ? positions.length === 0 ? <p className={styles.empty}>{account ? "No open account positions." : "Waiting for an account snapshot."}</p> : <table className={styles.table}>
        <thead><tr><th>Market</th><th>Side</th><th>Size</th><th>Entry</th><th>Unrealized</th><th>Leverage</th></tr></thead>
        <tbody>{positions.map(([coin, position]) => <tr key={coin}><td>{market(coin)}</td><td>{position.size > 0 ? "LONG" : "SHORT"}</td><td>{Math.abs(position.size)}</td><td>{fmtPrice(position.entryPrice)}</td><td>{fmtSignedUsd(position.unrealizedUsd, 2)}</td><td>{position.leverage}x</td></tr>)}</tbody>
      </table> : tab === "fills" ? fills.length === 0 ? <p className={styles.empty}>No account fills received.</p> : <table className={styles.table}>
        <thead><tr><th>Time</th><th>Market</th><th>Side</th><th>Price</th><th>Size</th></tr></thead>
        <tbody>{fills.map((value, index) => { const fill = record(value); const coin = typeof fill.coin === "string" ? fill.coin : ""; const time = numeric(fill.time); const price = numeric(fill.px); const size = numeric(fill.sz); return <tr key={typeof fill.tid === "number" ? fill.tid : index}><td>{time === null ? "-" : fmtClock(time, true)}</td><td>{coin ? market(coin) : "-"}</td><td>{fill.side === "B" ? "BUY" : fill.side === "A" ? "SELL" : "-"}</td><td>{price === null ? "-" : fmtPrice(price)}</td><td>{size ?? "-"}</td></tr>; })}</tbody>
      </table> : orders.length === 0 ? <p className={styles.empty}>No {tab === "orders" ? "open session orders" : "session order history"}.</p> : <table className={styles.table}>
        <thead><tr><th>Submitted</th><th>Market</th><th>Status</th><th>Cleanup</th></tr></thead>
        <tbody>{orders.map((order) => <tr key={order.cloid}><td>{fmtClock(order.submittedAt, true)}</td><td>{market(order.coin)}</td><td>{order.state}</td><td>{order.cancelPending ? "Cancellation pending" : "-"}</td></tr>)}</tbody>
      </table>}
    </div>
    <p className={styles.empty}>Positions and fills cover the whole account. Orders and history belong to this browser session. Stop cancels app-owned orders only; it does not close positions or revoke wallet approval.</p>
  </section>;
}
