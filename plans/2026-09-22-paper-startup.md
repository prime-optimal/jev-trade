# Paper startup deployment

Approved: start one timed paper run on bot startup and deploy only the bot.

1. Commit scoped startup implementation, regression tests, and behavior documentation. Keep real-mode confirmation and public read-only controls.
2. Deploy a clean archive of the commit to the existing Railway bot service. Exclude untracked local files, especially env.bak. Preserve one replica, volume, paper mode, and testnet.
3. Verify the exact deployment reaches SUCCESS, the public run state is running, and Jev decisions appear.

Local verification: 131 tests pass; bot and dashboard TypeScript checks pass; startup recovery/stop smoke passes.

Issue workflow blocked: prime-optimal/jev-trade has issues disabled. Do not change repository settings to enable them.
