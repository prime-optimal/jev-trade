# Deployment

## Two services

Railway builds `bot` from the repository root and `web` from `web/`. The historical `bot` service name now means the Bun inference API. It owns only the Jev provider credential and inference work. The Next service serves the browser dashboard, not a trading session gateway.

[`.railway/railway.ts`](../.railway/railway.ts) declares both GitHub sources on `main`, Railpack builds, health checks, and variables. It declares no trading wallet variables, visitor workers, or data volume. Bun serves `GET /health`; Next serves `/`. Both honor Railway's injected `PORT`.

The root [`railpack.json`](../railpack.json) and both package manifests select Bun 1.3.14. Railpack installs each service's dependencies separately with the corresponding lockfile. Bun starts with `bun run start`. Next builds with `bun run build` and starts with `bun run start`.

## Merge deploy versus manual upload

Merging to `main` is the normal application deploy. Both services track GitHub `main`; only services whose watch patterns match the push rebuild. Confirm the resulting deployments with `just deploy-status`.

`just deploy` is the optional pre-merge path. It runs tests and both typechecks, uploads the current checkout to both services with `railway up --ci`, then prints status. It has production side effects and is not a validation command. The next matching push to `main` replaces the upload. Do not deploy as part of a cleanup or review unless explicitly authorized.

The GitHub workflow's `test` and `build` jobs are required status checks on `main`; admins can bypass them. It installs root and web dependencies separately, runs the root Bun suite and both TypeScript checks, builds both checked-out service contexts with Railpack, and builds Next from its independent web context. It does not deploy or apply infrastructure. Green builds do not prove live Railway configuration or a wallet trade works.

## Infrastructure review boundary

Railway evaluates the TypeScript project graph through `railway config plan` and applies it through `railway config apply`. A source merge or an application upload is not an IaC apply. Never add a parallel `railway.json` or `railway.toml` configuration path.

| Recipe | Effect |
| --- | --- |
| `just deploy-plan` | Preview the infrastructure plan for the linked project and environment. |
| `just deploy-infra` | Preview, then invoke apply with confirmation. Use only for an explicitly approved infrastructure change. |
| `just deploy-setup` | Write the fnox OpenRouter secret to `bot` and create or print both public domains. This changes live resources. |
| `just deploy` | Validate and upload this checkout to both services. |
| `just deploy-status` | Read the latest status of both services. |

Issue #24 changes source only. No live plan, apply, volume deletion, secret deletion, or deployment is implied. The old `bot-data` volume and wallet variables may still exist remotely. Removing them from this graph can produce destructive changes in a future plan. Review that exact plan, preserve any needed data, and obtain explicit approval before applying it. Do not use automatic destructive confirmation flags.

Before an authorized apply, confirm the linked project and environment, review all variable and resource removals, and check that neither service uses a legacy Config File path. Keep provider secrets sealed or preserved, not literal values in source. Application rollback cannot restore deleted volume data.

## Origins and inference address

The bot graph sets `MODEL=jev`, `JEV_PROVIDER=openrouter`, `NODE_ENV=production`, and preserves `OPENROUTER_API_KEY`. It allows `https://www.jev-trade.com` and `https://jev-trade.com` through `WEB_ORIGINS`. Add any intended Railway dashboard domain as an exact HTTPS origin through a reviewed configuration change. An unlisted host can render the dashboard but cannot call `/decide`.

The web graph sets `NEXT_PUBLIC_API_URL` to `https://${{bot.RAILWAY_PUBLIC_DOMAIN}}`. Railway expands the reference at build time. The explicit scheme matters because the browser inference adapter requires an absolute URL. Generate the bot public domain before building web. A changed API domain requires a web rebuild, not merely a restart.

There is no runtime `BOT_API_URL`, session gateway cookie, operator port, or backend trading address. Do not provision wallet keys, account addresses, agent keys, or Hyperliquid transport credentials to either service. Browser wallet approval and Hyperliquid requests go directly to their destinations.

## Watch patterns

The bot watches `/src/**`, `/package.json`, `/bun.lock`, and `/railpack.json`. Web watches its source, public assets, package manifest, lockfile, and Next configuration. Patterns are repository-relative, including the `/web/` prefix. A docs-only or IaC-only push need not trigger an application build; IaC changes require their separate reviewed workflow.

## Verification after an authorized rollout

1. Confirm the intended deployment IDs succeeded, not merely that an upload returned.
2. Request the actual bot domain at `/health` and expect `{ "ok": true }`. `/` is intentionally `404`.
3. Open the actual deployed web host. Confirm public market data loads directly from Hyperliquid and the app starts stopped.
4. Confirm its origin is allowed and an explicit paper run receives `/decide` responses. Stop it and check the stopped state. Reload must not resume execution.
5. Treat Brave Wallet approval, real submission, cleanup, and interruption recovery as unverified until explicitly exercised with a wallet. A healthy service or paper run does not establish a live trade.

Bun replicas no longer coordinate a wallet or visitor registry. The graph retains one replica; inference limits remain per process. Browser execution requires an awake tab, and no server takes over on disconnect. Resting orders and accepted positions can outlive a tab; inspect Hyperliquid directly after interrupted cleanup.

## Rollback

Revert an application regression on `main` and let matching services rebuild. Do not restore a server-owned executor or provision old wallet keys as a shortcut. Coordinate root and web changes when the inference contract changes.

For an infrastructure regression, revert its source change and review a fresh plan before any authorized apply. Source rollback does not undo remote variables, resource deletion, or public-domain changes. Repeat health, origin, and explicit paper-run checks after rollout.
