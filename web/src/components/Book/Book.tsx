"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { BlockEvent, Meta, PricePoint, SleeveMeta } from "@/lib/types";
import { closedLots, tapeFills } from "@/lib/fills";
import { roePct } from "@/lib/pnl";
import { displayCoin, fmtClock, fmtCoin, fmtPct, fmtPrice, fmtSignedUsd, fmtUsd, shortTx, txUrl } from "@/lib/format";
import { useColumnWidths, useDragSize } from "@/lib/useResizable";
import { Bone } from "@/components/Skeleton/Skeleton";
import styles from "./Book.module.css";

type Tab = "positions" | "trades" | "history";

const TRADE_CAP = 200;

function fmtSize(size: number): string {
  if (size > 0 && size < 0.01) {
    return size.toLocaleString("en-US", { maximumFractionDigits: 5, minimumFractionDigits: 3 });
  }
  return size.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** A table whose header cells can be dragged to resize. Double click a handle to reset. */
function Table({ id, cols, children }: { id: string; cols: string[]; children: ReactNode }) {
  const { widths, startResize, nudge, reset } = useColumnWidths(`jev-trade:cols:${id}:v1`, cols.length);
  const fixed = widths.some((w) => w != null);
  return (
    <table className={styles.table} style={fixed ? { tableLayout: "fixed", width: "auto" } : undefined}>
      <colgroup>
        {cols.map((c, i) => (
          <col key={c} style={widths[i] != null ? { width: widths[i]! } : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {cols.map((c, i) => (
            <th key={c}>
              <span className={styles.thLabel}>{c}</span>
              <span
                className={styles.colHandle}
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label={`Resize ${c} column`}
                aria-valuemin={40}
                aria-valuenow={widths[i] ?? undefined}
                title="Drag or use arrow keys to resize, double click or Escape to reset"
                onPointerDown={(e) => startResize(i, e)}
                onDoubleClick={reset}
                onKeyDown={(e) => {
                  const th = e.currentTarget.parentElement;
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault();
                    nudge(i, (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 64 : 16), th);
                  } else if (e.key === "Escape") {
                    reset();
                  }
                }}
              />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function SkeletonRows({ n, cols }: { n: number; cols: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <tr key={i} className={styles.skelRow}>
          {Array.from({ length: cols }, (_, j) => (
            <td key={j}>
              <Bone w={36 + ((i + j) % 3) * 12} h={10} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function FilterIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M1 2h14l-5.5 6.5V14l-3-1.5V8.5z" fill="currentColor" />
    </svg>
  );
}

const POS_COLS = ["Market", "Side", "Size", "Entry", "Mark", "Value", "Unrealized", "ROE", "Lev"];
const HIST_COLS = ["Time", "Market", "Side", "Size", "Entry", "Exit", "PnL", "Fee"];
const LANE_COLS = ["Time", "Side", "Size", "PnL"];
const TRADE_COLS = ["Time", "Market", "Side", "Action", "Price", "Size", "Fee", "PnL", "Tx"];

export default function Book({
  sleeves,
  latestByCoin,
  tapeByCoin,
  selected,
  meta,
  onSelect,
  onNeedMoreTape,
  waiting = false,
}: {
  sleeves: SleeveMeta[];
  latestByCoin: Record<string, BlockEvent | null>;
  tapeByCoin: Record<string, PricePoint[]>;
  selected: string;
  meta?: Meta | null;
  onSelect: (coin: string) => void;
  onNeedMoreTape?: () => void;
  waiting?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("positions");
  const [allMarkets, setAllMarkets] = useState(true);
  const pane = useDragSize(
    "jev-trade:book-height:v1",
    220,
    120,
    () => (typeof window === "undefined" ? 600 : Math.round(window.innerHeight * 0.7)),
    -1,
  );

  const lotsByCoin = useMemo(() => {
    // Summaries use every closed lot; only the rendered rows are capped.
    const out: Record<string, { rows: (ReturnType<typeof closedLots>[number] & { coin: string })[]; count: number; pnl: number }> = {};
    for (const sleeve of sleeves) {
      const all = closedLots(tapeFills(tapeByCoin[sleeve.coin] ?? []))
        .map((lot) => ({ ...lot, coin: sleeve.coin }))
        .sort((a, b) => b.ts - a.ts);
      out[sleeve.coin] = { rows: all.slice(0, TRADE_CAP), count: all.length, pnl: all.reduce((s, l) => s + l.pnl, 0) };
    }
    return out;
  }, [sleeves, tapeByCoin]);

  const trades = useMemo(() => {
    const rows = [];
    for (const sleeve of sleeves) {
      if (!allMarkets && sleeve.coin !== selected) continue;
      for (const fill of tapeFills(tapeByCoin[sleeve.coin] ?? [])) rows.push({ ...fill, coin: sleeve.coin });
    }
    rows.sort((a, b) => b.ts - a.ts);
    return rows.slice(0, TRADE_CAP);
  }, [allMarkets, selected, sleeves, tapeByCoin]);

  const history = allMarkets ? [] : lotsByCoin[selected]?.rows ?? [];
  const anyLots = Object.values(lotsByCoin).some((lane) => lane.count > 0);
  const filterable = tab === "trades" || tab === "history";

  const tabButton = (id: Tab, label: string) => (
    <button
      type="button"
      className={tab === id ? styles.tabOn : styles.tab}
      role="tab"
      aria-selected={tab === id}
      onClick={() => {
        setTab(id);
        if (id !== "positions") onNeedMoreTape?.();
      }}
    >
      {label}
    </button>
  );

  return (
    <section className={styles.wrap} style={{ "--book-h": `${pane.size}px` } as React.CSSProperties}>
      <div
        className={styles.divider}
        role="separator"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label="Resize bottom pane"
        aria-valuemin={pane.min}
        aria-valuemax={pane.max}
        aria-valuenow={pane.size}
        title="Drag or use arrow keys to resize"
        onPointerDown={(e) => pane.startDrag(e, "y")}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            pane.nudge((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 64 : 16));
          }
        }}
      />
      <div className={styles.tabs}>
        <div role="tablist" aria-label="Account book" className={styles.tabList}>
          {tabButton("positions", "Positions")}
          {tabButton("trades", "Trades")}
          {tabButton("history", "History")}
        </div>
        {filterable ? (
          <span className={styles.scope} role="group" aria-label="Market filter" title="Filter by market">
            <FilterIcon />
            <button
              type="button"
              className={allMarkets ? styles.scopeOn : styles.scopeBtn}
              aria-pressed={allMarkets}
              onClick={() => setAllMarkets(true)}
            >
              All
            </button>
            <button
              type="button"
              className={allMarkets ? styles.scopeBtn : styles.scopeOn}
              aria-pressed={!allMarkets}
              onClick={() => setAllMarkets(false)}
            >
              {displayCoin(selected)}
            </button>
          </span>
        ) : null}
        {tab === "trades" ? <span className={styles.hint}>every fill Jev&apos;s orders got</span> : null}
      </div>

      {tab === "positions" ? (
        <div className={styles.scroller}>
          <Table id="positions" cols={POS_COLS}>
            {waiting && sleeves.length === 0 ? (
              <SkeletonRows n={5} cols={POS_COLS.length} />
            ) : (
              sleeves.map((sleeve) => {
                const latest = latestByCoin[sleeve.coin] ?? null;
                const pos = latest?.position;
                const open = Boolean(pos && pos.side !== "flat" && pos.size > 0);
                const mark = latest?.mid ?? null;
                const value = open && mark != null ? pos!.size * mark : null;
                const u = open ? pos!.unrealizedUsd : 0;
                const roe = roePct(pos);
                const side = (pos?.side ?? "flat").toUpperCase();
                const sideColor =
                  pos?.side === "long" ? "var(--buy-ink)" : pos?.side === "short" ? "var(--sell-ink)" : undefined;
                const pnlColor = open ? (u >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)") : undefined;
                return (
                  <tr
                    key={sleeve.coin}
                    className={sleeve.coin === selected ? styles.rowOn : undefined}
                    onClick={() => onSelect(sleeve.coin)}
                  >
                    <td>{displayCoin(sleeve.coin)}</td>
                    <td style={sideColor ? { color: sideColor } : undefined}>{side}</td>
                    <td>{open ? fmtCoin(pos!.size, sleeve.coin, 4) : "-"}</td>
                    <td>{open && pos?.entryPrice != null ? fmtPrice(pos.entryPrice) : "-"}</td>
                    <td>{mark != null ? fmtPrice(mark) : "-"}</td>
                    <td>{value != null ? fmtPrice(value) : "-"}</td>
                    <td style={pnlColor ? { color: pnlColor } : undefined}>{open ? fmtSignedUsd(u, 2) : "-"}</td>
                    <td style={pnlColor ? { color: pnlColor } : undefined}>{roe != null ? fmtPct(roe) : "-"}</td>
                    <td>{pos?.leverage != null ? `${pos.leverage}x` : "-"}</td>
                  </tr>
                );
              })
            )}
          </Table>
        </div>
      ) : tab === "history" ? (
        allMarkets ? (
          waiting && !anyLots ? (
            <div className={styles.scroller} aria-busy="true" aria-label="Loading history">
              <Table id="history" cols={HIST_COLS}>
                <SkeletonRows n={6} cols={HIST_COLS.length} />
              </Table>
            </div>
          ) : (
            <div className={styles.lanes} style={{ gridTemplateColumns: `repeat(${Math.max(1, sleeves.length)}, minmax(220px, 1fr))` }}>
              {sleeves.map((sleeve) => {
                const lane = lotsByCoin[sleeve.coin] ?? { rows: [], count: 0, pnl: 0 };
                const lots = lane.rows;
                const total = lane.pnl;
                return (
                  <div key={sleeve.coin} className={`${styles.lane}${sleeve.coin === selected ? ` ${styles.laneOn}` : ""}`}>
                    <button type="button" className={styles.laneHead} onClick={() => onSelect(sleeve.coin)}>
                      <span>{displayCoin(sleeve.coin)}</span>
                      <span style={{ color: lane.count ? (total >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)") : undefined }}>
                        {lane.count ? `${lane.count} lots ${fmtSignedUsd(total, 2)}` : "no closed lots"}
                      </span>
                    </button>
                    <div className={styles.scroller}>
                      {lots.length ? (
                        <Table id={`history-lane-${sleeve.coin}`} cols={LANE_COLS}>
                          {lots.map((lot) => (
                            <tr key={lot.key} onClick={() => onSelect(lot.coin)}>
                              <td>{fmtClock(lot.ts, true)}</td>
                              <td style={{ color: lot.side === "long" ? "var(--buy-ink)" : "var(--sell-ink)" }}>{lot.side.toUpperCase()}</td>
                              <td>{fmtSize(lot.size)}</td>
                              <td style={{ color: lot.pnl >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)" }}>{fmtSignedUsd(lot.pnl, 2)}</td>
                            </tr>
                          ))}
                        </Table>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : history.length === 0 ? (
          <div className={styles.empty}>no closed lots yet</div>
        ) : (
          <div className={styles.scroller}>
            <Table id="history" cols={HIST_COLS}>
              {history.map((lot) => {
                const pnlColor = lot.pnl >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)";
                return (
                  <tr key={`${lot.coin}|${lot.key}`} onClick={() => onSelect(lot.coin)}>
                    <td>{fmtClock(lot.ts, true)}</td>
                    <td>{displayCoin(lot.coin)}</td>
                    <td style={{ color: lot.side === "long" ? "var(--buy-ink)" : "var(--sell-ink)" }}>{lot.side.toUpperCase()}</td>
                    <td>{fmtSize(lot.size)}</td>
                    <td>{lot.entry != null ? fmtPrice(lot.entry) : "-"}</td>
                    <td>{fmtPrice(lot.exit)}</td>
                    <td style={{ color: pnlColor }}>{fmtSignedUsd(lot.pnl, 2)}</td>
                    <td>{lot.fee ? fmtUsd(lot.fee, 2) : "-"}</td>
                  </tr>
                );
              })}
            </Table>
          </div>
        )
      ) : waiting && trades.length === 0 ? (
        <div className={styles.scroller} aria-busy="true" aria-label="Loading trades">
          <Table id="trades" cols={TRADE_COLS}>
            <SkeletonRows n={6} cols={TRADE_COLS.length} />
          </Table>
        </div>
      ) : trades.length === 0 ? (
        <div className={styles.empty}>no trades yet</div>
      ) : (
        <div className={styles.scroller}>
          <Table id="trades" cols={TRADE_COLS}>
            {trades.map((fill) => {
              const sideColor = fill.side === "buy" ? "var(--buy-ink)" : "var(--sell-ink)";
              const action = fill.dir === "open" ? "OPEN" : fill.dir === "close" ? "CLOSE" : fill.dir === "flip" ? "FLIP" : "FILL";
              const pnl = typeof fill.closedPnl === "number" && fill.dir !== "open" ? fill.closedPnl : null;
              return (
                <tr key={`${fill.coin}|${fill.key}`} onClick={() => onSelect(fill.coin)}>
                  <td>{fmtClock(fill.ts, true)}</td>
                  <td>{displayCoin(fill.coin)}</td>
                  <td style={{ color: sideColor }}>{fill.side.toUpperCase()}</td>
                  <td style={{ color: sideColor }}>{action}</td>
                  <td>{fmtPrice(fill.price)}</td>
                  <td>{fmtSize(fill.size)}</td>
                  <td>{fill.feeUsd ? fmtUsd(fill.feeUsd, 4) : "-"}</td>
                  <td style={pnl != null ? { color: pnl >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)" } : undefined}>
                    {pnl != null ? fmtSignedUsd(pnl, 2) : "-"}
                  </td>
                  <td>
                    {fill.hash ? (
                      <a href={txUrl(fill.hash, meta?.explorerTx)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        {shortTx(fill.hash)}
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        </div>
      )}
    </section>
  );
}
