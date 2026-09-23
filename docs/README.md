# Maintainer documentation

- [Architecture](architecture.md) maps inference-only Bun, separate Next, and browser module ownership.
- [Trading behavior](trading.md) covers direct wallet execution, Jev decisions, finite runs, and exact-owned cleanup.
- [Jev inference API](api.md) defines `/health`, `/decide`, the address-free contract, origins, and request bounds.
- [Dashboard](dashboard.md) maps persistent browser state, public feeds, wallet controls, and UI rules.
- [Configuration](configuration.md) separates provider secrets and inference limits from browser trading preferences.
- [Jev provider](jev-provider.md) covers model selection and provider request handling.
- [Development](development.md) covers separate installs, local recipes, CI checks, and inference type copies.
- [Deployment](deployment.md) documents main-merge deploys, optional manual uploads, Railway declarations, and the no-apply boundary.

The browser wallet flow supports real trading, but documentation is not evidence of a completed approval or live order. Record explicit wallet verification before making that claim.

## Keeping docs current

Every behavior, configuration, or deployment change must update the matching document and add an entry under `Unreleased` in [`CHANGELOG.md`](../CHANGELOG.md). Historical server-owned changelog entries are not current operating instructions.
