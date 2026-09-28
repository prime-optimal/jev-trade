# Jev model contract

This document describes the complete boundary between market data and Jev. It is the reference for changing model inputs, questions, or decision history.

## One evaluation per tick

While a sleeve is Running, each decision tick captures the active Jev program and its market-facing inputs once, before any provider request can await. The capture records the program revision and a state and resolved question set for every group. All groups start from that capture, so a program swap affects later ticks, not a tick already in progress.

A required group that returns answers produces a normalized decision and a UUID, including a safe hold when its answers are invalid. A failed required group still produces a journaled evaluation with evidence, but no decision or order. Quotes, fills, and later price markouts keep the decision UUID. It is the durable join key for reviewing what Jev saw, what it answered, what the executor did, and what happened afterward.

Overlapping evaluations are allowed because a slow request must not skip the next tick. Only the newest still-live result can submit exchange work. A stale response is still a real Jev evaluation and is recorded as such, but it cannot trade.

## Program revision

The current code sets `PROGRAM_SCHEMA` to `jev-program-2026-09-24.1`, `FEATURE_CATALOG_VERSION` to `jev-features-2026-09-28.1`, and `PROJECTION_VERSION` to `jev-trade-projection-1`. A program definition pins the catalog version in `catalogVersion` and the projection version in `projection.version`. Validation checks the definition against the schema and the selected provider's supported question types. The activated definition is immutable.

`programRevision()` returns `sha256:` followed by the hash of canonical JSON containing the schema, catalog version, metadata for selected features, questions with their defaulted roles, groups, and projection. Changing any of those inputs changes the revision. The revision therefore identifies both the state Jev receives and how its required answers can become a decision. Presentation-only dashboard edits do not change it. See [`src/jev-program.ts`](../src/jev-program.ts) and [`src/jev-features.ts`](../src/jev-features.ts).

Each group carries its own selected feature values and resolved questions. The `DEFAULT_PROGRAM` has one `trade` group and three required choice questions, resolved by the code-owned `jev.bias`, `jev.intent`, and `jev.leverage` resolvers. Question roles are `required` or `observational`; an omitted role defaults to `observational`. The projection consumes only the required answers in the required group. Groups and role defaults are part of the hashed definition.

## State sent to Jev

Jev reads 17 inputs, the ids in `FEATURE_IDS` ([`src/jev-features.ts`](../src/jev-features.ts)). The current catalog version is `FEATURE_CATALOG_VERSION` = `jev-features-2026-09-28.1`. `DEFAULT_PROGRAM` puts all 17 in its one `trade` group.

Every tick, `Trader.buildState` in [`src/trader.ts`](../src/trader.ts) builds a `TradeState` (type in [`src/model.ts`](../src/model.ts)). `captureProgram` in [`src/jev-program.ts`](../src/jev-program.ts) then calls `extractFeatures` with the group's feature ids. That copies each requested input out of the `TradeState` into a frozen `snapshot.state`. Two rules follow from that code:

- All 17 keys are always present in `snapshot.state`. Missing data is never a missing or `null` top-level key. It appears as `null` fields inside `indicators` and `asset`, as `0` or `null` inside `trades` and `returnsBps`, or as an empty `depth` object.
- `extractFeatures` re-slices `book` to 5 levels and `recentTrades` to 10 entries. It copies only the named fields of each object, so extra fields on `TradeState` never reach Jev.

The resolved question text is also part of what Jev is sent. `resolvedRequiredQuestion` in `src/jev-program.ts` writes `market`, `tickMs`, the position stance (side, size, entry), the current leverage, and `maxLeverage` into the question instructions. Those values come from the same `TradeState` and share the input provenance below.

### Identity and timing

| Field | Meaning |
| --- | --- |
| `coin` | Sleeve asset, such as BTC or ETH. This is the name Hyperliquid uses in API calls. |
| `market` | Bot-side pair label, always `${coin}-USD` (`coinPair` in [`src/sleeves.ts`](../src/sleeves.ts)). It is not sent to Hyperliquid. |
| `tick` | Sleeve decision number. `Feed.maybeTick` increments it and `Trader.onBlock` receives it as `block`. |
| `tickMs` | Configured time between Jev evaluations in milliseconds (`config.tickMs`, from the `tickMs` setting). It is a setting, not a clock reading. |

### Price and returns

| Field | Meaning |
| --- | --- |
| `mid` | Midpoint of the best bid and best ask in the latest book. Not rounded. |
| `spreadBps` | Best ask minus best bid, divided by `mid`, in basis points. Rounded to 2 decimals. |
| `returnsBps.last1` | Mid return over the last 1 tick. |
| `returnsBps.last5` | Mid return over the last 5 ticks. |
| `returnsBps.last20` | Mid return over the last 20 ticks. |
| `returnsBps.last100` | Mid return over the last 100 ticks. |
| `recentMids` | Space-separated mids, oldest first, sampled from the last `horizonBlocks` ticks. |

A return window counts decision ticks, not exchange blocks, so `last100` spans `100 * tickMs`. Each return is `0`, not `null`, until the sleeve has recorded more than that many ticks.

### Order book

| Field | Meaning |
| --- | --- |
| `bookImbalance` | Bid size minus ask size divided by their sum, over every received level within 100 basis points of `mid`. Not top-of-book. Range -1 to 1. |
| `depth` | Cumulative bid and ask size inside 10, 25, and 50 basis points of `mid`, keyed `"10"`, `"25"`, `"50"`. |
| `book.bids` | Best five bid levels, best first, as `"<price> x <size>"`. |
| `book.asks` | Best five ask levels, best first, as `"<price> x <size>"`. |

### Public trade tape

| Field | Meaning |
| --- | --- |
| `trades.count` | Number of taker prints in the lookback window of `horizonBlocks` ticks. |
| `trades.buySz` | Taker buy size. |
| `trades.sellSz` | Taker sell size. |
| `trades.cvdSz` | Taker buy size minus taker sell size. |
| `trades.vwap` | Volume-weighted average trade price. `null` when the window has no prints. |
| `trades.lastPrice` | Price of the newest print in the window, `null` when none. |
| `trades.lastSide` | Taker side of that print, `null` when none. |
| `recentTrades` | Up to 10 newest prints as `"<tick> <side> <size> @ <price>"`, oldest first. The tick is the bot tick when the print arrived, not an exchange time. |

### Current sleeve position

| Field | Meaning |
| --- | --- |
| `position.coin` | Position asset. |
| `position.side` | `long`, `short`, or `flat`, from the sign of the sleeve's signed size. |
| `position.size` | Absolute position size in base units, rounded to 8 decimals. |
| `position.notionalUsd` | `size * mid`, rounded to 4 decimals. It is computed by the bot, not read from Hyperliquid. |
| `position.entry` | Average entry price when open, else `null`. |
| `position.leverage` | Cross leverage. Always `null` in paper mode. On a live sleeve it is the value Hyperliquid last reported in `clearinghouseState`, except that `Market.setLeverage` overwrites `Market.account.leverage` with the value the bot just sent after a successful `updateLeverage` call. Until the next `clearinghouseState` update, the captured value is therefore the leverage the bot last set, not one Hyperliquid confirmed. |
| `position.liquidationPx` | Hyperliquid liquidation price while open. Always `null` in paper mode. |
| `position.distanceBps` | Signed basis points from `entry` to the current `mid`, `(mid - entry) / entry`. It is not the distance to liquidation. `null` while flat. |
| `position.unrealizedUsd` | Current unrealized PnL. It is omitted while flat and present for `long` and `short`. |

### One-minute indicators

| Field | Meaning |
| --- | --- |
| `indicators.sma20` | Simple average of the last 20 one-minute closes. |
| `indicators.sma50` | Simple average of the last 50 one-minute closes. |
| `indicators.ema20` | 20-period exponential moving average of the one-minute closes. |
| `indicators.midVsSma20Bps` | Current book `mid` versus SMA20 in basis points. |
| `indicators.midVsSma50Bps` | Current book `mid` versus SMA50 in basis points. |
| `indicators.rsi14` | 14-period relative strength index of the closes. |
| `indicators.vol20Bps` | Sample standard deviation of the last 20 close-to-close log returns, times 10,000. |
| `indicators.high20` | Highest close in the last 20 closes. |
| `indicators.low20` | Lowest close in the last 20 closes. |
| `indicators.rangePos20` | Position of the newest close inside the high20 to low20 range, 0 to 1. |

### Hyperliquid asset context

| Field | Meaning |
| --- | --- |
| `asset.markPx` | Hyperliquid mark price. |
| `asset.oraclePx` | Hyperliquid oracle price. |
| `asset.fundingBps` | Context `funding` times 10,000. |
| `asset.premiumBps` | Context `premium` times 10,000. |
| `asset.openInterest` | Context `openInterest`. |
| `asset.dayNtlVlmUsd` | Context `dayNtlVlm`, the rolling daily notional volume. |
| `asset.dayChangeBps` | Basis points from context `prevDayPx` to the current book `mid`. It uses `mid`, not `markPx`. |
| `asset.maxLeverage` | Same value as the top-level `maxLeverage`. Never `null`. |
| `maxLeverage` | Venue maximum leverage for the asset. It builds the leverage rungs offered to Jev. |

## Input provenance

This section traces each input from Hyperliquid to the captured state. File paths and symbol names are given instead of line numbers. Sources: `Feed` in [`src/feed.ts`](../src/feed.ts), `bookFromLevels` in [`src/book.ts`](../src/book.ts), `TradeFeed` in [`src/trades.ts`](../src/trades.ts), `VenueChart` in [`src/chart.ts`](../src/chart.ts), [`src/indicators.ts`](../src/indicators.ts), [`src/account.ts`](../src/account.ts), `Market` in [`src/market.ts`](../src/market.ts), and `HyperliquidMetadataCache` in [`src/hyperliquid.ts`](../src/hyperliquid.ts). Anything the code does not show is marked `[unverified]`.

### Catalog metadata per input

These are the `FEATURE_CATALOG` entries. The catalog is copied into every group snapshot and is part of the hashed program revision.

| Input | Catalog meaning | Type | Units | `maxItems` | Availability | Freshness |
| --- | --- | --- | --- | --- | --- | --- |
| `coin` | Asset identifier | string | none | none | always | tick |
| `market` | Market identifier | string | none | none | always | tick |
| `tick` | Tick sequence number | number | tick | none | always | tick |
| `tickMs` | Configured interval between decisions | number | ms | none | always | tick |
| `mid` | Mid-market price | number | USD | none | always | tick |
| `spreadBps` | Bid-ask spread | number | bps | none | always | tick |
| `bookImbalance` | Bid versus ask size imbalance within 100 bps of mid | number | ratio | none | always | tick |
| `depth` | Cumulative resting size by distance from mid | object | size | 3 | always | tick |
| `book` | Best resting prices and sizes | object | price x size | 5 | always | tick |
| `returnsBps` | Recent price returns | object | bps | none | always | tick |
| `recentMids` | Recent mid-market prices | string | USD | none | always | tick |
| `trades` | Taker trade summary | object | none | none | always | tick |
| `recentTrades` | Recent taker prints | array | none | 10 | always | tick |
| `position` | Current position | object | none | none | always | unknown |
| `indicators` | Candle-derived technical indicators | object | none | none | nullable | unknown |
| `asset` | Venue market data | object | none | none | nullable | unknown |
| `maxLeverage` | Maximum allowed cross leverage | number | x | none | always | unknown |

Catalog version `jev-features-2026-09-28.1` corrected two descriptions that the earlier `jev-features-2026-09-24.1` text got wrong: `tickMs` had been "Tick time of day" and `bookImbalance` had been "Top-of-book size imbalance". The values never changed. Because the catalog text is part of the revision hash, that correction, together with the depth fix (see the `depth` rows above), starts a new program revision. Journal rows written under `jev-features-2026-09-24.1` carry the earlier revision.

The `book` `maxItems` of 5 counts levels per side. The `depth` `maxItems` of 3 counts the bands.

### Source and Hyperliquid call per input

"Cadence" is how often the bot receives or re-reads the data. The bot samples all of it once per tick. Hyperliquid's own push frequency is not visible in the code and is `[unverified]`.

| Input | Builder (file:symbol) | Hyperliquid call | Cadence |
| --- | --- | --- | --- |
| `coin` | `Market.coin` from `SleeveConfig.coin` (`src/sleeves.ts`) | none, configuration | fixed per sleeve |
| `market` | `Market.pair` from `coinPair` (`src/sleeves.ts`) | none, derived label | fixed per sleeve |
| `tick` | `Feed.maybeTick` counter, passed as `block` to `Trader.onBlock`, read in `Trader.buildState` | none | one per `tickMs` |
| `tickMs` | `config.tickMs` in `Trader.buildState` (setting `tickMs`, copied by `applySettingsToConfig` in `src/config.ts`) | none, configuration | fixed for the run |
| `mid` | `Book.mid` from `bookFromLevels` (`src/book.ts`), stored on `Feed.book`, read by `Market.readBook` | WebSocket `l2Book` with `fast: true`; HTTP info `l2Book` for the first snapshot and the fallback | WS push per book update `[unverified]`; HTTP at connect and every `fallbackMs` (default 30,000) only while the socket is not open |
| `spreadBps` | `Book.spreadBps` from `bookFromLevels` | same as `mid` | same as `mid` |
| `bookImbalance` | `Book.imbalance` from `bookFromLevels` | same as `mid` | same as `mid` |
| `depth` | `Book.depthBps` from `bookFromLevels`, copied in `Trader.buildState` | same as `mid` | same as `mid` |
| `book` | `Book.levels` from `bookFromLevels`, formatted by `lvl` in `Trader.buildState` | same as `mid` | same as `mid` |
| `returnsBps` | `ret` in `Trader.buildState` over `Trader.mids`, one `book.mid` pushed per tick in `Trader.onBlock` (capped at 400) | derived from the book above | one sample per tick |
| `recentMids` | `sampled` in `Trader.buildState` over `Trader.mids` | derived from the book above | one sample per tick |
| `trades` | `TradeFeed.summary` (`src/trades.ts`), fed by `Feed.ingestPrint` | WebSocket `trades`; HTTP info `recentTrades` once at connect and in the fallback | WS push per trade `[unverified]`; prints are de-duplicated by `tid` |
| `recentTrades` | `TradeFeed.recent(10)` formatted in `Trader.buildState` | same as `trades` | same as `trades` |
| `position` | `Trader.buildState` from `Trader.position` and `Market.account` (`VenueAccount`, `accountFromClearinghouse` in `src/account.ts`) | live: WebSocket `clearinghouseState` (user) and HTTP info `clearinghouseState`; paper: none | live: WS pushes plus `Market.refresh` at init, every 5th tick, and after fills; paper: recomputed from simulated fills each tick |
| `indicators` | `snapshotIndicators` (`src/indicators.ts`) over `VenueChart.closes(80)` via `Market.candleCloses` | HTTP info `candleSnapshot` for `1m` (5000 minutes) and `15m` (7 days) at connect; WebSocket `candle` with interval `1m` | snapshot once at `Feed.connect`; WS updates the forming candle continuously |
| `asset` | `venueFeatures` (`src/indicators.ts`) over `Feed.assetCtx` via `Market.assetCtx`, parsed by `parseAssetCtx` | WebSocket `activeAssetCtx`; HTTP info `metaAndAssetCtxs` (`Feed.pollAssetCtx`) | HTTP at connect and in the fallback; WS pushes `[unverified]` |
| `maxLeverage` | `Market.maxLeverage`, set by `Market.loadMaxLeverage` from `HyperliquidMetadataCache.maxLeverage` (`src/hyperliquid.ts`) | HTTP info `meta` (`universe[].maxLeverage`) | once per process (memoized in `hyperliquidMetadata`), read in `Market.init` |

The tick itself fires from `Feed.maybeTick`, which runs on every `l2Book` message and on an interval of `tickMs`. It returns early unless `tickMs` has passed since the last tick, so ticks are at least `tickMs` apart.

### Transform and null rules per input

| Input | Transform | When null, zero, or empty |
| --- | --- | --- |
| `coin`, `market` | none | never |
| `tick` | none | never |
| `tickMs` | none | never |
| `mid` | `(bestBid + bestAsk) / 2`, not rounded. `bookFromLevels` ignores levels with non-positive price or size and returns `null` when `ask <= bid`, so `Feed.book` keeps the previous book. | never once a book exists. The tick loop does not run before the first book. If one book side is empty, `bookFromLevels` invents a single level for it before any other calculation: price 5 basis points beyond the other side's touch, size copied from that touch. That level sets the best bid or ask, so `mid` and the spread are synthetic, and it also feeds `bookImbalance`, every `depth` band, and `book` (see those rows). |
| `spreadBps` | `(ask - bid) / mid * 10000`, rounded to 2 decimals | never. About 5 basis points when a side was synthesized. |
| `bookImbalance` | `(bidSz - askSz) / (bidSz + askSz)` over all received levels within 100 bps of `mid`, rounded to 3 decimals | `0` when both sums are 0. When one side was empty, the synthetic level from `bookFromLevels` is counted in its sum, so the value reflects an invented level of the same size as the other side's touch rather than an empty side. |
| `depth` | Sum of level sizes within 10, 25, and 50 bps of `mid` per side, base-coin units, rounded to 1 decimal in `Trader.buildState`. Cumulative, so 50 includes 25 includes 10. The sums cover the levels `bookFromLevels` kept after filtering, plus the synthetic level when one side was empty. The code does not cap the level count. | Bands are keyed `"10"`, `"25"`, `"50"` and are never omitted after the #81 fix. A thin book gives small or `0` sizes, not a missing band. When one side was empty, the synthetic level sits about 2.5 bps from `mid` and so counts in all three bands, giving that side a nonzero size equal to the other side's touch size. Journal rows recorded before the fix hold `depth: {}`, because `buildState` wrote keys `"10bps"`, `"25bps"`, `"50bps"` while `featureValue` read `"10"`, `"25"`, `"50"`. |
| `book` | Top 5 levels per side of the sorted levels (`Book.levels`), each formatted `price.toFixed(6) + " x " + round(size, 1)` | Arrays are shorter than 5 if fewer levels arrived. When one side was empty, its first entry (`book.bids[0]` or `book.asks[0]`) is the synthetic level, not a real resting order. Sizes below 0.05 print as `0` because of the 1-decimal rounding, which matters for high-priced coins such as BTC. |
| `returnsBps` | `(m[n-1] - m[n-1-k]) / m[n-1-k] * 10000` for `k` of 1, 5, 20, 100, rounded to 2 decimals. `m` is the sleeve's own per-tick mid history, including the current tick. | `0` (not `null`) while the history has `k` or fewer samples. The history starts empty for each new `Trader`, which `createExecutionRuntime` builds when a sleeve initializes. |
| `recentMids` | The last `horizonBlocks` mids (default 100, setting range 20 to 400), keeping the newest and every fifth sample before it, oldest first, `toFixed(6)`, joined by a space. Up to 20 values at the default. | One value on the first tick. Never empty because the current mid is always included. |
| `trades` | Prints whose bot tick is greater than `tick - horizonBlocks`, from a ring of the newest 500 prints. Sums, VWAP, and last print are not rounded. Sides come from the print `side`: `B` is a taker buy, anything else is a taker sell. | `count` 0, sums 0, `vwap`, `lastPrice`, `lastSide` `null` when the window is empty or no feed is attached (`emptySummary`). On a busy market the 500-print ring can cover less than the full window. |
| `recentTrades` | Newest 10 prints of the ring (not limited to the window), oldest first, `"<tick> <side> <size 1dp> @ <price 6dp>"` | `[]` when no print has arrived. Sizes below 0.05 print as `0`. |
| `position` | See the position section below. `entry`, `leverage`, `liquidationPx`, `distanceBps` are nullable numbers. | Flat: `size` 0, `entry`, `distanceBps`, and `liquidationPx` `null`, and `unrealizedUsd` omitted. Paper: `leverage` and `liquidationPx` always `null`. |
| `indicators` | Computed over the last 80 one-minute closes, oldest first, including the still-forming current candle. The moving averages, RSI, volatility, and range windows use the trailing closes. `ema20` seeds with the mean of the first 20 of those 80 closes and then runs over the rest. `rsi14` is a plain average of gains and losses over 14 differences, not Wilder smoothing (`50` when nothing moved, `100` when there are no losses). `vol20Bps` is the sample standard deviation of 20 log returns, so it needs 21 closes. Every value is rounded to 6 decimals by `snapNums`. | The object always exists. A field is `null` with too few closes: `sma20`, `ema20`, `high20`, `low20`, `rangePos20` need 20, `rsi14` needs 15, `vol20Bps` needs 21, `sma50` needs 50, and `midVsSma*` also need their SMA. This happens when the `candleSnapshot` request failed (`Feed.connect` only logs a warning) and the `candle` channel has not yet filled the window. `rangePos20` is `0.5` when high equals low. |
| `asset` | `markPx`, `oraclePx`, `openInterest`, `dayNtlVlm` pass through. `fundingBps` and `premiumBps` multiply the context value by 10000. `dayChangeBps` is `(mid - prevDayPx) / prevDayPx * 10000`. All are rounded to 6 decimals. Each new context replaces the previous one. Units of `funding`, `premium`, `openInterest` follow the Hyperliquid context `[unverified]`. | The object always exists. All seven context fields are `null` until the first `activeAssetCtx` message or `metaAndAssetCtxs` response arrives, or when the coin is not found in `universe`. A field is `null` when Hyperliquid omits it or it is not numeric (`parseAssetCtx`). `asset.maxLeverage` is never `null`. |
| `maxLeverage` | `floor` of `universe[coin].maxLeverage` from `meta`, accepted only if a finite number at least 1 | Never `null`. It is the fallback `50` (the `Market.maxLeverage` initial value) when `meta` fails or the coin is missing. The fallback is not distinguishable in the payload. |

### Position source: live sleeve versus paper sleeve

`Market.wallet` is `null` when `config.dryRun` is set (mode `paper`) or the sleeve has no private key. `Market.refresh` and the `clearinghouseState` subscription only run when a wallet exists, so `Market.account` stays `null` in that case.

- **Live sleeve (wallet present).** `Trader.syncFromVenue` copies the signed size and entry price from `Market.account`, which `accountFromClearinghouse` derives from Hyperliquid `clearinghouseState`. The size comes from `szi`, entry from `entryPx`, unrealized PnL from `unrealizedPnl`, leverage from `leverage.value` (the `type` is not checked), and liquidation from `liquidationPx`. `leverage` keeps its previous value when the coin has no open position, so a flat live sleeve can still report the last known leverage. `Trader.applyFill` does nothing while `Market.account` exists, so fills never change the position directly. If the first `clearinghouseState` response has not landed, `Market.account` is `null` and the position is the empty simulated one, that is, flat.
- **Paper sleeve (no wallet).** The position is simulated in the bot. `Trader.applyFill` updates `Trader.position` (signed size and cost basis) from simulated fills, and `entry` is `costUsd / size`. A maker entry fills only when `takeSimFills` sees a later public taker print at or through its limit price. An exit is an immediate taker fill at the exit price (`Trader.simTakerFill`). `unrealizedUsd` is `size * (mid - entry)` at the current book mid, `leverage` and `liquidationPx` are `null`, and no Hyperliquid account call is made. Hyperliquid's `clearinghouseState` is never read.

The captured position is the state going into the decision. `Trader.onBlock` harvests fills before `buildState`, and the order Jev is about to choose is placed afterwards. The position is often flat because entries are post-only quotes that `Trader.applyPosted` and `Trader.enqueueStandDown` replace or cancel on later ticks, and only a crossing print fills them.

`marketFacing` (`src/jev-features.ts`) is the object shape used by `MockModel`. It applies the same rule as `extractFeatures`: it omits `unrealizedUsd` only while the position is flat. Non-flat positions keep it. Nothing else is stripped from `position` by either path, and wallet address, equity, and lifetime PnL are not in `TradeState` at all.

### What freshness means

The catalog `freshness` field takes two values, `tick` and `unknown` (`FeatureFreshness` in [`src/jev-evidence.ts`](../src/jev-evidence.ts)). It is catalog metadata only. No input carries an age, a timestamp, or a staleness flag. `TradeState` has no time fields, and the only time recorded with the state is `capturedAt` on the group snapshot, which is the bot clock at capture.

- **`tick`** declares that the input is read from the bot's state at the tick that is captured. `coin`, `market`, `tick`, `tickMs`, and every book, price, return, and tape input are labeled this way. The code does not verify it. `mid` is the newest book the bot received and the tick loop has no age check on `Feed.book`.
- **`unknown`** declares that the catalog cannot say how old the underlying data is at the tick. That is true of `position` (the last `clearinghouseState` push or refresh for live sleeves, or the sleeve's simulated state for paper sleeves), `indicators` (the last `candle` update or the startup `candleSnapshot`), `asset` (the last `activeAssetCtx` message or poll), and `maxLeverage` (a `meta` read from process start). These sources have their own cadence, and the bot keeps no per-value timestamp for them.

The Model page reads the flag from the snapshot's `features` list. `InputCard` in `web/src/app/model/InputCard.tsx` appends "age unknown" to a card header when any of its inputs is `unknown`. Changing a `freshness` value changes the program revision because the selected catalog entries are hashed by `programRevision`.

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
