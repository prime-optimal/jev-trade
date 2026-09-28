import { fmtSignedUsd, fmtUsd } from "@/lib/format";
import InputCard from "./InputCard";
import { fmtBps, fmtNumber, fmtPx, numberValue, objectValue, signOf as sign, stringValue, tone, type CapturedFeature } from "./record";
import styles from "./inputs.module.css";

type Feature = CapturedFeature | undefined;

export function IndicatorsCard({ indicators, mid }: { indicators: Feature; mid: Feature }) {
  const values = objectValue(indicators?.value);
  if (!values) return <InputCard title="Indicators" features={[indicators]}><p className={styles.note}>Not captured for this decision.</p></InputCard>;
  const rsi = numberValue(values.rsi14);
  const range = numberValue(values.rangePos20);
  const low = numberValue(values.low20), high = numberValue(values.high20);
  const rsiState = rsi === null ? "not captured" : rsi >= 70 ? "overbought" : rsi <= 30 ? "oversold" : "neutral";
  const averages = [
    { name: "SMA 20", price: numberValue(values.sma20), distance: numberValue(values.midVsSma20Bps) },
    { name: "SMA 50", price: numberValue(values.sma50), distance: numberValue(values.midVsSma50Bps) },
    { name: "EMA 20", price: numberValue(values.ema20), distance: null },
  ];
  const midPrice = numberValue(mid?.value);
  return <InputCard title="Indicators" features={[indicators]}>
    <div className={styles.gauge}>
      <p><strong>{rsi !== null ? rsi.toFixed(1) : "n/a"}</strong> RSI 14, {rsiState}</p>
      <span className={styles.gaugeTrack} aria-hidden="true">
        <span className={styles.gaugeZone} style={{ left: 0, width: "30%" }} /><span className={styles.gaugeZone} style={{ left: "70%", width: "30%" }} />
        {rsi !== null ? <span className={styles.gaugeMark} style={{ left: `${Math.min(100, Math.max(0, rsi))}%` }} /> : null}
      </span>
      <span className={styles.gaugeScale} aria-hidden="true"><span>0</span><span>30</span><span>70</span><span>100</span></span>
    </div>
    <div className={styles.gauge}>
      <p><strong>{range !== null ? `${Math.round(range * 100)}%` : "n/a"}</strong> of 20 candle range</p>
      <span className={styles.gaugeTrack} aria-hidden="true">{range !== null ? <span className={styles.gaugeMark} style={{ left: `${Math.min(1, Math.max(0, range)) * 100}%` }} /> : null}</span>
      <span className={styles.gaugeScale} aria-hidden="true"><span>{fmtPx(low)} low</span><span>high {fmtPx(high)}</span></span>
    </div>
    <table className={styles.table}>
      <thead><tr><th scope="col">Average</th><th scope="col">Price</th><th scope="col">Mid vs</th></tr></thead>
      <tbody>{averages.map((average) => {
        const distance = average.distance ?? (average.price !== null && midPrice !== null ? (midPrice / average.price - 1) * 10_000 : null);
        return <tr key={average.name}><th scope="row">{average.name}</th><td>{fmtPx(average.price)}</td><td data-sign={sign(distance)}>{fmtBps(distance)}</td></tr>;
      })}</tbody>
    </table>
    <p className={styles.note}>Volatility {fmtBps(numberValue(values.vol20Bps), 2).replace("+", "")} over 20 candles</p>
  </InputCard>;
}

export function VenueCard({ asset, maxLeverage }: { asset: Feature; maxLeverage: Feature }) {
  const venue = objectValue(asset?.value);
  const leverage = numberValue(maxLeverage?.value) ?? numberValue(venue?.maxLeverage);
  if (!venue) return <InputCard title="Venue" features={[asset, maxLeverage]}><p className={styles.note}>Not captured for this decision.</p></InputCard>;
  const mark = numberValue(venue.markPx), oracle = numberValue(venue.oraclePx);
  const funding = numberValue(venue.fundingBps), premium = numberValue(venue.premiumBps), change = numberValue(venue.dayChangeBps);
  const volume = numberValue(venue.dayNtlVlmUsd);
  return <InputCard title="Venue" features={[asset, maxLeverage]}>
    <dl className={styles.stats}>
      <div><dt>Mark</dt><dd>{fmtPx(mark)}</dd></div>
      <div><dt>Oracle</dt><dd>{fmtPx(oracle)}</dd></div>
      <div><dt>Funding</dt><dd data-sign={sign(funding)}>{fmtBps(funding, 4)}</dd></div>
      <div><dt>Premium</dt><dd data-sign={sign(premium)}>{fmtBps(premium, 2)}</dd></div>
      <div><dt>Day change</dt><dd data-sign={sign(change)}>{fmtBps(change, 1)}</dd></div>
      <div><dt>Day volume</dt><dd>{volume !== null ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(volume) : "n/a"}</dd></div>
      <div><dt>Open interest</dt><dd>{fmtNumber(numberValue(venue.openInterest))}</dd></div>
      <div><dt>Max leverage</dt><dd>{leverage !== null ? `${leverage}x` : "n/a"}</dd></div>
    </dl>
  </InputCard>;
}

export function PositionCard({ position, coin }: { position: Feature; coin: string | null }) {
  const held = objectValue(position?.value);
  const side = stringValue(held?.side);
  const size = numberValue(held?.size);
  const unrealized = numberValue(held?.unrealizedUsd);
  const distance = numberValue(held?.distanceBps);
  return <InputCard title="Position going in" features={[position]}>
    {!held || side === null || side === "flat" || !size ? <p className={styles.bigValue}>Flat<span>no open position</span></p> : <>
      <p className={styles.bigValue} data-tone={tone(side)}>{side}<span>{fmtNumber(size, 5)} {stringValue(held.coin) ?? coin ?? ""}{numberValue(held.leverage) !== null ? ` at ${numberValue(held.leverage)}x` : ""}</span></p>
      <dl className={styles.stats}>
        <div><dt>Entry</dt><dd>{fmtPx(numberValue(held.entry))}</dd></div>
        <div><dt>Notional</dt><dd>{numberValue(held.notionalUsd) !== null ? fmtUsd(numberValue(held.notionalUsd), 2) : "n/a"}</dd></div>
        <div><dt>Mid vs entry</dt><dd>{fmtBps(distance, 2)}</dd></div>
        <div><dt>Unrealized</dt><dd data-sign={sign(unrealized)}>{unrealized !== null ? fmtSignedUsd(unrealized) : "n/a"}</dd></div>
        <div><dt>Liquidation</dt><dd>{fmtPx(numberValue(held.liquidationPx))}</dd></div>
      </dl>
    </>}
  </InputCard>;
}
