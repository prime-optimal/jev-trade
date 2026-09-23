# Trading behavior

## Runs own execution

The Bun process starts its public and private HTTP services and prepares stopped execution resources, but it starts Off. It does not trade on startup. If a transport is temporarily unavailable, the affected sleeve remains visible with its failure and retries while Off; recovery prepares the sleeve but does not start decisions or orders. Only the private operator API can start the shared executor. Start requires at least one ready sleeve, starts only the available sleeves, and leaves unavailable sleeves retrying without fabricated decisions for their missing feeds.

Each Start creates a new `runId` and a full configured duration, 30 minutes by default. The lifecycle records authoritative `startedAt`, `deadlineAt`, `stoppedAt`, `durationMs`, and `stopReason` timestamps. An absolute wall-clock deadline and a monotonic deadline guard prevent a clock rollback from extending a run. The scheduled timer is only a wake-up. Guards also reject work after awaited inference and before order submission.

Expiry invalidates execution immediately, stops scheduling, and runs the same cleanup as manual Off. The cleanup cancels only bot-owned resting orders for the affected coin. It is bounded to ten seconds for the lifecycle response, but a timed-out cleanup keeps running and remains tracked. `attention-required` blocks Start. Reconcile reports that cleanup is still pending until the in-flight work settles, then either completes the transition or retries a failed cleanup.

Stop does not liquidate an accepted position and does not revoke wallet authorization. Already submitted work may need reconciliation. Expired and manually stopped runs never restart automatically. A failed sleeve may recover resources while Off, but it cannot start work until an operator starts a run. Process restart starts Off rather than restoring an old run.

Live orders carry a stable Jev client-order-ID namespace with the Hyperliquid asset ID. On startup, each coin discovers matching namespaced orders left by an earlier process, reconciles pending order status through the venue, and cleans up only those orders. Orders for another coin and orders without the Jev namespace, including legacy orders, are never canceled by this recovery. The process warns that unidentified orders need manual review.

## Settings and mode

Operator Save applies one validated settings snapshot only while Off or Expired. It builds the replacement executor and its feeds before the new values become applied. A failed replacement is discarded and the previous executor is resumed unchanged; its retry callbacks cannot run inside the replacement transaction. Guest browser settings do not affect Bun execution.

Paper mode is the default. `DRY_RUN` must be the exact string `false` to select real mode from environment configuration. Real Start additionally requires a configured wallet for the relevant sleeve, matching official network endpoints, a successful preflight, and explicit confirmation. A missing wallet cannot place real orders. Brave Wallet is not part of this implementation.

A custom transport may pass metadata, WebSocket, and SDK RPC connectivity checks. Real mode remains disabled because the implementation cannot prove a custom endpoint's network identity. Selecting an official endpoint from the other network is rejected.

## Sleeves and wallets

One sleeve is created for each enabled coin. Supported coins are BTC, ETH, SOL, DOGE, and BNB. Wallet resolution follows this order:

1. Read coin keys from `.wallets.json`, if present.
2. Overlay keys from `WALLETS_JSON`.
3. Use `PRIVATE_KEY` for the first configured coin if that coin has no mapped key.

Each sleeve has its own `Market`, `Feed`, `Trader`, position, order state, and optional wallet. Paper entries rest in the local order map and match observed trade prints. Paper exits fill immediately at the calculated crossing price.

## What Jev answers

On every scheduled decision tick while Running, [`Trader.onBlock()`](../src/trader.ts) builds a trade state from the latest book, recent mids and trades, position, indicators, venue context, and maximum leverage. It asks Jev for bias, intent, and cross leverage even when an earlier Jev request is still pending. Intent is `open` or `hold` while flat, and `open`, `close`, or `hold` with a position.

Only the newest still-live result may execute. A result that returns after a newer tick or after Stop or expiry is stale, so its exchange work is suppressed. The Jev call still occurred and is not rewritten as a hold.

## Order mechanics

Entries are post-only Hyperliquid `Alo` limits. The quote moves `QUOTE_INSIDE_TICKS` inside the touch, one tick by default, without crossing the spread. A changed same-side order is modified. An identical order remains unchanged.

Exits are reduce-only `Ioc` limits. They cross the far touch by `CLOSE_SLIPPAGE_BPS`, five basis points by default. The market cancels its owned resting entry before an exit. An unfilled IOC leaves no resting order.

Jev chooses leverage on every decision. The trader writes cross leverage before maker entries unless the venue account already has that value. It skips leverage writes for exits. Paper mode records the normalized leverage without a venue request.

## Product rules

While Running, Jev makes the trading decision from the price feed on every scheduled Hyperliquid decision tick. Hold is a real Jev answer. It is not a skipped tick. Failed calls are recorded as failures, not presented as hold, and stale overlapping results cannot place orders.

The market stream and dashboard remain available while Off. Their availability never means orders or Jev decisions are running.
