import type { Metadata } from "next";
import Link from "next/link";
import HelpShell from "./HelpShell";
import styles from "./help.module.css";

export const metadata: Metadata = {
  title: "Help | Jev Trade",
  description: "What Jev sees, how every model input is calculated, and how to read its decisions and outcomes.",
  alternates: { canonical: "/help" },
};

const repo = "https://github.com/prime-optimal/jev-trade/blob/main/";
const sections = [
  ["pipeline", "Data pipeline"], ["identity", "Identity and timing"], ["price", "Price and returns"],
  ["book", "Order book"], ["tape", "Public trades"], ["position", "Position"],
  ["indicators", "Indicators"], ["asset", "Asset context"], ["freshness", "Freshness"],
  ["questions", "Questions"], ["revision", "Program revision"], ["privacy", "Sent and not sent"],
  ["outcomes", "Price vs outcome"], ["boundaries", "Boundaries"], ["sources", "Sources"],
] as const;

type Field = readonly [string, string];
const fieldAnchors: Record<string, true> = {
  coin: true, market: true, tick: true, tickMs: true, mid: true, spreadBps: true,
  returnsBps: true, recentMids: true, bookImbalance: true, depth: true, book: true, recentTrades: true,
};
function Fields({ rows }: { rows: readonly Field[] }) {
  return <dl className={styles.fields}>{rows.map(([name, description]) => <div key={name} id={fieldAnchors[name] ? `feature-${name}` : undefined}>
    <dt><code>{name}</code></dt><dd>{description}</dd>
  </div>)}</dl>;
}
function Source({ files }: { files: string[] }) {
  return <p className={styles.source}>Source: {files.map((file, index) => <span key={file}>
    {index > 0 ? ", " : ""}<a href={`${repo}${file}`}>{file}</a>
  </span>)}</p>;
}

export default function HelpPage() {
  return <HelpShell><main className={styles.page}>
    <header className={styles.intro}>
      <p className={styles.eyebrow}>Jev model reference</p>
      <h1>Help</h1>
      <p>Jev makes the buy, sell, or hold call from market evidence on every decision tick. This guide explains every input, the questions it answers, and what the recorded results do and do not mean.</p>
      <p><Link href="/model">Review captured decisions in Model</Link> or <Link href="/settings">configure your session in Settings</Link>. A sleeve is the bot&apos;s separate trading state for one asset.</p>
    </header>
    <nav className={styles.contents} aria-label="Help topics">{sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>

    <section id="pipeline" className={styles.section}>
      <h2>Data pipeline</h2>
      <ol>
        <li>Hyperliquid supplies public order books, taker trades, candles, and asset context. A live sleeve also reads its current position from the venue; paper sleeves simulate positions locally.</li>
        <li>While Running, the bot samples its current state on each decision tick. Book messages and an interval both trigger the tick gate; ticks are at least <code>tickMs</code> apart. The tick loop waits for the first usable book.</li>
        <li>The bot calculates the fields below. It captures the active immutable program, selected feature values, resolved questions, and program revision once, before any provider request can wait. Every group on that tick uses this same capture.</li>
        <li>Jev answers the required questions. The projection normalizes those answers into a decision. The executor handles orders separately, and history joins the decision, quote, fills, and later market returns by a decision UUID.</li>
      </ol>
      <p>The default program selects 17 top-level inputs in one <code>trade</code> group. All 17 keys exist in its captured state. Missing data appears as nullable nested fields, zeros, or empty collections, not a missing top-level input. A custom group receives only its selected inputs. Book levels are copied with a five-level limit per side; recent prints with a ten-entry limit.</p>
      <Source files={["src/trader.ts", "src/feed.ts", "src/jev-program.ts", "src/jev-features.ts"]} />
    </section>

    <section id="identity" className={styles.section}>
      <h2>Identity and timing</h2>
      <p>These four inputs are always available and labeled <code>tick</code> freshness. They come from bot configuration and the sleeve counter, not an exchange timestamp.</p>
      <Fields rows={[
        ["coin", "String asset identifier used in Hyperliquid calls, such as BTC or ETH. Fixed per sleeve; never null."],
        ["market", "String bot-side label constructed as coin-USD. Fixed per sleeve; never null. This pair label is not sent to Hyperliquid."],
        ["tick", "Numeric sleeve decision sequence number, incremented by the feed tick gate. Units: decision ticks, not exchange blocks. Never null."],
        ["tickMs", "Configured interval between evaluations, in milliseconds. Fixed for the run. It is not a clock reading or time of day; never null."],
      ]} />
      <Source files={["src/sleeves.ts", "src/feed.ts", "src/config.ts", "src/trader.ts"]} />
    </section>

    <section id="price" className={styles.section}>
      <h2>Price and returns</h2>
      <p>The price source is Hyperliquid <code>l2Book</code>: a fast WebSocket subscription, an HTTP snapshot at connect, and HTTP fallback every <code>fallbackMs</code> (default 30,000 ms) only while the socket is not open. The bot samples the latest received book once per tick. The exchange&apos;s own push frequency is not verified. These inputs have <code>tick</code> freshness, not a verified age.</p>
      <Fields rows={[
        ["mid", "USD midpoint: (bestBid + bestAsk) / 2, without rounding. Always a number after the first usable book. Invalid crossed books retain the previous book. A missing side can produce a synthetic midpoint; see Order book."],
        ["spreadBps", "(bestAsk - bestBid) / mid * 10,000, rounded to two decimals. Units: basis points (1 bps = 0.01%). Never null. About 5 bps when one book side is synthesized."],
        ["returnsBps", "Object with last1, last5, last20, and last100: (currentMid - midFromKTicksAgo) / midFromKTicksAgo * 10,000, rounded to two decimals. Each window uses the sleeve's own per-tick samples, including this tick. Each value is 0, not null, until more than K samples exist. New sleeve initialization starts an empty history; at most 400 mids are retained."],
        ["recentMids", "Space-separated USD mids from the last horizonBlocks ticks (default 100, setting range 20 to 400). Keeps the newest and every fifth earlier sample, oldest first, formatted to six decimals. Up to 20 values at the default. Starts with one value on the first tick and is never empty."],
      ]} />
      <p>A 100-tick window has a nominal duration of <code>100 * tickMs</code>, not 100 exchange blocks. Tick delays can make elapsed wall time longer. Repeated samples of an unchanged or old book can still produce zero returns.</p>
      <Source files={["src/book.ts", "src/feed.ts", "src/trader.ts"]} />
    </section>

    <section id="book" className={styles.section}>
      <h2>Order book</h2>
      <p>All book inputs use the same <code>l2Book</code> source and cadence as <a href="#price">mid</a>, with <code>tick</code> freshness. Sizes are base-coin units, not USD notionals. Calculations use all received valid levels, not the five displayed levels alone.</p>
      <Fields rows={[
        ["bookImbalance", "(bidSize - askSize) / (bidSize + askSize) across received levels within 100 bps of mid, rounded to three decimals. Ratio from -1 to 1; 0 when both sums are zero. It is not top-of-book imbalance."],
        ["depth", "Object with three cumulative distance bands keyed 10, 25, and 50. Each holds bid and ask size inside that many bps of mid, rounded to one decimal in base units. The 50 band includes 25, which includes 10. No received-level count cap is applied to these sums. Thin books give small or zero sizes, not missing bands."],
        ["book", "Object with bids and asks arrays, best first, at most five levels per side. Each string is price x size: USD price to six decimals and base size to one decimal. Arrays can be shorter than five. Sizes below 0.05 can appear as 0 after rounding, especially for high-priced assets."],
      ]} />
      <p className={styles.notice}>Synthetic-side caveat: non-positive prices and sizes are filtered. If one side is empty, the bot invents one level 5 bps beyond the other side&apos;s best price and copies its size. That level affects mid, spread, imbalance, all three depth bands, and the displayed book. It is not a real resting order. It sits about 2.5 bps from mid and counts in every band. A book with ask at or below bid is rejected, retaining the previous book.</p>
      <p>Older journal rows can contain <code>depth: {"{}"}</code> because the builder and extractor formerly disagreed on band keys. Those records remain unchanged; current captures use all three bands.</p>
      <Source files={["src/book.ts", "src/trader.ts", "src/jev-features.ts"]} />
    </section>

    <section id="tape" className={styles.section}>
      <h2 id="feature-trades">Public trade tape</h2>
      <p>Source: WebSocket <code>trades</code>, plus HTTP <code>recentTrades</code> at connect and during fallback. Prints are de-duplicated by trade ID and retained in a ring of the newest 500. The exchange&apos;s push frequency is not verified. Both inputs have <code>tick</code> freshness.</p>
      <Fields rows={[
        ["trades.count", "Number of taker prints whose arrival tick is greater than tick - horizonBlocks. Units: print count. Zero with no prints or no attached tape feed."],
        ["trades.buySz / trades.sellSz", "Summed taker buy and sell size in base-coin units over that window, without rounding. A venue side of B is a taker buy; any other side is treated as a taker sell. Both are zero for an empty window."],
        ["trades.cvdSz", "Taker buy size minus taker sell size, in base-coin units, without rounding. This is a windowed size delta, not a lifetime accumulator. Zero for an empty window."],
        ["trades.vwap", "Sum of trade price times size divided by total size, in USD, without rounding. Null for an empty window."],
        ["trades.lastPrice / trades.lastSide", "USD price and taker side of the newest print in the summary window, without price rounding. Both null for an empty window."],
        ["recentTrades", "Array of up to ten newest ring prints, oldest first, not restricted to the summary's horizonBlocks window. Each string is tick side size @ price, with size to one decimal and USD price to six. Tick means the bot tick at arrival, not exchange time. Empty array before any prints; small sizes can round to 0."],
      ]} />
      <p>A busy market can fill the 500-print ring before the full lookback window ends. The summary then covers less than the requested history. A last print in <code>recentTrades</code> can be outside the summary window.</p>
      <Source files={["src/trades.ts", "src/feed.ts", "src/trader.ts"]} />
    </section>

    <section id="position" className={styles.section}>
      <h2 id="feature-position">Current sleeve position</h2>
      <p><code>position</code> is an object with <code>unknown</code> freshness. It describes the position going into the decision, after the bot harvests prior fills and before it places the new order.</p>
      <Fields rows={[
        ["position.coin / position.side", "Asset identifier and long, short, or flat from the sign of the sleeve's signed size."],
        ["position.size", "Absolute position size in base units, rounded to eight decimals. Zero while flat."],
        ["position.notionalUsd", "Absolute size * current book mid, rounded to four decimals in USD. Bot-calculated, not a venue account value."],
        ["position.entry", "Average entry price in USD while open; null while flat."],
        ["position.leverage", "Current leverage multiplier. Null in paper mode. Live: the last venue-reported leverage value, or the value the bot most recently set after a successful updateLeverage call until the next account update. A flat live sleeve can retain its previous leverage. The account parser reads leverage.value without checking its type."],
        ["position.liquidationPx", "Venue liquidation price in USD while open. Null while flat and always null in paper mode."],
        ["position.distanceBps", "(mid - entry) / entry * 10,000. Signed price distance from entry, not distance to liquidation and not signed to the long or short stance. Null while flat."],
        ["position.unrealizedUsd", "Unrealized PnL in USD while long or short; omitted entirely while flat. Live: Hyperliquid unrealizedPnl. Paper: signed position size * (mid - entry). It is current position PnL, not lifetime PnL."],
      ]} />
      <h3>Live source</h3>
      <p>A wallet-backed sleeve uses WebSocket and HTTP <code>clearinghouseState</code>. Refreshes happen at initialization, every fifth tick, and after fills. The bot copies signed size from <code>szi</code>, entry from <code>entryPx</code>, PnL from <code>unrealizedPnl</code>, leverage from <code>leverage.value</code>, and liquidation from <code>liquidationPx</code>. Fills do not directly update the position while a venue account exists. Until the first account response lands, the captured position is the empty simulated position, which is flat.</p>
      <h3>Paper source</h3>
      <p>No wallet means no account subscription or account refresh. Simulated fills update signed size and cost basis; entry is cost divided by signed size. Maker entries fill only when a later public taker print crosses their limit. Exits are immediate simulated taker fills at the exit price. Pending post-only quotes can be replaced or canceled on later ticks, so a decision to open does not guarantee a position.</p>
      <Source files={["src/account.ts", "src/market.ts", "src/trader.ts", "src/jev-features.ts"]} />
    </section>

    <section id="indicators" className={styles.section}>
      <h2 id="feature-indicators">One-minute indicators</h2>
      <p><code>indicators</code> is always an object, with nullable fields and <code>unknown</code> freshness. The bot uses the last 80 one-minute closes, oldest first, including the still-forming candle. HTTP <code>candleSnapshot</code> loads 5,000 minutes of 1m candles and seven days of 15m candles at connect; only the 1m closes feed these indicators. WebSocket <code>candle</code> updates the forming 1m candle continuously. Every output is rounded to six decimals.</p>
      <Fields rows={[
        ["indicators.sma20 / indicators.sma50", "Simple average of the last 20 or 50 one-minute closes, in USD. Null with fewer than 20 or 50 closes respectively."],
        ["indicators.ema20", "20-period exponential moving average in USD. Seeds with the mean of the first 20 available closes in the 80-close slice, then updates over the rest. Null with fewer than 20 closes."],
        ["indicators.midVsSma20Bps / indicators.midVsSma50Bps", "(current book mid - SMA) / SMA * 10,000. Basis points against the respective candle-derived average. Null until that SMA exists."],
        ["indicators.rsi14", "Relative strength index on the last 14 close differences, using plain average gains and losses, not Wilder smoothing. Unitless scale from 0 to 100. Needs 15 closes; otherwise null. Returns 50 with no movement and 100 with no losses."],
        ["indicators.vol20Bps", "Sample standard deviation of the last 20 close-to-close log returns, multiplied by 10,000. Units: bps. Needs 21 closes; otherwise null. Not annualized volatility."],
        ["indicators.high20 / indicators.low20", "Highest and lowest close of the last 20 closes, in USD, not candle wick highs and lows. Null with fewer than 20 closes."],
        ["indicators.rangePos20", "(newest close - low20) / (high20 - low20), a ratio from 0 to 1. Uses the newest candle close, not the current book mid. Returns 0.5 for a flat range; null with fewer than 20 closes."],
      ]} />
      <p>If the startup candle request fails, the fields can stay null until WebSocket candles build sufficient history. A forming candle can change these values within the minute. A decision-tick return and a one-minute candle return are different windows.</p>
      <Source files={["src/chart.ts", "src/feed.ts", "src/indicators.ts", "src/market.ts"]} />
    </section>

    <section id="asset" className={styles.section}>
      <h2 id="feature-asset">Hyperliquid asset context and leverage limit</h2>
      <p><code>asset</code> is always an object, with nullable context fields and <code>unknown</code> freshness. Source: WebSocket <code>activeAssetCtx</code> plus HTTP <code>metaAndAssetCtxs</code> at connect and during fallback. Each new context replaces the previous one. Venue push frequency is not verified. All seven context values below are rounded to six decimals; they are null before context arrives, when the coin is absent, or when a field is omitted or nonnumeric.</p>
      <Fields rows={[
        ["asset.markPx / asset.oraclePx", "Venue mark and oracle price in USD, passed through from context before rounding. Neither is the book midpoint."],
        ["asset.fundingBps", "Venue funding value * 10,000. Displayed in bps; the context's funding period and economic interpretation are not independently verified by this implementation."],
        ["asset.premiumBps", "Venue premium value * 10,000. Displayed in bps; the raw context's units follow Hyperliquid and are not independently verified here."],
        ["asset.openInterest", "Context openInterest, passed through before rounding. Its venue unit definition is not independently verified here; do not assume this is a USD notional."],
        ["asset.dayNtlVlmUsd", "Context dayNtlVlm: rolling daily notional volume in USD, passed through before rounding."],
        ["asset.dayChangeBps", "(current book mid - context prevDayPx) / prevDayPx * 10,000. Basis points versus the previous day price. Uses mid, not markPx."],
        ["asset.maxLeverage / maxLeverage", "Same non-null maximum leverage multiplier in both places. Source: HTTP meta universe[].maxLeverage, memoized once per process and read at sleeve initialization. A finite value of at least 1 is floored to an integer. If metadata fails or the coin is absent, the fallback is 50x. The payload does not identify that fallback. Catalog freshness is unknown."],
      ]} />
      <p id="feature-maxLeverage"><code>maxLeverage</code> builds the allowed cross-leverage choices offered to Jev. It is a venue-limit input, not a guarantee that any chosen order will be accepted.</p>
      <Source files={["src/indicators.ts", "src/feed.ts", "src/market.ts", "src/hyperliquid.ts", "src/plan.ts"]} />
    </section>

    <section id="freshness" className={styles.section}>
      <h2>What freshness means</h2>
      <p><code>tick</code> means the input was read from the bot&apos;s state at capture. It does not certify that the exchange data was recently updated. No model input contains an age, timestamp, or staleness flag, and the book tick loop has no book-age check.</p>
      <p><code>unknown</code> means the catalog cannot establish the source age. Position, indicators, asset context, and max leverage use this label. Their latest updates arrive on separate schedules. Model shows &quot;age unknown&quot; when an input card includes one of them.</p>
      <p>The snapshot&apos;s <code>capturedAt</code> is the bot clock when the group was captured, not the exchange observation time of each value. HTTP fallback is not a freshness guarantee: a socket that remains open without fresh messages does not activate the disconnected-socket book fallback.</p>
      <Source files={["src/jev-evidence.ts", "src/jev-features.ts", "src/feed.ts"]} />
    </section>

    <section id="questions" className={styles.section}>
      <h2>Questions Jev answers</h2>
      <Fields rows={[
        ["Bias: long or short?", "The required bias question chooses long or short for this asset. Its resolved instructions include market, tickMs, and the current position stance from the same capture."],
        ["Intent: open, close, or hold?", "While flat, choices are open or hold. With a position, choices are open, close, or hold. The question includes the captured side, size, entry, and configured tick interval. Hold is Jev's answer, not code skipping an evaluation."],
        ["Leverage: which cross-leverage rung?", "The required leverage question offers the rungs allowed by the captured venue maximum. Instructions include current leverage (or unset), maximum leverage, and the allowed values. It chooses a multiplier, not an order size."],
      ]} />
      <p>These are independent choice questions in the default <code>trade</code> group, all using the same state. The projection consumes only required answers and derives the wire action from bias and intent. The program defines what the answers mean; the executor handles order placement separately.</p>
      <h3>Observational questions</h3>
      <p>Extra questions can be assigned an observational role or group to explore market hypotheses without changing trading. An omitted role defaults to observational. Choice, score, boolean, and noul question types are defined by the program and checked against provider support. Their completions are recorded separately, possibly later, under the same decision UUID and revision. They cannot change or suppress the required decision.</p>
      <h3>Readable, invalid, and failed answers</h3>
      <p><code>complete</code> means the required answers were readable and valid, including a valid hold. <code>invalid</code> means a required answer was missing or invalid; the result is a safe hold with invalid evidence. <code>failed</code> means the required provider group failed or timed out; an evaluation is recorded with no decision and no order. A late result is a separate execution condition, not an evaluation status or a hold answer.</p>
      <p>Confidence is shown only when a provider supplies a finite value from 0 through 1. It is not inferred from probabilities. Optional probabilities must use declared labels and finite values in that range. For gateway boolean answers, probability means P(true), not confidence. Bounded raw answer evidence is capped at 4,096 bytes.</p>
      <Source files={["src/jev-program.ts", "src/plan.ts", "src/jev-answers.ts", "src/jev-evidence.ts"]} />
    </section>

    <section id="revision" className={styles.section}>
      <h2>Program revision</h2>
      <p>The current contract uses schema <code>jev-program-2026-09-24.1</code>, feature catalog <code>jev-features-2026-09-28.1</code>, and projection <code>jev-trade-projection-1</code>. The activated definition is immutable and validated for the schema and provider&apos;s supported question types.</p>
      <p>A revision is <code>sha256:</code> plus a hash of canonical JSON containing the schema, catalog version, selected feature metadata, questions with defaulted roles, groups, and projection. Changing any of those changes the revision, even a catalog description or freshness label. Presentation-only dashboard changes do not.</p>
      <p>The revision identifies both what Jev received and how required answers became a decision. A program swap affects later ticks, not a capture already in progress. Compare like revisions, providers, model IDs, assets, and market regimes before judging improvements. Old records are not rewritten to match a new program.</p>
      <p>The earlier catalog called <code>tickMs</code> &quot;Tick time of day&quot; and <code>bookImbalance</code> &quot;Top-of-book size imbalance&quot;. Correcting those descriptions and the depth-band capture changed the revision. The values of tickMs and imbalance did not change.</p>
      <Source files={["src/jev-program.ts", "src/jev-features.ts"]} />
    </section>

    <section id="privacy" className={styles.section}>
      <h2>What is sent and not sent</h2>
      <p>Jev receives the group&apos;s selected market inputs and resolved question text: identity, timing, book and tape evidence, derived returns and indicators, venue context, maximum leverage, and current sleeve position. Questions can include market, tickMs, position side, size, entry, and current and maximum leverage. Non-flat positions include current unrealized PnL.</p>
      <p className={styles.notice}>The program capture does not include wallet addresses, private keys, provider credentials, equity, withdrawable balance, lifetime realized PnL, lifetime fees, or raw private fill history. Flat positions omit unrealized PnL. Extra TradeState fields are not forwarded by feature extraction.</p>
      <p>Deeper raw books, raw candle arrays, trade IDs, rejection details, account summaries, and private fee history are not additional model inputs. Adding an input requires a program change, a new revision, a documented reason, and review of token cost and decision value.</p>
      <p>Decision and execution history is stored separately from the model payload. Visitor queries are owner-scoped through an active session capability. The signed owner cookie restores history for that browser; it is a bearer credential and should not be shared. Operator history uses a separate internal owner and loopback-only access.</p>
      <Source files={["src/jev-features.ts", "src/jev-program.ts", "docs/jev-model.md"]} />
    </section>

    <section id="outcomes" className={styles.section}>
      <h2>Trailing Price 5t vs forward Outcome 5t</h2>
      <Fields rows={[
        ["Price 5t: before the decision", "The trailing input returnsBps.last5 compares this tick's captured mid to the mid five decision ticks earlier: (midNow - midBefore) / midBefore * 10,000. Jev can see it. It is unsigned to the chosen bias; positive means the market rose. During warmup it can be 0 because history is insufficient."],
        ["Outcome 5t: after the decision", "A later markout compares the mid five decision ticks after capture to the captured mid: (midAfter - midAtDecision) / midAtDecision * 10,000. Jev cannot see this future result at decision time. The bias-signed outcome keeps that sign for long and reverses it for short, so positive means price moved in Jev's chosen direction."],
      ]} />
      <p>Markouts are recorded after 1, 5, 20, and 100 ticks. A missing or pending markout is not zero. A horizon can remain unavailable when the run or sampling ends before enough later ticks arrive. Tick horizons are not a promise of exact wall-clock duration.</p>
      <p>A markout is a market-direction observation, not a filled trade return, realized PnL, fee-adjusted profit, or proof an order executed. Hold decisions can still have a directional bias and a later market outcome. Review quotes, individual fills, fees, closed PnL, and position evidence separately. A good market call can execute poorly; a well-executed trade can have a bad market outcome.</p>
      <p><Link href="/model">Open Model to compare answers, inputs, execution, and outcomes</Link>.</p>
      <Source files={["docs/jev-model.md", "web/src/app/model/MarketCards.tsx", "web/src/app/model/DecisionRail.tsx"]} />
    </section>

    <section id="boundaries" className={styles.section}>
      <h2>Boundaries and caveats</h2>
      <ul>
        <li>Evaluations may overlap so a slow request does not skip the next decision tick. Only the newest still-live result may submit exchange work. A stale response remains recorded as a real evaluation but cannot trade.</li>
        <li>An answer to open is not a fill. Post-only quotes may be canceled or replaced; exchange constraints and later market events determine execution. Paper fills are a simulation, not proof of live execution quality.</li>
        <li>Current captures can contain stale venue data, synthetic book levels, rounded small sizes, warmup zeros, nullable indicators, and an indistinguishable 50x leverage fallback. Read the source and null rules above before interpreting apparent certainty.</li>
        <li>Legacy rows have their original decision data but no reconstructable program capture: record type legacy, program metadata unavailable, null evidence, and empty observations. The old label jev-trade-2026-09-23.1 is not the current hashed revision.</li>
        <li>Required decisions, later observational answers, execution events, and forward markouts are separate evidence. Do not treat an observational answer as the trading instruction or a market markout as realized profit.</li>
      </ul>
      <Source files={["docs/jev-model.md", "src/trader.ts", "src/trader-journal.ts"]} />
    </section>

    <section id="sources" className={styles.section}>
      <h2>Source reference</h2>
      <p>This guide follows the <a href={`${repo}docs/jev-model.md`}>complete Jev model contract</a>. Source links above identify the builders, extractors, and interpretation code. The <a href={`${repo}src/jev-features.ts`}>feature catalog</a> defines input metadata; the <a href={`${repo}src/jev-program.ts`}>program definition</a> defines questions and projection.</p>
      <p>For the provenance of a particular historical decision, use its recorded capture and revision in <Link href="/model">Model</Link>, not today&apos;s default program. <a href="#pipeline">Back to data pipeline</a>.</p>
    </section>
  </main></HelpShell>;
}
