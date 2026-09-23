# Deployment

## Overview

Railway runs this repository as two services from one GitHub source:

- `bot` builds from the repository root and runs the Bun trading process.
- `web` builds from [`web/`](../web/) and runs the Next dashboard.

[`.railway/railway.ts`](../.railway/railway.ts#L10-L77) defines both services and the `bot-data` volume. Both services use the Railpack builder. [`railpack.json`](../railpack.json#L1-L6) pins the root build to Bun 1.3.14. Railway evaluates this project graph when `railway config plan` or `railway config apply` runs.

Railway Infrastructure as Code replaces the deprecated `railway.json` and `railway.toml` Config as Code model. New services cannot opt into that older model, and Railway stops reading existing Config as Code files on 2026-12-01. Neither service should have a Config File path set in Railway, or two configuration systems will try to manage the same service. See Railway's [Infrastructure as Code guide](https://docs.railway.com/infrastructure-as-code), [IaC reference](https://docs.railway.com/infrastructure-as-code/reference), and [Config as Code notice](https://docs.railway.com/config-as-code).

## Builds

Railpack installs dependencies with `bun install --frozen-lockfile`. The bot starts with `bun run start`. The dashboard runs `bun run build`, then starts with `bun run start` so Next honors Railway's injected `PORT`.

Railpack can resolve a Bun version from several sources, including `packageManager`, mise files, and custom configuration. The repository-level [`railpack.json`](../railpack.json#L1-L6) takes precedence for the bot and fixes Bun at 1.3.14 instead of following the local `mise.toml` value. The dashboard resolves the same version from [`web/package.json`](../web/package.json). See the Railpack [Bun provider](https://railpack.com/languages/bun), [mise integration](https://railpack.com/config/mise), and [configuration file reference](https://railpack.com/config/file).

## Just recipes

The `railway` group in the [`justfile`](../justfile) wraps the flow below. Every recipe acts on the project linked with `railway link` or `railway init`.

| Recipe | What it does |
|---|---|
| `just deploy-plan` | `railway config plan` for `.railway/railway.ts`. Read-only. |
| `just deploy-infra` | Runs the plan, then `railway config apply`, which asks for confirmation. |
| `just deploy-setup` | Reads `OPENROUTER_API_KEY` through fnox, writes it to the bot service from stdin without triggering a deploy, then creates or prints both public domains. Approve the 1Password prompt when it appears. |
| `just deploy` | Runs `just check`, uploads this checkout to `bot` and `web` with `railway up --ci`, streams each build, then prints status. Use it to ship a branch before it merges. |
| `just deploy-status` | Latest deployment status for `bot` and `web`. |

Both services track GitHub `main`, so a merged push to `main` redeploys whichever service's watch patterns match. `just deploy` is for code that is not on `main` yet. The next push to `main` replaces that upload.

First deploy of a fresh project:

```sh
railway init --name jev-trade
just deploy-infra
just deploy-setup
just deploy
```

## First-time setup by hand

Install the Railway CLI, sign in, and link this checkout to the intended project and environment:

```sh
brew install railway
railway login
railway link
```

If the project already exists, select `jev-trade` and the intended environment in the interactive `railway link` prompts. To create it instead, run `railway init --name jev-trade`; that command also links this checkout to the new project's default environment. Keep one project for this deployment. Before applying anything, confirm that no service has a Config File path set. Then preview the graph:

```sh
railway config plan
```

Review the plan. It should create or manage only `bot`, `web`, and the 512 MB `bot-data` volume mounted at `/data`. It should use the `main` branch and preserve the three bot secret variables. Apply only when that exact plan is intended:

```sh
railway config apply
```

The IaC graph does not generate Railway public domains. After the services exist, create one for each service:

```sh
railway domain --service bot
railway domain --service web
```

Railway injects `PORT` at runtime. The bot's local default of 3000 is not a production guarantee. Set the public domain target to the port in the bot's ready log. Check that the CLI is linked to the correct project and environment before updating it:

```sh
railway domain update <domain> --port 8080 --service bot
```

Set each secret without putting its value in shell history. `OPENROUTER_API_KEY` is required for the first safe deployment. Add wallet values later, before live trading. If a custom Hyperliquid provider requires an HTTP credential, set `HL_API_KEY` the same way:

```sh
printf '%s' "$OPENROUTER_API_KEY" | railway variables set OPENROUTER_API_KEY --stdin --service bot
printf '%s' "$PRIVATE_KEY" | railway variables set PRIVATE_KEY --stdin --service bot
printf '%s' "$WALLETS_JSON" | railway variables set WALLETS_JSON --stdin --service bot
printf '%s' "$HL_API_KEY" | railway variables set HL_API_KEY --stdin --service bot
```

The CLI can write these variables but does not expose a sealing flag. In the bot service Variables tab, open each secret variable's menu and choose **Seal**. A sealed value remains available to builds and deployments but cannot be read through the UI or API. Do not replace a variable that `railway variables list --service bot` reports as `<sealed>`. See [Railway variables](https://docs.railway.com/variables).

The first deployment must keep the safe defaults from [`.railway/railway.ts`](../.railway/railway.ts#L30-L44):

```text
MODEL=jev
JEV_PROVIDER=openrouter
HL_TESTNET=true
DRY_RUN=true
```

After deployment:

1. Request the bot public URL and confirm `/` returns HTTP 200.
2. Open the web public URL and confirm the dashboard receives the live feed.
3. Confirm the bot remains on testnet and dry-run before adding wallet funds.

With these paper-mode defaults, each bot process starts one configured-duration run when its first sleeve becomes ready. Expiry or manual Stop does not loop into another run; restarting the process creates a new paper run. A real-mode process starts Off and requires explicit confirmation through the private operator API. The public Railway dashboard remains a read-only guest view.

Railway documents generated domains under [public networking](https://docs.railway.com/networking/public-networking) and health checks under [deployment health checks](https://docs.railway.com/deployments/healthchecks).

## Dashboard API address

The web service sets `NEXT_PUBLIC_API_URL` from `bot.env.RAILWAY_PUBLIC_DOMAIN` in [the IaC graph](../.railway/railway.ts#L70-L72). Railway resolves that service reference to the bot's generated host. [`web/src/app/page.tsx`](../web/src/app/page.tsx#L16-L17) adds `https://` when the value has no scheme.

Railway exposes variables during builds as well as runtime. Next compiles `NEXT_PUBLIC_API_URL` into browser JavaScript during `bun run build`. If the bot domain changes, rebuild and redeploy `web`; restarting the existing web deployment is not enough. See [Railway variable references](https://docs.railway.com/variables/reference) and [build and start commands](https://docs.railway.com/builds/build-and-start-commands).

## Watch patterns

The bot watches `/src/**`, `/package.json`, `/bun.lock`, and `/railpack.json`. The dashboard watches its source, public assets, package files, lockfile, and Next configuration under `/web`.

Railway matches every watch pattern from the repository root, even when a service has a different root directory. Keep the `/web/` prefix on dashboard patterns. A push that changes no matching path does not trigger that service's deployment. The declarations live in [`.railway/railway.ts`](../.railway/railway.ts#L16-L19) and [`.railway/railway.ts`](../.railway/railway.ts#L49-L58).

## Single-bot safety

The wallet-owning bot must have one active process. Check all of these before every live deployment:

- Keep `bot-data` attached at `/data`. A Railway volume prevents old and new deployments of the same service from running at the same time, so deploys have brief downtime.
- Keep bot replicas at 1. Railway does not support replicas with a mounted volume.
- Do not create a second Railway environment, PR environment, or service with the same wallet keys.
- Do not run a local live bot against wallets used by production.
- Scope `PRIVATE_KEY` and `WALLETS_JSON` to the production `bot` service. Never add them as shared variables or web variables.
- Accept deploy downtime. Preventing duplicate orders is more important than a zero-downtime handoff.

`overlapSeconds: 0` and `drainingSeconds: 0` reduce handoff time, but the mounted volume is what enforces stop-before-start behavior. See the Railway [volume reference](https://docs.railway.com/volumes/reference) and [deployment reference](https://docs.railway.com/deployments/reference).

## Going live

1. Exercise every configured sleeve on testnet with `HL_TESTNET=true` and `DRY_RUN=true`.
2. Add and seal the intended production wallet variables on the bot service only.
3. Fund the intended wallets and verify each coin-to-wallet assignment and `QUOTE_USD` setting.
4. Change `DRY_RUN` from `"true"` to `"false"` in the bot `env` block of [`.railway/railway.ts`](../.railway/railway.ts#L30-L44), run `railway config plan`, review, then `railway config apply`. Do not flip it only in the dashboard or with `railway variables`; the IaC value would restore `true` on the next apply. Keep `HL_TESTNET` at `"true"` until real order behavior has been checked on testnet.
5. Change `HL_TESTNET` to `"false"` the same way, only for the mainnet launch.
6. Confirm the volume is attached, replicas remain at 1, and no other process has the same keys.

The variable meanings and wallet precedence are documented in [Configuration](configuration.md#environment-variables) and [Trading behavior](trading.md).

## Rollback

For an application regression, revert the offending commit on `main` and let the affected service rebuild from the reverted source. Do not start a second bot service as a shortcut. Keep the volume attached throughout the rollback.

For an infrastructure regression, revert the corresponding change in [`.railway/railway.ts`](../.railway/railway.ts), run `railway config plan`, review the reversal, then run `railway config apply` only when the reversal is correct. A source rollback does not undo Railway variables. Restore changed variables separately, review the staged changes, and redeploy the affected service. After either rollback, repeat the bot HTTP 200 and dashboard feed checks.
