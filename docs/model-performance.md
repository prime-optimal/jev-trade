# Model Performance tab and Right and Wrong

This document describes the Performance view on `/model`, the one definition of Right and Wrong that both the Decisions tab and the Performance tab use, and where every number comes from. The Decisions tab itself is described in [Dashboard](dashboard.md#model-page). What Jev is sent is described in [Jev model contract](jev-model.md).

Everything below was read from code. Claims that could not be verified from this repository are marked `[unverified]`.

## Vocabulary

| Term | Meaning in code |
| --- | --- |
| Tick | One Jev evaluation. `Feed.tick` in [`src/feed.ts`](../src/feed.ts) counts them from 1 per feed. The wire fields `block` and `observedBlock` hold this tick number. It is not a Hyperliquid block height. |
| `tickMs` | Configured spacing between ticks. `TradingSettings.tickMs` in [`src/settings.ts`](../src/settings.ts), default 30000, allowed 5000 to 300000. Visitor sessions cannot go below 30000 (`paper-session-guard.ts`). `Feed.maybeTick` never fires sooner than `tickMs` after the previous tick, so real spacing can be slightly longer. |
| Markout | The price move after a decision, measured on the bot at fixed later ticks and stored on the decision row. |
| Bias | Jev's answer to the required `bias` question, `long` or `short`. See `ModelDecision.bias` in [`src/model.ts`](../src/model.ts). |
| Signed bps | Markout multiplied by +1 for `long` and -1 for `short`. Wire field `signedReturnBps`, dashboard field `Markout.signedBps`. |
| Measured | A markout whose `signedBps` is a finite number. |
| Pending | No markout object for that horizon, or one whose `signedBps` is not a finite number. Pending rows are excluded from every rate and mean. |

## Right and Wrong

This is the canonical definition. Both tabs read the same field, `summary.markouts[horizon].signedBps`, produced by `summarize` in [`web/src/app/model/record.ts`](../web/src/app/model/record.ts) from the stored `signedReturnBps`.

### The rule

For a decision at horizon `h` (1, 5, 20 or 100 ticks):

| Result | Condition | Where it is applied |
| --- | --- | --- |
| Right | `signedBps > 0` | `outcomeAt` in [`web/src/app/model/filters.ts`](../web/src/app/model/filters.ts) (rail Right filter), `right` in `Timeline` ([`Timeline.tsx`](../web/src/app/model/Timeline.tsx)), `hits` in `metricFor`, `grouped` and the calibration buckets of [`performance-metrics.ts`](../web/src/app/model/performance-metrics.ts). |
| Wrong | `signedBps <= 0`, including exactly 0 | `outcomeAt` returns `"wrong"` for anything measured that is not above zero. Timeline and Performance count it as "not right", so the Wrong share is one minus the Right share. |
| Neither (pending) | no measured `signedBps` at that horizon | `outcomeAt` returns `null`. The rail shows `n/a`, the record shows `pending`, the Timeline draws a small pending square, and Performance leaves the row out of `n`. |

There is no fourth category. A flat move is Wrong, not neutral, for filtering and for every percentage. The rail row, the Timeline hover readout and the record use different colors for exactly 0 (see [Known inconsistencies](#known-inconsistencies)).

### Which horizon

- Decisions tab: the horizon selected in the Timeline group (1t, 5t, 20t, 100t). It is stored in the URL as `h` and defaults to 5 (`DEFAULT_MODEL_HORIZON` in [`web/src/lib/model-url.ts`](../web/src/lib/model-url.ts)). It drives the rail column, the rail Right and Wrong filter, the Timeline bars, the "right after N ticks" score and the record's markout stat.
- Performance tab: "Hit rate by horizon" shows all four horizons at once. Every other panel (intent, leverage, calibration) is fixed at 5t. Performance ignores the selected `h`.

The horizons are hard coded in `scheduleMarkout` in [`src/trader-journal.ts`](../src/trader-journal.ts) (`pending: new Set([1, 5, 20, 100])`) and in `HORIZONS` in `record.ts`. The `horizonBlocks` setting does not change them. It only sizes the trailing windows sent to Jev (see [Outcome horizons versus the Price pane](#outcome-horizons-versus-the-price-pane)).

### Reference price and resolving price

Both prices are the Hyperliquid book midpoint, `(best bid + best ask) / 2`, computed by `bookFromLevels` in [`src/book.ts`](../src/book.ts) from the `l2Book` feed.

- Reference (decision time): `book.mid` read by `Market.readBook` at the start of `Trader.onBlock`. It is the same number stored in the `mid` input, so it equals the last point of `recentMids` that Jev saw. It is read before the model call, so it does not move while Jev is thinking.
- Resolving: the mid stored in `Trader.observations` for tick `decisionTick + h`. `onBlock` stores `book.mid` for every tick before doing anything else, so the resolving price is the mid at the start of tick `decisionTick + h`.

Hyperliquid data behind the mid: `Feed` subscribes to WebSocket channel `l2Book` (`{ type: "l2Book", coin, fast: true }`) and keeps the latest snapshot in `Feed.book`. When the socket is down it falls back to the HTTP info request `{ type: "l2Book", coin }` (`Feed.snapshot`). If one side of the book is empty, `bookFromLevels` synthesizes the missing side 5 bps away from the other. The mid is not the mark price, the oracle price or the last trade.

### Sign convention

The formula in `emitMarkouts` ([`src/trader-journal.ts`](../src/trader-journal.ts)):

```text
marketReturnBps = (observedMid - referenceMid) / referenceMid * 10000
signedReturnBps = marketReturnBps * direction
direction       = +1 if bias is long, -1 otherwise   (scheduleMarkout)
```

Right therefore means: Jev said long and the mid rose, or Jev said short and the mid fell.

| Decision | Direction used | Right when |
| --- | --- | --- |
| `buy` from open + long | +1 | mid rose |
| `sell` from open + short | -1 | mid fell |
| `hold` with bias long | +1 | mid rose |
| `hold` with bias short | -1 | mid fell |
| `close` with bias long (action `sell` when closing a long, `buy` when closing a short) | +1 | mid rose |
| `close` with bias short | -1 | mid fell |

Consequences that are easy to miss:

- The label depends on `bias` only. It ignores `intent`, `action`, order side, order size and leverage. `quoteAction` in [`src/plan.ts`](../src/plan.ts) derives the action from intent and bias, but `scheduleMarkout` never sees it. A regression test pins this: `test/trader.test.ts`, "hold and close markouts follow long and short bias rather than order direction".
- Hold is scored, not skipped. Jev's hold still carries a bias, and a markout is scheduled for every decision that is not null (`Trader.onBlock` calls `scheduleMarkout` right after `recordDecision`). A hold is Right when its bias direction was right, even though no order was placed. Hold rows are included in Timeline percentages and all Performance tables. Filter by call to separate them.
- A safe hold from invalid answers is scored too. `decideFromJevAnswers` in `src/model.ts` uses `biasPick ?? "long"`, so a decision with an unreadable bias answer is scored as a long call. Those rows are flagged invalid on the Decisions tab (`isInvalid`) but are still counted in Performance.
- A stale or late-tagged decision cannot trade but is still scored. `late` on a journaled decision is the `stale` flag of `Trader.onBlock`, `!live || block < this.latestScheduledBlock`: the run was no longer live when Jev answered, or a newer tick had already been scheduled.
- Leverage has no effect. The markout is a raw price move in bps, not scaled by leverage, size or notional. A 10x decision and a 1x decision with the same bias score identically.
- A decision with no result from Jev (`action` `no decision`, from a failed required group) has no markout at all (`Trader.onBlock` returns before `scheduleMarkout`). It is never Right or Wrong and adds nothing to any sample.

### Fees and slippage

Not included. The markout compares two midpoints. It does not subtract maker or taker fees (`Fill.feeUsd`), the quote price, the close slippage cap (`closeSlippageBps`, applied in `takerPrice` in `src/book.ts`), spread crossing or partial fills. Right and Wrong describe the market direction call. They do not say the trade made money. The same statement is in the [Jev model contract](jev-model.md#durable-decision-history): a good call can have poor execution.

Execution and PnL are shown separately: the record's Order and Outcome panels (quote, fills with `feeUsd`, closed PnL) and the Performance closed PnL curve. The curve does not subtract fees either, see [Closed PnL over time](#closed-pnl-over-time).

### Worked example

BTC, `tickMs` 30000, decision at tick 100. Jev answers bias `short`, intent `open`, leverage 5, so the action is `sell`. The reference mid is 100000.0.

| Horizon | Resolving tick | Resolving mid | Market bps | Signed bps (x -1) | Label |
| --- | --- | --- | --- | --- | --- |
| 1t | 101 | 99980.0 | -2.0 | +2.0 | Right |
| 5t | 105 | 100030.0 | +3.0 | -3.0 | Wrong |
| 20t | 120 | 100000.0 | 0.0 | 0.0 | Wrong (flat counts as not right) |
| 100t | 200 | not reached yet | none | none | Pending, excluded |

Arithmetic for 5t: `(100030 - 100000) / 100000 * 10000 = +3.0` market, times -1 gives -3.0 signed. The market rose, Jev said short, so the call was Wrong at 5t even though it was Right at 1t.

If the same tick were a `hold` with bias `long` and the mid were 100100.0 at 5t, the market move is +10.0 bps, signed +10.0, so it is Right, with no order placed.

Aggregate example for the 5t hit rate. Four measured decisions with signed bps +3.0, -2.0, 0.0 and +5.0:

```text
n = 4, hits = 2 (the +3.0 and +5.0), hit rate = 2 / 4 = 50%
mean bps = (3.0 - 2.0 + 0.0 + 5.0) / 4 = +1.5
```

A fifth decision still pending at 5t changes neither `n` nor the rate.

## Performance tab

Component: [`Performance.tsx`](../web/src/app/model/Performance.tsx). All numbers come from `computePerformance` in [`performance-metrics.ts`](../web/src/app/model/performance-metrics.ts), a pure function of the loaded `DecisionSummary[]`. `ModelView` builds that list with `history.rows.map(summarize)` and passes all of it. The Decisions rail filters, coin filter and selected horizon are not applied.

### Data path

```text
Trader.onBlock  ->  scheduleMarkout / emitMarkouts   (src/trader-journal.ts)
   -> DecisionJournalEvent { type: "markout", horizonTicks, observedMid, signedReturnBps, marketReturnBps, ... }   (src/decision-events.ts)
   -> decision_journal.markouts JSONB, keyed by String(horizonTicks)   (write in src/decision-store.ts)
   -> GET /decisions?limit=&before=  (operator-control.ts, paper-sessions.ts)  ->  DecisionStore.list
   -> Next gateway GET /api/session/decisions  (web/src/app/api/session/[...path]/route.ts)
   -> useDecisions (web/src/lib/useDecisions.ts)  ->  summarize (record.ts)  ->  computePerformance
```

`DecisionStore.list` in [`src/decision-store.ts`](../src/decision-store.ts) is owner scoped and orders by `created_at DESC, decision_id DESC`. Each row holds `markouts`, `fills`, `quote`, `decision` and `evidence`.

### Loaded history

- `useDecisions` requests 50 rows per page (`limit=50`) and follows `nextBefore` for older pages. The server clamps `limit` to 200 (`MAX_LIMIT`).
- The header text "Numbers cover N loaded decisions" is `summaries.length` including rows with no decision. Nothing outside the loaded pages counts. Load older appends 50 more rows and every panel recomputes.
- The tab covers all coins in the window together. There is one row per sleeve per tick, so with several enabled coins a page of 50 rows spans only a few ticks.
- Live refresh: when the SSE feed shows a new tick, `useDecisions.pullLatest` refetches the newest 50 rows and `mergeNewestPage` in [`web/src/lib/decisionMerge.ts`](../web/src/lib/decisionMerge.ts) merges them by decision id. Every incoming row replaces the loaded row with the same id (`byId.set`), markouts included, so a decision still inside the newest 50 picks up markouts as they resolve. Rows beyond the newest 50, and rows loaded through Load older, keep the markouts they had when they were fetched. A decision that was pending when such a row was loaded stays pending in the UI until Refresh or a page reload re-reads it, even though the database has since resolved it.

### Header and sample counters

| Text | Formula |
| --- | --- |
| Loaded decisions | `totalLoaded = summaries.length` |
| Measured 5t | `measuredAtFiveTicks` = count of summaries whose `markouts[5].signedBps` is finite |
| Calibrated | `calibratedAtFiveTicks` = measured 5t summaries whose `confidence` is not null and inside 0 to 1 |
| Small sample line | shown when `0 < measuredAtFiveTicks < 10` |
| Empty line | shown when `totalLoaded > 0` and `measuredAtFiveTicks === 0` |

The small-sample threshold is 10 everywhere (a per-row "small sample" tag when `0 < n < 10`). It is a warning label only. No confidence interval or significance test is computed.

### Hit rate by horizon

`metricFor` is run once per horizon in `HORIZONS`.

```text
values   = signedBps of every summary with a finite markouts[h].signedBps
n        = values.length
hits     = count(values > 0)
hitRate  = hits / n            (null when n = 0, displayed n/a)
meanBps  = sum(values) / n     (null when n = 0, displayed n/a)
```

- Denominator is measured decisions at that horizon only, so `n` differs by horizon: `n(1t) >= n(5t) >= n(20t) >= n(100t)` in practice.
- Zero counts in `n` and in the mean but not in `hits`.
- Includes hold, close, open, invalid, late and legacy rows, and every coin.
- Display: hit rate `Math.round(rate * 100)` followed by `%`. Mean bps through `fmtBps` with one decimal and an explicit sign, for example `+1.5 bps`. Mean bps is the plain average of signed bps, not a size weighted or compounded return.
- Data source: `signedReturnBps` produced by `emitMarkouts`, resolving mid described in [Reference price and resolving price](#reference-price-and-resolving-price).

### Hit rate by intent at 5t

`grouped(fiveTickRows, summary => summary.intent, "Unspecified")`.

- Population: the measured 5t rows only.
- Groups: the stored `decision.intent` (`open`, `close`, `hold`). A row with no intent goes to `Unspecified`.
- Per group: the same `n`, `hits`, `hitRate` and `meanBps` formulas as above, on 5t signed bps.
- Groups with no measured rows do not appear. Rows are sorted by label (`localeCompare`, numeric aware).
- Intent is the plan Jev chose while flat or holding a position. `liveIntent` in `src/plan.ts` converts a `close` answer to `hold` while flat, so `hold` includes both a real hold and a flat close.
- Because scoring uses bias, the `close` group is scored by the bias Jev attached to the close, not by the direction of the closing order.

### Hit rate by leverage at 5t

Same as intent, keyed by `${summary.leverage}x`, or `Unspecified` when leverage is null. Leverage is `decision.leverage`, parsed by `parseLeverage` in `src/plan.ts` and snapped to the nearest rung from `leverageRungs`: 1, 2, 3, 5, 10, 20, 40, 50 up to `maxLeverage`, plus `maxLeverage` itself when it is not already one of those rungs. Labels sort numerically (2x before 10x). This table shows whether higher leverage choices correlate with better direction calls. It does not show leveraged PnL, since markouts are not scaled by leverage.

### Closed PnL over time

`pnlCurve` in `computePerformance`:

```text
points = summaries with closedPnl not null and finite
sorted ascending by summary.time (decision timestamp)
pnl[i] = pnl[i-1] + closedPnl[i]        (cumulative, starts at 0)
```

- `summary.closedPnl` in `summarize` is the sum of `closedPnl` over the decision's fills, or null when no fill carries one. The chart caption "N recorded outcomes" counts these points. A fill with `closedPnl` 0 still makes a point.
- The x position is the decision time, not the fill time. A fill is attributed to the decision that placed the order that filled (`takeLiveFills` in `src/trades.ts` matches `orderId` to the resting order's `decisionId`). A close that fills on a later tick appears at the decision that placed the closing order, not at the decision that opened the position.
- Source: Hyperliquid `userFills`. Live fills arrive on the WebSocket subscription `userFills` (`Feed.onMessage`) and are reconciled with the info request `userFills` (`Market.reconcileUserFills`). The `closedPnl` and `fee` fields of each fill are copied into `Fill.closedPnl` and `Fill.feeUsd`, then journaled as a `fill` event by `Trader.recordFill`.
- Paper mode has no closed PnL. Simulated fills (`takeSimFills`, `Trader.simTakerFill`) never set `closedPnl`, so a paper run shows "No closed PnL is recorded in loaded history".
- Fees: the curve sums `closedPnl` only and does not subtract `feeUsd`. Whether Hyperliquid reports `closedPnl` gross or net of the fee is `[unverified]` here. The record's Outcome panel shows the fee per fill.
- Not included: unrealized PnL, funding, and fills whose `closedPnl` was missing.
- Chart scaling: y range is the min and max of 0 and every point, widened by 1 if flat. x is linear in time, or evenly spaced when all points share one timestamp. The axis labels are the first and last point times.
- This panel is independent of Right and Wrong. A Right call can lose money and a Wrong call can close profitably.

### Confidence calibration at 5t

`calibration` in `computePerformance`, using `CONFIDENCE_BUCKETS = [0, 0.2, 0.4, 0.6, 0.8, 1]`.

- Confidence source: `summary.confidence` from `summarize`. It is the `confidence` the provider attached to the required `bias` answer, only when that answer has status `answered`, is a choice, and its choice matches the decision's bias. Confidence is recorded only when the provider supplied a finite value from 0 to 1 (`finiteConfidence` in `src/jev-answers.ts`). It is never derived from probabilities. The mock model supplies none, so mock history has an empty calibration panel.
- Population: measured 5t rows with a non-null confidence.
- Bucketing: `confidenceBucket` puts `c` in bucket `i` when `edge[i] <= c < edge[i+1]`. The value 1 lands in the last bucket, so the last bucket is `[0.8, 1]`. Values outside 0 to 1 return null and are excluded.
- Per bucket:

```text
n              = rows in bucket
hits           = count(signedBps at 5t > 0)
hitRate        = hits / n           (null if n = 0)
meanConfidence = sum(confidence) / n (null if n = 0)
```

- The chart draws each bucket's bar at its bucket midpoint, `(lower + upper) / 2`, with height `max(1, hitRate * plotHeight)` pixels when `n > 0`. The diagonal is the line where hit rate equals that midpoint, so a bar on the diagonal means the bucket hit as often as the middle of its confidence range. Bars below the diagonal indicate overconfidence for that range. The chart does not plot mean confidence. Mean confidence appears only in the table beside it, so compare the table's mean confidence with its hit rate for a precise reading.
- Buckets with `n < 10` get the small sample tag. With five buckets, the sample per bucket is usually far smaller than the total.
- The bucket rate uses the bias direction call, the same Right definition as everywhere else. It is not calibration of the intent or leverage answers.

## Outcome horizons versus the Price pane

There are two different 5-tick numbers on `/model`. They measure different windows and will not match.

| | Price pane `5 ticks` (What Jev saw) | Outcome horizon `5t` (rail, Timeline, Performance) |
| --- | --- | --- |
| Window | The 5 ticks before the decision | The 5 ticks after the decision |
| Known when | At decision time, sent to Jev | Only after tick `decisionTick + 5` |
| Field | `returnsBps.last5` input | `markouts["5"].signedReturnBps` and `marketReturnBps` |
| Producer | `Trader.buildState`, `ret(5)` in [`src/trader.ts`](../src/trader.ts) | `emitMarkouts` in [`src/trader-journal.ts`](../src/trader-journal.ts) |
| Formula | `(mid[now] - mid[now-5]) / mid[now-5] * 10000` over `Trader.mids` | `(mid[t+5] - mid[t]) / mid[t] * 10000`, then times bias direction |
| Signed by bias | No, raw market move | Yes for `signedBps`, raw for `marketBps` |
| Short history | `ret(k)` returns 0 unless more than `k` mids are stored, so early ticks show `0.00 bps`, not an error | Missing until the resolving tick arrives |

Details:

- `Trader.mids` gets one `book.mid` per tick (`onBlock`), capped at 400. The trailing returns `last1`, `last5`, `last20` and `last100` are tick based, not clock based. After a bot restart the array is empty again.
- `recentMids` is `mids.slice(-horizonBlocks)` (`horizonBlocks` default 100) sampled every 5th value counting back from the newest. Its last point is the current mid, which is the markout reference price. Its spacing is 5 ticks per point.
- The "after decision" segment of the Price sparkline comes from the stored markouts, not from the input. `PriceCard` in [`MarketCards.tsx`](../web/src/app/model/MarketCards.tsx) plots `markouts[h].observedMid` for h = 1, 5 and 20 (not 100). The Right and Wrong label uses `signedBps`, which multiplies by bias direction. The plotted mid is the raw market price, so a Wrong short call draws a rising line.
- Clock time: tick spacing is `tickMs`. At `tickMs` 30000 (default) 5t is about 2.5 minutes, 20t about 10 minutes and 100t about 50 minutes. At 60000, 5t is 5 minutes. The rail header and the record label horizons in ticks, not seconds. The record's `observedTimestamp` gives the real resolving time.

## Caveats

- Pending can be permanent. `Trader.markouts` and `Trader.observations` are in memory only (`Trader` fields). A markout resolves only if the same trader is still running when tick `t + h` arrives. Not resolved: bot restart, run expiry or Stop (`onBlock` returns immediately when `isRunLive()` is false, before observations are stored), a rebuild that creates a new trader, and a tick that fails before the observation is stored. A decision in these cases stays pending in the database forever.
- Default run length versus 100t. The default run lasts 30 minutes (`durationMinutes` 30 in `execution-runtime.ts`, `runDurationMinutes` 30 in settings). At `tickMs` 30000 that is about 60 ticks, so 100t markouts cannot resolve inside a default run, and decisions in the last 20 ticks never get a 20t markout. Expect n to shrink sharply from 1t to 100t.
- Markouts overlap. Consecutive ticks share most of their 20t and 100t windows, so measured decisions are heavily correlated and the effective sample is much smaller than `n`. There are also several sleeves per tick that trade correlated coins.
- Coins are pooled. There is no per-coin split on the Performance tab. Use the Decisions tab coin filter to look at one coin. The 5t hit rate differs from the Timeline score whenever filters are active, because the Timeline honors them and Performance does not.
- History window. Only loaded pages count, newest first. A shorter window than the whole journal can bias a rate toward the current regime. `decision-store.ts` never deletes `decision_journal` rows (it only clears pending observation staging rows), so older history stays reachable through Load older.
- Owner scoping. Visitors see only their own owner's rows. The operator session sees the internal operator owner.
- Each rate has no benchmark. In a rising market a coin flip on bias is about the base rate of up moves at that horizon. A mean above zero with a hit rate near 50 percent can come from a few large moves.
- Late and stale rows are included. Decisions flagged `late` because they were stale (see the sign convention notes above) are still scored. A `late` tick with no Jev decision has no markout and is not in any sample.
- Tick numbers restart per feed. `block` values in the journal are not globally unique across restarts. Markouts are keyed by `decisionId`, not by block.
- The `horizonBlocks` setting shown in Settings sizes the Jev input windows. It does not change the outcome horizons.

## Known inconsistencies

Found while tracing Right and Wrong through the two tabs. The definition (`signedBps > 0`) is applied identically in every counter. The differences below are presentation, not scoring.

1. Exactly 0 signed bps is drawn three ways.
   - `DecisionRail.tsx` gives it `data-sign="flat"` (neutral).
   - `Execution.tsx` and `RecordView.tsx` use `signOf`, which returns undefined for 0 (neutral).
   - `Timeline.tsx` colors the hover readout `focusValue > 0 ? "pos" : "neg"` and draws the bar downward from the zero line, so 0 looks Wrong.
   - The Right and Wrong filter (`outcomeAt`) and all percentages treat 0 as Wrong. `test/model-filters.test.ts` has a test named "classifies right, wrong, flat, and pending markouts at the selected horizon" but asserts `outcomeAt(withMarkout("hold", 0), 5)` is `"wrong"`, so there is no flat category.
2. Pending wording differs. The rail shows `n/a`, the record stat and Outcome panel show `pending`, and the Timeline readout shows `Nt pending`. All mean the same: no measured `signedBps` at that horizon. The rail tooltip says "No N tick markout recorded".
3. The Timeline and Performance can disagree on the same horizon. Timeline `right` is computed on the filtered set, Performance on all loaded rows. With no filters active the 5t Timeline share and the Performance "All" row at 5t are the same set and formula.
4. The Price sparkline mixes units. In `Sparkline` in `MarketCards.tsx` the x position is `index / span` where `span = (series.length - 1) + lastAfterHorizon`. Each `recentMids` point is one x unit but spans 5 ticks (the sampling in `Trader.buildState`), while each after-decision point is placed `horizon` x units after the last point, one unit per tick. The after-decision path is therefore drawn about 5 times longer (stretched to the right) per tick than the trailing series. Only the geometry is affected. The plotted prices and the Right and Wrong labels are correct.
5. Hold is scored by bias, and the bias is visible but the scoring is not explained. The rail Plan column, the record and the Timeline readout show intent, bias and leverage (for example `hold long 3x`), but nothing in the UI says the markout is scored by that bias. A hold with a positive markout can look like a good outcome for a decision that took no risk, and a hold can be Wrong. This is intended (`test/trader.test.ts`). Filter calls to hold to see the hold-only rate.

Doc clarification, not a code inconsistency: the Performance paragraph in [`dashboard.md`](dashboard.md) says pending markouts are excluded. More exactly, each horizon excludes rows whose `signedBps` is not finite, and the 5t-only panels drop the whole row when its 5t markout is pending even if 1t is measured.
