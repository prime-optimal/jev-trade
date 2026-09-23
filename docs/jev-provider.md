# Jev provider

`MODEL=jev` selects the real [`JevModel`](../src/model.ts). Provider choice, model defaults, and startup credential checks live in [`src/config.ts`](../src/config.ts).

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

The bot sends the model id `jev-latest` by default ([`resolveJevModelId()`](../src/config.ts)); OpenRouter resolves it server side. Set `JEV_MODEL_ID` to pin a version such as `typesafe/jev-1.13`. A live call on 2026-09-22 returned model `typesafe/jev-1.13-20260917`, provider `TypeSafe`, choice answers with probabilities and confidence, and usage fields `input_tokens`, `output_tokens`, and `cost` in about 270 to 390 ms.

## Request and response contract

[`callJev()`](../src/model.ts) sends one immutable prompt snapshot with revision `jev-trade-2026-09-23.1`, the market-facing state, and independent choice questions for bias, intent, and leverage. The journal stores that exact snapshot with every successful decision. The full input and question contract is in [Jev model contract](jev-model.md).

OpenRouter and TypeSafe use `TypeSafeClient.systemOne()`. Gateway uses AI SDK `experimental_evaluate()`. Both paths return answer choices and probability distributions. The adapter also reads input usage as `usage.input_tokens` from the TypeSafe SDK or `usage.inputTokens` from AI SDK, then returns the normalized decision and `inputTokens`.

Every provider call has a 4,000 ms deadline. SDK request retries are disabled with `maxRetries: 0`, including both the client and call settings for OpenRouter and TypeSafe. The AI SDK gateway call also sets `maxRetries: 0`.

## Errors, overlap, and stale results

[`Trader.onBlock()`](../src/trader.ts) starts one Jev evaluation on every scheduled tick while the sleeve is Running, even when an earlier evaluation is pending. Successful decisions receive UUIDs that carry through quotes, fills, and 1, 5, 20, and 100 tick markouts.

Only the newest result from a still-live run may submit exchange work. A response that arrives after a newer tick or after Stop or expiry remains a recorded Jev evaluation, but it is stale and cannot trade. The bot never rewrites a stale response as hold.

A model timeout or other provider error logs and records the failure. It does not fabricate a decision or enqueue order work. The next tick calls Jev again, including after HTTP 402, `no available TypeSafe API credits`, or `insufficient credits`, which `jevUnavailable()` labels in the log.

A successful Jev `hold` is different: it increments the decision count, has `late: false`, and cancels the standing quote. See [Trading behavior](trading.md) for order semantics.

## Cost accounting

On each successful decision, [`src/trader.ts`](../src/trader.ts) adds:

```text
inputTokens / 1,000,000 * jevUsdPerMTok
```

`jevUsdPerMTok` is `0.042` in [`src/config.ts`](../src/config.ts), matching OpenRouter's price of $0.042 per one million input tokens. The accumulated amount is exposed as `totals.jevUsd`. Output tokens and provider-reported total cost are not used by this calculation.

## Local verification

Set the safe local path in `.env`:

```dotenv
MODEL=jev
DRY_RUN=true
```

Ensure fnox can resolve the selected provider key, then run:

```sh
just dev
```

Watch the bot logs for non-late decision lines, or inspect `http://localhost:3000/snapshot`. A successful event has `decision.late` set to `false`, Jev choices and probabilities, and increasing decision totals. `DRY_RUN=true` keeps order execution simulated while using real market data and real Jev calls.
