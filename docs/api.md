# Jev inference API

Bun exposes one listener on `PORT`, default 3000. It returns Jev decisions, not market feeds, account state, orders, or trading sessions. The implementation is [`src/server.ts`](../src/server.ts).

| Route | Result |
| --- | --- |
| `GET /health` | `200` with `{ "ok": true }`. Process health, not proof of provider or wallet readiness. |
| `POST /decide` | One validated `JevRequest`, returning a `JevResponse`. |
| `OPTIONS /decide` | `204` for an allowed origin requesting POST with only Content-Type. |

All other paths return `404`, including `/`, `/snapshot`, `/events`, `/sessions`, and the former operator routes. There is no SSE, Next session gateway, or compatibility execution API. Unsupported methods on known paths return `405`.

## Contract

[`src/types.ts`](../src/types.ts) and [`web/src/lib/bot-types.ts`](../web/src/lib/bot-types.ts) are byte-identical inference contracts:

```ts
interface JevRequest {
  network: "testnet" | "mainnet";
  state: TradeState;
}

interface JevResponse {
  tick: number;
  decision: ModelDecision;
}
```

`TradeState` contains public market features and non-identifying position context. See the canonical type for the exact nested fields. `ModelDecision` includes action, intent, bias, leverage, probabilities, and inference metrics. The response echoes `state.tick`; the browser still checks its own run and tick before acting.

Wallet addresses, private keys, signatures, provider objects, account snapshots, order records, and session capabilities are not part of this contract. Do not add them to the payload. The browser uses [`requestJev`](../web/src/lib/jev.ts) to serialize an allowlisted request with `credentials: "omit"` and `referrerPolicy: "no-referrer"`. Non-identifying position fields are permitted; raw account transport objects are not.

## Validation and origins

POST requires `Content-Type: application/json` and an exact allowed `Origin`. `WEB_ORIGINS` is a comma-separated list of HTTP or HTTPS origins without paths or trailing slashes. Production has no implicit allowed origins. Development adds localhost, loopback, and detected IPv4 LAN dashboard origins on port 3001.

Requests carrying cookies or authorization headers are rejected. Origin checks are not wallet authentication and do not grant execution authority. The service validates the full request with [`src/jev-request.ts`](../src/jev-request.ts), rejecting extra fields, invalid numbers, invalid shapes, and oversized bodies. Responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; allowed origins receive an exact CORS origin, never a wildcard.

## Bounds and failures

Inference admission uses a per-socket-peer token bucket, default burst 20 and refill 300 requests per minute. Forwarded IP headers are not trusted, so a shared proxy can share one limit. A global concurrency limit defaults to 32. The HTTP deadline defaults to 4000 ms; a timed-out provider call retains its permit until it settles so late work cannot bypass the bound.

Failures return `{ "error": "code" }`, not a synthetic hold decision. Origin failures return `403`, invalid requests `400`, unsupported media `415`, rate limits `429`, busy admission `503`, provider failures `502`, and deadlines `504`. Request size and validation limits are defined in the validator. No error starts a run or submits an order. See [Configuration](configuration.md) for inference settings and [Trading behavior](trading.md) for browser guards.
