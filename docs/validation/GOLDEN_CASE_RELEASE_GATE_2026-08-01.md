---
title: "Intero Golden Case release gate — 2026-08-01"
type: validation
status: implemented-awaiting-external-canaries
date: 2026-08-01
roadmap: docs/PRODUCT_ROADMAP.md
plan: docs/plans/2026-08-01-001-golden-case-delivery-plan.md
golden_case: docs/GOLDEN_CASE.md
---

# Intero Golden Case release gate — 2026-08-01

## Decision

G0–G6 are implemented and pass the fixed Golden Case through the local product
surface. The repository gates, a clean PostgreSQL migration/RLS run, the local
durable Worker path, realtime fanout, the new Golden browser matrix, and the
pre-existing R1/R2 browser acceptance all pass. The configured-provider prose
path is implemented with persisted provenance and a real-environment canary,
but no configured external environment was available to execute that canary.

Do not mark G7 or the roadmap stages exited yet. This worktree has not run the
case against a real external Provider, a deployed durable Worker, or the target
environment's migration and rollback path. A deterministic local Provider is
not release evidence for those gates.

The original validation was run from `codex/r1-r2-closure`; the implementation
subsequently landed as `04d7b8a` and was merged to `main` in `ba6ae4c`.

## Closure refresh — 2026-08-03

The exact merged revision `ba6ae4c` passed the repository
[CI gate](https://github.com/WatsonHS/intero/actions/runs/30760528960). A fresh
audit then found and closed one G2 interaction gap: an ambiguous request could
resolve to Team scope from the original message, but the correction surface
only accepted Project selections. The API remains compatible with the original
`{ projectIds }` request and now also accepts `{ scopeKind: "team" }`. The
server derives that Team scope from the requester's and corrector's shared
authorized Team Projects; clients cannot submit a wider Team Project list.

The current delivery delta passed:

- OpenAPI generation, TypeScript, Prettier, shell syntax, and diff checks;
- 402/402 default TypeScript tests, with the same 63 environment-gated tests
  exercised separately;
- 64/64 clean disposable PostgreSQL, Better Auth, RLS, authorization, Worker,
  realtime, and object-storage integration tests;
- all 14 package builds and the existing Web bundle budget;
- Golden Case browser acceptance 5/5, including the Team-scope correction;
- the isolated real PostgreSQL/Graphile Worker R1/R2 compatibility browser
  path 1/1.

The first disposable integration attempt omitted the production-equivalent
default table grants for `intero_app`, so three Better Auth tests correctly
failed with database permission errors. The database was discarded, recreated
with the same default grants as the deployment bootstrap, and the complete
integration set then passed 64/64. No shared development database was migrated
or used as the test target.

G7 is still not complete. This host has no `.env.production`, deployed Intero
LaunchAgent, configured Provider, or isolated external canary credentials. The
repository now provides privacy-safe canary and target-readiness receipts, and
rollback requires the public health endpoint to recover before success is
recorded, but those checks still need to run on the real target.

## G0–G7 audit

| Gate | Status             | Current evidence                                                                                                                                                              |
| ---- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0   | complete locally   | Fixed clean-state Alex/Priya fixture; migration `0037` left immutable; forward-only `0038`; disposable database runs                                                          |
| G1   | complete locally   | Room-local Intero identity, exact mention dispatch, durable ID-only request/outbox, replay-safe single response, access tests                                                 |
| G2   | complete locally   | Single/cross-Project/Team/ambiguous resolver, explicit and participant Work State evidence, Project or Team correction in place, restricted-candidate isolation               |
| G3   | complete locally   | Authorized cross-Project matching; compatible/conflict/insufficient/stale/correction/withdrawal/replay branches; prompted/proactive dedupe; no eligible Team Room stays quiet |
| G4   | complete locally   | Layered brief, deterministic locale fallback, bounded provider prose, Alex/Priya first-layer browser assertions, dismiss/mute/revisit                                         |
| G5   | complete locally   | Responsible-human confirmation, wrong-principal rejection, one Decision, one summary/child closure, personal Stand-in and Coding Agent context backflow                       |
| G6   | complete locally   | Five-case Golden browser matrix with presence and absence assertions plus reviewed artifacts                                                                                  |
| G7   | blocked externally | Repository and local runtime gates pass; real Provider, deployed Worker, target migration/RLS/authorization/rollback, and target clean-to-confirmed canaries remain unproved  |

## Migration boundary

Migration `0037_r1_r2_coordination_kernel.sql` was already part of the shared
history and was left immutable. The Golden Case uses the forward-only migration
`0038_golden_case_coordination.sql` for Intero requests, Team/cross-Project
membership, provenance, structured briefs, backfill, and RLS.

The shared `intero` development database was inspected read-only and was not
migrated by this run. Migration and integration checks used disposable local
databases created specifically for this gate and removed afterward.

## Repository gates

Commands and results:

```bash
pnpm generate
pnpm lint
pnpm format:check
pnpm test:ts
pnpm build
pnpm bundle:report
```

- OpenAPI generation completed and refreshed the generated contract.
- TypeScript lint and Prettier checks passed.
- The default TypeScript run passed 396 tests in 80 files; 63
  environment-gated tests in 17 files were skipped in that command and were
  exercised separately where relevant below.
- All 14 packages built successfully.
- The Web bundle remained within the existing budget; the entry chunk was
  208 KiB and `CommunicationsView` remained a 168 KiB lazy chunk.

## Clean database, Worker, and realtime proof

Migration `0038` was applied to a fresh disposable PostgreSQL database. The
following integration groups then passed:

- PostgreSQL tenant isolation and RLS: 2/2;
- platform PostgreSQL store, including concurrent confirmation replay creating
  one Decision per source Thread: 9/9;
- normalized PilotStore, including durable ID-only Intero request/outbox and
  cross-Project membership: 8/8;
- durable Pilot jobs, including retry, crash-window recovery, serialization,
  and startup ordering: 4/4;
- public Stand-in PostgreSQL repository: 1/1;
- PostgreSQL outbox to live local Centrifugo: 3/3.

The database, RLS, normalized-store, and public-repository groups passed 20/20
against one newly migrated disposable database. The durable Worker group then
passed 4/4 against a second clean database with the same `CONNECT, CREATE`
worker permissions declared by the development compose profile. Both databases
were removed after the run.

The realtime cohort used 32 clients. All 32 received the publication; p95 and
p99 visibility were 2 ms. The local throughput check completed 25 publications
at 4,214 publications per second. These numbers are local integration evidence,
not hosted capacity claims.

## Browser acceptance

Golden Case command:

```bash
pnpm test:e2e:golden-case
```

Result: 5/5 passed on the final local rerun.

The browser matrix proves:

1. a compatible explicit question receives one Intero answer and opens no
   coordination;
2. ambiguous scope remains bounded, hides restricted candidates, and a human
   correction revises the same Room entry;
3. a prompted cross-Project conflict supports relevance, replay, one required
   human confirmation, one Decision, one closed child branch, one final shared
   result, both participants reading the compact Room entry, and
   dismiss/mute/revisit without project-state mutation;
4. an unprompted high-confidence conflict and a later prompt converge on the
   same case, discussion, and Room entry;
5. corrected current evidence clears the original case, child discussion, and
   Room entry in place without producing a false Decision.

Reviewed captures:

- `output/playwright/golden-case/01-compatible-control.png`
- `output/playwright/golden-case/02-scope-corrected-in-place.png`
- `output/playwright/golden-case/03-confirmed-shared-result.png`
- `output/playwright/golden-case/04-proactive-prompt-dedupe.png`
- `output/playwright/golden-case/05-corrected-evidence-closed-in-place.png`

The legacy R1/R2 product acceptance was also rerun against an isolated local
API, Web renderer, PostgreSQL database, and durable Worker:

```bash
INTERO_E2E_API_URL=http://127.0.0.1:4310 \
INTERO_E2E_RENDERER_URL=http://127.0.0.1:5173 \
pnpm test:e2e:r1-r2
```

Result: 1/1 passed on the final local rerun.

That compatibility run first exposed a duplicate: Team-level proactive
detection was considering a same-Project producer/consumer pair whenever the
Team happened to contain another unrelated Project. The implementation now
requires the two source Claims themselves to span at least two Projects and
stores only those source Project IDs. A regression assertion keeps an
unrelated Team Project from widening the coordination scope.

The Golden browser matrix is now an explicit GitHub CI step after the R1/R2
acceptance step.

## Configured-provider prose boundary

Intero now calls the administrator-configured model gateway only after
deterministic authorization, scope resolution, and conflict classification.
The provider receives the authorized Project names, scope evidence,
classification, boundary, reason, and bounded Claim facts. It does not receive
the raw Room message, Project UUIDs, Claim revisions, unrelated scoped Claims,
prompts, file contents, diffs, or tool logs.

The structured result is persisted with `brief.proseSource = "provider"`.
Provider timeout, invalid output, or unavailability falls back to a deterministic
localized brief with `brief.proseSource = "deterministic_fallback"`; the
coordination path remains usable. If a proactive fallback opened the case
first, a later explicit request can upgrade that same brief and Room entry in
place instead of creating a duplicate.

The adapter contract exercises this path through an OpenAI-compatible HTTP
provider. Focused scope, provider, fallback, upgrade, localization, and metrics
tests pass 23/23. The opt-in deployed canary is:

```bash
INTERO_REAL_PROVIDER_CANARY=1 \
pnpm test:e2e:collaboration --grep "Golden Case canary"
```

It creates two clean Projects in one Team, connects two real product-issued
cloud Agents, reports the conflicting Claims, mentions Room-local Intero,
waits for the durable Worker, and requires the persisted result to retain the
deterministic cross-Project scope while reaching `proseSource = "provider"` and
one Room summary. It then records a human Decision, verifies the same summary is
resolved, checks the product-installed Coding Agent current-context, asks an
authorized personal Stand-in about the confirmed result, and captures the final
browser artifact.

## Documented clean-to-confirmed run

The fixed fixture starts with `Intero Lab`, the Engineering Team,
`#engineering`, Alex, Priya, `Auth Platform`, `Mobile App`, and conflicting
`retryDelayMs` Claims. It seeds inputs only. The application creates the
Room-local Intero principal, durable request, authorized cross-Project scope,
one coordination case, one child discussion, one layered Room entry, the
confirmation action, and one Decision. Replay and proactive/prompt races retain
the same semantic artifacts. Corrected or withdrawn evidence can dismiss that
same path with a visible reason and no Decision. The final browser capture shows
the human-confirmed result without claiming either codebase changed.

The confirmed Decision is also reloaded into Coding Agent current-context and
personal Stand-in model context. The Stand-in path accepts only resolved
coordination with a durable Decision ID, and only when both the asker and the
represented person are authorized affected participants; proposals and
unconfirmed conclusions remain excluded. The installed direct-cloud MCP now
proxies `stand_in.current_context` through the authenticated server tool instead
of returning only static local connection metadata, so this Decision reaches
the actual Coding Agent installation path.

## Required external evidence

G7 remains open until all of the following are recorded without prompts,
responses, secrets, or raw logs:

The 2026-08-03 audit found the real-provider canary flag and target database,
worker, API, renderer, production environment, and Provider configuration
unavailable. No external canary, deployment, rollback, or target mutation was
attempted or claimed.

1. a configured real external Provider produces the bounded scope explanation
   and human-readable prose while deterministic evidence still controls the
   conflict identity;
2. a deployed durable Worker proves outbox retry and realtime in-place updates;
3. the target environment applies migration `0038` and passes RLS and
   authorization checks;
4. the target rollback procedure is exercised and the recovery result is
   recorded;
5. the target clean-to-confirmed Golden Case has artifact references and no
   privacy leak or semantic duplicate.

Run the external gates from an isolated target and a privacy-safe evidence
directory:

```bash
INTERO_G7_EVIDENCE_DIR=/absolute/path/to/evidence \
INTERO_E2E_API_URL=https://api.example.com \
INTERO_E2E_RENDERER_URL=https://app.example.com \
INTERO_E2E_PASSWORD='<isolated canary credential>' \
INTERO_G7_TARGET_ID=intero-staging \
INTERO_G7_EXPECTED_RELEASE_SHA='<deployed Git SHA>' \
pnpm test:g7:golden-case

INTERO_G7_EVIDENCE_DIR=/absolute/path/to/evidence \
INTERO_PRODUCTION_ENV_FILE=/absolute/path/to/.env.production \
INTERO_G7_TARGET_ID=intero-staging \
INTERO_G7_EXPECTED_RELEASE_SHA='<deployed application Git SHA>' \
INTERO_G7_EXPECTED_SCHEMA_SHA='<deployed schema Git SHA>' \
pnpm test:g7:target-readiness
```

`INTERO_G7_EXPECTED_SCHEMA_SHA` defaults to the expected application SHA; set
it separately after a forward-only schema migration followed by an application
rollback. The first command writes an opaque-ID runtime manifest plus
`golden-case-release-canary.json`; the second writes `target-readiness.json`.
The receipts bind the same target and expected release identities and contain
origins, timing, assertion names, hashes, and pass/fail state only. They do not
contain Provider keys, passwords, prompts, responses, file contents, or raw
logs. Privacy mode disables Playwright screenshots and traces and removes its
temporary output directory after the canary.
