# Architecture

## Runtime split

The repository contains two processes:

- The bot runs on Bun from the repository root. It owns credentials, market data, Jev calls, account state, and Hyperliquid orders.
- The dashboard runs on Next.js from [`web/`](../web/). It receives public JSON and SSE data from the bot. It does not import bot runtime code or hold trading credentials.

This boundary is intentional. Trading and secrets stay in the Bun process, while the dashboard remains a live Next app.

## Startup

[`src/index.ts`](../src/index.ts) creates one reusable execution runtime for the shared executor, registers every configured sleeve, and prepares sleeves serially to avoid a burst of Hyperliquid HTTP requests. Immutable symbol and leverage metadata is fetched once and shared across its sleeves. A successful sleeve becomes live immediately. A failed sleeve remains registered as retrying and retries independently after 30 minutes without restarting healthy sleeves.

The HTTP and SSE server starts before shared sleeve initialization. In shared paper mode, startup arms one timed run after settings are applied and starts it when the first sleeve is ready. Shared real mode remains Off until a private operator starts it. Expiry or manual Stop never starts another shared run.

The same bot process owns a registry of isolated visitor sessions. Creating a session starts a keyless paper execution runtime in its own Bun Worker and loopback HTTP server. That Worker starts Off. The registry authenticates each nested session request with its opaque capability, proxies it only to the matching Worker, and disposes idle Workers. The shared executor and visitor Workers reuse the runtime and serializers but do not share lifecycle, settings, history, or trades.

## Bot modules

| File | Responsibility |
| --- | --- |
| [`src/types.ts`](../src/types.ts) | Shared HTTP and SSE wire types. |
| [`src/config.ts`](../src/config.ts) | Environment parsing, defaults, provider selection, safety flags, and timing values. |
| [`src/sleeves.ts`](../src/sleeves.ts) | Coin list and wallet assignment for each sleeve. |
| [`src/market.ts`](../src/market.ts) | Hyperliquid account access, leverage, orders, fills, and dry-run behavior. |
| [`src/book.ts`](../src/book.ts) | L2 book normalization, depth metrics, and maker or taker price calculation. |
| [`src/feed.ts`](../src/feed.ts) | Hyperliquid HTTP snapshots, WebSocket subscriptions, trade tape, and timers. |
| [`src/trades.ts`](../src/trades.ts) | Trade and fill buffers, summaries, and simulated fill matching. |
| [`src/chart.ts`](../src/chart.ts) | Venue candles, one-second mids, fill markers, and chart history. |
| [`src/indicators.ts`](../src/indicators.ts) | Indicators and venue features passed to the model. They do not gate trades. |
| [`src/snapshot.ts`](../src/snapshot.ts) | History and tape clipping for API responses. |
| [`src/account.ts`](../src/account.ts) | Clearinghouse state conversion and realized PnL and fee accounting. |
| [`src/plan.ts`](../src/plan.ts) | Intent normalization, leverage rungs, and conversion to one order plan. |
| [`src/model.ts`](../src/model.ts) | `TradeState`, Jev questions and answer mapping, plus real and mock models. |
| [`src/decision-events.ts`](../src/decision-events.ts) | Typed decision, quote, fill, and markout events for the journal. |
| [`src/decision-store.ts`](../src/decision-store.ts) | Optional PostgreSQL decision journal, serialized writes, and owner-scoped cursor queries. |
| [`src/owner-token.ts`](../src/owner-token.ts) | Signed owner tokens used to restore durable visitor ownership. |
| [`src/trader.ts`](../src/trader.ts) | Per-tick decision loop, order queue, simulated positions, totals, and events. |
| [`src/server.ts`](../src/server.ts) | Bun HTTP server, snapshots, history, tape, and SSE broadcasts. |
| [`src/index.ts`](../src/index.ts) | Process composition, sleeve lifecycle wiring, and logging. |
| [`src/execution-runtime.ts`](../src/execution-runtime.ts) | Reusable executor assembly for the shared bot and isolated visitor Workers. |
| [`src/paper-sessions.ts`](../src/paper-sessions.ts) | In-memory visitor registry, capability routing, capacity, rate, body, stream, and idle limits. |
| [`src/paper-session-worker.ts`](../src/paper-session-worker.ts) | Keyless visitor runtime with explicitly injected environment before runtime imports. |
| [`src/paper-session-guard.ts`](../src/paper-session-guard.ts) | Paper-only, official-endpoint, credential-free visitor request restrictions. |

The Jev provider is behind the `Model` interface in [`src/model.ts`](../src/model.ts). See [Jev provider](jev-provider.md) for provider configuration.

## Per-tick flow

```mermaid
flowchart LR
  A[Hyperliquid book and tape] --> B[Immutable prompt snapshot]
  B --> C[Overlapping Model.decide calls]
  C --> D[Decision event with UUID]
  D --> E{Newest and run still live}
  E -->|Yes| F[Serialized quote work]
  E -->|No| G[Record stale result only]
  F --> H[Quote and correlated fills]
  D --> I[Parent journal queue]
  H --> I
  A --> J[Markouts at later ticks]
  J --> I
  I --> K[PostgreSQL]
  D --> L[SSE server]
  H --> L
  L --> M[Next dashboard]
```

`Trader.onBlock()` reads the latest book, harvests fills, and creates one immutable prompt snapshot per scheduled tick. Model calls may overlap. Each successful result receives a UUID and is recorded, including stale results. Only the newest result from a live run may queue exchange work.

Exchange work and PostgreSQL writes use separate serialized queues, so neither venue latency nor journal I/O blocks the next model call. Quote and individual fill events retain the decision UUID; stable fill IDs make WebSocket, HTTP reconciliation, and retry delivery idempotent. Later observations add market return and returns signed to Jev's long or short bias at 1, 5, 20, and 100 ticks. Visitor Workers send journal events to the parent Bun process, which owns the PostgreSQL connection and write queue. Stop, rebuild, and shutdown drain model and exchange work, reconcile final Hyperliquid user fills, clean up owned orders, and wait for Worker journal acknowledgement or termination before closing that queue. See the full [Jev model contract](jev-model.md).

## Runtime cadences

| Setting | Default | Work performed |
| --- | ---: | --- |
| `TICK_MS` | 30000 ms | Advances the local tick, summarizes book and tape state, asks the model, emits a block event, and queues the resulting order action. |
| `PRICE_MS` | 1000 ms | Emits a price event when the mid changes and adds live mids to chart data. It does not make a Hyperliquid request, ask the model, or place an order. |
| `HL_FALLBACK_POLL_MS` | 30000 ms | While the WebSocket is disconnected, refreshes the book, recent trades, and asset context over HTTP. It performs no recurring HTTP work while the socket is healthy. |

Book WebSocket messages may trigger either local cadence when its interval has elapsed. A timer also checks the decision cadence, so a quiet book can still produce ticks. Hyperliquid book, trade, candle, and asset-context subscriptions are the primary market-data path. HTTP supplies startup snapshots and disconnected-socket recovery.

## State and persistence

Execution state stays in process memory: `Trader.history`, recent mids, pending orders, simulated positions, totals, feed trade buffers, chart points, connected SSE clients, and the snapshot cache. History is capped by `historySize`, currently 1,000 block events per sleeve. Feed and chart buffers have their own caps. A restart discards this execution state.

The visitor registry and every visitor runtime also live in process memory. Each visitor owns a separate Worker, execution runtime, market connections, settings, run lifecycle, and buffers. The default registry holds at most 8 sessions and expires a session after 10 minutes without a request. The bot service must stay at one replica because capabilities and Workers are not shared across processes.

When `DATABASE_URL` is configured, PostgreSQL keeps successful decision history separately from transient execution state. Records include the exact revisioned prompt snapshot, normalized decision, correlated quote and fills, and later markouts. The active session capability authorizes visitor reads. A separate signed HttpOnly owner cookie can restore the same database owner after reconnect or restart. Query routes do not accept it directly; session creation exchanges it for a new short-lived capability.

A bot restart still loses active visitor capabilities, Workers, runs, settings, and in-memory history. Visitors must Reconnect to create a new Off Worker. With durable storage enabled, the new capability can be associated with the restored owner, so prior decision history remains queryable. The shared executor reloads venue candles, user fills, and clearinghouse state. For live sleeves it fetches existing open orders for the coin and cancels only its own orders. The optional `.wallets.json` file is configuration, not trading-state persistence.
