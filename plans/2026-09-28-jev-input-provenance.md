# Jev input provenance and Model page docs

Parent issue: #79. Branch: `docs/79-jev-input-provenance`.

## Steps

1. #80: bot input provenance in `docs/jev-model.md`. For each of the 17 `FEATURE_IDS` in `src/jev-features.ts`, record the source file and symbol, the Hyperliquid info or WS call, cadence, freshness, and nullability.
2. #81: root-cause why `depth` renders unknown, why the venue, indicator, and position cards show "age unknown", and why position is usually flat. Fix real bugs test-first and document behavior that is by design.
3. #82: in `docs/dashboard.md`, document the Model page, the 17 inputs, the Performance tab calculations, Right and Wrong, and the outcome horizons compared with the Price pane.
4. #83: verify the web shows what the bot sent. Cross-check `GroupSnapshot.state` against `web/src/app/model/*` and browser-smoke `/model` using the real-data fixture.

## Gates

`just check`, `just build-web`, markdown lint, a reviewer pass that checks doc claims against code, a browser smoke of `/model`, and a CHANGELOG `Unreleased` entry.
