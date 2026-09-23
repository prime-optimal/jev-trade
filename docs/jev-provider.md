# Jev provider

`MODEL=jev` selects the real [`JevModel`](../src/model.ts). Bun resolves provider credentials and serves address-free inference through `POST /decide`. Provider choice, model defaults, and startup credential checks live in [`src/config.ts`](../src/config.ts).

## Provider selection

An explicit valid `JEV_PROVIDER` always wins. When it is unset, selection follows this order:

1. `openrouter` when `OPENROUTER_API_KEY` is nonempty.
2. `typesafe` when `TYPESAFE_API_KEY` is nonempty.
3. `gateway` when `AI_GATEWAY_API_KEY` is nonempty.
4. `openrouter` when no provider key is present. Its credential check then stops startup.

Any other explicit value throws `JEV_PROVIDER must be openrouter, typesafe, or gateway`.

| Provider | Default model ID | Required credential | Missing credential error |
| --- | --- | --- | --- |
| `openrouter` | `jev-latest` | `OPENROUTER_API_KEY` | `MODEL=jev with JEV_PROVIDER=openrouter needs OPENROUTER_API_KEY. Get a key at https://openrouter.ai/settings/keys.` |
| `typesafe` | `jev-latest` | `TYPESAFE_API_KEY` | `MODEL=jev with JEV_PROVIDER=typesafe needs TYPESAFE_API_KEY. Get a key at https://docs.typesafe.ai/ or set JEV_PROVIDER=gateway with AI_GATEWAY_API_KEY.` |
| `gateway` | `typesafe-ai/jev` | `AI_GATEWAY_API_KEY` | `MODEL=jev with JEV_PROVIDER=gateway needs AI_GATEWAY_API_KEY. Or set JEV_PROVIDER=openrouter with OPENROUTER_API_KEY.` |

`JEV_MODEL_ID` overrides the provider default. For example, pin OpenRouter instead of following its latest alias:

```dotenv
JEV_PROVIDER=openrouter
JEV_MODEL_ID=typesafe/jev-1.13
```

The resolution and credential contracts are covered by [`test/jev-provider.test.ts`](../test/jev-provider.test.ts).

## OpenRouter System One

OpenRouter serves Jev through `POST https://openrouter.ai/api/v1/systemone`. This is the System One API, not the chat completions API. [`src/model.ts`](../src/model.ts) creates a `TypeSafeClient` with `baseURL: "https://openrouter.ai/api"`; the SDK appends `/v1/systemone`.

The inference service sends the model id `jev-latest` by default ([`resolveJevModelId()`](../src/config.ts)); OpenRouter resolves it server side. Set `JEV_MODEL_ID` to pin a version such as `typesafe/jev-1.13`.

## Request and response contract

The browser sends `network` and `state` to `POST /decide` using the exact address-free [`JevRequest`](../src/types.ts) contract. [`src/jev-request.ts`](../src/jev-request.ts) validates the request. [`callJev()`](../src/model.ts) then sends two top-level inputs to the provider:

- `state`: the market-facing subset of `TradeState`, including book, tape, position, indicators, and venue context. Identity and lifetime PnL are excluded.
- `questions`: independent choice questions for bias, intent, and leverage.

OpenRouter and TypeSafe use `TypeSafeClient.systemOne()`. Gateway uses AI SDK `experimental_evaluate()`. Both paths return answer choices and probability distributions. The adapter also reads input usage as `usage.input_tokens` from the TypeSafe SDK or `usage.inputTokens` from AI SDK, then returns the normalized decision and `inputTokens`.

`POST /decide` returns `{ "tick": ..., "decision": ... }`. The decision includes normalized choices, probability distributions, latency, and input token usage. The endpoint only returns inference results.

## Deadlines and errors

`INFERENCE_DEADLINE_MS` sets the HTTP response deadline, defaulting to 4,000 ms. A deadline returns HTTP 504 with `deadline_exceeded`; it does not release the provider concurrency permit until the underlying call settles. SDK retries are disabled with `maxRetries: 0`, including both the client and call settings for OpenRouter and TypeSafe. The AI SDK gateway call also sets `maxRetries: 0`.

Provider failures return HTTP 502 with `provider_error`. Rate limiting returns HTTP 429 with `rate_limited`, and exhausted concurrency returns HTTP 503 with `busy`. These are errors, not Jev hold decisions.

## Local setup and verification

Keep provider credentials in fnox as 1Password references. The checked-in [`fnox.toml`](../fnox.toml) resolves `OPENROUTER_API_KEY`; select another provider only after configuring its required credential.

For an explicit OpenRouter setup, put non-secret configuration in `.env`:

```dotenv
MODEL=jev
JEV_PROVIDER=openrouter
JEV_MODEL_ID=jev-latest
WEB_ORIGINS=http://localhost:3001
```

Start the inference service with provider credentials injected by fnox:

```sh
just dev
```

In another terminal, check service health:

```sh
curl http://localhost:3000/health
```

The expected response is `{"ok":true}`. This checks HTTP availability, not provider access.

To check provider access, save this synthetic request as `jev-request.json`:

```json
{
  "network": "testnet",
  "state": {
    "coin": "BTC",
    "market": "BTC-USD",
    "tick": 1,
    "tickMs": 5000,
    "mid": 100000,
    "spreadBps": 1,
    "bookImbalance": 0,
    "depth": {},
    "book": { "bids": [], "asks": [] },
    "returnsBps": { "last1": 0, "last5": 0, "last20": 0, "last100": 0 },
    "recentMids": "",
    "trades": {
      "count": 0, "buySz": 0, "sellSz": 0, "cvdSz": 0,
      "vwap": null, "lastPrice": null, "lastSide": null
    },
    "recentTrades": [],
    "position": {
      "coin": "BTC", "side": "flat", "size": 0, "notionalUsd": 0,
      "entry": null, "leverage": null, "liquidationPx": null,
      "distanceBps": null, "unrealizedUsd": 0
    },
    "indicators": {
      "sma20": null, "sma50": null, "ema20": null,
      "midVsSma20Bps": null, "midVsSma50Bps": null, "rsi14": null,
      "vol20Bps": null, "high20": null, "low20": null, "rangePos20": null
    },
    "asset": {
      "markPx": null, "oraclePx": null, "fundingBps": null,
      "premiumBps": null, "openInterest": null, "dayNtlVlmUsd": null,
      "dayChangeBps": null, "maxLeverage": 40
    },
    "maxLeverage": 40
  }
}
```

Submit it to `/decide`:

```sh
curl --fail-with-body http://localhost:3000/decide \
  -H 'Origin: http://localhost:3001' \
  -H 'Content-Type: application/json' \
  --data-binary @jev-request.json
```

A successful response echoes tick `1` and includes a Jev decision. This makes a real provider call with synthetic input and may incur usage charges. The request must match `JevRequest`; do not send provider-native requests or caller-supplied questions.

`/decide` requires an approved `Origin` and JSON content type. Do not send cookies or authorization headers. Provider credentials stay in Bun and are never included in browser requests.
