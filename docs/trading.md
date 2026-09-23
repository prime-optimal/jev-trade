# Trading behavior

## Runs own execution

The Bun process starts its public and private HTTP services and prepares execution resources. In paper mode, process startup arms exactly one timed run after the configured settings and duration have been applied; it starts when the first sleeve becomes ready. A temporarily unavailable sleeve remains visible with its failure and retries while Off until that first ready sleeve starts the run. In real mode, startup remains Off and only the private operator API can start the shared executor after explicit confirmation. Start requires at least one ready sleeve, starts only the available sleeves, and leaves unavailable sleeves retrying without fabricated decisions for their missing feeds.

Each Start creates a new `runId` and a full configured duration, 30 minutes by default. The lifecycle records authoritative `startedAt`, `deadlineAt`, `stoppedAt`, `durationMs`, and `stopReason` timestamps. An absolute wall-clock deadline and a monotonic deadline guard prevent a clock rollback from extending a run. The scheduled timer is only a wake-up. Guards also reject work after awaited inference and before order submission.

Expiry invalidates execution immediately, stops scheduling, and runs the same cleanup as manual Off. The cleanup cancels only bot-owned resting orders for the affected coin. It is bounded to ten seconds for the lifecycle response, but a timed-out cleanup keeps running and remains tracked. `attention-required` blocks Start. Reconcile reports that cleanup is still pending until the in-flight work settles, then either completes the transition or retries a failed cleanup.

Stop does not liquidate an accepted position and does not revoke wallet authorization. Already submitted work may need reconciliation. Expired and manually stopped runs never restart automatically, so the paper startup behavior does not loop. A failed sleeve may recover resources while Off, but it cannot restart an expired or manually stopped run. Restarting the process arms a new paper run rather than restoring the old run; real mode restarts Off and still requires a private, confirmed Start.

Live orders carry a stable Jev client-order-ID namespace with the Hyperliquid asset ID. On startup, each coin discovers matching namespaced orders left by an earlier process, reconciles pending order status through the venue, and cleans up only those orders. Orders for another coin and orders without the Jev namespace, including legacy orders, are never canceled by this recovery. The process warns that unidentified orders need manual review.

## Settings and mode

Local operator Save applies one validated settings snapshot only while Off or Expired. It builds the replacement shared executor and feeds before the new values become applied. A failed replacement is discarded and the previous executor resumes unchanged.

Remote visitors do not control that executor. Each visitor gets a keyless paper runtime in a separate Bun Worker. It starts Off and waits for the visitor to configure, Save, and Start. Save applies settings to that Worker. Start, Stop, expiry, history, and simulated positions also belong only to it. A visitor can select official mainnet or testnet market data, assets, duration, and numeric paper controls. Real mode, wallet or transport credentials, custom destinations, and a decision cadence below 30000 ms are rejected.

If visitor cleanup reaches `attention-required`, Start remains blocked. Settings offers Reset paper run, which retries reconciliation. Refresh resumes the same Worker and its applied settings. If the capability is removed, the session expires, or the bot restarts, the UI requires an explicit Reconnect. The new session starts Off with defaults and empty history; it cannot recover the prior run.

Paper mode remains the default for the shared executor. `DRY_RUN` must be the exact string `false` to select shared real mode from environment configuration. In real mode, a sleeve with no configured wallet key still runs as paper; only keyed sleeves can place real orders. Real Start additionally requires matching official network endpoints, a successful preflight, and explicit confirmation through the local operator channel. Brave Wallet is not part of this implementation.

A custom transport may pass metadata, WebSocket, and SDK RPC connectivity checks for the local operator. Shared real mode remains disabled because the implementation cannot prove a custom endpoint's network identity. Selecting an official endpoint from the other network is rejected.

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

## Bounded follow-on roadmap

Provisional release scope, pending final review against integrated #22 and #23: Brave Wallet plus finite browser-session trading is the only current release scope. This statement is a release boundary, not a claim that the browser migration has been verified. The earlier implementation descriptions remain unchanged here; #22/#23 final review must align them with the integrated behavior before closing #25.

Browser closure ends browser-owned execution and may leave resting orders or open positions. Closing the browser is not a confirmed cancellation or liquidation. A wallet connection does not make execution unattended.

None of the following six milestones is implemented by this roadmap:

1. Coinbase injected EVM extension. Require explicit EIP-6963 wallet selection and real Hyperliquid testnet checks for account access, chain selection, and typed-sign agent approval. Smart accounts and passkeys require separate qualification.
2. OKX extension. Use EIP-6963 when available, otherwise the official `window.okxwallet` provider. Test coexistence with other injected wallets. Do not invent an RDNS identifier or claim typed-sign support without testing it. Enable only after real Hyperliquid testnet agent approval. Mobile OKX Connect is distinct from WalletConnect.
3. WalletConnect mobile. Require a maintained EIP-1193 provider, a public project ID, explicit Arbitrum namespaces, and only the necessary methods. Qualify QR and deep-link flows, rejection, expiry, disconnect, and session restoration. Never restore Running or persist an agent key. Document metadata disclosed to third parties. Closing the desktop browser still ends execution, even if the mobile wallet remains connected.
4. Longer or unbounded runs. Longer finite runs already fit the current duration validation; this roadmap does not add a new run mode. Any unbounded mode must preserve independent agent expiry, freshness guards, Stop, sleep and visibility handling, and owned-order cleanup. Define what happens when authorization expires. Removing the run timer does not provide 24/7 execution.
5. Unattended execution. Design a separate hosted or desktop worker before implementation. Specify signer custody, restart and upgrade behavior, funding and loss policy, user control, and recovery from ambiguous order outcomes. Never silently restore Railway wallet execution.
6. Inference-key BYOK. User-supplied credentials are inference keys only, never wallet or agent keys. Before implementation, define privacy, transport, retention, logging, browser exposure, provider handling, and the address-free inference boundary. This roadmap prescribes no credential storage.

Keep wallet adapters, run policy, execution ownership, and inference credential selection separate. Every future wallet must pass direct-browser Hyperliquid testnet agent approval, order placement, cancellation, and privacy checks before release. Do not add backend accounts or send wallet addresses, account data, orders, wallet keys, or agent keys through Bun or Next. Inference must remain address-free.
