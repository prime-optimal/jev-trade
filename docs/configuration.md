# Configuration

The bot reads environment values in [`src/config.ts`](../src/config.ts), [`src/sleeves.ts`](../src/sleeves.ts), and [`src/model.ts`](../src/model.ts). The dashboard has one public build setting in [`web/src/app/page.tsx`](../web/src/app/page.tsx).

## Environment variables

| Name | Default | Where read | Secret | Purpose |
| --- | --- | --- | --- | --- |
| `HL_COINS` | `BTC,ETH,SOL,DOGE,BNB` | [`src/sleeves.ts`](../src/sleeves.ts) | No | Comma-separated Hyperliquid perps. Creates one sleeve per nonempty entry. |
| `HL_TESTNET` | `true` | [`src/config.ts`](../src/config.ts) | No | Selects testnet. Only the exact string `false` selects mainnet. |
| `TICK_MS` | `60000` | [`src/config.ts`](../src/config.ts) | No | Decision and requote cadence in milliseconds. Each tick calls Jev once per sleeve unless that sleeve's previous call is still running. The dashboard chart timeframe does not change it. |
| `PRICE_MS` | `200`, minimum `50` | [`src/config.ts`](../src/config.ts) | No | Chart and live-mid cadence in milliseconds. This does not call Jev. |
| `QUOTE_USD` | `40` | [`src/config.ts`](../src/config.ts) | No | Target notional in USD for one entry quote. |
| `QUOTE_INSIDE_TICKS` | `1` | [`src/config.ts`](../src/config.ts) | No | Number of price ticks an entry quote moves inside the touch. |
| `CLOSE_SLIPPAGE_BPS` | `5` | [`src/config.ts`](../src/config.ts) | No | Basis points beyond the far touch used for reduce-only IOC exits. |
| `HORIZON_BLOCKS` | `100` | [`src/config.ts`](../src/config.ts) | No | Lookback in decision ticks for sampled mids and trade summaries. |
| `BANKROLL_USD` | `200` | [`src/config.ts`](../src/config.ts) | No | Dry-run bankroll denominator for PnL percentage when no venue account is present. |
| `PRIVATE_KEY` | Unset | [`src/config.ts`](../src/config.ts), [`src/sleeves.ts`](../src/sleeves.ts) | Yes | Hyperliquid wallet key for the first listed coin when the wallet map has no key for it. |
| `WALLETS_JSON` | Unset | [`src/sleeves.ts`](../src/sleeves.ts) | Yes | JSON wallet map overlaid on `.wallets.json`. Keys are assigned by coin. |
| `DRY_RUN` | `false` | [`src/config.ts`](../src/config.ts) | No | Exact string `true` forces simulated orders even when wallet keys exist. A sleeve without a key is also dry-run. |
| `MODEL` | `mock` | [`src/config.ts`](../src/config.ts) | No | Selects `mock` or `jev`. |
| `JEV_PROVIDER` | Resolved from available keys, then `openrouter` | [`src/config.ts`](../src/config.ts) | No | Selects `openrouter`, `typesafe`, or `gateway`. |
| `JEV_MODEL_ID` | `jev-latest`, or `typesafe-ai/jev` for gateway | [`src/config.ts`](../src/config.ts) | No | Overrides the model identifier sent to the selected Jev provider. |
| `OPENROUTER_API_KEY` | Unset | [`src/config.ts`](../src/config.ts), [`src/model.ts`](../src/model.ts) | Yes | Credential for the OpenRouter Jev endpoint. |
| `TYPESAFE_API_KEY` | Unset | [`src/config.ts`](../src/config.ts), [`src/model.ts`](../src/model.ts) | Yes | Credential for the official TypeSafe API. |
| `AI_GATEWAY_API_KEY` | Unset | [`src/config.ts`](../src/config.ts), [`src/model.ts`](../src/model.ts) | Yes | Credential used by the Vercel AI Gateway provider. |
| `PORT` | `3000` | [`src/config.ts`](../src/config.ts), [`src/server.ts`](../src/server.ts) | No | Bot HTTP and SSE listen port. |
| `NEXT_PUBLIC_API_URL` | Page host on port `3000` | [`web/src/app/page.tsx`](../web/src/app/page.tsx) | No | Browser-visible bot base URL, without a trailing slash. A bare host gets `https://`. Unset, the browser uses `http://<page hostname>:3000`. Next embeds it into the client bundle at build time. |

Numeric values use JavaScript `Number()` conversion. Invalid numeric text is not replaced by the default. Provider selection and credential requirements are covered in [Jev provider](jev-provider.md).

## Value sources

### Local non-secret values

Copy the examples, then edit the root file for the bot and the web file only when the dashboard needs a different API URL:

```sh
cp .env.example .env
cp web/.env.example web/.env.local
```

Bun automatically loads the root `.env`; no dotenv package is used. The examples are [`/.env.example`](../.env.example) and [`web/.env.example`](../web/.env.example). `NEXT_PUBLIC_API_URL` must be set before a production dashboard build because its value is baked into client JavaScript.

### Secrets with fnox

[`fnox.toml`](../fnox.toml) resolves `OPENROUTER_API_KEY` from 1Password at process start. Its configured reference is `op://u3gfzsvm2c4uhigf252w5xprgq/3jrakpjic7ov2uq5haofe32zku/credential`. [`just dev`](../justfile) and [`just start`](../justfile) run the bot through `fnox exec`, so injected process values take precedence over `.env` values.

Add wallet keys with the global mise helper tasks. They append a `provider = "onepass"` entry, which matches the provider name in `fnox.toml`. Set `FNOX_SKIP_SYNC=1` because their follow-up sync writes an age-encrypted `fnox.local.toml`, and this repo defines no age provider:

```sh
FNOX_SKIP_SYNC=1 mise run fnox-apikey -- PRIVATE_KEY
FNOX_SKIP_SYNC=1 mise run fnox-opref -- VAR ITEM_UUID FIELD
```

Do not put live keys in committed environment files.

### Per-sleeve wallet file

Copy [`.wallets.example.json`](../.wallets.example.json) to the gitignored `.wallets.json` for keys beyond the first coin. [`src/sleeves.ts`](../src/sleeves.ts) reads that file first, overlays `WALLETS_JSON`, then uses `PRIVATE_KEY` only for the first listed coin if it still has no mapped key. Both accepted JSON shapes are implemented by `parseWalletsJson()`.

### Production

Set bot and dashboard production values as Railway variables. Secrets stay on the bot service. Set `NEXT_PUBLIC_API_URL` on the dashboard service before its build. See [Deployment](deployment.md) for the service layout and deployment procedure.
