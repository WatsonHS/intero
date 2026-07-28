---
title: "feat: production realtime conversations"
type: feat
status: target-plan
date: 2026-07-28
origin: docs/adr/0009-durable-authorized-realtime-conversations.md
---

# Production realtime conversations

## Outcome

Implement ADR-0009 so human and Stand-in conversations are durable,
authorization-safe, low latency, incrementally synchronized, and recoverable
without normal-mode polling.

This plan deliberately turns the existing PostgreSQL/outbox/worker/Centrifugo
pieces into one end-to-end protocol. It does not replace them with a second
realtime stack.

## Implemented baseline

The first implementation slice now includes authenticated canonical
conversation commands, idempotent sequence allocation, bounded tail and cursor
reads, explicit outbox audiences, short-lived connection/subscription tokens,
WebSocket-to-SSE client fallback, HTTP delta repair, degraded polling, Pilot DM
compatibility, historical DM backfill, and durable asynchronous Stand-in
questions.

The remaining production rollout gates are the environment-specific controls
in Unit 6 plus participant-removal disconnect control, shared multi-node rate
limiting, and production-like capacity/failover tests. Those gates do not
change the durable protocol implemented here.

## Unit 0 — Security baseline

- Require an authenticated principal on every canonical Thread list, read,
  create, post, access-change, conclude, and read-cursor route.
- Derive sender and actor IDs from the authenticated request.
- Enforce `thread:view`, `thread:post`, and `thread:manage_access` against the
  canonical participant source and SpiceDB.
- Filter Thread lists before loading messages or unread counts.
- Add per-principal and per-Thread send rate limits plus bounded message size.

Primary areas:

- `apps/server-api/src/app.ts`
- `apps/server-api/src/auth.ts`
- `apps/server-api/src/spicedb-authorization.ts`
- `infra/spicedb/schema.zed`
- `packages/api-contracts/src/index.ts`

Acceptance:

- actor-spoofing and cross-Thread tests fail closed;
- unauthenticated requests return `401`, non-participants return `404` or
  policy-approved `403`, and neither leaks Thread existence;
- the API never accepts a sender/actor identity from a conversation mutation
  body.

## Unit 1 — Canonical durable conversation repository

- Add `access_version`, `latest_message_at`, participant visibility/audit
  fields, and message idempotency constraints.
- Separate message content readability from participant/Agent sequence
  visibility; stop treating server-readable as Agent-readable.
- Implement atomic sequence allocation, message insert, Thread head update,
  Activity Event, and outbox insert.
- Materialize independently retryable outbox publications for the Thread and
  participant personal channels.
- Add idempotent lookup by `clientMessageId`.
- Replace whole-history Thread list reads with summary list and paginated
  message cursor reads.
- Validate and advance read cursors monotonically.
- Implement direct repository operations rather than snapshot-wide persistence.

Primary areas:

- a new additive migration under `apps/server-api/drizzle/`
- `apps/server-api/src/database/schema.ts`
- `apps/server-api/src/platform-store.ts`
- `apps/server-api/src/postgres-store.ts`
- `packages/domain/src/conversations.ts`
- `packages/api-contracts/src/index.ts`
- generated OpenAPI output

Acceptance:

- concurrent integration tests prove contiguous unique sequences;
- retries across a simulated lost response produce one row and one outbox
  event;
- list reads stay bounded when a Thread contains at least 100,000 messages;
- cursor reads return exact ordered gaps and reject access loss.

## Unit 2 — Unify Pilot DM and Stand-in conversation storage

- Map Pilot direct-message and personal Stand-in routes onto canonical Threads.
- Preserve current product identities, access-boundary behavior, and external
  response shapes during compatibility.
- Stop new writes to `pilot_dm_threads`, `pilot_dm_messages`, and
  `pilot_stand_in_exchanges`.
- Build an idempotent backfill preserving IDs, sequences, participants, access
  transitions, timestamps, and read semantics.
- Give each `(project, viewer, standInOwner)` conversation a stable Thread UUID;
  do not continue using a Project ID as a synthetic Thread ID.
- Add parity reporting before switching reads.
- Retain rollback reads for one release; remove obsolete persistence only in a
  later reviewed migration.

Primary areas:

- `apps/server-api/src/pilot-routes.ts`
- `apps/server-api/src/pilot-store.ts`
- `apps/server-api/src/normalized-postgres-pilot-store.ts`
- `apps/server-api/src/postgres-store.ts`
- migration/backfill scripts and integration tests
- `apps/web/src/pilot/adapters.ts`

Acceptance:

- migrated fixture and realistic-volume datasets have matching Thread/message
  counts, heads, participants, visibility boundaries, timestamps, and sampled
  content hashes;
- existing Web response contracts remain compatible during rollout;
- no new Pilot message uses the Organization-wide snapshot lock.

## Unit 3 — Authorized realtime control plane

- Define and validate `conversation.changed.v1`.
- Route Thread events only to `intero:thread:<threadId>` and content-free
  personal hints to `intero:user:<principalId>`.
- Give one outbox event explicit audience publications and idempotent completion
  tracking.
- Add short-lived connection and Thread subscription token routes.
- Use the same canonical authorization check for subscription and HTTP read.
- Add participant-removal unsubscribe/disconnect control delivery.
- Add a production Centrifugo template with TLS-edge assumptions, signed tokens,
  private publish API, restricted origins, WebSocket, SSE/emulation, recoverable
  content-free history, and distributed engine configuration.

Primary areas:

- `apps/server-api/src/` realtime token/routes module
- `apps/server-worker/src/outbox.ts`
- `apps/server-worker/src/postgres-repository.ts`
- `packages/domain/src/` realtime contract
- `packages/config/src/index.ts`
- `infra/centrifugo/`
- `docs/OPERATIONS.md`

Acceptance:

- a non-participant cannot mint or refresh a Thread subscription;
- private events are absent from Organization channels;
- publications contain no message or prompt content;
- token expiry, signing-key rotation, access revocation, worker retry, and
  multi-node fanout tests pass;
- Centrifugo downtime does not change message commit success.

## Unit 4 — Web synchronization coordinator

- Add the official `centrifuge` JavaScript SDK.
- Create one application-level coordinator for connection tokens, transport
  state, personal subscription, active Thread subscriptions, and token refresh.
- Prefer WebSocket and configure bidirectional SSE fallback.
- Buffer publications during the initial cursor read.
- Coalesce hints into sequence-based delta fetches and merge idempotently.
- Use React Query invalidation only as a view integration mechanism, not as the
  synchronization protocol.
- Add optimistic send states using a stable `clientMessageId`.
- Expose `connecting`, `live`, `degraded`, and `offline` status.
- Enable cursor polling with jitter only while degraded; remove fixed ten-second
  polling while live.
- Load bounded recent history and paginate older messages.

Primary areas:

- new `apps/web/src/realtime/` modules
- `apps/web/src/api.ts`
- `apps/web/src/pilot/api.ts`
- `apps/web/src/views/CommunicationsView.tsx`
- connection-status design primitives and localization

Acceptance:

- snapshot/subscription race, duplicate publication, reversed publication,
  send-response loss, expired history, token expiry, and reconnect tests lose
  no message;
- live mode has no chat `refetchInterval`;
- degraded mode is visible and automatically returns to live;
- optimistic messages settle exactly once or expose an actionable retry.

## Unit 5 — Asynchronous Stand-in replies

- Commit a human question as a canonical message.
- Enqueue one durable Stand-in job keyed by the question message ID in the same
  transaction.
- Move provider calls out of the API request.
- Append the answer through the canonical message transaction.
- Represent pending, retrying, and terminal failure without inventing an
  assistant answer.
- Keep normal human chat independent of provider readiness.

Primary areas:

- `apps/server-api/src/pilot-routes.ts`
- `apps/server-api/src/pilot-service.ts`
- `apps/server-worker/src/pilot-jobs.ts`
- canonical conversation repository
- `apps/web/src/views/CommunicationsView.tsx`

Acceptance:

- the question request returns after durable enqueue rather than model
  completion;
- provider timeout, process crash, and at-least-once retry produce at most one
  answer;
- human messages continue while the Stand-in provider is unavailable.

## Unit 6 — Operability, scale, and rollout

- Add privacy-safe realtime, cursor-repair, idempotency, outbox-age, connection,
  transport, and Stand-in queue metrics.
- Alert on burn rate, reconnect storms, oldest outbox/job age, authorization
  anomalies, and degraded-mode duration.
- Add load tests for 10,000 connections, 200 message writes/s, and 1,000
  publications/s, then repeat at twice forecast peak.
- Exercise slow consumers, rolling API/worker/Centrifugo/Redis restarts,
  database failover, Redis loss, and secret/token-key rotation.
- Add a realtime feature flag and staged rollout: team-internal, small tenant
  cohort, 10%, 50%, 100%.
- Keep cursor polling as kill-switch fallback.
- Document backup/restore and completed-outbox cleanup.

Primary areas:

- `packages/config/src/metrics.ts`
- API and worker readiness
- `docs/OPERATIONS.md`
- `docs/PILOT_RUNBOOK.md`
- integration and browser E2E suites

Acceptance:

- ADR-0009 SLOs and capacity gate pass in a production-like environment;
- disabling realtime does not lose data and moves clients to degraded cursor
  repair;
- observability contains no content or unbounded tenant/object labels;
- rolling deployment preserves sends, subscriptions, and cursor recovery.

## Required end-to-end scenarios

1. Two human participants exchange messages in two isolated authenticated
   browsers with no normal-mode polling.
2. Simultaneous sends from multiple devices converge on one ordered history.
3. A response lost after commit is safely retried with the same
   `clientMessageId`.
4. A browser disconnects beyond realtime history TTL and repairs the exact
   durable gap.
5. The worker and Centrifugo are stopped independently while sends continue;
   remote clients later converge.
6. A participant is removed during an active connection and immediately loses
   HTTP and refreshed subscription access.
7. An unauthorized browser guesses Thread and channel UUIDs and learns no
   content or existence.
8. A Stand-in provider times out while the two humans continue chatting.
9. Historical Pilot DMs remain visible and ordered after canonical migration.
10. A rolling deployment and reconnect storm stay inside capacity and recovery
    objectives.

## Completion gate

Production realtime conversations are complete only when:

- Units 0–6 and all required end-to-end scenarios pass;
- no production conversation mutation accepts client-selected actor identity;
- no private conversation event uses an Organization-wide channel;
- live clients use realtime hints plus cursor repair, with no fixed chat poll;
- every acknowledged message is recoverable from PostgreSQL after realtime
  history and Redis are discarded;
- old Pilot chat writes are disabled and migration parity evidence is retained;
- ADR-0009 changes from `proposed implementation target` to `accepted` with
  linked validation evidence.
