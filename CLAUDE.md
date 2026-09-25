---
description: Bun bot plus Next dashboard. Do not flatten the two runtimes.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

The bot is Bun. The dashboard is Next in `web/`. That split is intentional: keys, evaluate, and orders stay on the Bun process; the page is a live Next app. Do not fold the dashboard into Bun HTML imports unless you are merging deploys. Do not use Node, npm, pnpm, vite, or express for new work.

## Bot (repo root)

- `bun <file>` instead of `node` or `ts-node`
- `just test` runs the Bun tests instead of jest or vitest
- `just install` installs bot and dashboard dependencies
- `Bun.serve()` for the SSE API. WebSocket is built-in.
- Prefer `Bun.file` over `node:fs` read/write when touching new I/O
- Bun loads `.env`. Do not add dotenv.
- Use `just` recipes for setup, local processes, and checks. `just dev` starts the bot in watch mode with fnox; `just start` starts it without watch mode with fnox. `just web` starts Next.

Bot listens on `PORT` (default 3000). Dashboard `web/` is Next on 3001.

```sh
just dev
just web
```

## Dashboard (`web/`)

Next.js App Router. SSE client in `web/src/lib/useFeed.ts`. Wire types are `src/types.ts`. The dashboard keeps a copy in `web/src/lib/bot-types.ts` so its standalone build does not need the repo root. Keep those two files identical. `just test` diffs them. Both the Next dashboard and Bun bot are hosted on Railway.

## Testing

Tests live in `test/`, not next to `src/`. `just check` verifies tests and typechecks for the bot and dashboard. Use `just test` for tests alone and `just build-web` for the production dashboard build.

```sh
just check
```

For dashboard, SSR, or client changes, also run a browser smoke check. Reuse an existing safe local process or start the needed processes with `just dev` and `just web` using paper/mock settings that cannot place real orders. If ports are occupied, reuse the appropriate process or choose alternate ports and update the local dashboard connection settings; never kill unknown processes. Open the affected route in a browser, exercise the changed behavior, and check the browser console for errors. A build or typecheck alone does not replace this runtime check.

## Docs

[`docs/`](docs/) is the maintainer map. Every behavior, configuration, or deployment change must update the matching document and add an entry under `Unreleased` in [`CHANGELOG.md`](CHANGELOG.md).

Railway infrastructure is TypeScript in [`.railway/railway.ts`](.railway/railway.ts). Never add `railway.json`. Exactly one live bot process may run against the wallets.

## Deploying

Railway is the only hosting and deployment platform for both services. Do not deploy either service to Vercel.

Merging to `main` is the deploy. Both services track GitHub `main`, and a merged push redeploys whichever service's watch patterns in [`.railway/railway.ts`](.railway/railway.ts) match the change, so a bot-only or web-only change deploys only that service. After a merge, confirm with `just deploy-status`.

`just deploy` is the optional pre-merge path documented in [`docs/deployment.md`](docs/deployment.md): it uploads the current checkout to both services with `railway up`, which has production side effects. It is never part of the normal task flow. Do not add a third deploy path.

The merge gate is [`.github/workflows/test.yml`](.github/workflows/test.yml): it runs tests, typechecks, the dashboard build, and a Railpack build of both service contexts against the checked-out commit. Its `test` and `build` jobs are required status checks on `main`, which admins can bypass. Local `railpack build` is a diagnostic only; Railway does not pin a Railpack builder version, and a local build from a dirty working directory sees untracked files that the GitHub source never contains.

## The core message (do not break this)

The demo is a live Jev trading bot on Hyperliquid. Every design or strategy change must keep these claims true:

> I built a trading bot with Jev!
>
> Jev decides if it should "buy" or "sell", given the price feed of an asset pair, and executes real trades.
>
> Jev decides on every Hyperliquid tick.
>
> Demo link: https://jevon.up.railway.app/

Non-negotiables: Jev makes the buy/sell call (not code), from the price feed; real trades from a real wallet; a Jev decision every tick, not every N ticks. The demo is the live dashboard. No middle dots, em dashes or en dashes in any rendered text. No blinking or pulsing indicators.

Hold is one of Jev's answers, so a tick can end with no order. That is Jev's call, not the code skipping a tick, and the decision still happens every tick. Do not reintroduce a forced buy or sell just to keep an order on the book.

## GitHub workflow

- Repository: https://github.com/prime-optimal/jev-trade
- Project: [Jev Trade #10](https://github.com/users/prime-optimal/projects/10)
- Planning labels: `feat`, `chore`
