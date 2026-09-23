---
description: Bun inference service plus Next browser trading app. Do not flatten the two runtimes.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Jev inference runs on Bun. The browser app uses Next in `web/`. Bun owns the Jev provider credential and address-free inference, not trading credentials or execution. The browser owns settings, public feeds, paper state, wallet/provider connections, ephemeral agent signing, account state, run lifecycle, orders, and fills. Do not fold the browser app into Bun HTML imports or move browser execution into Next server routes. Do not use Node, npm, pnpm, vite, or express for new work.

## Inference service (repo root)

- `bun <file>` instead of `node` or `ts-node`
- `bun test` instead of jest or vitest
- `bun install` / `bun run <script>`
- `Bun.serve()` for the inference API.
- Prefer `Bun.file` over `node:fs` read/write when touching new I/O
- Bun loads `.env`. Do not add dotenv.
- Use `just` recipes for setup, local processes, and checks. `just dev` and `just start` inject secrets through fnox.

The inference service listens on `PORT`, default 3000. Dashboard `web/` is Next on 3001.

```sh
bun run start
bun run dev:web
```

## Dashboard (`web/`)

Next.js App Router. Browser code owns the trading lifecycle and talks directly to Hyperliquid for public market data, account state, orders, and fills. Keep wallet addresses, signatures, provider objects, agent keys, and session capabilities out of the inference API.

Shared inference types live in `src/types.ts`, with a byte-identical copy in `web/src/lib/bot-types.ts` so the web build does not need the repo root. Browser display and account types stay local to `web/`; do not add them to the shared inference contract. Use explicit network signing identity independently of HTTP or WebSocket endpoint URLs. A custom endpoint must not silently change mainnet/testnet signing.

Keep ephemeral agent keys in browser memory only. Do not persist them or send them to Bun. Browser Start and Stop own runs; Bun must not create visitor workers or retain visitor trading sessions.

## Testing

Tests live in `test/`, not next to `src/`.

```sh
bun test
```

## Docs

[`docs/`](docs/) is the maintainer map. Every behavior, configuration, or deployment change must update the matching document and add an entry under `Unreleased` in [`CHANGELOG.md`](CHANGELOG.md).

Railway infrastructure is TypeScript in [`.railway/railway.ts`](.railway/railway.ts). Never add `railway.json`. Bun must not run an executor against visitor wallets.

## The core message (do not break this)

The demo is a live Jev trading bot on Hyperliquid. Every design or strategy change must keep these claims true:

> I built a trading bot with Jev!
>
> Jev decides if it should "buy" or "sell", given the price feed of an asset pair, and executes real trades.
>
> Jev decides on every Hyperliquid tick.
>
> Demo link: https://www.jev-trade.com/

Non-negotiables: Jev makes the buy/sell call (not code), from the price feed; real trades from a real wallet; a Jev decision every tick, not every N ticks. The demo is the live dashboard. No middle dots, em dashes or en dashes in any rendered text. No blinking or pulsing indicators.

Hold is one of Jev's answers, so a tick can end with no order. That is Jev's call, not the code skipping a tick, and the decision still happens every tick. Do not reintroduce a forced buy or sell just to keep an order on the book.

## GitHub workflow

- Repository: https://github.com/prime-optimal/jev-trade
- Project: [Jev Trade #10](https://github.com/users/prime-optimal/projects/10)
- Planning labels: `feat`, `chore`
