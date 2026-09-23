# Configuration

Bun reads inference configuration at startup. Browser settings control trading locally. Neither settings nor wallet material are sent to a server-side executor.

## Bun environment

| Name | Default | Purpose |
| --- | --- | --- |
| `MODEL` | `jev` | `jev` or local-only `mock`. Production rejects mock. The example template selects mock for local development. |
| `NODE_ENV` | Unset | `production` disables implicit development origins and requires Jev. |
| `JEV_PROVIDER` | Credential selection, then `openrouter` | `openrouter`, `typesafe`, or `gateway`. Without an explicit selection, configured keys select in that order. |
| `JEV_MODEL_ID` | `jev-latest`, or `typesafe-ai/jev` for Gateway | Selected provider model. |
| `OPENROUTER_API_KEY` | Unset | Secret OpenRouter credential. |
| `TYPESAFE_API_KEY` | Unset | Secret TypeSafe credential. |
| `AI_GATEWAY_API_KEY` | Unset | Secret Gateway credential. |
| `PORT` | `3000` | Inference listener, integer 1 through 65535. Railway injects its own port. |
| `WEB_ORIGINS` | No production origins | Exact comma-separated HTTP or HTTPS dashboard origins. No paths, wildcards, or trailing slashes. |
| `INFERENCE_RATE_PER_MINUTE` | `300` | Per-socket-peer refill, integer 1 through 6000. |
| `INFERENCE_BURST` | `20` | Per-peer burst, integer 1 through 1000. |
| `INFERENCE_CONCURRENCY` | `32` | Global active request bound, integer 1 through 256. |
| `INFERENCE_DEADLINE_MS` | `4000` | Response deadline, integer 100 through 30000 ms. Late provider work retains its permit until settlement. |

Bun loads `.env` automatically. Copy [`.env.example`](../.env.example). `just dev` and `just start` use fnox to inject the provider credential from the existing [`fnox.toml`](../fnox.toml). Do not commit credentials. Missing selected-provider credentials fail Jev startup.

Development adds `http://localhost:3001`, `http://127.0.0.1:3001`, and detected IPv4 LAN origins on port 3001. Production must list every intended dashboard origin explicitly, including a Railway preview host if it should call inference. CORS is not wallet authorization.

## Dashboard build environment

`NEXT_PUBLIC_API_URL` is the browser-visible Bun inference base URL. Set a complete URL such as `https://inference.example.com`, with no `/decide` suffix. The browser appends `/decide`. A bare hostname is not supported. With no value, the browser uses the page origin on port 3000. Copy [`web/.env.example`](../web/.env.example) to `web/.env.local` when needed.

Next embeds this value during its build. Rebuild the dashboard after changing it. It must be reachable by the visitor's browser, not a Railway private hostname. There is no `BOT_API_URL`, operator URL, session cookie, or server-side exchange proxy.

## Browser settings and secrets

[`settings.ts`](../web/src/lib/trading/settings.ts) defines browser trading preferences. [`persistence.ts`](../web/src/lib/trading/persistence.ts) controls which non-secret fields can persist. The settings page separates drafts from applied preferences and prevents execution-setting replacement while a run or cleanup is unresolved. Saving never starts a run.

Network, markets, paper or real mode, sizing, cadence, and finite run duration belong here, not in Bun environment variables. Default runs last 30 minutes. Real execution requires explicit wallet connection, agent authorization, and confirmation before On. Reload does not restore execution authority.

[`networks.ts`](../web/src/lib/trading/networks.ts) separates signing identity from transport endpoints. Endpoint selection must not silently change mainnet/testnet signing identity. Wallet providers and ephemeral agent private keys stay in browser memory. Do not persist keys, credential-bearing endpoints, or live authorization as preferences.

The server no longer reads `PRIVATE_KEY`, `WALLETS_JSON`, `.wallets.json`, `HL_*`, `DRY_RUN`, trading cadence or sizing variables, or `CONTROL_*`. Do not provision wallet keys to Bun or Next. Removing declarations from source is not proof that old Railway secrets or volumes have been removed; live cleanup requires a separately reviewed infrastructure plan.
