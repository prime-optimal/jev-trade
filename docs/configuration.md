# Configuration

The Bun process reads environment values at startup, then exposes an operator-only session settings layer. The dashboard keeps guest preferences separately. Neither settings path writes `.env` or Railway variables.

## Environment variables

| Name | Default | Secret | Purpose |
| --- | --- | --- | --- |
| `HL_COINS` | `BTC,ETH,SOL,DOGE,BNB` | No | Initial enabled perps. Runtime settings support these five coins. |
| `HL_TESTNET` | `true` | No | Only the exact string `false` selects mainnet. |
| `HL_API_URL` | Selected network API | No | Hyperliquid HTTP API base URL. A blank WebSocket override derives from this URL. |
| `HL_WS_URL` | Derived from HTTP API | No | Independent market WebSocket override. |
| `HL_RPC_URL` | Selected network SDK RPC | Potentially | SDK explorer RPC URL. Query strings and provider paths may contain credentials. |
| `HL_API_KEY` | Unset | Yes | Optional credential for a custom HTTP API. Official Hyperliquid API hosts reject transport keys. The key is never sent to the RPC or WebSocket. |
| `HL_API_KEY_HEADER` | `Authorization` | No | Header that carries the custom API key. Reserved and invalid header names are rejected by runtime settings. |
| `HL_API_KEY_SCHEME` | `Bearer` | No | One authentication token prepended to the key. Blank sends the raw key. |
| `HL_FALLBACK_POLL_MS` | `30000` | No | HTTP recovery interval while the market WebSocket is disconnected. Valid runtime range is 1000 through 300000 ms. |
| `TICK_MS` | `30000` | No | Jev decision cadence. Valid runtime range is 5000 through 300000 ms. |
| `PRICE_MS` | `1000` | No | Chart and live-mid cadence. Valid runtime range is 50 through 5000 ms. It does not call Jev. |
| `QUOTE_USD` | `40` | No | Positive entry notional for one quote. |
| `QUOTE_INSIDE_TICKS` | `1` | No | Entry offset, from 0 through 10 ticks. |
| `CLOSE_SLIPPAGE_BPS` | `5` | No | Reduce-only IOC exit slippage, from 0 through 100 basis points. |
| `HORIZON_BLOCKS` | `100` | No | Decision lookback, from 20 through 400 ticks. |
| `BANKROLL_USD` | `200` | No | Positive paper PnL denominator. It is not real equity or a loss limit. |
| `RUN_DURATION_MINUTES` | `30` | No | Positive integer minutes for each new run. There is no unlimited mode. |
| `PRIVATE_KEY` | Unset | Yes | Wallet key for the first configured coin when no wallet map entry exists. |
| `WALLETS_JSON` | Unset | Yes | Coin-to-wallet mapping overlaid on `.wallets.json`. |
| `DRY_RUN` | `true` | No | Paper mode unless the exact string `false` is supplied. Real mode also needs a wallet, successful official-network validation, and explicit confirmation at Start. |
| `MODEL` | `mock` | No | `mock` or `jev`. |
| `JEV_PROVIDER` | Resolved from configured provider keys, then `openrouter` | No | `openrouter`, `typesafe`, or `gateway`. |
| `JEV_MODEL_ID` | Provider default | No | Model identifier for the selected Jev provider. |
| `OPENROUTER_API_KEY` | Unset | Yes | OpenRouter credential. |
| `TYPESAFE_API_KEY` | Unset | Yes | Official TypeSafe credential. |
| `AI_GATEWAY_API_KEY` | Unset | Yes | Vercel AI Gateway credential. |
| `PORT` | `3000` | No | Public read-only HTTP and SSE port. |
| `CONTROL_PORT` | `3002` | No | Private operator listener port. The listener always binds `127.0.0.1`. |
| `CONTROL_ORIGIN` | `http://localhost:3001` | No | Exact local dashboard origin allowed to mutate operator state. It must be an explicit localhost, `127.0.0.1`, or IPv6 loopback HTTP origin. |
| `CONTROL_HOST` | `127.0.0.1:<CONTROL_PORT>` | No | Exact accepted Host header. It must name a loopback host and the configured control port. |
| `NEXT_PUBLIC_API_URL` | Page hostname on port `3000` | No | Browser-visible public bot API. A bare host gets `https://`. Set it before a production dashboard build. |
| `NEXT_PUBLIC_OPERATOR_API_URL` | `http://127.0.0.1:3002` on localhost pages, otherwise disabled | No | Optional browser-visible operator base URL. Set it only for an explicitly arranged local channel. It does not add authentication or make remote exposure safe. |

Bun loads the root `.env` automatically. Copy [`.env.example`](../.env.example) for bot values and [`web/.env.example`](../web/.env.example) for browser build values. Do not commit live credentials.

## Settings and operator boundary

The public server on `PORT` is read-only. It publishes market data and authoritative run state, but it cannot apply settings or start and stop the shared wallet. Do not reverse proxy the control listener into the public site.

The operator listener binds only to `127.0.0.1`. It checks the peer address, exact Host header, and exact Origin for mutations. Use it from the local dashboard. An SSH tunnel is suitable only when both dashboard and control ports remain local loopback endpoints and the configured origin and host still match. Never expose port 3002 to a LAN or the internet.

The operator response includes non-secret model and provider configuration, whether provider and wallet secrets exist, the environment baseline, and session override names. It never returns wallet keys, provider keys, or the transport key. Credential-bearing endpoint paths and query strings are redacted from operator responses.

Save applies one validated operator snapshot while stopped and rebuilds execution resources. Cancel changes only the draft. Guest Save writes browser preferences and never changes Bun. Startup is always Off, including process restart. No stored preference starts trading.

## Transport validation

Validation runs while stopped and checks all three configured transports with an eight-second bound:

- HTTP sends Hyperliquid `meta` to the effective `/info` URL and checks the universe shape.
- WebSocket subscribes to `allMids` and waits for an expected channel response.
- SDK RPC sends the explorer request `{ type: "userDetails", user: "0x0000000000000000000000000000000000000000" }` and expects a `userDetails` response with a `txs` array.

The API key is scoped to Hyperliquid HTTP info and exchange requests. The separate SDK RPC transport receives no API-key header. Current trading does not otherwise depend on the SDK explorer RPC, but validation requires the configured RPC to support that protocol.

The validator rejects a selected network paired with the other network's official API, WebSocket, or RPC endpoint. A fully official matching endpoint set establishes network identity. A custom set can pass connectivity checks, but its network identity cannot be proven, so real trading remains disabled. There is no fallback to official endpoints after a custom endpoint fails.

## Browser persistence

Validated guest settings use `jev-trade:settings:v1:<network>:guest`. A future lowercase wallet owner uses `jev-trade:settings:v1:<network>:<owner>`. The first load for an owner copies guest values only when that owner has no saved value. Existing owner settings remain isolated.

The selected network uses `jev-trade:network:v1`. Theme uses `jev-trade:theme:v1`. Theme is browser-wide and may change while trading runs. If storage is unavailable, settings remain in memory and the page warns that they will not survive a refresh.

Transport API keys are memory-only. RPC overrides are memory-only. HTTP and WebSocket URLs with query strings or provider base paths are also memory-only because they may contain credentials. Run state, wallet keys, and provider credentials are never stored in browser settings.

## Secret sources

[`fnox.toml`](../fnox.toml) resolves the configured OpenRouter secret at process start. The `just dev` and `just start` recipes use `fnox exec`. Per-coin wallet keys may come from the gitignored `.wallets.json`, `WALLETS_JSON`, and then `PRIVATE_KEY` for the first coin. The settings page shows only configured or missing status for these operator secrets.
