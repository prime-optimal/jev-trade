# Changelog

All notable changes to this project are documented here. This changelog starts from upstream commit `a3f2f83` and follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- Added OpenRouter as a Jev provider through its System One endpoint, with provider-specific model defaults and startup credential checks.
- Added provider resolution in this order: OpenRouter, TypeSafe, then Vercel AI Gateway when matching credentials are available.
- Added OpenRouter provider coverage in `test/jev-provider.test.ts` and documented `OPENROUTER_API_KEY` in `.env.example`.
- Added `fnox.toml` to resolve `OPENROUTER_API_KEY` from 1Password through a `onepass` provider, matching the global `fnox-apikey` and `fnox-opref` mise helpers.
- Added `justfile` recipes for setup, local processes, tests, typechecks, checks, and the dashboard production build.
- Added Railway TypeScript infrastructure in `.railway/railway.ts` for the bot, dashboard, bot data volume, service variables, watch paths, health checks, and deployment settings.
- Added maintainer documentation for architecture, trading, the API, dashboard, configuration, Jev providers, development, and deployment.
- Added configurable Hyperliquid HTTP, WebSocket, and RPC endpoints with optional HTTP API-key authentication.
- Added a standalone Settings route with isolated visitor and private operator scopes, browser-wide light and dark themes, and memory-only handling for transport credentials.
- Added a private loopback operator listener for settings, transport validation, Start, Stop, and owned-order reconciliation. The public API exposes read-only authoritative run state.
- Added execution-owned timed runs that start Off, default to 30 minutes, enforce wall-clock and monotonic deadlines, and block restart when bounded owned-order cleanup needs attention.
- Added Hyperliquid HTTP, WebSocket, and SDK RPC preflight. Real trading requires matching official endpoints and explicit confirmation. Custom endpoint identity cannot enable real mode.
- Added isolated keyless visitor paper sessions for #8. Each remote visitor gets an Off Bun Worker with its own settings, feed, lifecycle, history, and simulated trades, while localhost keeps the private shared operator.
- Added the same-origin Next session gateway with an HttpOnly, SameSite=Strict capability cookie, Secure in production, exact public Origin checks, expiry and reconnect handling, and `BOT_API_URL` runtime routing.
- Added visitor limits for 8 concurrent sessions, 10-minute inactivity expiry, 2 SSE streams per session, 64 KiB request bodies, creation burst 8 with refill 16 per minute, a 30-second Start cooldown, and a 30000 ms minimum decision cadence.
- Added PostgreSQL decision history with queued parent-process writes, exact revisioned Jev prompt snapshots, decision UUID correlation, individually retained fills with idempotent retry identities, bias-signed 1, 5, 20, and 100 tick markouts, and shutdown draining.
- Added signed anonymous owner continuity plus capability-scoped visitor decision reads and a loopback-only operator decision endpoint. The owner credential expires after one year, is not accepted by query routes, and must first be exchanged for a short-lived session capability.
- Added the Jev model contract guide covering every prompt field, exclusion, question, outcome, privacy boundary, and prompt-refinement workflow.

### Changed

- Made OpenRouter the default Jev provider when no provider credential selects another provider. TypeSafe and Vercel AI Gateway remain available.
- Shared the TypeSafe SDK client path between OpenRouter and the official TypeSafe API.
- Pinned Bun 1.3.14 in both package manifests and `railpack.json`.
- Railpack builds both services: frozen `bun install`, bot starts with `bun run start`, dashboard builds with `bun run build` and starts with `bun run start`.
- Changed the dashboard production start script to `next start`, which honors Railway's `PORT`.
- Changed the dashboard and visitor gateway API URL handling to add `https://` when `NEXT_PUBLIC_API_URL` is a bare Railway host.
- Updated `web/public/llms.txt` to name OpenRouter as the default Jev API.
- The dashboard dev server now allows this machine's LAN IPv4 addresses in `allowedDevOrigins`, and with `NEXT_PUBLIC_API_URL` unset the dashboard reads the bot at the page's own host on port 3000. Opening it by LAN IP no longer needs a manual `next.config.ts` edit.
- Added `railway` just recipes: `deploy-plan`, `deploy-infra`, `deploy-setup`, `deploy` and `deploy-status`.
- Changed the default `TICK_MS` from 2000 to 30000, so each sleeve asks Jev every 30 seconds. The dashboard chart timeframes are unchanged and still only group prices into candles.
- Removed the 30 second Jev pause after a credit or provider error. The next tick calls Jev again instead of emitting late holds without a call.
- Slowed the default `PRICE_MS` from 200 to 1000 to reduce dashboard price-event traffic. This setting does not make Hyperliquid requests and does not affect the 30-second Jev cadence.
- Made WebSocket subscriptions the primary Hyperliquid market-data path. Book, recent-trade, and asset-context HTTP recovery polls now run only while the socket is disconnected, at a configurable 30-second default cadence.
- Shared immutable Hyperliquid symbol and leverage metadata across sleeves instead of requesting the same startup data once per market.
- Changed bot startup log separators to plain punctuation.
- Fixed pre-existing root TypeScript errors with type-only changes in `src/config.ts`, `src/model.ts`, and `src/market.ts`. Root and dashboard typechecks now pass.
- Updated `.gitignore` so maintainer docs are tracked and local `fnox.local.toml` overrides remain ignored.
- Changed paper trading to the default unless `DRY_RUN=false` is set explicitly.
- Separated price-stream connectivity from trading state in the dashboard Header. Public visitors can see run status but cannot control the shared executor.
- Changed sleeve initialization and retry so recovery cannot start decision loops after manual Stop or expiry. During the single armed paper startup, the first ready sleeve starts the run; recovered sleeves join only while that run remains active.
- Kept the Off control plane available when initial sleeve resources fail, with visible retryable errors. Operator Start runs the available sleeves when at least one is ready. Later settings replacements remain atomic and preserve the prior executor on failure.
- Paper-mode process startup now arms one configured-duration run that starts when the first sleeve is ready. Failures stay Off and retry, expiry and manual Stop do not loop, process restart creates a new paper run, and real mode still requires a private confirmed Start.
- Remote settings now apply paper settings to the visitor's Worker instead of changing browser preferences only. Visitors can Save, Start, Stop, and reset cleanup without controlling the shared executor. Refresh resumes the same Worker; an expired or deleted session requires explicit Reconnect to a fresh Off session.
- Visitor Workers receive an explicit allowlisted runtime environment before importing bot modules. This prevents Bun's parent dotenv values from being compiled into `process.env.NAME` reads inside the Worker.
- Reorganized Settings into Trading, Jev model, and Connections tabs. The model tab exposes cadence and lookback controls, the current prompt revision and questions, and the full input catalog with explanations.
- Changed `Model.decide` to return the normalized answer with the exact immutable prompt snapshot used for that evaluation. Successful decisions now retain one ID through quotes and correlated fills.

### Removed

- Removed the Dockerfile and `.dockerignore`; Railway now builds both services with Railpack.

### Fixed

- Corrected the production bot domain target from port 3000 to the Railway-injected port 8080, restoring public access to `/` and `/snapshot`.

- Fixed `dev:web`, which used `bun --cwd web run dev` and printed Bun help instead of starting the dashboard while exiting successfully.
- Failed sleeve initialization no longer removes the sleeve from the API and dashboard. The bot exposes starting, retrying, and live status, shows the failure in the UI, and retries that sleeve after 30 minutes without restarting healthy sleeves.
- `DRY_RUN=false` with no wallet key no longer fails every sleeve at startup with "real trading requires a wallet private key". Keyless sleeves run in paper mode again, as they did before the settings page, while keyed sleeves keep real execution.
- Serialized initial sleeve startup so simultaneous Hyperliquid HTTP requests do not amplify rate-limit failures.

