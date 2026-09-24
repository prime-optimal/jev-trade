# Trading behavior

## Runs own execution

The Bun process starts its public and private HTTP services and prepares execution resources. In paper mode, process startup arms exactly one timed run after the configured settings and duration have been applied; it starts when the first sleeve becomes ready. A temporarily unavailable sleeve remains visible with its failure and retries while Off until that first ready sleeve starts the run. In real mode, startup remains Off and only the private operator API can start the shared executor after explicit confirmation. Start requires at least one ready sleeve, starts only the available sleeves, and leaves unavailable sleeves retrying without fabricated decisions for their missing feeds.

Each Start creates a new `runId` and a full configured duration, 30 minutes by default. The lifecycle records authoritative `startedAt`, `deadlineAt`, `stoppedAt`, `durationMs`, and `stopReason` timestamps. An absolute wall-clock deadline and a monotonic deadline guard prevent a clock rollback from extending a run. The scheduled timer is only a wake-up. Guards also reject work after awaited inference and before order submission.

Expiry invalidates execution immediately, stops scheduling, and runs the same cleanup as manual Off. The cleanup cancels only bot-owned resting orders for the affected coin. It is bounded to ten seconds for the lifecycle response, but a timed-out cleanup keeps running and remains tracked. `attention-required` blocks Start. Reconcile reports that cleanup is still pending until the in-flight work settles, then either completes the transition or retries a failed cleanup.

Stop does not liquidate an accepted position and does not revoke wallet authorization. Already submitted work may need reconciliation. Expired and manually stopped runs never restart automatically, so the paper startup behavior does not loop. A failed sleeve may recover resources while Off, but it cannot restart an expired or manually stopped run. Restarting the process arms a new paper run rather than restoring the old run; real mode restarts Off and still requires a private, confirmed Start.

Live orders carry a stable Jev client-order-ID namespace with the Hyperliquid asset ID. On startup, each coin discovers matching namespaced orders left by an earlier process, reconciles pending order status through the venue, and cleans up only those orders. Orders for another coin and orders without the Jev namespace, including legacy orders, are never canceled by this recovery. The process warns that unidentified orders need manual review.

## Settings and mode

Local operator Save applies one validated settings snapshot only while Off or Expired. It builds the replacement shared executor and feeds before the new values become applied. A failed replacement is discarded and the previous executor resumes unchanged.

Remote visitors do not control that executor. Each visitor gets a keyless paper runtime in a separate Bun Worker. It starts Off and waits for the visitor to configure, Save, and Start. Save applies settings to that Worker. Start, Stop, expiry, in-memory history, and simulated positions also belong only to it. A visitor can select official mainnet or testnet market data, assets, duration, and numeric paper controls. Real mode, wallet or transport credentials, custom destinations, and a decision cadence below 30000 ms are rejected.

If visitor cleanup reaches `attention-required`, Start remains blocked. Settings offers Reset paper run, which retries reconciliation. Refresh resumes the same Worker and its applied settings. If the capability is removed, the session expires, or the bot restarts, the UI requires an explicit Reconnect. The new session starts Off with defaults and fresh execution state. When durable decision storage is enabled, a signed owner cookie can associate the new session with the same decision-history owner. The cookie does not authorize reads without the new active capability.

Paper mode remains the default for the shared executor. `DRY_RUN` must be the exact string `false` to select shared real mode from environment configuration. In real mode, a sleeve with no configured wallet key still runs as paper; only keyed sleeves can place real orders. Real Start additionally requires matching official network endpoints, a successful preflight, and explicit confirmation through the local operator channel. Brave Wallet is not part of this implementation.

A custom transport may pass metadata, WebSocket, and SDK RPC connectivity checks for the local operator. Shared real mode remains disabled because the implementation cannot prove a custom endpoint's network identity. Selecting an official endpoint from the other network is rejected.

## Sleeves and wallets

One sleeve is created for each enabled coin. Supported coins are BTC, ETH, SOL, DOGE, and BNB. Wallet resolution follows this order:

1. Read coin keys from `.wallets.json`, if present.
2. Overlay keys from `WALLETS_JSON`.
3. Use `PRIVATE_KEY` for the first configured coin if that coin has no mapped key.

Each sleeve has its own `Market`, `Feed`, `Trader`, position, order state, and optional wallet. Paper entries rest in the local order map and match observed trade prints. Paper exits fill immediately at the calculated crossing price.

## What Jev answers

On every scheduled decision tick while Running, [`Trader.onBlock()`](../src/trader.ts) captures the active validated Jev program once, including its revision, group inputs, and resolved questions. The allowlisted market-facing feature projection excludes wallet and lifetime fields. The capture is made before provider calls are awaited, and it records the inputs used for that evaluation. The complete feature catalog and question wording live in the [Jev model contract](jev-model.md).

Model calls may overlap, so a slow evaluation does not cause the next scheduled tick to be skipped. Each evaluation gets a UUID before its model call. The required group determines the decision; observational groups are journaled when they finish and never alter or suppress it. Explicit hold is complete. An unreadable required answer becomes a safe hold with invalid evidence.

Only the newest still-live result may execute. A result that returns after a newer tick or after Stop or expiry is stale, so its exchange work is suppressed. It remains a recorded evaluation and is not rewritten as a hold. A required provider failure or timeout is journaled without a decision, order, or dashboard decision.

At 1, 5, 20, and 100 later ticks, the journal adds both the market return and the return signed to Jev's long or short bias. This includes hold and close decisions, so reviewers can measure the directional answer separately from quote and fill execution.

## Order mechanics

Entries are post-only Hyperliquid `Alo` limits. The quote moves `QUOTE_INSIDE_TICKS` inside the touch, one tick by default, without crossing the spread. A changed same-side order is modified. An identical order remains unchanged.

Exits are reduce-only `Ioc` limits. They cross the far touch by `CLOSE_SLIPPAGE_BPS`, five basis points by default. The market cancels its owned resting entry before an exit. An unfilled IOC leaves no resting order.

Jev chooses leverage on every decision. The trader writes cross leverage before maker entries unless the venue account already has that value. It skips leverage writes for exits. Paper mode records the normalized leverage without a venue request.

## Product rules

While Running, Jev makes the trading decision from the price feed on every scheduled Hyperliquid decision tick. Hold is a real Jev answer. It is not a skipped tick. Failed calls are recorded as failures, not presented as hold, and stale overlapping results cannot place orders.

The market stream and dashboard remain available while Off. Their availability never means orders or Jev decisions are running.
