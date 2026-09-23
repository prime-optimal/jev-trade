# Trading behavior

## Browser sessions own execution

The dashboard uses one browser-local [`session.ts`](../web/src/lib/trading/session.ts), with [`feed.ts`](../web/src/lib/trading/feed.ts) and [`trader.ts`](../web/src/lib/trading/trader.ts) providing the #22 feed and decision loop. [`SettingsProvider.tsx`](../web/src/lib/trading/SettingsProvider.tsx) integrates them for #23. Bun handles address-free Jev inference only. Neither Bun nor Next receives wallet identities, raw account snapshots, or order records, or executes orders for visitors. There is no server-side visitor Worker, server wallet executor, backend control address, session gateway, private operator API, or SSE feed.

The browser sends wallet approval requests directly to Brave Wallet and account and exchange requests directly to Hyperliquid. Only `JevRequest` crosses the application boundary through [`web/src/lib/jev.ts`](../web/src/lib/jev.ts) to `/decide`, with credentials omitted and no referrer. Wallet identity, account snapshots, and order records must not enter that request.

Public data stays available while disconnected or stopped. Disabled markets remain visible. Their presence, or a healthy feed connection, is not permission to trade.

## Connection, authorization, and mode

Connecting Brave Wallet selects an owner. It does not authorize trading. Agent authorization is a separate explicit wallet action and does not start a run. Changing accounts or networks does not transfer a running session to the new identity. Wallet connection, agent authorization, run policy, execution ownership, and inference are separate concerns.

Paper execution simulates orders and balances locally. It does not submit exchange orders or spend wallet funds. Its account values are simulation values, not a claim about the connected wallet. Real execution requires matching owner and network authorization and explicit confirmation of whole-account net-position management. An unavailable real authorization is an error, not permission to silently fall back to paper.

Account equity and withdrawable balance belong to one owner account, not to each coin. Positions are venue net positions. Real execution can therefore affect an existing position on an enabled market, including exposure opened outside this application. The dashboard shows owner equity once and market-specific positions separately.

## Finite runs

Only explicit On or Start begins a fresh run. Duration defaults to 30 minutes and accepts longer valid finite settings. The session computes an absolute deadline. In real mode it also limits the run to the authorization expiry minus a safety margin. The UI countdown displays that deadline; it does not enforce it by itself.

Connect, authorize, Save, navigation, reload, reconnection, and visibility changes never start or extend execution. The current session API has no separate pause or Resume operation. There is no automatic resume after reload or recovery, and no silent signer restoration. A later explicit On starts a new run rather than restoring the previous deadline.

Submission guards reject work outside a running session, after its deadline, or against stale market data. Session invalidation prevents late Jev results from placing new orders. A request already submitted to the venue may still need reconciliation.

## Stop, End, and owned-order cleanup

Stop and deadline expiry invalidate execution before cleanup. Ending the session is not an instruction to liquidate positions. Cleanup drains pending exchange work and attempts to cancel only orders recorded by exact client order ID, or `cloid`, as owned by this session. A shared namespace is not evidence of ownership. Cleanup does not cancel unrelated manual orders or another application's orders.

Successful cleanup releases local session resources and clears its signing capability. Clearing the browser signer is not revoking the agent at Hyperliquid. Stop and End neither close accepted positions nor promise venue revocation.

Cleanup has a bounded wait. If owned orders remain unresolved or cleanup times out, the session reports attention required and blocks a new run. Reconciliation must settle the uncertain work before execution can start again. An error is not a hold decision or successful cancellation.

Wallet changes stop new signing but retain exact-owned cancellation until cleanup or explicit End. Reconciliation uses the original owner and a dedicated network transport, even after reconnecting another wallet. Approval expiry disables all signing, including cancellation, without discarding unresolved cleanup state. Orders still open after expiry require venue-side cancellation before reconciliation can release the session.

Order, leverage, and cancellation deadlines are passed as SDK execution options, not action fields. Long finite run deadlines use bounded timer intervals rather than overflowing browser timers.

The order journal is browser-session state, not a server recovery service. A reload or browser closure must not be presented as proof that venue orders were canceled. Inspect the venue for outstanding orders and positions after an interrupted cleanup.

## Browser lifetime

Execution needs an awake browser, fresh market data, and direct venue connectivity. Visibility, offline, sleep, freshness, and deadline guards stop further execution when detected. Reconnecting or returning to the page does not restart it.

A suspended or closed browser cannot guarantee timely cancellation. Venue positions and resting orders can outlive the tab. There is no server execution fallback, and a finite local deadline is not an exchange-enforced liquidation or cancellation guarantee.

## What Jev answers

While running, the browser trader asks Jev for the trading decision from the public price feed on each decision tick. Jev chooses buy, sell, or hold; application code does not substitute a forced trade. Hold is a real answer, not a skipped tick.

Only a still-current result in a live session may produce exchange work. Results invalidated by a newer tick, Stop, or expiry cannot place orders. Failed inference and stale results remain distinct from hold.

## Order mechanics

Entries use post-only Hyperliquid `Alo` limits. Exits use reduce-only `Ioc` limits. An exit cancels the session's owned resting entry before submitting its closing order. An unfilled IOC does not leave a resting order.

Jev chooses leverage. Real entries apply cross leverage through the direct exchange transport; paper execution records simulated leverage without a venue write. Market enablement, metadata, account readiness, and session guards still apply before submission.

Paper resting entries match observed market trades. Simulated execution does not establish that a corresponding real order would fill. Paper results and real account state must remain visibly separate.

## Verification boundary

The demo remains a live Jev trading bot on Hyperliquid. Jev makes the buy or sell decision from the price feed on every Hyperliquid decision tick while running, and real mode executes real trades from the authorized wallet. Hold remains Jev's choice. These product rules do not establish that a wallet exercise has passed.

The market stream and dashboard remain available while Off. Their availability never means orders or Jev decisions are running.

## Verification boundary

Documentation of the browser session contract is not proof of a completed Brave Wallet approval or live trade. Real-mode release proof requires an explicit Brave Wallet exercise on Hyperliquid testnet with observed agent approval, order placement, cancellation, interruption recovery, and privacy checks. Private keys and agent keys must stay in the browser and never enter Bun, Next, logs, or proof artifacts. A private-key-only test or paper simulation does not prove the Brave Wallet approval flow.

No such wallet exercise is established by this documentation update. Do not report wallet authorization, real order submission, cleanup, or interruption recovery as verified without its observed outcome.

## Bounded follow-on roadmap

Brave Wallet plus finite browser-session trading is the current release scope. The behavior above reflects the integrated #22, #23, and #24 contract, not a claim that live-wallet verification has passed. This roadmap does not commit to additional wallets, unbounded runs, or unattended trading.

Browser closure ends browser-owned execution and may leave resting orders or open positions. Closing the browser is not a confirmed cancellation or liquidation. A wallet connection does not make execution unattended.

The following six milestones remain unimplemented and outside the current release scope:

1. Coinbase injected EVM extension. Require explicit [EIP-6963 wallet selection](https://eips.ethereum.org/EIPS/eip-6963) and real Hyperliquid testnet checks for account access, chain selection, and typed-sign agent approval. Smart accounts and passkeys require separate qualification. Consult the [Coinbase Wallet documentation](https://docs.cdp.coinbase.com/coinbase-wallet/introduction/welcome) without treating other Coinbase wallet products as equivalent.
2. OKX extension. Use EIP-6963 when available, otherwise the official `window.okxwallet` provider described in the [OKX injected-provider documentation](https://web3.okx.com/build/docs/waas/okx-wallet-injection). Test coexistence with other injected wallets. Do not invent an RDNS identifier or claim typed-sign support without testing it. Enable only after real Hyperliquid testnet agent approval. Mobile OKX Connect is distinct from WalletConnect.
3. WalletConnect mobile. Require a maintained [EIP-1193 provider](https://eips.ethereum.org/EIPS/eip-1193), a public project ID, explicit Arbitrum namespaces, and only the necessary methods. Use the [WalletConnect provider documentation](https://docs.walletconnect.network/wallet-sdk/web/usage) to qualify QR and deep-link flows, rejection, expiry, disconnect, and session restoration. Connection restoration must never restore Running or silently restore a signer, and must never persist an agent key. Document metadata disclosed to third parties. Closing the desktop browser still ends execution, even if the mobile wallet remains connected.
4. Unbounded-run policy. Longer finite runs already fit the current duration validation; they are not an unimplemented feature. Any future unbounded mode must preserve independent agent expiry, freshness guards, Stop, sleep and visibility handling, and exact-owned cleanup. Define what happens when authorization expires, including loss of cancellation authority. Removing the run timer does not provide 24/7 execution.
5. Unattended execution. Design a separate hosted or desktop worker before implementation. Specify signer custody, restart and upgrade behavior, funding and loss policy, user control, and recovery from ambiguous order outcomes. Never silently restore Railway wallet execution. Hosted signer custody would require an explicit architecture and privacy review, not an exception hidden in a wallet adapter.
6. Inference-key BYOK. User-supplied credentials are inference keys only, never wallet or agent keys. Before implementation, define privacy, transport, retention, logging, browser exposure, provider handling, and the address-free inference boundary. This roadmap prescribes no credential storage.

Keep wallet adapters, run policy, execution ownership, and inference credential selection separate. Every future wallet must pass direct-browser Hyperliquid testnet agent approval, order placement, cancellation, and privacy checks before release. Do not add backend accounts or send wallet addresses, account data, orders, wallet keys, or agent keys through Bun or Next. Inference must remain address-free.

Hyperliquid's [exchange endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint) and [nonces and API wallets](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets) document venue actions and agent-wallet constraints. These direct sources inform qualification; they do not prove any wallet adapter or lifecycle behavior works in this application.
