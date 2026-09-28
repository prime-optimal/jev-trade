import InputCard from "./InputCard";
import { fmtBps, fmtNumber, fmtPx, numberValue, objectValue, signOf as sign, stringValue, tone, type CapturedFeature, type Horizon, type Markout } from "./record";
import styles from "./inputs.module.css";

type Feature = CapturedFeature | undefined;
type Level = { price: number; size: number };

export function PriceCard({ mid, spread, imbalance, returns, mids, indicators, markouts }: { mid: Feature; spread: Feature; imbalance: Feature; returns: Feature; mids: Feature; indicators: Feature; markouts: Partial<Record<Horizon, Markout>> }) {
  const price = numberValue(mid?.value);
  const series = (stringValue(mids?.value) ?? "").trim().split(/\s+/).map(Number).filter((value) => Number.isFinite(value) && value > 0);
  const after = ([1, 5, 20] as const).flatMap((horizon) => {
    const observed = markouts[horizon]?.observedMid ?? null;
    return observed === null ? [] : [{ horizon, mid: observed }];
  });
  const averages = objectValue(indicators?.value);
  const lines = [
    { key: "sma20", name: "SMA 20", value: numberValue(averages?.sma20) },
    { key: "sma50", name: "SMA 50", value: numberValue(averages?.sma50) },
    { key: "ema20", name: "EMA 20", value: numberValue(averages?.ema20) },
  ].filter((line): line is { key: string; name: string; value: number } => line.value !== null);
  const returnValues = objectValue(returns?.value) ?? {};
  return <InputCard title="Price" features={[mid, spread, imbalance, returns, mids]} wide>
    <div className={styles.priceHead}>
      <p className={styles.bigValue}>{price !== null ? fmtPx(price) : "n/a"}<span>mid</span></p>
      <p><strong>{fmtNumber(numberValue(spread?.value))}</strong> bps spread</p>
      <p><strong data-sign={sign(numberValue(imbalance?.value))}>{fmtNumber(numberValue(imbalance?.value), 3)}</strong> book imbalance</p>
    </div>
    {series.length > 1 ? <Sparkline series={series} after={after} lines={lines} /> : <p className={styles.note}>No recent mids captured.</p>}
    <dl className={styles.returns}>{Object.entries(returnValues).map(([key, value]) => {
      const bps = numberValue(value);
      return <div key={key}><dt>{key.replace("last", "")} tick{key === "last1" ? "" : "s"}</dt><dd data-sign={sign(bps)}>{fmtBps(bps, 2)}</dd></div>;
    })}</dl>
  </InputCard>;
}

function Sparkline({ series, after, lines }: { series: number[]; after: { horizon: number; mid: number }[]; lines: { key: string; name: string; value: number }[] }) {
  const last = series.length - 1;
  const span = last + (after.at(-1)?.horizon ?? 0);
  const domain = [...series, ...after.map((point) => point.mid), ...lines.map((line) => line.value)];
  const low = Math.min(...domain), high = Math.max(...domain);
  const pad = (high - low) * 0.08 || 1;
  const x = (index: number) => index / span * 600;
  const y = (value: number) => 160 - (value - low + pad) / (high - low + pad * 2) * 160;
  const path = series.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  return <figure className={styles.spark}>
    <div className={styles.sparkPlot}>
      <svg viewBox="0 0 600 160" preserveAspectRatio="none" role="img" aria-label={`${series.length} recent mids from ${fmtPx(series[0])} to ${fmtPx(series[last])}${after.length ? `, then ${after.map((point) => `${fmtPx(point.mid)} after ${point.horizon} ticks`).join(", ")}` : ""}`}>
        {after.length ? <rect className={styles.afterZone} x={x(last)} y={0} width={600 - x(last)} height={160} /> : null}
        {lines.map((line) => <line key={line.key} className={styles.average} data-line={line.key} x1={0} x2={600} y1={y(line.value)} y2={y(line.value)} vectorEffect="non-scaling-stroke" />)}
        <polyline className={styles.mids} points={path} vectorEffect="non-scaling-stroke" />
        {after.length ? <polyline className={styles.afterPath} points={[`${x(last)},${y(series[last]!)}`, ...after.map((point) => `${x(last + point.horizon)},${y(point.mid)}`)].join(" ")} vectorEffect="non-scaling-stroke" /> : null}
        <line className={styles.dot} x1={x(last)} x2={x(last)} y1={y(series[last]!)} y2={y(series[last]!)} vectorEffect="non-scaling-stroke" />
        {after.map((point) => <line key={point.horizon} className={styles.afterDot} x1={x(last + point.horizon)} x2={x(last + point.horizon)} y1={y(point.mid)} y2={y(point.mid)} vectorEffect="non-scaling-stroke" />)}
      </svg>
      <span className={styles.axisHigh}>{fmtPx(high)}</span><span className={styles.axisLow}>{fmtPx(low)}</span>
    </div>
    <figcaption className={styles.legend}>
      <span data-line="mids">{series.length} mids</span>
      {lines.map((line) => <span key={line.key} data-line={line.key}>{line.name} {fmtPx(line.value)}</span>)}
      {after.length ? <span data-line="after">after decision</span> : null}
    </figcaption>
  </figure>;
}

function levels(value: unknown): Level[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const [price, size] = typeof item === "string" ? item.split(/\s+x\s+/).map(Number) : [];
    return price !== undefined && size !== undefined && Number.isFinite(price) && Number.isFinite(size) ? [{ price, size }] : [];
  });
}

export function BookCard({ book, spread, mid }: { book: Feature; spread: Feature; mid: Feature }) {
  const record = objectValue(book?.value);
  const asks = levels(record?.asks).sort((a, b) => a.price - b.price).slice(0, 5).reverse();
  const bids = levels(record?.bids).sort((a, b) => b.price - a.price).slice(0, 5);
  const peak = Math.max(0, ...asks.map((level) => level.size), ...bids.map((level) => level.size));
  const row = (level: Level, side: "sell" | "buy") => <li key={`${side}-${level.price}`} data-side={side}>
    <span className={styles.levelBar} aria-hidden="true" style={{ width: `${peak ? level.size / peak * 100 : 0}%` }} />
    <span>{fmtPx(level.price)}</span><span>{fmtNumber(level.size, 4)}</span>
  </li>;
  return <InputCard title="Order book" features={[book]}>
    {asks.length || bids.length ? <ol className={styles.ladder} aria-label="Top of book, asks above bids">
      <li className={styles.ladderHead} aria-hidden="true"><span>Price</span><span>Size</span></li>
      {asks.map((level) => row(level, "sell"))}
      <li className={styles.spreadRow}><span>{fmtPx(numberValue(mid?.value))} mid</span><span>{fmtNumber(numberValue(spread?.value))} bps</span></li>
      {bids.map((level) => row(level, "buy"))}
    </ol> : <p className={styles.note}>No book levels captured.</p>}
  </InputCard>;
}

export function DepthCard({ depth, imbalance }: { depth: Feature; imbalance: Feature }) {
  const bands = Object.entries(objectValue(depth?.value) ?? {}).flatMap(([band, sides]) => {
    const side = objectValue(sides);
    const bid = numberValue(side?.bid), ask = numberValue(side?.ask);
    return bid === null || ask === null ? [] : [{ band: Number(band), bid, ask }];
  }).sort((a, b) => a.band - b.band);
  const peak = Math.max(0, ...bands.flatMap((band) => [band.bid, band.ask]));
  return <InputCard title="Depth" features={[depth]}>
    {bands.length ? <div className={styles.depth}>
      <p className={styles.depthHead} aria-hidden="true"><span>Bid size</span><span>Within</span><span>Ask size</span></p>
      {bands.map((band) => <div key={band.band} className={styles.depthRow}>
        <span className={styles.depthSide} data-side="buy"><span>{fmtNumber(band.bid)}</span><span className={styles.depthBar} style={{ width: `${peak ? band.bid / peak * 100 : 0}%` }} /></span>
        <span className={styles.depthBand}>{band.band} bps</span>
        <span className={styles.depthSide} data-side="sell"><span className={styles.depthBar} style={{ width: `${peak ? band.ask / peak * 100 : 0}%` }} /><span>{fmtNumber(band.ask)}</span></span>
      </div>)}
      <p className={styles.note}>Top of book imbalance {fmtNumber(numberValue(imbalance?.value), 3)}</p>
    </div> : <p className={styles.note}>No depth bands captured.</p>}
  </InputCard>;
}

export function FlowCard({ trades }: { trades: Feature }) {
  const flow = objectValue(trades?.value);
  if (!flow) return <InputCard title="Taker flow" features={[trades]}><p className={styles.note}>No trade summary captured.</p></InputCard>;
  const buy = numberValue(flow.buySz) ?? 0, sell = numberValue(flow.sellSz) ?? 0;
  const total = buy + sell;
  const cvd = numberValue(flow.cvdSz);
  const lastSide = stringValue(flow.lastSide);
  return <InputCard title="Taker flow" features={[trades]}>
    <div className={styles.split} role="img" aria-label={`Taker buys ${fmtNumber(buy, 4)}, taker sells ${fmtNumber(sell, 4)}`}>
      <span data-side="buy" style={{ flexGrow: total ? buy / total : 1 }} /><span data-side="sell" style={{ flexGrow: total ? sell / total : 1 }} />
    </div>
    <p className={styles.splitLabels}><span data-side="buy">Buys {fmtNumber(buy, 4)}</span><span data-side="sell">Sells {fmtNumber(sell, 4)}</span></p>
    <dl className={styles.stats}>
      <div><dt>Net size</dt><dd data-sign={sign(cvd)}>{cvd !== null && cvd > 0 ? "+" : ""}{fmtNumber(cvd, 4)}</dd></div>
      <div><dt>Trades</dt><dd>{fmtNumber(numberValue(flow.count), 0)}</dd></div>
      <div><dt>VWAP</dt><dd>{fmtPx(numberValue(flow.vwap))}</dd></div>
      <div><dt>Last</dt><dd><span data-tone={tone(lastSide)}>{lastSide ?? "n/a"}</span> {fmtPx(numberValue(flow.lastPrice))}</dd></div>
    </dl>
  </InputCard>;
}

export function PrintsCard({ prints, tick }: { prints: Feature; tick: Feature }) {
  const now = numberValue(tick?.value);
  const rows = (Array.isArray(prints?.value) ? prints.value : []).flatMap((item) => {
    const match = typeof item === "string" ? /^(\d+)\s+(buy|sell)\s+([\d.]+)\s+@\s+([\d.]+)$/i.exec(item.trim()) : null;
    return match ? [{ block: Number(match[1]), side: match[2]!.toLowerCase(), size: Number(match[3]), price: Number(match[4]) }] : [];
  });
  const peak = Math.max(0, ...rows.map((row) => row.size));
  return <InputCard title="Recent prints" features={[prints]}>
    {rows.length ? <ol className={styles.prints}>
      {rows.map((row, index) => <li key={index} data-side={row.side}>
        <span className={styles.printAge}>{now !== null ? now === row.block ? "this tick" : `${now - row.block}t ago` : row.block}</span>
        <span className={styles.printSide}>{row.side}</span>
        <span className={styles.printSize}><span className={styles.levelBar} aria-hidden="true" style={{ width: `${peak ? row.size / peak * 100 : 0}%` }} /><span>{fmtNumber(row.size, 4)}</span></span>
        <span>{fmtPx(row.price)}</span>
      </li>)}
    </ol> : <p className={styles.note}>No prints captured.</p>}
  </InputCard>;
}
