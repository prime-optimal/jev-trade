# Isolated visitor paper sessions

Tracking: https://github.com/prime-optimal/jev-trade/issues/8

Approved ownership: each visitor controls their own paper session. Never route a visitor mutation to the shared bot or expose the loopback operator.

## Implemented

- Extracted executor assembly into `execution-runtime.ts`. The shared index still uses wallet-backed sleeve specs. Each visitor uses the same runtime in a distinct keyless Bun Worker with paper mode and official venue endpoints only.
- Injected `globalThis.__JEV_RUNTIME_ENV__` before importing runtime modules in the Worker. Passing an allowlisted Worker `env` alone was not sufficient because Bun can inline the parent dotenv value for direct `process.env.NAME` reads.
- Reused the public snapshot and SSE server plus the operator handler behind a visitor guard. The guard rejects real mode, credentials, custom destinations, and decision cadences below 30000 ms before a request reaches runtime settings.
- Added the in-memory bot registry and capability router. It supports the session operator, settings, validation, lifecycle, snapshot, history, tape, and SSE routes. Defaults are 8 Workers, 10-minute inactivity expiry, 2 SSE streams per session, 64 KiB bodies, creation burst 8 with refill 16 per minute, and a 30-second Start cooldown.
- Added the same-origin Next gateway. It keeps the opaque capability in an HttpOnly, SameSite=Strict cookie scoped to `/api/session`, adds Secure in production, and requires mutation Origin to match the exact public Host and forwarded protocol. The gateway uses `BOT_API_URL` at runtime and falls back to `NEXT_PUBLIC_API_URL`.
- Remote pages now establish an isolated session before loading feed or run data. The Worker starts Off. Save applies settings to that Worker; Start, Stop, and cleanup reset stay within it. Refresh resumes the same capability and applied settings. Localhost retains the private shared operator.
- Session state is memory-only. An authenticated DELETE, inactivity expiry, or bot restart loses the Worker, settings, run, and history. The UI shows Reconnect instead of creating a replacement automatically. Reconnect creates a new Off Worker with defaults, empty history, and all five supported coins. Shared public endpoints remain read-only.

## Ownership

Runtime: `src/index.ts`, `src/server.ts`, `src/execution-runtime.ts`, `src/paper-session-worker.ts`, `src/paper-session-guard.ts`.

Registry: `src/paper-sessions.ts`.

Gateway: `web/src/app/api/session` and `web/src/lib/trading/session-gateway.ts`.

UI: `SettingsProvider`, operator helpers, feed transport, Header, and SettingsForm.

## Proof

- Local regression coverage passed for capability isolation, unknown and expired capabilities, paper-only restrictions, custom transport and credential rejection, body, stream, creation, cooldown, and lifecycle limits.
- The explicit environment injection check proved that hostile parent dotenv wallet and transport values do not enter a visitor runtime, and that only the injected model credential reaches the provider.
- A local mock-model smoke exercised two actual Bun Workers and two Chromium BrowserContexts. Each context independently saved settings and ran Start and Stop. Refresh resumed an applied value of 52 in the same session.
- An authenticated session DELETE moved the UI to explicit Reconnect with no automatic replacement. Clicking Reconnect created a fresh Off session with the default value of 40, empty history, and all five supported coins.
- The completed local check covered 150 tests, root and web TypeScript checks, and the production dashboard build.

## Railway release proof

- User approved production deployment. Both uploads used clean committed archives, excluding `.env`, `env.bak`, wallet files and unrelated local plans.
- Bot commit `53d2b76`: deployment `2780b3d8-3875-4332-ab80-e752ffc4fde3`, SUCCESS. Startup confirmed `model=jev openrouter`, paper mode, five live keyless sleeves.
- Web commit `203b410`: deployment `2c0eb1e9-75bc-41f6-870d-91e4f260d653`, SUCCESS. This includes the verified host-only Railway URL normalization fix.
- On https://web-production-ae50f.up.railway.app/settings, the first browser saved BTC-only settings with a quote value of 41 and used the rendered Start and Stop switch. Jev returned hold in 190 ms and sell in 134 ms, neither late.
- A second isolated Chromium context retained the default quote value of 40, all five coins, and Off state. Starting that context did not start the first. Both were stopped; refreshing the first resumed its saved settings.
- The shared bot retained run ID `c61cde9e-892f-4661-a425-a27252d94a92` and Running status throughout visitor control verification.
- The production capability cookie was HttpOnly, Secure, SameSite=Strict, and scoped to `/api/session`. The dashboard rendered the visitor's BTC history. Smoke sessions were removed afterward.
- Final checks passed: 150 tests, 603 assertions, both TypeScript checks, and the production Next build. PR: https://github.com/prime-optimal/jev-trade/pull/13.
