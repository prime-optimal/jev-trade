# Jev Help and editable experiments

Parent #89; Help #90; customization #91; presets #92.

## Decisions

- Add top-level `/help` via `web/src/site.config.json`. Keep `/model` focused on decision inspection, with links to Help and a separate `/model/configure` editor.
- Document all 17 `FEATURE_CATALOG` inputs and nested fields, their source, calculation, units, windows, null/zero/fallback rules and freshness limits. Reuse and verify `docs/jev-model.md` against builders rather than inventing financial interpretations.
- Reuse `ProgramDefinition`, `activateProgram`, canonical revision and snapshot-before-await semantics. Preserve code-owned required answer labels, resolver versions and projection. Allow supplemental guidance for required questions and editable observational questions; catalog selection changes actual payloads.
- Use owner-capability-authenticated session program GET/POST through the existing Next gateway and loopback runtime. Program changes are stopped-only and public paper-only. Each worker retains its own active definition; history remains immutable and owner-scoped.
- Presets are server-provided validated complete definitions, not copied browser constants. Load into an editable draft; only Apply changes the active program. Show modified state and reset to defaults. Do not add arbitrary data-source code or claim profitability.

## Execution

1. Inspect branch/worktrees, navigation, `src/jev-program.ts`, `src/jev-features.ts`, model/runtime/session integration and existing docs/tests. Preserve unrelated `fnox.toml` edits using sibling worktree `jev-trade-wt-89` based on main.
2. Implement Help route/style and source-backed reference, navigation and contextual Model links. Follow DESIGN.md existing tokens; no new colors required.
3. Implement backend program activation, validation, paper session/gateway API, required-question guidance, existing real/mock evaluator activation, and configuration/preset API. Run LSP references before changing exported symbols. Add behavioral tests in test/ for invalid configs, request capture/revision and owner isolation, without weakening existing tests.
4. Implement `/model/configure` UI using GET/POST program contract; question/observational editing, catalog selection, validation, draft/apply/reset/preset state, stopped-only behavior and API errors.
5. Update docs/jev-model.md, docs/model-page.md, docs/dashboard.md, docs/api.md and CHANGELOG.md according to actual implementation.
6. Run focused tests, `just check`, `just build-web`, `bunx @google/design.md lint DESIGN.md` and design diff against 9bb9485. Existing tests/fixtures are not to be weakened or modified merely to pass checks.
7. Safe paper/mock smoke: documented `just smoke-model` / `just smoke-bot`, alternate ports if occupied, Next with explicit BOT_API_URL. Browser exercise Help lookup and anchors, editing and presets, apply/reset, actual captured questions/features/revision, two-session isolation, keyboard and dark/light/narrow layouts. Inspect screenshots, scroll panes and overflow; refresh affected assets.

## Risks and verification

- Required schemas remain code-owned; custom guidance must appear in resolved provider instructions and hash, not redefine valid answers.
- Empty/unknown/duplicate feature selections and malformed/oversized questions must be rejected without changing active configuration.
- Applying a program must reach every subsequent sleeve evaluation, including mock smoke; in-flight captures and old journal rows remain unchanged.
- Authentication, worker isolation and stopped-only update rules must be exercised. No operator production settings or live trading deployment will be changed.
- Help must not assert freshness or external units beyond code evidence. Include forming candles, warm-up zero returns, synthetic book levels, tape truncation, max-leverage fallback and trailing-vs-forward distinctions.
- Browser checks must inspect visible controls, console/hydration, narrow overflow and both themes. Tests/build alone do not prove the UI works.
