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

### Changed

- Made OpenRouter the default Jev provider when no provider credential selects another provider. TypeSafe and Vercel AI Gateway remain available.
- Shared the TypeSafe SDK client path between OpenRouter and the official TypeSafe API.
- Pinned Bun 1.3.14 in both package manifests and `railpack.json`.
- Railpack builds both services: frozen `bun install`, bot starts with `bun run start`, dashboard builds with `bun run build` and starts with `bun run start`.
- Changed the dashboard production start script to `next start`, which honors Railway's `PORT`.
- Changed the dashboard API URL handling to add `https://` when `NEXT_PUBLIC_API_URL` is a bare Railway host.
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

### Removed

- Removed the Dockerfile and `.dockerignore`; Railway now builds both services with Railpack.

### Fixed

- Fixed `dev:web`, which used `bun --cwd web run dev` and printed Bun help instead of starting the dashboard while exiting successfully.
- Failed sleeve initialization no longer removes the sleeve from the API and dashboard. The bot exposes starting, retrying, and live status, shows the failure in the UI, and retries that sleeve after 30 minutes without restarting healthy sleeves.
- Serialized initial sleeve startup so simultaneous Hyperliquid HTTP requests do not amplify rate-limit failures.

## Known issues

- A sleeve emits a synthetic late hold without calling Jev when its previous Jev call is still running at the next tick. Provider calls have a 4,000 ms deadline, so this cannot happen at the 30,000 ms default tick. It can only happen if `TICK_MS` is set below that deadline, and that conflicts with the product claim that Jev decides on every tick.
