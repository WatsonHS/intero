---
title: "R1/R2 coordination-kernel release gate — 2026-08-01"
type: validation
status: external-provider-canary-required
date: 2026-08-01
roadmap: docs/PRODUCT_ROADMAP.md
plan: docs/plans/2026-07-31-001-r1-r2-coordination-kernel-implementation-plan.md
---

# R1/R2 coordination-kernel release gate — 2026-08-01

## Decision

The R1/R2 coordination kernel is implemented and passes deterministic
end-to-end browser acceptance plus production-like migration, scale, and
failure-recovery validation.

Do not mark the roadmap stages exited yet. The remaining release gate is one
separately recorded canary against a real external Provider through the
durable Worker path.

## Browser acceptance

Command:

```bash
pnpm test:e2e:r1-r2
```

Result: 1 test passed in 45.9 seconds.

The test creates a clean Project and Room, two authenticated people, and two
actual Agent connections. It reports Claims through the MCP CLI and proves:

- a compatible producer/consumer pair creates zero Coordination Threads,
  zero Action Inbox items, zero contextual relevance prompts, and zero source
  Room summaries;
- a breaking producer update creates one multi-source conflict, one canonical
  child Thread, and one structured source-Room summary;
- contextual relevance can be dismissed and revisited without creating work;
- no Action Inbox item exists until an explicit conclusion is proposed;
- only the responsible participant confirms the conclusion;
- confirmation resolves the specialized branch and removes the active Inbox
  item;
- the source Room sequence does not advance during proposal or resolution;
- the original summary message keeps its identity and gains revisions instead
  of being duplicated.

Reviewed captures:

- `output/playwright/r1-r2-coordination/01-compatible-control-quiet.png`
- `output/playwright/r1-r2-coordination/02-conflict-contextual-relevance.png`
- `output/playwright/r1-r2-coordination/03-human-confirmed-closure.png`
- `output/playwright/r1-r2-coordination/04-room-summary-revised-in-place.png`

## Production-like release validation

Command:

```bash
pnpm test:r0:production-like
```

Run ID: `intero-r0-20260731t210720z-67540`.

The gate built fresh immutable production images from the combined R0/R1/R2
branch, migrated a fresh PostgreSQL database through migration `0037`, and
started two API replicas plus two Worker replicas with PostgreSQL, SpiceDB,
MinIO, and Centrifugo.

Results:

- HTTPS health, Web readiness, and private API readiness passed;
- 10,000 realtime clients connected in 71,300 ms;
- 9,999 of 10,000 clients received the test event (99.99%);
- delivery latency was p95 170 ms, p99 175 ms, maximum 5,000 ms;
- 1,000 publications completed in 29 ms (34,190 per second);
- API replica failover passed;
- Worker replica failover passed;
- Centrifugo restart and client recovery passed;
- PostgreSQL restart and API/Worker recovery passed.

## Repository quality gate

The final combined branch also passed:

- `pnpm generate`, with the generated OpenAPI contract committed;
- `pnpm lint`;
- `pnpm format:check`;
- `pnpm test`: 94 files and 433 tests passed with no skips when PostgreSQL,
  Graphile Worker, SpiceDB, MinIO, and Centrifugo were enabled;
- `pnpm build` across all 14 packages;
- `pnpm bundle:report` within the existing Web bundle budgets;
- `pnpm audit --prod` with no known vulnerabilities;
- `bash -n scripts/dev-demo.sh` and `docker compose config --quiet`.

## Development-stack correction

The first browser run found that `scripts/dev-demo.sh` seeded the deterministic
Provider configuration but did not start the Provider process. Durable jobs
therefore failed with `MODEL_GATEWAY_UNAVAILABLE`.

The script now starts the configured Provider before the API/Web stack, waits
for its readiness endpoint, and cleans up every process on exit. Startup and
interrupt cleanup were verified; ports 4310, 4312, and 5173 were free after
shutdown.

## External Provider boundary

The existing real-provider browser canary sets
`INTERO_REAL_PROVIDER_CANARY=1` and explicitly rejects
`intero-demo-deterministic`. It therefore cannot silently pass on the local
deterministic Provider.

The following read-only checks found no usable external Provider:

- the restored pre-reset database snapshot contains zero
  `pilot_provider_configs` rows;
- no supported OpenAI, Anthropic, Google, Vercel AI Gateway, or Intero real
  Provider credential is present in the environment;
- no configured local OpenAI-compatible service is available.

Required final evidence:

1. configure a real external Provider without committing credentials;
2. run the existing real-provider canary through the durable Worker;
3. record the Provider identity, run time, success/failure result, and artifact
   references without recording prompts, model responses, logs, or secrets;
4. only then update the roadmap stage status to exited.
