# Dashboard

The dashboard is a separate Next.js App Router application in [`web/`](../web/). Market feeds, wallet connection, account reads, and order execution belong to the browser. Bun supplies Jev inference, not a visitor executor. Next keeps server-rendered metadata, fonts, and JSON-LD; wallet state stays in client memory.

## Routes and shared state

[`web/src/app/page.tsx`](../web/src/app/page.tsx) renders the market dashboard. [`web/src/app/settings/page.tsx`](../web/src/app/settings/page.tsx) renders the non-indexed settings page. One persistent [`SettingsProvider`](../web/src/lib/trading/SettingsProvider.tsx) owns the wallet, session, and feed store above both routes. Navigation does not create another executor or extend a deadline.

Public prices, books, trades, and charts remain visible without a wallet. Account metrics are null while disconnected, not invented zero balances. Disabled markets remain visible but cannot trade. A connected market feed does not mean a wallet is connected or execution is running.

The interface distinguishes disconnected, connected but stopped, running, and attention-required states. Paper and real execution must be labeled separately. Errors are not Jev hold decisions.

## Wallet connection and authorization

Connect requests the Brave Wallet account. It does not authorize an agent, submit an order, or start a run. Network preparation and agent authorization are separate explicit actions. Approving the agent leaves execution stopped.

Real execution requires the matching owner and network, usable authorization, and explicit confirmation that the session manages the account's whole net position on enabled markets. Positions are not isolated strategy sleeves. Another application or a manual trade can change the same venue position.

One owner equity value appears once at account level. Market cards show their own positions, not copies of account equity. Paper balances and positions are simulated session values and must not look like wallet balances.

## Runs and cleanup

Only explicit On begins a fresh finite run. The default is 30 minutes; longer valid finite settings remain supported. Real runs also stop before agent authorization expires. The display follows the session deadline, not a timer that resets on render.

Connecting, authorizing, navigating, reloading, reconnecting a feed, returning to a visible tab, and changing settings never start or extend a run. Reload does not restore an active executor or signer. There is no automatic Resume. The current session API has no separate pause or Resume operation; another explicit On is a new run, not a continuation of the old deadline.

Stop ends execution and attempts to cancel only this session's app-owned resting orders. End has the same execution boundary, not a liquidation meaning. Neither action closes accepted positions or revokes venue authorization. Successful cleanup drops the local signing capability. Uncertain submissions or failed cleanup remain visible as attention required and block another run until reconciliation succeeds.

The browser must remain awake and connected for execution and cleanup. Visibility, connection, sleep, stale-market, and deadline guards stop further work when detected. Closing the tab or suspending the browser cannot guarantee cancellation of resting venue orders. Inspect Hyperliquid directly if the browser disappears before cleanup completes. No server takes over the run.

## Settings page

Settings separate a draft from applied preferences. Saving settings does not start execution. Execution settings cannot replace an active or unresolved session. Appearance remains independent of trading.

The page covers network, enabled markets, paper or real mode, run duration, and trading values. Saved preferences are not a saved executor, wallet authorization, or permission to resume. Credential-bearing transports and signing material must not become durable browser preferences.

Theme uses `jev-trade:theme:v1`. The first visit follows the system preference. An explicit light or dark choice updates the whole app and browser theme color.

## Feed and privacy boundaries

The browser uses the #22 public feed and session APIs. Public market subscriptions and direct account subscriptions have different lifetimes; stopping execution does not hide the public market view. Feed reconnection only restores data delivery. It never starts trading.

Wallet, account, and order data travel only through direct wallet and Hyperliquid transports. They do not enter Next requests, Bun requests, server logs, an SSE session gateway, or a server-side visitor Worker. The only inference payload crossing the application boundary is `JevRequest` through [`web/src/lib/jev.ts`](../web/src/lib/jev.ts), with credentials omitted and no referrer. It must not carry wallet, account, or order data.

There is no dashboard setting for a backend execution address or operator control listener. Bun and Next remain separate runtimes. Browser-local execution does not turn Next into an exchange proxy or Bun into a wallet custodian.

## Verification boundary

These contracts do not establish a completed Brave Wallet approval or a real-money order. Live wallet approval, submission, cleanup, and browser-interruption behavior require explicit wallet testing before being reported as verified.

Rendered text must not contain middle dots, em dashes, or en dashes. Do not add blinking or pulsing indicators.
