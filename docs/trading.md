# Trading behavior

## Browser sessions own execution

The dashboard uses one browser-local session and the #22 feed and trading APIs. Bun handles Jev inference only. Neither Bun nor Next receives wallet, account, or order data or executes orders for dashboard visitors. There is no server-side visitor Worker, server wallet executor, or backend control address in this flow.

The browser sends wallet approval requests directly to Brave Wallet and account and exchange requests directly to Hyperliquid. Only `JevRequest` crosses the application boundary through [`web/src/lib/jev.ts`](../web/src/lib/jev.ts), with credentials omitted and no referrer. Wallet identity, account snapshots, and order records must not enter that request.

Public data stays available while disconnected or stopped. Disabled markets remain visible. Their presence, or a healthy feed connection, is not permission to trade.

## Connection, authorization, and mode

Connecting Brave Wallet selects an owner. It does not authorize trading. Agent authorization is a separate explicit wallet action and does not start a run. Changing accounts or networks does not transfer a running session to the new identity.

Paper execution simulates orders and balances locally. It does not submit exchange orders or spend wallet funds. Its account values are simulation values, not a claim about the connected wallet. Real execution requires matching owner and network authorization and explicit confirmation of whole-account net-position management. An unavailable real authorization is an error, not permission to silently fall back to paper.

Account equity and withdrawable balance belong to one owner account, not to each coin. Positions are venue net positions. Real execution can therefore affect an existing position on an enabled market, including exposure opened outside this application. The dashboard shows owner equity once and market-specific positions separately.

## Finite runs

Only explicit On or Start begins a fresh run. Duration defaults to 30 minutes and accepts longer valid finite settings. The session computes an absolute deadline. In real mode it also limits the run to the authorization expiry minus a safety margin. The UI countdown displays that deadline; it does not enforce it by itself.

Connect, authorize, Save, navigation, reload, reconnection, and visibility changes never start or extend execution. The current session API has no separate pause or Resume operation. There is no automatic resume after reload or recovery. A later explicit On starts a new run rather than restoring the previous deadline.

Submission guards reject work outside a running session, after its deadline, or against stale market data. Session invalidation prevents late Jev results from placing new orders. A request already submitted to the venue may still need reconciliation.

## Stop, End, and owned-order cleanup

Stop and deadline expiry invalidate execution before cleanup. Ending the session is not an instruction to liquidate positions. Cleanup drains pending exchange work and attempts to cancel only orders recorded as owned by this session. It does not cancel unrelated manual orders or another application's orders.

Successful cleanup releases local session resources and clears its signing capability. Clearing the browser signer is not revoking the agent at Hyperliquid. Stop and End neither close accepted positions nor promise venue revocation.

Cleanup has a bounded wait. If owned orders remain unresolved or cleanup times out, the session reports attention required and blocks a new run. Reconciliation must settle the uncertain work before execution can start again. An error is not a hold decision or successful cancellation.

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

Documentation of the browser session contract is not proof of a completed Brave Wallet approval or live trade. Do not report wallet authorization, real order submission, cleanup, or interruption recovery as verified without an explicit wallet exercise and its observed outcome.
