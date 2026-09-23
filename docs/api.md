# Bot HTTP and SSE API

[`src/server.ts`](../src/server.ts) starts a Bun HTTP server on `PORT`, default 3000. All routes allow any origin and request headers. `OPTIONS` returns an empty CORS response. Unknown paths return `404` with `{"error":"not found"}`.

## HTTP routes

| Route | Response |
| --- | --- |
| `GET /` | Process [`Meta`](../src/types.ts) plus `latestByCoin`, a map of coin to the latest `BlockEvent` or `null`. |
| `GET /snapshot` | `Meta` plus clipped `historyByCoin` and `tapeByCoin` maps. This is the dashboard's first-paint payload. |
| `GET /history` | A map of coin to the full in-memory `BlockEvent[]`, up to 1,000 events per sleeve. |
| `GET /tape` | A map of coin to clipped `PricePoint[]`. |
| `GET /events` | SSE stream. Sends a `snapshot` immediately, then live events. |
| `GET /events?lite=1` | SSE stream. Sends `ready` instead of the initial snapshot, then live events. |

`/snapshot`, `/history`, and `/tape` use gzip when `Accept-Encoding` contains `gzip`, and then also set `Vary: Accept-Encoding`. Both the gzip and plain responses set `Cache-Control: no-store`. The root JSON response is not gzip-compressed. SSE uses `text/event-stream`, `Cache-Control: no-cache`, and a keep-alive connection.

The server serializes each SSE message as an `event` line followed by one JSON `data` line.

Status transitions use the `sleeve` event with `{ type: "sleeve", sleeve: SleeveMeta }`. The dashboard receives starting, retrying, and live transitions without reloading.

## Common payloads

The canonical interfaces are in [`src/types.ts`](../src/types.ts).

### `Meta`

```ts
{
  model: string;
  wallet: string | null;
  dryRun: boolean;
  market: string;
  startedAt: number;
  venue: string;
  coin: string;
  pair: string;
  explorerTx: string;
  tickMs: number;
  sleeves: Array<{
    coin: string;
    pair: string;
    label: string;
    wallet: string | null;
    status: "starting" | "live" | "retrying";
    error: string | null;
    retryAt: number | null;
  }>;
}
```

Every configured sleeve is present in `sleeves`, including one that could not initialize. A retrying sleeve includes a public error summary and the Unix millisecond time of its next initialization attempt.

### `BlockEvent`

```ts
{
  coin: string;
  block: number;
  ts: number;
  mid: number;
  bestBid: number;
  bestAsk: number;
  spreadBps: number;
  decision: Decision | null;
  quote: Quote | null;
  fill: Fill | null;
  resting: { bidSz: number; askSz: number };
  position: Position;
  totals: Totals;
  accountValue?: number | null;
  withdrawable?: number | null;
}
```

`Decision` contains `action`, optional `intent`, `bias`, and `leverage`, buy, sell, hold, and optional bias and intent probabilities, `upIn10`, `latencyMs`, and `late`. `Position` contains side, size, entry price, leverage, and unrealized PnL in USD and base size. `Totals` contains block, decision, quote, fill, revert, and late counts, Jev cost, fees, and realized and total PnL.

### `Quote`

```ts
{
  side: "buy" | "sell";
  price: number;
  size: number;
  txHash: string | null;
  cancel: number[];
  status: "placed" | "reverted" | "sim";
  orderId: number | null;
  capped: boolean;
  reduceOnly?: boolean;
  unchanged?: boolean;
  taker?: boolean;
}
```

### `Fill`

```ts
{
  side: "buy" | "sell";
  size: number;
  price: number;
  txHash: string | null;
  orderId: number;
  simulated: boolean;
  feeUsd?: number;
  closedPnl?: number;
  dir?: "open" | "close" | "flip";
}
```

### `PricePoint`

```ts
{
  ts: number;
  mid: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  bar?: "1s" | "1m" | "15m";
  block?: number;
  fill?: {
    side: "buy" | "sell";
    price: number;
    size: number;
    dir?: "open" | "close" | "flip";
    hash?: string;
    closedPnl?: number;
    feeUsd?: number;
  };
}
```

## SSE events

| Event | JSON payload |
| --- | --- |
| `snapshot` | `Meta` plus `historyByCoin: Record<string, BlockEvent[]>` and `tapeByCoin: Record<string, PricePoint[]>`. Sent only on a non-lite connection. |
| `ready` | `startedAt` as a number. Sent only when `lite=1`. |
| `ping` | Current Unix time in milliseconds. Sent every 15 seconds. |
| `block` | One `BlockEvent`. It is emitted after the decision and before asynchronous order placement completes. |
| `quote` | `{ coin: string, block: number, quote: Quote }`. This updates the earlier block event. |
| `fill` | `{ coin: string, block: number, fill: Fill, ts?: number }`. Venue fill broadcasts use block `0` and include the venue timestamp. |
| `price` | `{ coin: string, ts: number, mid: number, bestBid: number, bestAsk: number, spreadBps: number }`. |

## Snapshot cache and clipping

The serialized snapshot and its SSE encoding are cached for 400 ms. Requests inside that window receive the same snapshot body.

[`src/snapshot.ts`](../src/snapshot.ts) applies these limits:

| Payload | Limit |
| --- | ---: |
| Snapshot block history | Latest 12 events per sleeve |
| Snapshot one-second points | Latest 900 |
| Snapshot one-minute points | Latest 400 |
| Snapshot fills | Latest 12 |
| `/tape` one-second points | Latest 900 |
| `/tape` one-minute points | Latest 5,000 |

`/tape` retains all available 15-minute candles and fills. Snapshot tape omits 15-minute candles. The chart store itself caps source history, so "all available" still means the current process memory.
