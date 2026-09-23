# Dashboard

The dashboard is a separate Next.js App Router application in [`web/`](../web/). The public view reads market data and run status from Bun. It does not receive wallet keys, Jev credentials, or transport API keys.

## Routes and shared state

[`web/src/app/page.tsx`](../web/src/app/page.tsx) renders the market dashboard. [`web/src/app/settings/page.tsx`](../web/src/app/settings/page.tsx) renders the non-indexed settings page. [`SettingsProvider`](../web/src/lib/trading/SettingsProvider.tsx) sits above both routes, so navigation does not create another market feed or reset a run display.

The Header separates two facts:

- `Prices connected`, `connecting`, or `reconnecting` reports the public SSE connection.
- `Off`, `Starting`, `Running`, `Stopping`, `Expired`, or `Attention required` reports the authoritative Bun run.

A connected price stream does not mean trading is running. The old green Live meaning no longer controls trading. Green run styling appears only while the lifecycle reports `running`.

The run display derives elapsed and remaining time from Bun's `startedAt`, `deadlineAt`, `stoppedAt`, `durationMs`, and `serverNow`. React's interval only refreshes the display. It does not enforce or extend the deadline. A refresh reconnects to the existing Bun run and never sends Start.

## Operator and guest views

The public dashboard is not a global trading control. The operator switch works only when the browser can reach the private loopback control API and the operator connection preflight is valid. Remote public visitors can see run state but cannot start, stop, validate, reconcile, or apply settings.

On a localhost page, the browser defaults the operator API to `http://127.0.0.1:3002`. A non-local page has no operator API unless `NEXT_PUBLIC_OPERATOR_API_URL` was explicitly built in. That variable is only routing. It adds no authentication, so it must point to a deliberately protected local channel, never a public reverse proxy.

Startup and process restart are Off. Start requires at least one enabled asset and a successful transport validation. Real mode also opens an explicit confirmation prompt and the Bun API requires `confirmReal: true`. No Brave Wallet connection is required for the current server-wallet operator path.

The switch shows the configured limit while Off, 30 minutes by default. A running display shows elapsed time and remaining time. Manual Off and expiry use the same owned-order cleanup path. `Attention required` blocks another start and locks execution settings. The private operator view shows Retry cleanup, which calls reconcile and unlocks the form only after cleanup succeeds. Stop does not liquidate positions.

## Settings page

The form separates drafts from applied settings.

- Save validates one complete snapshot. In operator scope it rebuilds the stopped Bun executor. In guest scope it saves browser preferences only.
- Cancel restores the applied values without making a request.
- Reset changes the draft. Save is still required.
- Trading and connection fields are disabled during Starting, Running, Paused, Stopping, and Attention required. Theme remains editable.

The page covers appearance, network and paper or real mode, enabled assets, entry notional, transport endpoints, optional custom API authentication, run duration, and advanced cadence and order values. Operator configuration shows non-secret values and configured or missing secret status. It never displays secret values.

Theme uses `jev-trade:theme:v1`. The first visit follows the system preference. An explicit light or dark choice updates the whole app and the browser theme color. Guest and future owner settings use separate network-scoped storage keys. API keys, RPC URLs, and credential-bearing endpoint paths or queries stay in memory.

## Feed lifecycle

[`useFeed()`](../web/src/lib/useFeed.ts) first fetches `GET /snapshot` and opens `/events?lite=1`. The lite stream sends `ready` instead of another snapshot. The hook later fetches `/tape` for deeper chart history.

A 45-second event gap reconnects the stream. Before the first snapshot, the timeout is 90 seconds. Retry delay starts at one second and caps at ten seconds. `ping` events keep the connection active. Run state is also polled from public `GET /run` every two seconds, and operator state is polled every five seconds when the local channel exists.

Every configured sleeve remains visible if initialization fails. Healthy sleeves continue independently. A failed sleeve can retry only while the authoritative run is Running. It cannot restart an expired or manually stopped run.

## Shared wire types

[`src/types.ts`](../src/types.ts) is canonical for the market feed. [`web/src/lib/bot-types.ts`](../web/src/lib/bot-types.ts) is its byte-for-byte dashboard copy. Settings and lifecycle contracts likewise have Bun and web copies because the dashboard build does not import root source files.

## API URLs and local development

`NEXT_PUBLIC_API_URL` selects the public Bun API. When unset, the browser uses its page hostname on port 3000. `NEXT_PUBLIC_OPERATOR_API_URL` selects the private control API only when explicitly set; localhost pages otherwise use `127.0.0.1:3002`.

Run Bun on port 3000 and the dashboard on port 3001. The private operator listener starts with Bun on loopback port 3002. Its default accepted origin is `http://localhost:3001`, so use that exact dashboard URL unless the control origin is configured to another explicit loopback origin.

Rendered text must not contain middle dots, em dashes, or en dashes. Do not add blinking or pulsing indicators.
