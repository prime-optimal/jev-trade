import { fmtSignedUsd, fmtUsd, shortTx, txUrl } from "@/lib/format";
import { fmtBps, fmtNumber, fmtPx, HORIZONS, signOf, tone, type DecisionSummary } from "./record";
import styles from "./record.module.css";

export default function Execution({ summary }: { summary: DecisionSummary }) {
  const { quote, fills } = summary;
  return <>
    <section className={styles.panel} aria-label="Execution">
      <h3>Order</h3>
      {quote ? <div className={styles.order}>
        <p className={styles.orderLine}><span data-tone={tone(quote.side)}>{quote.side ?? "side not recorded"}</span> {fmtNumber(quote.size, 5)} @ {fmtPx(quote.price)}</p>
        <p className={styles.tags}>
          {quote.status ? <span>{quote.status === "sim" ? "simulated" : quote.status}</span> : null}
          {quote.taker !== null ? <span>{quote.taker ? "taker" : "maker"}</span> : null}
          {quote.capped ? <span>size capped</span> : null}
          {quote.reduceOnly ? <span>reduce only</span> : null}
        </p>
        <p className={styles.meta}>{quote.orderId !== null ? `Order ${quote.orderId}` : "No order id"}{quote.txHash ? <>, <a href={txUrl(quote.txHash)} target="_blank" rel="noreferrer">tx {shortTx(quote.txHash)}</a></> : null}</p>
      </div> : <p className={styles.meta}>{summary.action === "hold" ? "Hold. No order placed." : "No order recorded."}</p>}
      {fills.length ? <ol className={styles.fills} aria-label="Fills">{fills.map((fill, index) => <li key={`${fill.id ?? "fill"}-${index}`}>
        <span><span data-tone={tone(fill.side)}>{fill.side ?? "fill"}</span> {fmtNumber(fill.size, 5)} @ {fmtPx(fill.price)}</span>
        <span className={styles.meta}>{[fill.dir, fill.simulated ? "simulated" : null, fill.feeUsd !== null ? `fee ${fmtUsd(fill.feeUsd)}` : null].filter(Boolean).join(", ")}</span>
        {fill.closedPnl !== null ? <span data-sign={signOf(fill.closedPnl)}>{fmtSignedUsd(fill.closedPnl)} closed</span> : null}
      </li>)}</ol> : quote ? <p className={styles.meta}>No fills recorded.</p> : null}
    </section>
    <Outcome summary={summary} />
  </>;
}

function Outcome({ summary }: { summary: DecisionSummary }) {
  const values = HORIZONS.flatMap((horizon) => [summary.markouts[horizon]?.signedBps ?? null, summary.markouts[horizon]?.marketBps ?? null]);
  const scale = Math.max(1, ...values.filter((value): value is number => value !== null).map(Math.abs));
  return <section className={styles.panel} aria-label="Outcome">
    <h3>Outcome</h3>
    <p className={styles.pnl}><strong data-sign={signOf(summary.closedPnl)}>{summary.closedPnl !== null ? fmtSignedUsd(summary.closedPnl) : "n/a"}</strong> closed PnL from recorded fills</p>
    <div className={styles.markouts} role="img" aria-label={HORIZONS.map((horizon) => `${horizon} ticks: ${summary.markouts[horizon] ? `${fmtBps(summary.markouts[horizon]!.signedBps)} for the call, market ${fmtBps(summary.markouts[horizon]!.marketBps)}` : "pending"}`).join("; ")}>
      {HORIZONS.map((horizon) => {
        const markout = summary.markouts[horizon];
        const bars = [{ key: "signed", value: markout?.signedBps ?? null }, { key: "market", value: markout?.marketBps ?? null }];
        return <div key={horizon} className={styles.markout}>
          <div className={styles.markoutPlot} aria-hidden="true">{markout ? bars.map((bar) => bar.value === null ? null : <span key={bar.key} data-bar={bar.key} data-sign={signOf(bar.value)}
            style={{ height: `${Math.max(2, Math.abs(bar.value) / scale * 50)}%`, top: bar.value > 0 ? `${50 - Math.abs(bar.value) / scale * 50}%` : "50%" }} />) : null}</div>
          <p><b>{horizon}t</b></p>
          <p data-sign={signOf(markout?.signedBps ?? null)}>{markout ? fmtBps(markout.signedBps).replace(" bps", "") : "pending"}</p>
          <p className={styles.meta}>{markout ? `mkt ${fmtBps(markout.marketBps).replace(" bps", "")}` : ""}</p>
        </div>;
      })}
    </div>
    <p className={styles.legend}><span data-bar="signed">Call, signed by bias</span><span data-bar="market">Market move</span><span data-bar="unit">in bps</span></p>
  </section>;
}
