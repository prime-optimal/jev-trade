# Maintainer documentation

- [Architecture](architecture.md) explains the Bun and Next runtime split, startup flow, modules, and in-memory state.
- [Trading behavior](trading.md) documents sleeves, Jev decisions, order mechanics, leverage, and trading safety.
- [Jev model contract](jev-model.md) is the full prompt, input, exclusion, decision history, privacy, and refinement reference.
- [Bot HTTP and SSE API](api.md) defines routes, payloads, event types, retention, and compression.
- [Dashboard](dashboard.md) maps the Next app, feed lifecycle, shared types, and UI rules.
- [Configuration](configuration.md) lists environment variables, defaults, secrets, and wallet sources.
- [Jev provider](jev-provider.md) covers provider selection, request handling, late ticks, and cost accounting.
- [Development](development.md) covers setup, local recipes, verification, shared types, and repository rules.
- [Deployment](deployment.md) documents the Railway service graph, Railpack builds, variables, rollout safety, and first deployment.

## Keeping docs current

Every behavior, configuration, or deployment change must update the matching document and add an entry under `Unreleased` in [`CHANGELOG.md`](../CHANGELOG.md).
