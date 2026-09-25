# Jev Trade

[![Live desk](https://img.shields.io/badge/live-jevon.up.railway.app-111)](https://jevon.up.railway.app/)
[![License: MIT](https://img.shields.io/badge/license-MIT-111)](LICENSE)

I built a trading bot with Jev. Jev reads the Hyperliquid book every tick and answers buy, sell, or hold. The bot sends the order. Five coins, five wallets, real fills.

**[Watch the live desk](https://jevon.up.railway.app/)**

[![Jev Trade live desk](assets/desk.png)](https://jevon.up.railway.app/)

[![Recorded Jev decisions on the Model page](assets/model.png)](https://jevon.up.railway.app/model)

Jev makes the call. Hold is one of its answers, so a tick can end with no order. Position, balance, and PnL come from Hyperliquid.

Based on [jev-trader](https://github.com/jarrodwatts/jev-trader) by Jarrod Watts under the MIT license. The venue is Hyperliquid, not Monad or Kuru.

## What you are looking at

- Five isolated sleeves for BTC, ETH, SOL, DOGE, and BNB. Each has its own wallet and Jev call.
- The left pane is the live book as candles. Green and red marks are fills. The entry line is the open position.
- The right pane is the latest Jev call and the tape of every tick.
- The table shows Positions and Trades, the same split a futures desk uses.

With a wallet key and `DRY_RUN` not set to `true`, the bot sends real orders on testnet or mainnet. Start with a dry run.

## How a tick works

1. The bot reads the book.
2. Jev picks long or short, then open, close, or hold.
3. An entry is a post-only Alo quote one tick inside the touch. It stays on the maker side until a taker hits it.
4. An exit is an Ioc that crosses the touch. If it does not fill, the order is reported as reverted.
5. Hold sends no order and pulls any resting quote Jev no longer wants.

The bot is Bun on port 3000. The dashboard is a separate Next app in `web/` on port 3001. Keys, evaluation, and orders stay in the Bun process.

## Run locally

Install [mise](https://mise.jdx.dev/), [just](https://just.systems/), [fnox](https://fnox.jdx.dev/), and the 1Password CLI. Then install both dependency trees and trust the project configuration:

```sh
just install
mise trust
fnox sync
```

`mise.toml` supplies every non-secret setting with defaults that mirror the code; `fnox.toml` resolves the OpenRouter key from 1Password. Personal overrides belong in a git-ignored `mise.local.toml`. Start the bot and dashboard in separate terminals:

```sh
just dev
just web
```

Open http://localhost:3001, or the Network URL `just web` prints to reach it from another device on your LAN. With `NEXT_PUBLIC_API_URL` unset, the dashboard reads the bot on the same host at port 3000.

`HL_TESTNET=true` is the default. `DRY_RUN=true` forces simulated orders, and a sleeve without a wallet key also runs dry. `MODEL=mock` needs no provider key.

## Live Jev

Set `MODEL=jev` in `mise.local.toml`:

```toml
[env]
MODEL = "jev"
JEV_PROVIDER = "openrouter"
```

OpenRouter is the default provider and `fnox` injects its key. The bot also supports the official TypeSafe API with `JEV_PROVIDER=typesafe` and `TYPESAFE_API_KEY`, or Vercel AI Gateway with `JEV_PROVIDER=gateway` and `AI_GATEWAY_API_KEY`. If `JEV_PROVIDER` is unset, available credentials select OpenRouter first, then TypeSafe, then Gateway. See [Jev provider](docs/jev-provider.md) for model defaults and request details.

## Live testnet orders

1. Keep `HL_TESTNET=true`.
2. Set `PRIVATE_KEY` for the first coin.
3. Copy `.wallets.example.json` to `.wallets.json` and add the other sleeve keys, or set `WALLETS_JSON`.
4. Get mock USDC from https://app.hyperliquid-testnet.xyz/drip. The faucet only pays addresses that have deposited on mainnet.
5. Leave `DRY_RUN=false`. A missing sleeve key still makes that sleeve a dry run.

`HL_TESTNET=false` selects mainnet. Do not set it until wallet assignment and quote sizing have been reviewed.

## Verify

```sh
just check
just build-web
```

## Deployment

Railway builds the bot and dashboard with Railpack. TypeScript infrastructure in [`.railway/railway.ts`](.railway/railway.ts) defines both services and the bot volume. Never run more than one live bot process against the same wallets. See [Deployment](docs/deployment.md) before creating or changing Railway resources.

## Docs

Start with the [maintainer documentation map](docs/README.md). Project changes are recorded in the [changelog](CHANGELOG.md).

## License

MIT. Copyright 2026 aowang. Includes MIT code originally published as jev-trader by Jarrod Watts.
