# Bot HTTP and SSE API

The implementation runs two Bun listeners. The public listener on `PORT`, default 3000, is read-only and allows browser origins. The private operator listener binds `127.0.0.1` on `CONTROL_PORT`, default 3002. Never expose or reverse proxy the operator listener as a public control API.

## Public routes

| Route | Response |
| --- | --- |
| `GET /` | Public process metadata plus the latest event by coin. Operator model configuration is omitted. |
| `GET /snapshot` | Public metadata plus clipped history and tape by coin. |
| `GET /history` | Full in-memory block history by coin, up to 1,000 events per sleeve. |
| `GET /tape` | Clipped price history by coin. |
| `GET /run` | Current authoritative `RunSnapshot`. |
| `GET /events` | SSE snapshot followed by live events. |
| `GET /events?lite=1` | SSE `ready` event followed by live events. |

`/snapshot`, `/history`, and `/tape` support gzip and set `Cache-Control: no-store`. SSE sends `text/event-stream`, `Cache-Control: no-cache`, and a keep-alive connection.

The public API has no settings, validation, Start, Stop, or reconcile mutation. Public CORS is for read-only dashboard data, not operator authorization.

## Visitor decision history

`GET /sessions/decisions?limit=&before=` returns durable decision history for the owner associated with the active visitor session. The opaque session capability is required and authorizes the read. The server resolves the owner from that capability and always applies the owner predicate. A signed owner cookie may restore ownership after reconnect or restart. Query routes do not accept that cookie directly; session creation must exchange it for a new short-lived capability.

The Next gateway exposes the same operation as same-origin `GET /api/session/decisions?limit=&before=`. Browser code never receives the capability. `limit` defaults to 50 and is capped at 200. `before` is the opaque cursor returned by the preceding page.

The dashboard `/model` Decisions view consumes this endpoint. No additional history routes exist.

Pages are newest first:

```ts
interface DecisionPage {
  rows: Array<{
    decisionId: string;
    createdAt: number;
    updatedAt: number;
    decision: unknown;
    recordType: ProgramRecordType | "legacy";
    evidence: EvaluationEvidence | null;
    observations: { readonly [groupId: string]: GroupResult };
    programMetadata: "available" | "unavailable";
    quote: unknown | null;
    fills: unknown[];
    markouts: Record<string, unknown>;
  }>;
  nextBefore: string | null;
}
```

Each row joins an evaluation to its quote, correlated fills, and available 1, 5, 20, and 100 tick markouts. A failed required-group evaluation has `decision: null`; it is recorded with evidence but does not produce a dashboard decision. New rows use `recordType: "jev-program-v1"` and include evidence and observational results.

Legacy rows retain their original `decision` JSON, including its old `prompt` and `promptRevision`. They use `recordType: "legacy"`, `programMetadata: "unavailable"`, `evidence: null`, and `observations: {}`. The server does not reconstruct program metadata or evidence for these rows.

## Run payload

```ts
interface RunSnapshot {
  runId: string | null;
  status: "off" | "starting" | "running" | "paused" | "stopping" | "expired" | "attention-required";
  startedAt: number | null;
  deadlineAt: number | null;
  stoppedAt: number | null;
  durationMs: number;
  stopReason: string | null;
  serverNow: number;
}
```

Timestamps are Unix milliseconds from the execution owner. `serverNow` lets the browser display time against the Bun clock. Clients must not treat a local display timer as the authority.

SSE also emits `run` with the same snapshot when lifecycle state changes. Other events are `snapshot`, `ready`, `ping`, `block`, `quote`, `fill`, `price`, and `sleeve`.

## Private operator listener

The listener accepts only loopback peers. Every request must have the exact `CONTROL_HOST`. Browser mutations must also have an Origin exactly equal to `CONTROL_ORIGIN`. The default pair is `127.0.0.1:3002` and `http://localhost:3001`.

Mutation bodies must be JSON objects with `Content-Type: application/json` and are limited to 64 KiB. Unknown fields are rejected. Responses use `Cache-Control: no-store`. Error messages redact the active transport key and credential-bearing URL details.

| Route | Body | Result |
| --- | --- | --- |
| `GET /operator` | None | Redacted operator snapshot with applied settings, environment baseline, override names, `redactedEndpoints`, configured or missing secret flags, last connection result, and run state. |
| `GET /decisions?limit=&before=` | None | Newest-first cursor page of durable decisions for the internal shared-executor owner. This route is loopback-only with the rest of the operator listener. |
| `POST /settings` | `{ settings, apiKey?, clearedEndpoints? }` | Validates and applies a complete snapshot while Off or Expired. Empty `apiKey` clears it. `clearedEndpoints` may contain `hyperliquidApiUrl`, `hyperliquidWsUrl`, or `rpcUrl` when that field is explicitly cleared. Rebuilds execution resources before commit. |
| `POST /validate` | `{ settings?, apiKey? }` | Validates the candidate or applied HTTP, WebSocket, and SDK RPC transports while stopped. Returns `200` when compatible and `422` for a completed incompatible check. |
| `POST /start` | `{ confirmReal? }` | Runs preflight and starts one authoritative run. Real mode requires `confirmReal: true`. Repeated Start while Starting or Running is idempotent. |
| `POST /stop` | `{}` | Cancels a pending Start or validation, invalidates execution, and waits for bounded owned-order cleanup. Repeated Stop is idempotent. |
| `POST /reconcile` | `{}` | Retries owned-order cleanup from `attention-required`. Other states return the current snapshot. |

Settings changes and validation are rejected while active. Start requires at least one asset. Start also requires successful HTTP metadata, market WebSocket, and SDK RPC preflight. Real Start accepts only a matching official endpoint set because custom endpoint identity cannot be established.

Operator snapshots never contain wallet keys, provider credentials, or the transport API key. They report only whether those secrets are configured. `redactedEndpoints` names URL fields hidden because they contain a query, embedded credential, or credential-like path. The corresponding value in `settings` is `null`. Sending that hidden field back as `null` retains its current runtime value unless the request also names it in `clearedEndpoints`. An explicitly cleared field must be `null`. The server never silently replaces a hidden custom URL with a network default.

## Connection validation payload

A validation response contains:

```ts
interface ConnectionValidation {
  ok: boolean;
  realAllowed: boolean;
  message: string;
  apiUrl: string;
  wsUrl: string;
  rpcUrl: string;
  checkedAt: number;
}
```

HTTP validation sends `{ type: "meta" }` to `/info`. WebSocket validation subscribes to `allMids`. RPC validation uses the Hyperliquid SDK explorer protocol with `{ type: "userDetails", user: "0x0000000000000000000000000000000000000000" }` and requires a `userDetails` response containing `txs`. The custom HTTP key is applied to info and exchange requests only. It is not attached to SDK RPC or WebSocket traffic.

## Public market payloads

The canonical public interfaces remain in [`src/types.ts`](../src/types.ts). `Meta` describes sleeves and process metadata. `BlockEvent` carries each decision and account snapshot. `Quote`, `Fill`, and `PricePoint` update order, fill, and chart state. A sleeve status is `starting`, `live`, or `retrying`.

The serialized snapshot and SSE encoding are cached for 400 ms. Snapshot block history keeps the latest 12 events per sleeve. Snapshot tape keeps 900 one-second points, 400 one-minute points, and 12 fills. `/tape` keeps 900 one-second points, 5,000 one-minute points, all available 15-minute candles, and all available fills within the process memory caps.
