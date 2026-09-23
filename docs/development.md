# Development

## Setup

Use Bun and the [`justfile`](../justfile) recipes. Root Bun and `web/` Next are separate dependency trees with separate lockfiles. Do not flatten them or import root runtime code into the standalone web build. fnox and the 1Password CLI supply the configured Jev provider credential for `just dev` and `just start`.

```sh
just install
cp .env.example .env
```

The template uses local mock inference. Select `MODEL=jev` and configure the chosen provider credential to exercise Jev. Production requires Jev. Trading settings belong to the browser, not the root environment. See [Configuration](configuration.md).

## Local processes

Start each process in its own terminal:

```sh
just dev
just web
```

Bun serves `/health` and `/decide` on port 3000. Next serves the dashboard on port 3001. Open http://localhost:3001. Copy `web/.env.example` to `web/.env.local` only when an absolute inference URL override is needed. Its value must be browser-reachable; it is compiled into the web build.

The dashboard starts stopped. Public feeds work without a wallet. Begin with an explicit finite paper run. Connecting a wallet or saving preferences must not start trading, and a reload must not resume it. Do not add wallet private keys to either runtime's environment.

## Checks

| Command | Work performed |
| --- | --- |
| `just test` | Root Bun suite, including browser module contracts under `test/`. |
| `just typecheck` | Separate root and web TypeScript checks. |
| `just check` | Tests and both typechecks. |
| `just build-web` | Production Next build from the web dependency tree. |

Tests live under [`test/`](../test/), not beside source. Use Bun's runner. A mock or paper check does not prove real Brave Wallet approval, live orders, cleanup, or browser-interruption behavior. Record the actual wallet exercise before claiming those paths are verified.

## Continuous integration

[`.github/workflows/test.yml`](../.github/workflows/test.yml) runs on pull requests and pushes to `main`, using Bun 1.3.14. The `test` job installs root and web with their frozen lockfiles, runs `bun run test`, and typechecks both runtimes. The independent `build` job installs the latest Railpack and starts BuildKit, then runs `railpack build .` for Bun and `railpack build ./web` for Next against the checked-out commit. It then installs web dependencies with its frozen lockfile and runs the Next production build.

Both `test` and `build` are required status checks on `main`; admins can bypass them. Railpack builds run before the host dependency install and Next build so those generated files cannot enter the service build contexts. Local `railpack build` is diagnostic only: Railway does not pin its builder version, and a dirty local checkout can include untracked files absent from GitHub.

The workflow does not run wallet approvals, deploy, or apply IaC. `just deploy` is not another check command; it uploads to production. See [Deployment](deployment.md).

## Inference and browser types

[`src/types.ts`](../src/types.ts) is the canonical address-free inference contract. [`web/src/lib/bot-types.ts`](../web/src/lib/bot-types.ts) is byte-identical so web can build without the repository root. Update both together; [`test/types.test.ts`](../test/types.test.ts) checks equality.

Display, account, wallet, and lifecycle types belong to [`web/src/lib/trading/types.ts`](../web/src/lib/trading/types.ts) and their browser modules. Do not put them back into the inference contract or add compatibility exports for deleted server executors.

## Browser safety boundaries

- Keep Jev as the decision maker on every trading tick. Hold is an answer; inference failure is an error, not hold.
- Keep exchange work serialized independently of inference. Late responses must pass browser run and tick guards before acting.
- Keep provider credentials on Bun and wallet signing material in browser memory. Wallet and Hyperliquid transports are direct.
- Preserve explicit finite runs and exact-owned cleanup. No automatic resume, server takeover, or liquidation claim on Stop.
- Keep rendered text free of middle dots, em dashes, and en dashes. Do not add blinking or pulsing indicators.

## Documentation

Update the matching document for behavior, configuration, or deployment changes and add an `Unreleased` entry to [`CHANGELOG.md`](../CHANGELOG.md). Keep [API documentation](api.md) aligned with the inference types and [Trading behavior](trading.md) aligned with the browser session implementation.
