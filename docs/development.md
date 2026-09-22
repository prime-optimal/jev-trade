# Development

## Prerequisites

- [mise](https://mise.jdx.dev/) for repository tool versions and helper tasks. [`mise.toml`](../mise.toml) declares Bun, fnox, hk, and communique.
- Bun. The root [`package.json`](../package.json), dashboard [`web/package.json`](../web/package.json), and [`railpack.json`](../railpack.json) pin production and package-manager use to Bun 1.3.14. The local mise configuration tracks the latest Bun.
- [fnox](https://fnox.jdx.dev/) with the 1Password CLI signed in. [`fnox.toml`](../fnox.toml) resolves secrets when the bot starts.
- [just](https://just.systems/) for the project recipes in [`justfile`](../justfile).

Do not use Node, npm, pnpm, Vite, Express, or dotenv for this repository. The bot is a Bun process. The dashboard is a separate Next.js application in [`web/`](../web/).

## First-time setup

Install both dependency trees and create the local bot configuration:

```sh
just install
cp .env.example .env
```

Edit `.env` for the intended model and safety mode. See [Configuration](configuration.md) for every variable and secret source. Copy `web/.env.example` to `web/.env.local` only when the dashboard needs a bot URL other than its localhost default.

## Run locally

Start the bot in watch mode with fnox secrets injected:

```sh
just dev
```

The bot serves HTTP and SSE on port 3000 by default. In another terminal, start the dashboard:

```sh
just web
```

The dashboard development server listens on port 3001. Open `http://localhost:3001`.

`HL_TESTNET` defaults to `true`. A sleeve without a wallet key is dry-run automatically, and `DRY_RUN=true` forces every sleeve to simulate orders even when keys are available. Keep testnet and dry-run enabled until live wallet assignment and quote sizing have been reviewed. See [Trading behavior](trading.md).

## Verification commands

| Command | Work performed |
| --- | --- |
| `just test` | Runs the root Bun test suite. |
| `just typecheck` | Runs TypeScript checks for the bot and dashboard. |
| `just check` | Runs tests and both typechecks. |
| `just build-web` | Creates a production Next dashboard build. |

The recipes are defined in [`justfile`](../justfile). Tests belong in [`test/`](../test/), not beside source files, and use Bun's test runner.

## Continuous integration

[`.github/workflows/test.yml`](../.github/workflows/test.yml) runs for pull requests and pushes to `main`. Its Ubuntu job checks out the repository, installs the latest Bun through `oven-sh/setup-bun`, runs `bun install --frozen-lockfile`, then runs `bun test`. It does not typecheck or build the dashboard, so run `just check` and `just build-web` locally when a change affects those surfaces.

## Shared wire types

[`src/types.ts`](../src/types.ts) is the canonical bot HTTP and SSE type file. [`web/src/lib/bot-types.ts`](../web/src/lib/bot-types.ts) is an exact copy because the standalone dashboard build cannot depend on files outside `web/`. Update both files in the same change. [`test/types.test.ts`](../test/types.test.ts) verifies that they are byte-for-byte identical.

Dashboard-only types belong in [`web/src/lib/types.ts`](../web/src/lib/types.ts). More detail is in [Dashboard](dashboard.md).

## Project rules

The repository rules are recorded in [`CLAUDE.md`](../CLAUDE.md):

- Use Bun commands and APIs for the bot. Use `Bun.serve()` for HTTP and SSE, built-in WebSocket support, and `Bun.file` for new file I/O.
- Keep the Bun bot and Next dashboard as separate runtimes. Credentials, Jev evaluation, and orders stay in the bot.
- Put tests under `test/` and run them with `bun test`.
- Keep Jev as the decision maker on every Hyperliquid decision tick. `hold` is a valid Jev answer. Late ticks (previous call still running, or provider pause) currently skip the Jev call; see Known issues in [`CHANGELOG.md`](../CHANGELOG.md).
- Rendered text must not contain middle dots, em dashes, or en dashes.
- Do not add blinking or pulsing indicators.

## Documenting changes

For every behavior, configuration, or deployment change, update the matching file under [`docs/`](./) and add an entry under `Unreleased` in [`CHANGELOG.md`](../CHANGELOG.md). Keep API payload changes synchronized with the shared wire types and [API documentation](api.md).
