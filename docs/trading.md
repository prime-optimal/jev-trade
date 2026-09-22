# Trading behavior

## Sleeves and wallets

[`src/sleeves.ts`](../src/sleeves.ts) creates one sleeve per coin in `HL_COINS`. The default list is BTC, ETH, SOL, DOGE, and BNB. Each sleeve has its own `Market`, `Feed`, `Trader`, position, order state, and optional wallet.

Wallet resolution follows these rules:

1. Read coin keys from `.wallets.json`, if present.
2. Overlay keys from `WALLETS_JSON`.
3. Use `PRIVATE_KEY` for the first listed coin only when that coin has no key from the wallet map.

A sleeve without a key runs in dry-run mode. `DRY_RUN=true` disables live trading for every sleeve even when keys exist. Dry-run entries rest in the local order map and match against observed trade prints. Dry-run exits fill immediately at the calculated crossing price.

## What Jev answers

On every available decision tick, [`Trader.onBlock()`](../src/trader.ts) builds a [`TradeState`](../src/model.ts) from the latest book, recent mids and trades, position, indicators, venue context, and the coin's maximum leverage. [`jevQuestions()`](../src/model.ts) asks three independent choice questions:

- Bias: `long` or `short`.
- Intent: `open` or `hold` while flat. With a position, the choices are `open`, `close`, or `hold`.
- Cross leverage: one of the valid integer rungs up to the venue maximum.

The standard leverage rungs are 1, 2, 3, 5, 10, 20, 40, and 50. The exact venue maximum is appended when it is not already present.

[`decideFromJevAnswers()`](../src/model.ts) normalizes the choices and probabilities. An unreadable bias forces `hold`. While flat, a `close` answer also becomes `hold`. The chosen leverage is rounded to the nearest valid rung. [`planQuote()`](../src/plan.ts) then maps the result:

| Intent | Position | Result |
| --- | --- | --- |
| `hold` | Any | No order. Cancel the resting entry. |
| `open` plus `long` | Any | Buy the configured quote size. |
| `open` plus `short` | Any | Sell the configured quote size. |
| `close` | Long | Sell the full live position, reduce-only. |
| `close` | Short | Buy the full live position, reduce-only. |

## Order mechanics

Entries are post-only Hyperliquid `Alo` limit orders. [`quotePrice()`](../src/book.ts) places them `QUOTE_INSIDE_TICKS` inside the touch, with a default of one tick. If that would cross the spread, it joins the touch. A same-side order with changed price or size is modified in place. An identical order remains unchanged.

Exits are reduce-only `Ioc` limits for the full position. [`takerPrice()`](../src/book.ts) crosses beyond the far touch by `CLOSE_SLIPPAGE_BPS`, five basis points by default, and rounds away from the spread. Before sending an exit, the market cancels its resting entry. An unfilled `Ioc` leaves no resting order.

`hold` calls `cancelResting()`. This matters because an old entry could otherwise fill after Jev withdrew the intent.

## Leverage

Jev chooses leverage on every decision. The trader writes cross leverage before maker entries, unless the venue account already has that value. It skips the leverage write for exits because the close does not depend on a new margin setting. Dry-run mode accepts the normalized value without a venue request.

## Mock model

`MODEL=mock` selects [`MockModel`](../src/model.ts). It is a deterministic stand-in based on 20-tick return, book imbalance, trade-flow imbalance, and tick-derived noise. It produces the same bias, intent, leverage, probability, and timing shape as Jev. Weak signals hold, and signals opposing an open position close it. It is for local behavior without an API call, not a substitute for the Jev product path.

## Testnet and mainnet safety

`HL_TESTNET` defaults to testnet. Only the exact string `false` selects mainnet. Live signing also requires a sleeve key and `DRY_RUN` not equal to `true`. The process clears its own open orders for a coin when a live sleeve initializes.

Before mainnet, verify `HL_TESTNET=false`, wallet assignment by coin, quote notional, and the active model. A missing key does not fail startup. It silently makes that sleeve a dry run, with the mode printed at startup and exposed in process metadata only as the aggregate `dryRun` flag.

## Product rules

Jev makes the buy or sell decision from the price feed on every Hyperliquid decision tick. Code may normalize malformed answers and translate Jev's intent into an order, but indicators never gate the call. Known exception: late ticks, described below and in [jev-provider.md](jev-provider.md), are emitted without a Jev call. See the Known issues section of [CHANGELOG.md](../CHANGELOG.md).

`hold` is a Jev answer. It is not a skipped tick. Never force a buy or sell to keep an order active. A late tick means the prior Jev call is still running or Jev is temporarily paused after a credit error. It is recorded as late and must not be presented as a Jev hold decision.
