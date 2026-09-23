# Jev model contract

This document describes the complete boundary between market data and Jev. It is the reference for changing model inputs, questions, or decision history.

## One evaluation per tick

While a sleeve is Running, each decision tick creates one immutable prompt snapshot. Jev receives its exact `state` and `questions`; the stored `revision` identifies that contract for later comparison. The snapshot contains:

- `revision`: the prompt contract version
- `state`: the market-facing state described below
- `questions`: the exact bias, intent, and leverage questions

A successful response becomes one normalized decision with a UUID. Its quote, fills, and later price markouts keep that UUID. This is the durable join key for reviewing what Jev saw, what it answered, what the executor did, and what happened afterward.

Overlapping evaluations are allowed because a slow request must not skip the next tick. Only the newest still-live result can submit exchange work. A stale response is still a real Jev evaluation and is recorded as such, but it cannot trade.

## Prompt revision

The current revision is `jev-trade-2026-09-23.1`.

A prompt revision names the semantics of both the state and the questions. Change it whenever a field changes meaning, a field is added or removed, criteria change, or instructional text changes. Presentation-only dashboard edits do not require a new revision.

Decision history stores the revision, exact state, and exact questions together. A reviewer must group comparisons by revision unless it is explicitly evaluating a prompt migration.

## State sent to Jev

### Identity and timing

| Field | Meaning |
| --- | --- |
| `coin` | Sleeve asset, such as BTC or ETH. |
| `market` | Hyperliquid market symbol. |
| `tick` | Monotonic sleeve decision number. |
| `tickMs` | Configured time between Jev evaluations. |

### Price and returns

| Field | Meaning |
| --- | --- |
| `mid` | Current best bid and ask midpoint. |
| `spreadBps` | Current spread in basis points around the midpoint. |
| `returnsBps.last1` | Midpoint return over one observed block. |
| `returnsBps.last5` | Midpoint return over five observed blocks. |
| `returnsBps.last20` | Midpoint return over twenty observed blocks. |
| `returnsBps.last100` | Midpoint return over one hundred observed blocks. |
| `recentMids` | Compact recent midpoint series used as local price context. |

### Order book

| Field | Meaning |
| --- | --- |
| `bookImbalance` | Top-of-book bid size minus ask size, normalized by their sum. |
| `depth` | Cumulative bid and ask size inside 10, 25, and 50 basis point bands. |
| `book.bids` | Best five bid levels, formatted as price and size. |
| `book.asks` | Best five ask levels, formatted as price and size. |

### Public trade tape

| Field | Meaning |
| --- | --- |
| `trades.count` | Number of taker prints in the lookback window. |
| `trades.buySz` | Taker buy size. |
| `trades.sellSz` | Taker sell size. |
| `trades.cvdSz` | Taker buy size minus taker sell size. |
| `trades.vwap` | Volume-weighted average trade price when prints exist. |
| `trades.lastPrice` | Most recent trade price. |
| `trades.lastSide` | Most recent taker side. |
| `recentTrades` | Compact recent public trade list. |

### Current sleeve position

| Field | Meaning |
| --- | --- |
| `position.coin` | Position asset. |
| `position.side` | `long`, `short`, or `flat`. |
| `position.size` | Absolute position size. |
| `position.notionalUsd` | Current notional value. |
| `position.entry` | Average entry price when open. |
| `position.leverage` | Current cross leverage when known. |
| `position.liquidationPx` | Venue liquidation price when known. |
| `position.distanceBps` | Distance from midpoint to liquidation in basis points. |
| `position.unrealizedUsd` | Current unrealized PnL. It is omitted while flat. |

### One-minute indicators

| Field | Meaning |
| --- | --- |
| `indicators.sma20` | 20-sample simple moving average. |
| `indicators.sma50` | 50-sample simple moving average. |
| `indicators.ema20` | 20-sample exponential moving average. |
| `indicators.midVsSma20Bps` | Midpoint distance from SMA20 in basis points. |
| `indicators.midVsSma50Bps` | Midpoint distance from SMA50 in basis points. |
| `indicators.rsi14` | 14-sample relative strength index. |
| `indicators.vol20Bps` | 20-sample realized volatility in basis points. |
| `indicators.high20` | Highest midpoint in the 20-sample window. |
| `indicators.low20` | Lowest midpoint in the 20-sample window. |
| `indicators.rangePos20` | Midpoint position inside the 20-sample high-low range. |

### Hyperliquid asset context

| Field | Meaning |
| --- | --- |
| `asset.markPx` | Hyperliquid mark price. |
| `asset.oraclePx` | Hyperliquid oracle price. |
| `asset.fundingBps` | Current funding rate in basis points. |
| `asset.premiumBps` | Mark premium over oracle in basis points. |
| `asset.openInterest` | Current open interest. |
| `asset.dayNtlVlmUsd` | Rolling daily notional volume. |
| `asset.dayChangeBps` | Rolling daily price change in basis points. |
| `asset.maxLeverage` | Venue maximum leverage for the asset. |
| `maxLeverage` | Maximum leverage used to build the available leverage rungs. |

## Questions Jev answers

The evaluator receives three independent choice questions over the same state.

1. **Bias:** choose `long` or `short` for the asset.
2. **Intent:** choose `open` or `hold` while flat. With an open position, choose `open`, `close`, or `hold`.
3. **Leverage:** choose one cross-leverage rung from the values allowed by the venue maximum.

The normalized result derives the wire `action` from bias and intent. Hold is a first-class Jev answer, not a code-side decision to skip a tick.

## Deliberately excluded data

The prompt does not contain wallet addresses, private keys, provider credentials, account equity, withdrawable balance, lifetime realized PnL, lifetime fees, or raw private fill history. The model receives the current sleeve position and public market evidence needed for the next decision.

Hyperliquid exposes more raw data than this contract currently uses, including deeper book levels, raw candle arrays, trade IDs, order rejection details, account summaries, and private fee history. Adding one of those fields is a model-contract change. It requires a prompt revision, a documented reason, and review of token cost and decision value.

## Durable decision history

PostgreSQL stores every successful decision under its owner, along with its exact prompt and later execution evidence. The parent Bun process owns the database connection and serial write queue. Visitor Workers send typed journal events to that parent, so model cadence never waits for database I/O.

Each decision record can accumulate:

- the normalized Jev answer and probability distributions
- the planned or submitted quote
- every correlated fill as an individual event, including stable fill identity, price, fees, and closed PnL
- the observed position and run totals after each fill
- market return and return signed to Jev's long or short bias after 1, 5, 20, and 100 ticks

A reviewer can therefore compare a decision against both execution quality and later market direction. Quote and fill outcomes must not be confused with markouts: a good market call can have poor execution, and a well-executed trade can still have a poor market outcome.

## Privacy and query access

Visitor rows are partitioned by an opaque owner UUID. A signed HttpOnly owner cookie restores that UUID when the browser creates a new session. Query routes do not accept it directly; session creation exchanges it for a new short-lived capability. Every visitor history request must present that active capability, and the parent resolves the owner from it before issuing an owner-filtered SQL query.

The owner token and cookie expire after one year on both server and browser. Treat both cookies as bearer credentials. Copying the signed owner token lets another client create a capability for that owner until the token expires or `DECISION_OWNER_SECRET` changes.

Shared operator rows use a separate internal owner. Their query route exists only on the loopback operator listener. Never expose an endpoint that accepts an owner UUID from a browser or lets a caller remove the owner predicate.

## Prompt refinement workflow

1. Export a bounded owner-scoped decision window through the authenticated decisions endpoint or query the database with an internal reviewer role.
2. Group records by prompt revision, model provider, model ID, asset, and market regime.
3. Compare intent and directional probabilities with fills, closed PnL, and fixed-horizon markouts.
4. Write a proposed prompt change and state the failure mode it addresses.
5. Assign a new prompt revision and evaluate it without rewriting old records.
6. Promote the revision only after it improves the intended metric without weakening privacy, latency, or the every-tick Jev contract.
