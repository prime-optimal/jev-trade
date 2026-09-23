# Settings page and timed bot runs

## Scope

Implement a standalone `/settings` page, light/dark mode, configurable Hyperliquid transport, and an actual bot on/off control with a default 30-minute run limit. This plan does not require Brave Wallet connection. [BRAVE_WALLET_PLAN.md](BRAVE_WALLET_PLAN.md) owns wallet discovery, authorization, browser trading migration, and wallet-specific cleanup. It consumes the settings and lifecycle contracts here.

This is a plan only. Do not change runtime code, environment files, secrets, deployments, or live trading as part of splitting the plans.

## Runtime boundary

Keep Next in `web/` and Bun as the current execution owner until the separate wallet migration ships. A browser timer must not pretend to stop a bot that still trades on Bun. Implement settings application and the deadline where execution actually happens. Turning Off stops trading, not the HTTP service or dashboard, so the user can turn it On again.

The current shared bot is not a per-visitor bot. Before the wallet migration, only the operator may apply shared trading settings or start/stop it. Keep mutation endpoints on a private loopback-only control listener, validate Origin/Host, and reject public access. Local control may be exposed through an explicitly configured authenticated operator channel, never through the public SSE/API listener with CORS as its only protection. The public dashboard may show authoritative status but cannot control the shared wallet. Once the wallet plan moves execution into each browser, the same controls operate that visitor's session without operator privileges. Do not create public global controls or require wallet connection merely to use local settings.

## Settings page

Add `web/src/app/settings/page.tsx`, a client form, and a CSS module using the existing design tokens. Give the route non-indexable metadata. Add a Settings link in Header using Next navigation. Mount a persistent client settings/run provider inside the existing server layout, retaining server metadata, fonts, and JSON-LD. Navigation must neither duplicate timers/feeds nor reset a run.

Organize the form into Appearance, Trading, Connections, Run duration, and Operator configuration. Expose network, paper/real mode, enabled assets, and entry notional directly. Put decision cadence, price refresh, quote offset, exit slippage, lookback, and paper bankroll under Advanced. No leverage override: Jev keeps its existing choice bounded by venue metadata.

Drafts remain separate from applied settings. Save validates and applies one complete snapshot while stopped. Cancel discards drafts. Reset affects only the selected scope and requires Save to apply. Disable execution-affecting settings during Running/Stopping with "Stop trading to change these settings." Theme may change at any time. No field writes `.env` or Railway variables. Show which values are session overrides versus operator-provided configuration.

### Environment configuration coverage

Use `.env.example`, `web/.env.example`, and the actual config parser as the inventory. Never read or copy ignored `.env` secret values into this plan or the browser. Existing transport helpers in `src/config.ts` and `src/hyperliquid.ts` already resolve custom endpoints and auth headers; extend those paths rather than adding a competing implementation.

| Existing configuration | Settings treatment |
| --- | --- |
| `HL_COINS`, `HL_TESTNET`, `DRY_RUN` | Enabled assets, network, and paper/real mode. Apply only to the authorized execution scope. |
| `TICK_MS`, `PRICE_MS` | Advanced decision and price refresh cadences. Current source defaults are 30000 and 1000 ms. |
| `QUOTE_USD`, `QUOTE_INSIDE_TICKS`, `CLOSE_SLIPPAGE_BPS` | Entry notional, quote offset, and exit slippage. |
| `HORIZON_BLOCKS`, `BANKROLL_USD` | Lookback and paper bankroll; never represent bankroll as real wallet equity or a real loss cap. |
| `HL_API_URL`, `HL_WS_URL`, `HL_RPC_URL` | Custom HTTP, optional independent WebSocket override, and optional Hyperliquid SDK RPC URL. |
| `HL_API_KEY`, `HL_API_KEY_HEADER`, `HL_API_KEY_SCHEME` | Memory-only optional key plus Advanced header/scheme controls. Existing defaults are `Authorization` and `Bearer`; empty scheme sends the raw key. |
| `HL_FALLBACK_POLL_MS` | Advanced fallback polling interval, default 30000 ms, integer 1000 through 300000. Preserve this existing name in the parser and environment template. |
| `MODEL`, `JEV_PROVIDER`, `JEV_MODEL_ID` | Operator-only model/provider configuration. Show current non-secret values to the operator, not editable visitor policy. |
| `OPENROUTER_API_KEY`, `TYPESAFE_API_KEY`, `AI_GATEWAY_API_KEY` | Server-only provider secrets. Show configured/missing status only in the private operator view; manage values through fnox, not browser inputs. |
| `PRIVATE_KEY`, `WALLETS_JSON` | Server wallet secrets until wallet migration. No value display, import, or browser editor. Explain their operator-only status. |
| `PORT`, `NEXT_PUBLIC_API_URL` | Read-only operator/deployment information. Keep localhost/LAN fallback; changing the venue URL must not change this application's API destination. |

No existing environment setting is silently treated as safe to expose. Operator-only fields remain documented in the page but their values and configured status are not published to visitors. The new run duration is distinct from the existing 30-minute failed-sleeve retry delay; retries must never start an expired or manually stopped run.

### Shared settings contract

Create `web/src/lib/trading/settings.ts` and `web/src/lib/trading/networks.ts`. These modules own the browser settings schema and public endpoint defaults, not wallet connectors. Keep the authoritative Bun validator consistent with the same constraints without making Bun import the Next application. Follow the existing copied-wire-contract convention where a setting crosses the current API boundary.

```ts
type SupportedCoin = "BTC" | "ETH" | "SOL" | "DOGE" | "BNB";
interface TradingSettings {
  version: 1;
  network: "testnet" | "mainnet";
  mode: "paper" | "real";
  enabledCoins: SupportedCoin[];
  tickMs: number;
  priceMs: number;
  quoteUsd: number;
  quoteInsideTicks: number;
  closeSlippageBps: number;
  horizonBlocks: number;
  bankrollUsd: number;
  runDurationMinutes: number;
  hyperliquidApiUrl: string | null;
  hyperliquidWsUrl: string | null;
  hyperliquidApiKeyHeader: string;
  hyperliquidApiKeyScheme: string;
  fallbackMs: number;
  rpcUrl: string | null;
}
```

Keep `theme: "light" | "dark"` as a browser-wide preference, separate from wallet/network settings. Keep the optional `hyperliquidApiKey` outside the persisted settings object in private runtime memory.

Defaults are testnet, paper, all five coins, 30000 ms decisions, 1000 ms prices, $40 entry notional, one inside tick, five basis points exit slippage, 100-tick lookback, $200 paper bankroll, and **30 minutes per run**. Preserve current source cadence defaults instead of the older wallet plan's proposed 60000/200 ms values. Blank custom URLs use the network defaults or existing resolver rules. Preserve operator configuration as explicit overrides rather than silently replacing it with guest defaults. Regardless of configuration, startup is Off and real Start needs explicit confirmation.

Validate on Save and load. Reject non-finite numbers. `tickMs` is an integer from 5000 to 300000; `priceMs` from 50 to 5000; `quoteInsideTicks` from 0 to 10; `horizonBlocks` from 20 to 400; `closeSlippageBps` from 0 to 100. Entry notional and paper bankroll must be positive finite numbers. Run duration is a positive integer number of minutes with no zero/unlimited option. Reject values that cannot produce a safe finite deadline. Deduplicate supported asset literals. An empty selection may be saved but disables On with "Enable at least one asset." Never silently increase notional to meet venue minimums. Keep `historySize=1000` internal rather than adding a new control.

### Persistence

Persist validated non-secret browser settings at `jev-trade:settings:v1:<network>:guest` without requiring a wallet. The future wallet adapter supplies a lowercase owner address and uses `jev-trade:settings:v1:<network>:<owner>`. A first-time owner copies guest values; an existing owner loads only its own settings. Store selected network at `jev-trade:network:v1` and theme at `jev-trade:theme:v1`. Operator-applied shared configuration is separate from guest preferences; loading a visitor's storage never changes Bun configuration.

Read browser storage after mount. Invalid or unknown-version values reset only the affected scope and show a notice. Denied storage falls back to memory with "Settings will not survive a refresh." Never persist Running, authorization permissions, private keys, or endpoint credentials. Credential-bearing RPC URLs also stay in memory and must be re-entered after reload. Do not restore trading automatically from stored preferences.

### Light/dark mode

Provide a labeled light/dark toggle on the settings page. On first visit use the system preference; an explicit selection takes precedence and persists across refresh and navigation. Apply it through shared CSS tokens to the entire dashboard, settings form, charts, controls, tooltips, and focus states. Avoid a flash of the wrong theme and hydration mismatch. Both themes must have readable contrast, including disabled/error states. Keep the existing restrictions against middle dots, long dashes, blinking, and pulsing indicators.

Update the browser `theme-color` along with the theme rather than retaining the current fixed white value.

## Hyperliquid and RPC connections

Provide a custom Hyperliquid API base URL, an optional masked API key, and an optional RPC URL. These are distinct from `NEXT_PUBLIC_API_URL`, which points to this application's Bun API and later its Jev inference service. An API key is a transport-provider credential, not a wallet private key, seed phrase, or Hyperliquid agent key.

| Network | Default Hyperliquid HTTP | Default market WebSocket |
| --- | --- | --- |
| testnet | `https://api.hyperliquid-testnet.xyz` | `wss://api.hyperliquid-testnet.xyz/ws` |
| mainnet | `https://api.hyperliquid.xyz` | `wss://api.hyperliquid.xyz/ws` |

The HTTP override must reach every Hyperliquid HTTP consumer: metadata, books/candles, account queries, and order submission where applicable. Preserve the existing resolver's derived `ws(s)://<API base>/ws` behavior when `HL_WS_URL` is blank, with an independent Advanced WebSocket override for providers using another endpoint. Verify compatibility before enabling execution; do not assume every custom HTTP provider supports WebSockets. Show effective HTTP and WebSocket destinations separately. Never fall back silently to official endpoints after a custom endpoint failure. Never put an HTTP API key in WebSocket URLs or subscription messages.

Use HTTPS for remote endpoints, with HTTP allowed only for explicit local development. Reject malformed URLs, embedded username/password credentials, and fragments. Preserve documented provider base paths. Do not send arbitrary browser-supplied destinations through the public Bun service as a proxy. Current Bun execution accepts endpoint changes only through operator control; future browser execution contacts the endpoint directly.

Validate connectivity while stopped using a bounded, non-trading request. Verify the expected Hyperliquid response shape and selected network before enabling real execution; if network identity cannot be established reliably, leave real execution disabled with an actionable explanation. Custom transport never changes Hyperliquid signing domains or wallet approval chain IDs. Verify the pinned SDK's actual transport injection points before implementation, including charts and account clients.

Hyperliquid's official API does not require this optional transport API key. Reuse the existing configurable header/scheme behavior for supported custom providers, applying it to HTTP reads and exchange transport. Validate header token syntax, reject CR/LF in header names/schemes/values, and forbid reserved headers such as Host, Cookie, Content-Length, and Origin. Confirm browser CORS permits the chosen header before enabling browser execution. Unsupported authentication must produce a clear error, not silently ignore the entered key or leak it to the default host. Show which host receives it; clear it when that host changes. Keep it out of local/session storage, URLs, telemetry, logs, SSR props, and Jev requests. A credential used by the current Bun executor passes only through the private operator channel and stays in runtime memory. After browser migration it stays in browser memory and goes only to the chosen provider. Scope credentials by destination so the SDK cannot forward the HTTP provider key to a different RPC host.

The optional RPC URL maps to the existing Hyperliquid SDK `rpcUrl` transport option. Blank uses `https://rpc.hyperliquid-testnet.xyz` on testnet or `https://rpc.hyperliquid.xyz` on mainnet, as the current resolver does. It is not Hyperliquid `/info`, `/exchange`, its market WebSocket, or the Arbitrum wallet-approval RPC. Verify the pinned SDK's RPC protocol and a supported read-only validation request before wiring validation; do not assume `eth_chainId` or substitute an Arbitrum endpoint. Entering it does not switch a wallet. If current trading never calls the SDK RPC path, state that accurately while still wiring the setting into the actual transport. Treat provider tokens embedded in RPC paths/queries as secrets, mask them, and do not persist them.

## Timed on/off control

Replace the existing green Live control's trading role with an explicit bot On/Off switch and timer in the same Header area. Keep market-stream connectivity separately labeled so "prices connected" cannot be confused with "bot trading."

- Off initially shows the configured limit, default `30:00`, and no running indicator.
- On starts one run only after the execution owner's preflight succeeds. Show elapsed time and remaining time, for example `Running 05:12 / 30:00` and `24:48 left`.
- Use green only while execution is actually Running. Show Stopping, Expired, and Attention required as distinct text states, not just color. Make the switch keyboard-accessible with a descriptive label; do not announce every timer tick through a live region.
- At the deadline, stop issuing decisions and orders immediately, follow the same cleanup path as manual Off, and remain Off/Expired until explicitly turned On again. Do not silently extend or roll over into another run.
- A fresh On starts a new full configured interval. A safety pause/resume within a run retains the original deadline. After expiry there is no Resume of that run.
- Manual Off freezes the completed elapsed time and stops the current run. Theme edits, route navigation, incoming price events, reconnects, or settings reloads cannot reset or extend the timer.

### Authoritative lifecycle contract

Expose a run snapshot with `runId`, `status`, `startedAt`, `deadlineAt`, `stoppedAt`, `durationMs`, and `stopReason`. Status distinguishes `off`, `starting`, `running`, `paused`, `stopping`, `expired`, and `attention-required`. Publish authoritative timestamps, not incrementing counters from React renders. Synchronize browser display with the execution owner's clock when Bun owns the run. Display elapsed as the bounded difference from `startedAt`; remaining is never negative.

Use an absolute wall-clock deadline plus a monotonic elapsed guard so clock rollback cannot extend a run. A scheduled timeout is only a wake-up mechanism. Recheck deadline/run identity at each decision, after awaited inference, before signing/submission, and before processing queued work. Invalidating the run prevents late decisions or queued placements from restarting it. Repeated On/Off commands must be idempotent and cannot create duplicate loops. A Stop during Starting cancels startup too.

On Off/expiry, invalidate execution immediately, stop decision scheduling, abort or ignore pending inference, prevent queued orders, then cancel/reconcile only this run's owned resting orders. Track order ownership rather than using the existing broad coin-wide cancellation. Bound cleanup to 10 seconds; failed or ambiguous cleanup stays Attention required with a residual-order warning and blocks a fresh run until reconciled. Do not report successful cleanup merely because the timer reached zero. Stop does not liquidate positions or revoke wallet authorization. Already submitted orders may require reconciliation and accepted positions remain exposed.

With the current Bun executor, enforce the deadline on Bun even if every dashboard disconnects or sleeps. Process restart starts Off rather than continuing an old run. Dashboard refresh reconnects to the existing authoritative run without issuing On. With the later browser executor, refresh starts Off and the wallet plan's visibility/sleep guards stop trading; deadline checks still reject expired work on wake. Neither runtime may fabricate a Jev hold for a skipped or failed decision. Jev remains responsible for each scheduled trading decision while Running.

## Implementation sequence

1. Inventory configuration and execution ownership. Establish validated applied settings, private operator mutation boundaries, and the run snapshot/control contract. Do not start a second live bot.
2. Add settings persistence, route/navigation, and light/dark tokens. Save applies only validated snapshots to the appropriate execution scope.
3. Wire the actual Hyperliquid transports and optional key, validate the optional RPC, and display the effective destinations and credential lifetime.
4. Implement the execution-owned run lifecycle, 30-minute default, shutdown guards, owned-order cleanup, and Header elapsed/remaining display. Attach the existing Bun executor now; Brave integration later replaces that adapter rather than adding another timer.
5. Verify behavior below, then update `docs/configuration.md`, `docs/dashboard.md`, `docs/trading.md`, and `docs/api.md` for the settings/control boundaries. Update relevant `.env.example` entries and `CHANGELOG.md` under Unreleased. These documentation updates belong to implementation, not this plan split.

## Verification and acceptance

Settings is independently complete without a Brave provider or connected wallet. Test against an isolated paper/testnet runtime, never a second funded production bot.

- Open `/settings` and return to the dashboard at desktop and phone sizes. Save, cancel, reset, invalid input, denied/corrupt storage, and refresh behave as specified. Route changes never create a second feed/run. Existing owner/guest isolation is verified when the wallet adapter supplies identity.
- Switch both themes while stopped and running, refresh, and inspect dashboard/charts/forms/focus states. No flash, unreadable state, timer reset, or hydration mismatch.
- Confirm configuration values are mapped to their real consumers. Secret values never appear in public API responses, page source, storage, logs, or browser bundles. Public visitors cannot mutate the shared Bun bot.
- Exercise custom HTTP with and without a supported optional key, clear overrides, reject malformed/wrong-network URLs, and verify failures do not fall back silently. Capture destinations without storing secrets. Verify SDK-compatible RPC validation and that RPC is never substituted for the Hyperliquid API or wallet approval transport.
- Prove the default is 30 minutes. Use a controlled clock to exercise expiry without waiting 30 minutes; also run a short real-duration smoke scenario against the isolated executor and observe automatic shutdown without a browser timer driving it.
- Verify elapsed/remaining, manual Off, explicit fresh On, navigation, refresh, reconnect, sleep, clock rollback, and process restart. No automatic restart or deadline extension. Expiry while inference or exchange work is outstanding prevents new submission and reports cleanup accurately.
- Confirm only owned orders are cancelled, unrelated orders remain, cancellation failure blocks restart, and Stop does not claim positions were closed. Verify an expired run cannot be resumed and that agent expiry can end a future wallet run earlier.

Run the repository's relevant existing checks after implementation and visually exercise the actual dashboard. This document split itself requires link/ownership/requirement checks only, not builds, trades, or deployment.
