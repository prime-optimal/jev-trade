# Jev model contract

This document describes the complete boundary between market data and Jev. It is the reference for changing model inputs, questions, or decision history.

## One evaluation per tick

While a sleeve is Running, each decision tick captures the active Jev program and its market-facing inputs once, before any provider request can await. The capture records the program revision and a state and resolved question set for every group. All groups start from that capture, so a program swap affects later ticks, not a tick already in progress.

A required group that returns answers produces a normalized decision and a UUID, including a safe hold when its answers are invalid. A failed required group still produces a journaled evaluation with evidence, but no decision or order. Quotes, fills, and later price markouts keep the decision UUID. It is the durable join key for reviewing what Jev saw, what it answered, what the executor did, and what happened afterward.

Overlapping evaluations are allowed because a slow request must not skip the next tick. Only the newest still-live result can submit exchange work. A stale response is still a real Jev evaluation and is recorded as such, but it cannot trade.

## Program revision

The current code sets `PROGRAM_SCHEMA` to `jev-program-2026-09-24.1`, `FEATURE_CATALOG_VERSION` to `jev-features-2026-09-24.1`, and `PROJECTION_VERSION` to `jev-trade-projection-1`. A program definition pins the catalog version in `catalogVersion` and the projection version in `projection.version`. Validation checks the definition against the schema and the selected provider's supported question types. The activated definition is immutable.

`programRevision()` returns `sha256:` followed by the hash of canonical JSON containing the schema, catalog version, metadata for selected features, questions with their defaulted roles, groups, and projection. Changing any of those inputs changes the revision. The revision therefore identifies both the state Jev receives and how its required answers can become a decision. Presentation-only dashboard edits do not change it. See [`src/jev-program.ts`](../src/jev-program.ts) and [`src/jev-features.ts`](../src/jev-features.ts).

Each group carries its own selected feature values and resolved questions. The `DEFAULT_PROGRAM` has one `trade` group and three required choice questions, resolved by the code-owned `jev.bias`, `jev.intent`, and `jev.leverage` resolvers. Question roles are `required` or `observational`; an omitted role defaults to `observational`. The projection consumes only the required answers in the required group. Groups and role defaults are part of the hashed definition.

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

The default program asks three independent required choice questions over the same captured state:

1. **Bias:** choose `long` or `short` for the asset.
2. **Intent:** choose `open` or `hold` while flat. With an open position, choose `open`, `close`, or `hold`.
3. **Leverage:** choose one cross-leverage rung from the values allowed by the venue maximum.

The projection derives the wire `action` from bias and intent. Hold is a first-class Jev answer, not a code-side decision to skip a tick. Additional questions can be assigned to observational groups. Their answers are recorded separately and cannot change or suppress the required decision.

## Evidence and evaluation outcomes

`ModelEvaluation` contains `decision`, `evidence`, and an `observations` promise. The evidence records the program capture, required group result, record type, and evaluation status. Each group result records its answers, unexpected answer keys, provider identity and usage, timing, and any failure. Each answer records its declared type, role, status, bounded raw value, and parsed answer when available. Raw answer JSON is capped at 4,096 bytes.

Evaluation status is `complete`, `invalid`, or `failed`. `complete` means the required answers were readable and valid. A valid `hold` answer is complete, not invalid. `invalid` means at least one required answer is missing or invalid; the model returns a safe hold and marks the evidence invalid. `failed` means the required provider group failed or timed out; the evaluation has no decision. A stale result is a separate trading condition, not a hold or evaluation status.

Choice and score confidence is recorded only when the provider supplied a valid finite value from 0 through 1. The parser does not derive confidence from probabilities. Optional probabilities must use declared labels and finite values from 0 through 1. For a gateway boolean answer, `probability` means P(true), not confidence. See [`src/jev-answers.ts`](../src/jev-answers.ts) and [`src/jev-evidence.ts`](../src/jev-evidence.ts).

Observational group completions are journaled later as `decision-observation` events with the same decision UUID and captured program revision. They do not alter the decision evidence or trading outcome. [`src/trader-journal.ts`](../src/trader-journal.ts) handles those events.

## Deliberately excluded data

The program capture does not contain wallet addresses, private keys, provider credentials, account equity, withdrawable balance, lifetime realized PnL, lifetime fees, or raw private fill history. It contains the current sleeve position and public market evidence needed for the next decision. The feature catalog bounds collections such as book levels and recent trades. Flat positions omit `unrealizedUsd`; wallet and lifetime fields never leave the bot.

Hyperliquid exposes more raw data than this catalog currently uses, including deeper book levels, raw candle arrays, trade IDs, order rejection details, account summaries, and private fee history. Adding a field requires a program change and revision, a documented reason, and review of token cost and decision value.

## Durable decision history

PostgreSQL stores every evaluation under its owner, along with its program capture, evidence, and later execution evidence. The parent Bun process owns the database connection and serial write queue. Visitor Workers send typed journal events to that parent, so model cadence never waits for database I/O.

Each decision record can accumulate:

- the normalized Jev answer and probability distributions
- the required group evidence and the captured program definition
- the planned or submitted quote
- every correlated fill as an individual event, including stable fill identity, price, fees, and closed PnL
- the observed position and run totals after each fill
- market return and return signed to Jev's long or short bias after 1, 5, 20, and 100 ticks

A reviewer can therefore compare a decision against both execution quality and later market direction. Quote and fill outcomes must not be confused with markouts: a good market call can have poor execution, and a well-executed trade can still have a poor market outcome.

Rows written before the versioned program format keep their original decision JSON, including its former prompt fields. They are returned as `recordType: "legacy"` with `programMetadata: "unavailable"`, `evidence: null`, and empty observations. Legacy rows are never reconstructed into program captures. This includes rows labeled `jev-trade-2026-09-23.1`; that label is not the current program revision.

## Privacy and query access

Visitor rows are partitioned by an opaque owner UUID. A signed HttpOnly owner cookie restores that UUID when the browser creates a new session. Query routes do not accept it directly; session creation exchanges it for a new short-lived capability. Every visitor history request must present that active capability, and the parent resolves the owner from it before issuing an owner-filtered SQL query.

The owner token and cookie expire after one year on both server and browser. Treat both cookies as bearer credentials. Copying the signed owner token lets another client create a capability for that owner until the token expires or `DECISION_OWNER_SECRET` changes.

Shared operator rows use a separate internal owner. Their query route exists only on the loopback operator listener. Never expose an endpoint that accepts an owner UUID from a browser or lets a caller remove the owner predicate.

## Program refinement workflow

1. Export a bounded owner-scoped decision window through the authenticated decisions endpoint or query the database with an internal reviewer role.
2. Group records by program revision, model provider, model ID, asset, and market regime.
3. Compare intent and directional probabilities with fills, closed PnL, and fixed-horizon markouts.
4. Write a proposed program change and state the failure mode it addresses.
5. Validate and activate the changed definition to obtain its new revision. Keep old records unchanged.
6. Add exploratory questions to an observational group when they should not affect trading. Their results are journaled separately and cannot change or suppress the required decision.
7. Promote a revision only after it improves the intended metric without weakening privacy, latency, or the every-tick Jev contract.
