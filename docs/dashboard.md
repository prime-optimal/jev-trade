# Dashboard

The dashboard is a separate Next.js App Router application in [`web/`](../web/). It reads the bot's public API and does not access wallets, Jev credentials, or Hyperliquid clients.

## Structure

### `web/src/app`

| Path | Responsibility |
| --- | --- |
| [`page.tsx`](../web/src/app/page.tsx) | Client page composition, sleeve selection, portfolio summaries, and API URL selection. |
| [`layout.tsx`](../web/src/app/layout.tsx) | Root HTML, font, metadata, icons, and structured data. |
| [`globals.css`](../web/src/app/globals.css) | Global tokens and page-level styles. |
| [`page.module.css`](../web/src/app/page.module.css) | Main two-column layout. |
| [`robots.ts`](../web/src/app/robots.ts) | Robots metadata route. |
| [`sitemap.ts`](../web/src/app/sitemap.ts) | Sitemap metadata route. |

### `web/src/components`

| Component | Responsibility |
| --- | --- |
| `Header` | Connection state and portfolio balance and PnL. |
| `SleeveStrip` | Coin selection and per-sleeve status. |
| `FlowChart` and `CandlePane` | Price candles, live mids, and fill markers. |
| `DecisionPanel` | Current Jev decision, probabilities, position, and order state. |
| `Feed` | Recent decision and trade activity. |
| `Book` | Sleeve summary cards and expanded market detail. |
| `Logo`, `TokenIcon`, `Skeleton` | Shared visual elements and loading placeholders. |

Each component keeps its styles in the same directory as a CSS module.

### `web/src/lib`

| File | Responsibility |
| --- | --- |
| [`useFeed.ts`](../web/src/lib/useFeed.ts) | Snapshot loading, SSE lifecycle, reconnects, reducer state, and tape hydration. |
| [`bot-types.ts`](../web/src/lib/bot-types.ts) | Exact dashboard copy of the bot wire types. |
| [`types.ts`](../web/src/lib/types.ts) | Re-exports wire types and adds dashboard-only feed state. |
| [`ohlc.ts`](../web/src/lib/ohlc.ts) | Candle and live-mid transformations. |
| [`fills.ts`](../web/src/lib/fills.ts) | Fill marker helpers. |
| [`format.ts`](../web/src/lib/format.ts) | Display formatting and decision labels. |
| [`pnl.ts`](../web/src/lib/pnl.ts) | Portfolio balance and PnL aggregation. |

## Feed lifecycle

[`useFeed()`](../web/src/lib/useFeed.ts) first fetches `GET /snapshot` and opens `/events?lite=1`. The lite stream sends a `ready` event instead of duplicating the snapshot. After the first snapshot, the hook fetches `/tape` for deeper chart history.

The reducer keeps state by coin. `block` appends or replaces a decision event. Later `quote` and `fill` events update the matching block. `price` updates the current mark and live candle without creating a decision. The browser keeps at most 1,000 block events and 200,000 tape points per sleeve.

A 45-second event gap triggers reconnection. Before the first snapshot, the timeout is 90 seconds. Reconnect delay starts at one second and caps at ten seconds. `ping` events keep the connection live.

## Shared wire types

[`src/types.ts`](../src/types.ts) is canonical. [`web/src/lib/bot-types.ts`](../web/src/lib/bot-types.ts) must remain byte-for-byte identical because the dashboard build does not depend on files outside `web/`. [`test/types.test.ts`](../test/types.test.ts) enforces the copy.

When a wire type changes, update both files in the same change. Dashboard-only types belong in [`web/src/lib/types.ts`](../web/src/lib/types.ts), not in the shared copy.

## API URL and local development

[`page.tsx`](../web/src/app/page.tsx) reads `NEXT_PUBLIC_API_URL` and adds `https://` to a bare host. When it is unset, the browser uses the page's own hostname on port 3000, so `http://localhost:3001` and the LAN Network URL both reach the local bot. Next embeds `NEXT_PUBLIC_*` values into the client bundle at build time, so set the production bot URL before building the dashboard.

In development, [`next.config.ts`](../web/next.config.ts) adds every non-internal IPv4 address of the machine to `allowedDevOrigins`, so opening the dashboard by LAN IP is not blocked by Next's cross-origin dev check. The list is read when `just web` starts; restart it after the machine's address changes. The bot already sends `access-control-allow-origin: *` ([`src/server.ts`](../src/server.ts)).

Run the bot on port 3000 and the dashboard with Bun:

```sh
bun run start
bun run --cwd web dev
```

The dashboard dev script runs `next dev -p 3001`, so open `http://localhost:3001`.

## Rendered-text rules

Rendered text must not contain middle dots, em dashes, or en dashes. Use commas, colons, parentheses, or separate sentences. Do not add blinking or pulsing indicators. Static state changes and plain connection labels are acceptable.
