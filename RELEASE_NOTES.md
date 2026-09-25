# v0.5: A Live Desk for Jev’s Decisions

v0.5 expands Jev Trade from a live trading dashboard into an interactive paper-trading and decision-review product. Jev can now make richer position and order decisions, visitors can run isolated paper sessions, and optional durable history makes it possible to inspect the evidence behind evaluations and their outcomes.

## Added

- **Isolated visitor paper trading.** Remote visitors can save settings and start or stop their own keyless paper session. Each session has independent execution state and cannot control or alter the shared executor ([#8](https://github.com/prime-optimal/jev-trade/issues/8), [#10](https://github.com/prime-optimal/jev-trade/issues/10), [#13](https://github.com/prime-optimal/jev-trade/pull/13) by @prime-optimal). A visitor session starts Off; reconnecting after expiry or a bot restart creates a fresh session rather than silently resuming execution.
- **Decision history and review.** When PostgreSQL is configured, Jev evaluations and their evidence, quotes, correlated fills, observations, and later markouts can be retained. The new `/model` page provides owner-scoped, paginated history with grouped evidence and separate execution and outcome details ([#26](https://github.com/prime-optimal/jev-trade/pull/26), [4df6051](https://github.com/prime-optimal/jev-trade/commit/4df6051)). Existing legacy records remain readable and are labeled when program metadata is unavailable.
- **Versioned Jev question programs.** Programs are validated and immutable while an evaluation is in flight; revisions identify the captured questions and allowlisted market features used for that tick. Required questions drive the trade decision, while observational questions can be recorded without changing or delaying it ([#33](https://github.com/prime-optimal/jev-trade/pull/33)). Invalid required answers produce a safe hold; a failed required provider evaluation is recorded without fabricating a decision or placing an order.
- **A live product dashboard.** The main page now presents market book cards, wallet equity and PnL, candle charts, and a mobile-friendly layout ([2bba62f](https://github.com/prime-optimal/jev-trade/commit/2bba62f), [929a915](https://github.com/prime-optimal/jev-trade/commit/929a915)). Chart candles and fill marks use venue data.
- **More Jev provider choices.** OpenRouter is available alongside official TypeSafe and Vercel AI Gateway ([#1](https://github.com/prime-optimal/jev-trade/pull/1)).
- **Scoped settings and timed runs.** Added settings and run controls for the private operator and isolated visitor sessions ([#2](https://github.com/prime-optimal/jev-trade/pull/2)).

## Changed

- Jev's decisions now cover long/short bias, open/close/hold intent, and leverage, informed by the live position, PnL, indicators, and venue context ([ecf6170](https://github.com/prime-optimal/jev-trade/commit/ecf6170)). Entries use post-only orders; exits use reduce-only IOC orders across the touch. A hold sends no order and pulls a resting quote ([f6d67a8](https://github.com/prime-optimal/jev-trade/commit/f6d67a8)).

## Fixed

- Invalid sides no longer default to long, skipped ticks are visible, and provider or sleeve failures retry ([d79acc8](https://github.com/prime-optimal/jev-trade/commit/d79acc8), [#1](https://github.com/prime-optimal/jev-trade/pull/1)).
- Jev continues evaluating while exchange orders settle, and Hyperliquid request pressure is reduced ([b533e9b](https://github.com/prime-optimal/jev-trade/commit/b533e9b), [#1](https://github.com/prime-optimal/jev-trade/pull/1)).
- Fixed a PostgreSQL markout write that could stall queued decision-history writes ([1cb9b96](https://github.com/prime-optimal/jev-trade/commit/1cb9b96)).

**Full Changelog**: https://github.com/prime-optimal/jev-trade/compare/7d06eca8f54d75c3a9cc5eea551d6250967dcadc...HEAD