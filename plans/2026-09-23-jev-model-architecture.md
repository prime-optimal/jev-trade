# Jev model architecture and decision history

Parent issue: [#14](https://github.com/prime-optimal/jev-trade/issues/14)

## Decisions

- Use Railway PostgreSQL through the private `DATABASE_URL`. SQLite would put every visitor Worker against one mounted file and would not give the reviewer service the same query and indexing options.
- Keep one database writer in the parent Bun process. Visitor Workers send typed journal events to the parent instead of opening their own pools.
- Give every successful model decision a UUID. Carry it through its quote, fill, and measured markouts so review queries do not depend on tick numbers or order IDs.
- Store the exact state and questions sent to Jev with a named prompt revision.
- Use a server-issued, signed anonymous owner token for durable ownership. Query routes accept only an active capability. Session creation can exchange the signed owner token for a new short-lived capability tied to the same owner.
- Keep shared operator history under a separate owner and expose it only on the loopback operator listener.

## Work

1. Deepen the `Model` interface so one evaluation returns its normalized decision and exact prompt snapshot. Add decision IDs and outcome observations to the Trader journal seam. [#15](https://github.com/prime-optimal/jev-trade/issues/15)
2. Replace the collapsed Advanced section with settings tabs. Put cadence, lookback, the prompt, and the complete Jev input catalog on a Jev model tab. Give every setting explanatory text. [#16](https://github.com/prime-optimal/jev-trade/issues/16)
3. Add a queued PostgreSQL decision store, signed owner tokens, Worker-to-parent journal messages, capability-scoped visitor reads, loopback operator reads, and Railway IaC. [#17](https://github.com/prime-optimal/jev-trade/issues/17)
4. Update architecture, model, provider, dashboard, API, configuration, deployment, and changelog documentation.

## Verification

- Run focused Bun tests for model evaluation, decision correlation, session ownership, and decision query authorization.
- Run the existing full Bun suite, root typecheck, dashboard typecheck, and dashboard build.
- Open the actual settings page at desktop and phone widths and verify every tab and help label.
- Run `railway config plan` and review that it adds PostgreSQL plus the private bot variable without changing unrelated resources. Do not apply the plan without explicit approval.
