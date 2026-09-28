# Model page: Decisions tab

The `/model` page is a read-only browser for the decision journal. The Decisions tab answers three questions for every recorded tick: what did Jev see, what did Jev answer, and what happened afterwards. This document maps each panel to the wire field, the bot code that produces it, and the Hyperliquid call behind it.

Related documents:

- [Jev model contract](jev-model.md#input-provenance) defines every input field, its Hyperliquid call, transform, and null rules.
- [Model performance](model-performance.md) defines Right and Wrong, hit rate, and the Performance tab.
- [Dashboard](dashboard.md#model-page) has the short page summary, URL state, and gateway routes.

Code references name a file and a symbol. Line numbers are deliberately absent.

## Where the data comes from

The page renders only journal rows. The live SSE feed never supplies row content.

| Step | Code | What it does |
| --- | --- | --- |
| Bot writes events | `Trader.onBlock`, `Trader.applyPosted`, `Trader.recordFill` in `src/trader.ts`; `recordDecision`, `recordObservations`, `emitMarkouts` in `src/trader-journal.ts` | Enqueues typed `DecisionJournalEvent` values (`decision`, `decision-observation`, `quote`, `fill`, `markout`, defined in `src/decision-events.ts`). |
| Journal merges events into one row per decision | `createDecisionStore` in `src/decision-store.ts` | Each event type updates a column of `decision_journal`. `toDecisionRow` builds the `DecisionRow` returned to readers. |
| Bot serves rows | The `decisions` route in `src/paper-sessions.ts` (visitor session, the route the page uses through `/api/session`) | Newest first, 50 rows by default (`DEFAULT_LIMIT`, max 200), `before` cursor from `encodeCursor`. `?id=<decisionId>` returns one row and cannot be combined with `limit` or `before`. The operator control listener (`GET /decisions` in `src/operator-control.ts`) serves the same list without `id`. |
| Next gateway | `/api/session/decisions` (see [dashboard.md](dashboard.md#settings-page)) | Adds the session capability and returns owner-scoped rows. |
| Browser history hook | `useDecisions` in `web/src/lib/useDecisions.ts` | Requests `limit=50`, pages older rows with `before`, merges live pulls with `mergeNewestPage` in `web/src/lib/decisionMerge.ts`. |
| Linked record hook | `useDecisionRecord` in `web/src/lib/useDecisionRecord.ts` | Fetches `?id=` only when the URL names a decision that is not in the loaded rows. 404 shows "Decision not found for this account." |
| Row to summary | `summarize` in `web/src/app/model/record.ts` | Flattens a `DecisionRow` into a `DecisionSummary` used by the timeline, filters, rail, and header. |

### Journal event to row field

| Event | Producer | Row field | Notes |
| --- | --- | --- | --- |
| `decision` | `recordDecision`, called from `Trader.onBlock` after `Model.decide` returns | `decision`, `recordType`, `evidence` | `decision` holds the full event payload. `summarize` reads the model call from `decision.decision`, and reads `timestamp`, `coin`, `block`, `late`, `provider`, `modelId`, and `runId` from the envelope. `evidence.capture.groups[].state` is the input snapshot. A failed call stores `decision: null`. |
| `decision-observation` | `recordObservations` in `src/trader-journal.ts` | `observations[groupId]` | Extra evaluation groups that never move orders. Empty for the default program, which has one `trade` group. |
| `quote` | `Trader.applyPosted` after `Market.send` | `quote` | The order placed for this decision. Absent for a hold. |
| `fill` | `Trader.recordFill` from `Trader.harvest` and `Trader.simTakerFill` | `fills[]` | One entry per fill, deduplicated by `fillId`. |
| `markout` | `emitMarkouts` in `src/trader-journal.ts` | `markouts["1" \| "5" \| "20" \| "100"]` | One entry per horizon, written when that horizon resolves. See [Outcome](#outcome-resolved-after-the-decision). |

`Decision`, `Quote`, and `Fill` shapes are in `src/types.ts`. The row shape is `DecisionRow` in `src/decision-store.ts`, mirrored by hand in `web/src/lib/journal-types.ts`.

### How new rows arrive

1. `ModelView` builds a `liveSignal` string from the newest event per coin in `feed.byCoin` (`coin:block:ts;`). The feed is the SSE feed from `useFeed` and its transport in `web/src/lib/useFeedTransport.ts`.
2. When the string changes, `useDecisions` calls `pullLatest`, which refetches the newest page (`limit=50`) and merges by `decisionId`.
3. If the pull found nothing new, one retry runs 1200 ms later, because the journal write is queued and can land after the SSE event.
4. New ids show a text `new` cue in the rail for 5 seconds (`NEW_ROW_CUE_MS`).
5. Markouts arrive later, as separate journal events. Nothing pushes them to the page. A loaded row only picks up its markouts when the page re-reads it: the next live pull re-reads the newest 50 rows and replaces those rows by `decisionId` (`mergeNewestPage`), and Refresh replaces every loaded row. Load older only appends rows that are not already loaded (`loadPage` without `replace`), so it never updates a row that is already on the page.

The Refresh button runs `loadPage` with `replace`. The current rows stay on screen until the new page arrives, then they are replaced by it, and the `new` cues are cleared when the request starts. A `401` creates a visitor session and retries once. A `410` shows "Session expired."

### URL state

`useModelUrlState` and `web/src/lib/model-url.ts` keep two parameters: `d` (selected decision id) and `h` (markout horizon, one of 1, 5, 20, 100, default 5). Selecting a row or bar pushes history state. Filters and the Decisions or Performance switch are component state and are not in the URL.

## Layout

At 1100 px and wider the page does not scroll; the rail and record scroll separately. Below 1100 px everything stacks.

```
Header
Toolbar: Model | Decisions / Performance switch | Refresh
Timeline: counts, horizon buttons, % right, markout bars, brush strip
Filters: Call, Status, N tick outcome, Coin
+------------------+----------------------------------------------------+
| Decision rail    | Record header                                      |
| (352 px)         |  call, coin, plan, markout, latency, tokens, model |
|                  +-------------+------------------+-------------------+
|                  | Trade call  | What Jev saw     | Order             |
|                  | (answers)   | (input cards)    | Outcome           |
+------------------+-------------+------------------+-------------------+
```

The record has three columns (360 px, flexible, 300 px) from 1600 px. Between 1100 and 1599 px the Order and Outcome column drops under Trade call, and What Jev saw keeps the right side. Component files live in `web/src/app/model/`.

| Region | Component | Data |
| --- | --- | --- |
| Timeline | `Timeline.tsx`, `BrushStrip.tsx`, `web/src/lib/brush-window.ts` | Filtered `DecisionSummary[]`, oldest left. Bar height is `markouts[h].signedBps`. Decisions with no markout at the chosen horizon are small 4 by 4 squares on the zero line. |
| Filters | `RailFilters.tsx`, `filters.ts` | Call (`summary.action`), Late only (`envelope.late`), Invalid or failed (`isInvalid`), N tick outcome (`outcomeAt`), Coin. Filters combine with AND. |
| Rail | `DecisionRail.tsx` | Time, Coin, Call, Plan (intent, bias, leverage, `late`), and the signed markout at the chosen horizon (`n/a` when missing). |
| Record header | `RecordView.tsx` | Call, coin, plan, `Late tick`, chosen-horizon markout (`pending` when missing), latency, tokens, model, and a meta line with time, coin, block, provider, run, decision id, program revision. |
| Trade call | `Answers.tsx` | `evidence.required` and `observations`. |
| What Jev saw | `Inputs.tsx`, `MarketCards.tsx`, `ContextCards.tsx`, `InputCard.tsx` | `evidence.capture.groups[].state`. |
| Order | `Execution.tsx` | `quote` and `fills`. |
| Outcome | `Execution.tsx` (`Outcome`) | Sum of `fills[].closedPnl` and `markouts`. |

Header fields come from `summarize`:

| Header item | Source |
| --- | --- |
| Call | `decision.decision.action` (`buy`, `sell`, `hold`). Shown as `no decision` when the stored decision is null and `unavailable` when it is present but has no valid action. |
| Plan chips | `decision.decision.intent`, `bias`, `leverage`. |
| Latency, tokens | `evidence.required.timing.latencyMs`, `evidence.required.provider.usage`. Provider latency, not tick latency. |
| Model, provider | Envelope `modelId` and `provider`, from `config.jevModelId` and `config.jevProvider` in `Trader.onBlock`. |
| Block | Envelope `block`, which is `Feed.tick` (see [Tick clock](#tick-clock)). |
| Late tick | Envelope `late`. Set when a call failed (`decision` is null), or when the decision is stale, meaning the run was no longer live when the call returned or a newer tick had already been scheduled (`stale = !live || block < latestScheduledBlock` in `Trader.onBlock`, exposed as `Decision.late`). |
| Revision | `evidence.capture.revision`, from `programRevision` in `src/jev-program.ts`. |

Legacy rows (`recordType: "legacy"`) have no evidence. The record shows a `Stored decision` panel with the raw fields and "Program metadata unavailable for this record."

## Trade call

Source: `row.evidence.required` plus each entry of `row.observations`, produced by `JevModel.decide` in `src/model.ts` through `callProviderGroup` in `src/jev-provider.ts` (see [jev-provider.md](jev-provider.md)). `Answers.tsx` renders one `AnswerGroup` per group.

- The required group is titled Trade call, with its status, latency, and token counts. Observational groups are titled Observations and marked "Recorded for study. These answers do not move orders."
- Each question (`bias`, `intent`, `leverage` in the default program, `REQUIRED_KEYS` in `src/jev-program.ts`) shows its declared type, an `answered`, `missing`, `invalid`, `failed`, or `incomplete` status when not answered, and the picked answer's confidence.
- Choice answers render as probability bars over `criteria` with the pick marked; score answers as a column chart; boolean and `noul` answers as a 0 to 1 meter. Criteria and instructions come from the snapshot's `questions` (`resolveQuestion` in `src/jev-program.ts`), so the page shows the text that was sent at that tick, not the current prompt.
- An unanswered question shows "No answer was returned." or "Answer <status>." with the bounded provider response (capped at 4,096 bytes) under a details element.

The action shown in the header is derived, not answered. `decideFromJevAnswers` in `src/model.ts` combines the answers with the position side, and `quoteAction` in `src/plan.ts` maps intent and bias to the header action: `open` with `long` is `buy`, `open` with `short` is `sell`, `close` with `long` is `sell`, `close` with `short` is `buy`, `hold` is `hold`. The order is planned separately. On `close`, `planQuote` in `src/plan.ts` ignores bias and flattens the live position with a reduce-only Ioc order (a sell when the position is long, a buy when it is short), so the header action and the order side can differ, for example a `close` with bias `short` on a long position shows `buy` in the header but sells. A flat position turns a picked `close` into `hold` (`liveIntent` in `src/plan.ts`). If `bias` is missing or invalid, `decideFromJevAnswers` falls back to `long` and forces the intent to `hold`.

## What Jev saw

Source: `row.evidence.capture.groups[]`. `captureProgram` in `src/jev-program.ts` builds each group's `state` with `extractFeatures` in `src/jev-features.ts` from the `TradeState` that `Trader.buildState` returns. The capture happens once per tick, before any provider request, so the card values are exactly the values the provider was given.

`Inputs.tsx` prints a caption such as `Captured 14:03:22 from catalog jev-features-2026-09-24.1. trade read 17 inputs.` The time is `capturedAt`. The number is `Object.keys(snapshot.state).length` for each group, joined by commas. `extractFeatures` writes every requested id, so the default `trade` group always reads 17. The count says how many inputs were sent, not how many held data: an empty `depth` object and an `indicators` object full of nulls still count.

A card renders only if its feature id is present in the snapshot. A custom program that omits a feature omits its card. The `RENDERED` set in `Inputs.tsx` lists the 17 ids the page knows about. Any other id falls into an "Other inputs" card.

Hovering a card header shows each input's catalog `meaning` and `units` (from `FEATURE_CATALOG`). The header lists the input ids the card covers and appends `age unknown` when any of them has `freshness: "unknown"` in the catalog.

### The 17 inputs

The ids are `FEATURE_IDS` in `src/jev-features.ts`. For exact field lists, rounding, cadence, and null rules of each input, use [Input provenance](jev-model.md#input-provenance) in the Jev model contract. The last column here gives the Hyperliquid call that feeds the value.

| Input | Card | What the card shows | Null or empty renders as | Upstream |
| --- | --- | --- | --- | --- |
| `coin` | none; record header coin chip and rail Coin column (`summary.coin`) | Asset symbol. The header prefers the envelope `coin` and falls back to the captured `coin`. | `n/a` in the rail; no chip in the header. | `Market.coin` from the sleeve config. No HL call. |
| `market` | none; not read by the page | Not displayed. `summary.coin` falls back to the `market` field of the stored envelope or decision (`summarize` in `record.ts`), not to this captured input. | Not applicable. | `Market.pair` from the sleeve config. No HL call. |
| `tick` | none; `PrintsCard` uses it for print ages | The header `block` comes from the envelope, which holds the same tick. | Prints show their raw block number instead of `Nt ago`. | `Feed.tick`, incremented in `Feed.maybeTick`. |
| `tickMs` | none | Never displayed in a card. | Not applicable. | `config.tickMs`, set from settings. |
| `mid` | Price | Headline price. Also the mid row in the order book. | `n/a` | `Feed.book.mid`, the midpoint of best bid and best ask from `bookFromLevels` in `src/book.ts`. Book from WebSocket `l2Book` (`fast: true`) with an HTTP `l2Book` snapshot. |
| `spreadBps` | Price (`bps spread`); Order book spread row | Spread in basis points. | `n/a` | Same book, `Book.spreadBps`. |
| `bookImbalance` | Price (`book imbalance`); Depth footer | Signed ratio, three decimals. | `n/a` | `Book.imbalance`: (bid size minus ask size) over their sum for levels within 100 bps of mid (`near(..., 100)` in `bookFromLevels`). This is not top of book, although the catalog `meaning` and the Depth footer text say "Top of book". |
| `depth` | Depth | Diverging bars of cumulative bid and ask size within 10, 25, and 50 bps of mid. | `No depth bands captured.` Rows written before the depth key fix have `{}` and keep this text. | `Book.depthBps` from `bookFromLevels`; `Trader.buildState` passes keys `"10"`, `"25"`, `"50"`. Same `l2Book` book. |
| `book` | Order book | Five asks above and five bids below with size bars. | `No book levels captured.` | `Book.levels` (top five per side, from `l2Book`), formatted `price x size` in `Trader.buildState`. |
| `returnsBps` | Price (returns row) | `1 tick`, `5 ticks`, `20 ticks`, `100 ticks` returns in bps, ending at the decision mid. | Row is empty if the object is absent. A value of `0.00 bps` can also mean not enough history (see [Price pane](#price-pane-what-jev-saw)). | `Trader.buildState` `ret(k)` over `Trader.mids`, the per-tick `book.mid` history. |
| `recentMids` | Price (sparkline) | Sampled recent mids with the SMA and EMA lines. | `No recent mids captured.` when fewer than two prices parse. | `Trader.buildState` `sampled`: last `config.horizonBlocks` mids, every fifth counting back from the newest. |
| `trades` | Taker flow | Buy and sell size split, net size, trade count, VWAP, last side and price. | Object absent shows `No trade summary captured.` Zero prints shows zeros with `n/a` for VWAP and last. | `TradeFeed.summary` in `src/trades.ts`, prints from WebSocket `trades` and an HTTP `recentTrades` poll (`Feed.ingestPrint`). Window is the last `config.horizonBlocks` ticks. |
| `recentTrades` | Recent prints | Up to ten prints with age, side, size, price. | `No prints captured.` | `TradeFeed.recent(10)`, same source as `trades`. |
| `position` | Position going in | Side, size, leverage, entry, notional, mid versus entry, unrealized PnL, liquidation price. | `Flat` with `no open position` when side is `flat`, size is 0, or the object is absent. Individual missing fields show `n/a`. | `Trader.buildState` after `Trader.syncFromVenue`. Live account from `clearinghouseState` (WebSocket channel, plus HTTP `clearinghouseState` in `Market.refresh`); paper from `Trader.applyFill`. |
| `indicators` | Indicators | RSI 14 gauge, 20 candle range gauge, SMA 20, SMA 50, EMA 20 versus mid, 20 candle volatility. | Object absent shows `Not captured for this decision.` Null fields show `n/a`, and RSI reads `not captured`. | `snapshotIndicators` in `src/indicators.ts` over `Market.candleCloses(80)`, one minute candles from `candleSnapshot` (startup) and the WebSocket `candle` channel (`VenueChart`). |
| `asset` | Venue | Mark, oracle, funding, premium, day change, day volume, open interest, max leverage. | Object absent shows `Not captured for this decision.` Null fields show `n/a`. | `venueFeatures` in `src/indicators.ts` over `Feed.assetCtx`, from WebSocket `activeAssetCtx` and an HTTP `metaAndAssetCtxs` poll (`Feed.pollAssetCtx`). `asset.maxLeverage` is added in `Trader.buildState`. |
| `maxLeverage` | Venue (Max leverage row) | Cap used to build the leverage rungs. Falls back to `asset.maxLeverage`. | `n/a` | `Market.maxLeverage`, default 50, replaced by `HyperliquidMetadataCache.maxLeverage` (HTTP `meta`, `universe[].maxLeverage`). |

Indicator and venue sub-fields are `null` when the source has not delivered data yet, for example fewer than 20 or 50 candles for SMA, or no `activeAssetCtx` message yet. `indicators` and `asset` are catalog `nullable`, which means null fields inside a present object. The inputs themselves are never absent.

### What unknown, age unknown, empty, and no open position mean

| Text | Meaning |
| --- | --- |
| `age unknown` on a card header | The catalog marks `position`, `indicators`, `asset`, and `maxLeverage` as `freshness: "unknown"` in `FEATURE_CATALOG`. The bot records no per-input timestamp for them. They are the latest value the bot held at the tick, not a value stamped to the tick. `InputCard.tsx` adds the text whenever any input on the card is `unknown`. This is truthful metadata and not an error. Indicators, Venue, and Position going in carry it. |
| `freshness: "tick"` (no suffix) | The value was read or computed inside the tick from the book and tape the bot held at that moment. |
| `Flat / no open position` | The captured `position.side` is `flat` or `size` is 0. The card reads the state that was sent going into the decision, so it shows the position before this decision's order, never after. |
| Position is mostly flat | This is by design. Entries are post-only maker quotes. Each tick's decision replaces the resting quote (`Trader.applyPosted` clears `orders`), and a hold cancels it (`enqueueStandDown`), so fills are rare. Exits are Ioc takers (`planQuote` in `src/plan.ts`). |
| `No depth bands captured.` | `depth` was `{}`. Before the key fix, `Trader.buildState` wrote `"10bps"` style keys while `featureValue` read `"10"`, so every stored row has an empty `depth`. Rows written after the fix carry the three bands. |
| `Not captured for this decision.` | The input was absent or not an object in the snapshot. |
| `n/a` in a card | The field is `null` or not a finite number. |
| `not recorded`, `empty`, `unsupported value` | Fallback text from `Fields.tsx` for inputs the cards do not know. |
| `unavailable` (call) | A decision exists but its `action` is not `buy`, `sell`, or `hold`. |
| `no decision` (call) | Jev's required group failed or timed out (`decision: null`). The tick is a late tick and no order is placed. |
| `pending` (markout) | See [Outcome](#outcome-resolved-after-the-decision). |

## Price pane (what Jev saw)

`PriceCard` in `web/src/app/model/MarketCards.tsx` draws the Price card from six captured inputs: `mid`, `spreadBps`, `bookImbalance`, `returnsBps`, `recentMids`, and `indicators` (for the SMA and EMA reference lines). Everything in it except the post-decision overlay is the window the provider received at decision time.

### The window Jev received

`Trader.onBlock` runs once per tick. In order:

1. `Market.readBook` returns `Feed.book`, the latest local book.
2. `Trader.mids.push(book.mid)`. This array holds one mid per tick, capped at 400.
3. `Trader.observations.set(block, { mid, ts })` records the tick for later markouts.
4. `Trader.buildState` computes:
   - `returnsBps.lastK` as `round(((m[n-1] - m[n-1-K]) / m[n-1-K]) * 10000, 2)` where `m` is `Trader.mids` and `m[n-1]` is this tick's mid. `K` is 1, 5, 20, or 100. If `n <= K` the value is `0`, not null.
   - `recentMids` as the last `config.horizonBlocks` mids (default 100), keeping every fifth mid counting back from the newest, joined by spaces with six decimals. The default window gives 20 points, spaced five ticks apart.
5. `Model.decide` captures the state. Later ticks cannot change it.

So the `5 ticks` figure in the Price card is a backward return: this tick's mid against the mid five ticks earlier. It is unsigned, it is not tied to the call, and it was known before Jev answered.

The sparkline's dashed reference lines are `indicators.sma20`, `sma50`, and `ema20`. They come from one minute candle closes, not from the tick mids.

### Post-decision overlay on the same card

The card also reads `markouts[1|5|20].observedMid` and draws a shaded "after decision" zone with a line from the decision mid to each observed mid. That overlay is not something Jev saw. It comes from the journal row's `markouts`, after the fact. It is missing until the horizon resolves. Known discrepancy: the sparkline's x scale steps one unit per sampled mid (five ticks apart) while the overlay places 1, 5, and 20 tick points at 1, 5, and 20 units, so the overlay dots sit further right than their tick distance implies. Read the numbers, not the horizontal spacing, for after-decision points.

## Outcome (resolved after the decision)

`Outcome` in `web/src/app/model/Execution.tsx` shows closed PnL and one column per horizon (`HORIZONS` is 1, 5, 20, 100). Each column shows the signed markout, the market move as `mkt`, and two bars.

### How a markout is produced

1. `Trader.onBlock`, after a non-null decision, calls `scheduleMarkout` (`src/trader-journal.ts`) with the decision tick `block`, the decision `book.mid` (the same mid that went into the state), and the decision's `bias`. It records `direction = bias === "long" ? 1 : -1` and a pending set `{1, 5, 20, 100}`. It then calls `emitMarkouts`.
2. On every later `onBlock`, `Trader.observations.set(block, { mid, ts })` runs first and `emitMarkouts` runs immediately after. For each pending horizon `h`, if tick `block + h` has an observation, it emits a `markout` journal event:
   - `marketReturnBps = ((observedMid - decisionMid) / decisionMid) * 10000`
   - `signedReturnBps = marketReturnBps * direction`
   - `observedBlock = block + h`, `observedTimestamp = observation ts`, `observedMid`.
3. `decision-store.ts` merges each event into `markouts[String(h)]`. `summarize` maps `signedReturnBps` to `signedBps`, `marketReturnBps` to `marketBps`, and copies the `observed*` fields.

Reference price: the decision tick mid, never the order price or the fill price. Observed price: the mid at exactly the tick `h` ticks later.

Sign convention: by `bias`, not by `action`, order side, or intent. `direction` is +1 for `long` and -1 for `short`, so `signedBps` is positive when the market moved the way the bias said it would. A `hold` with bias `long` is scored as a long. A `close` is scored by the bias Jev attached to it, not by the side of the closing order: the order side follows the position (`planQuote`), so a close with bias `short` that sells an existing long is scored as a short, and a rise in price after that sell scores negative. `Call, signed by bias` in the Outcome legend means this. The `Market move` bar is the unsigned `marketBps`. When bias is missing, `decideFromJevAnswers` defaults it to `long`, and the markout then scores as a long.

A `no decision` row is never scheduled, so all four horizons stay empty for it.

### When a horizon stays pending

A horizon is `pending` in the record and `n/a` in the rail when its markout event does not exist. Causes:

- The tick `block + h` has not happened yet. At the default `tickMs` of 30 s, the 100 tick horizon takes about 50 minutes, longer than the default 30 minute run, so 100 tick markouts usually stay pending in a default run (see [model-performance.md](model-performance.md#caveats)).
- The bot restarted, or the run stopped, before tick `block + h`. `Trader.markouts` and `Trader.observations` are in-memory maps and nothing resumes them, so those horizons never resolve.
- No observation exists for that exact tick (`readBook` threw, or `onBlock` returned early because the run was no longer live).
- The decision was `no decision`.
- The markout event was written but the page has not read it yet (see [How new rows arrive](#how-new-rows-arrive)).

Closed PnL is separate. It sums `fills[].closedPnl` (`Fill.closedPnl`, copied from Hyperliquid `userFills` for live fills). It is `n/a` when no fill has a closed PnL value, which is always the case in paper mode because simulated fills never set it.

## Why the two 5 tick numbers differ

Both numbers are labelled 5 ticks on the same record. They answer different questions.

| | Price card, `5 ticks` | Outcome, `5t` |
| --- | --- | --- |
| Field | `returnsBps.last5` in the captured snapshot | `markouts["5"].signedReturnBps` (and `marketReturnBps`) |
| Direction in time | Backward: tick `t - 5` to tick `t` | Forward: tick `t` to tick `t + 5` |
| Known when | Before Jev answered | Only after tick `t + 5` |
| Sign | Raw market move, no sign | Multiplied by +1 for `long` bias and -1 for `short` bias |
| Rounding | Two decimals, in the state | Unrounded in the journal, formatted by `fmtBps` |
| Producer | `Trader.buildState` `ret(5)` | `emitMarkouts` |
| Can be missing | Shows `0.00` with under 6 mids of history | `pending` |

Both use the same formula, `(later mid - earlier mid) / earlier mid * 10000`, on tick mids taken at the start of `onBlock`. They cover different five tick spans and one is signed. For example, if the mid was 100.00 at `t - 5`, 100.10 at `t`, and 100.05 at `t + 5`, the Price card shows about `+10.0 bps`, the market move in Outcome is about `-5.0 bps`, and a `short` bias signs that to `+5.0 bps`.

The two spans meet in one place. The Outcome market move at 5 ticks for the decision at tick `t` is the same number as the Price card `5 ticks` return for the decision at tick `t + 5`, when both decisions exist and no tick was skipped in between, apart from the two decimal rounding.

## Right and Wrong

The Decisions tab uses one test: a decision is Right at a horizon when `markouts[h].signedBps > 0`. Zero and negative values are Wrong. A missing markout is neither. The same test drives:

- the timeline score text `N% right after N ticks` and `N measured, mean X bps` (`Timeline.tsx`, computed over the filtered decisions only),
- the rail filters Right and Wrong (`outcomeAt` in `web/src/app/model/filters.ts`), and
- the Performance tab (`computePerformance` in `performance-metrics.ts`).

Colors are not uniform: Timeline bars are colored by action, the Timeline hover readout uses `signedBps > 0`, and the rail and record treat exactly 0 as neutral. See [model-performance.md](model-performance.md#known-inconsistencies).

Right therefore means the bias-signed market move was positive after `h` ticks. It does not mean the order was profitable, or that an order was placed. See [model-performance.md](model-performance.md) for the canonical definition and how hit rate, mean bps, and calibration use it.

## Order

Source: `row.quote` and `row.fills`.

- The order line shows side, size, and price from `Quote` (`src/types.ts`), with tags for `status` (`placed`, `reverted`, or `sim`, shown as `simulated`), `taker` or `maker`, `size capped`, and `reduce only`. `Market.send` in `src/market.ts` places live orders with the Hyperliquid exchange `order` action (Alo entries, Ioc exits) or `modify` when the side stays put. Paper mode records a `sim` quote.
- Fills show side, size, price, direction (`open`, `close`, `flip`), simulated flag, fee, and closed PnL. Live fills come from the `userFills` WebSocket channel and HTTP `userFills` reconciliation (`Market.reconcileUserFills`). Paper fills come from `takeSimFills` and `Trader.simTakerFill`.
- A hold shows "Hold. No order placed." An order-less non-hold shows "No order recorded." A quote with no fills shows "No fills recorded."

## Tick clock

A tick is one Jev evaluation, not a Hyperliquid block. `Feed.maybeTick` in `src/feed.ts` increments `Feed.tick` and calls `Trader.onBlock`, at least `tickMs` after the previous tick (default 30000, `config.tickMs`). The wire fields `block` and `observedBlock` hold this counter. It restarts with the bot process and is not unique across restarts, so markouts are keyed by `decisionId`. Horizons in this page are always measured in ticks. At the default `tickMs`, 1 tick is 30 seconds, 5 ticks 2.5 minutes, 20 ticks 10 minutes, and 100 ticks 50 minutes. `observedTimestamp` in a markout gives the real resolving time.

## Known discrepancies

- `bookImbalance` is measured within 100 bps of mid (`bookFromLevels` in `src/book.ts`, and the `Book.imbalance` comment in `src/types.ts`). The catalog `meaning` in `src/jev-features.ts` and the Depth card footer describe it as top of book. [jev-model.md](jev-model.md#catalog-metadata-per-input) records the same mismatch.
- The catalog `meaning` for `tickMs` is "Tick time of day" and `Fields.tsx` labels it the same way, but the value is the configured interval between evaluations in milliseconds.
- The sparkline steps one x unit per sampled mid (five ticks) but places the after-decision points one x unit per tick, so the overlay is drawn stretched to the right compared with the trailing series. Prices and Right or Wrong labels are unaffected. [model-performance.md](model-performance.md#known-inconsistencies) lists it too.
- `returnsBps` reports `0` rather than null when the bot has too little history, for example just after a restart, so a zero return can mean no data.
