---
title: "feat: close core product loops and improve pilot UX"
type: feat
status: in-progress
date: 2026-07-29
---

# Core product closure and pilot UX

## Outcome

Move Intero from a broad, demo-capable feature set to a trustworthy pilot
product. Prioritize complete user loops, visible recovery actions, and a green
release baseline before adding new top-level product surfaces.

The work remains additive to Team Pulse, Action Inbox, Communications,
Coordination, Spec Review, Project work, and Settings. It does not introduce a
new automation dashboard or expand Stand-in authority.

## P0 — Trustworthy core loops

### 1. Startup, test, and release baseline

- [x] `pnpm dev:pilot` preserves every database URL required by migrations,
      API runtime, and worker runtime.
- [x] A disposable demo environment starts with one documented command and
      reaches API, Web, worker, realtime, authorization, and object-storage
      readiness.
- [x] Unit, real-dependency integration, build, and browser acceptance suites
      run in CI without silent skips.
- [x] Phase 6, Phase 7, and Agent-connection browser tests match the current
      accessible UI and connection contract.

Acceptance:

- A clean checkout reaches Team Pulse through the documented startup path.
- CI has one green release gate covering migrations, runtime dependencies,
  browser-visible collaboration, backup/restore, and build output.

### 2. Agent connection lifecycle

- [x] Use one explicit lifecycle across server, cloud client, Web, and tests:
      `awaiting_initialization`, `mcp_initialized`, `lifecycle_pending`,
      `configuration_outdated`, `connected`, and `disconnected`.
- [x] Treat successful MCP verification with a pending lifecycle Hook as a
      valid intermediate result rather than a failed connection.
- [x] Persist and validate the required Agent configuration version.
- [x] Show the exact next action, timeout/failure reason, retry, repair, and
      revoke controls in Web Settings.

Acceptance:

- A user can always tell which connection step is complete and what to do next.
- A Hook approval delay cannot make a successfully verified MCP connection look
  broken.

### 3. Realtime delivery state

- [x] Show `connecting`, `live`, `degraded`, `offline`, and `disabled` inside
      Communications with concise consequences and recovery guidance.
- [x] Keep durable HTTP/cursor repair authoritative in degraded mode.
- [x] Complete participant-removal disconnect, shared multi-node rate limiting,
      staged rollout controls, and local outage, multi-client fanout, and
      capacity smoke evidence.
- [ ] Run production-like capacity, failover, and canary evidence in the target
      infrastructure. This is an external release validation gate, not an
      unimplemented product path.

Acceptance:

- Users can distinguish live delivery, background repair, and offline waiting
  without opening developer tools.

### 4. State consistency and recovery

- [x] Make Spec annotation, discussion, unresolved-thread, and Decision Record
      counts derive from one canonical calculation.
- [x] Give legacy/incomplete Coordination and Stand-in records an explicit
      degraded detail state instead of a blank or contradictory screen.
- [x] Show saving, saved, failed, retry, and conflict states for inline Work
      Item mutations.
- [x] Add browser acceptance fixtures for stale, legacy, and partially migrated
      records.

Acceptance:

- The same entity never reports contradictory counts or lifecycle states on one
  screen.
- Failed mutations remain visible and recoverable.

## P1 — Reach attention and first value

### 5. Action Inbox browser notifications

- [x] Offer an explicit browser-notification opt-in from notification settings.
- [x] Notify only for newly arrived, unmuted, unresolved items while the page is
      hidden.
- [x] Deduplicate by Inbox item ID and keep the in-app Inbox authoritative when
      native notification delivery is unavailable.
- [x] Open the matching Intero action when the browser supports notification
      click routing.

Acceptance:

- A permitted browser receives one notification for one new Action Inbox item,
  never for history replay or muted categories.

### 6. First-use guide

- [x] Add a resumable checklist: invite a member, connect an Agent, receive the
      first checkpoint, observe Team Pulse, and complete one Spec Review.
- [x] Derive completion from real backend state instead of local-only flags.
- [x] Keep the checklist dismissible and out of established daily-work views
      after completion.

Acceptance:

- A new pilot administrator can reach the first shared, trustworthy Agent signal
  without external instructions.

### 7. Connection and service diagnostics

- [x] Add one Settings diagnostics surface for Agent, model provider, realtime,
      API/worker, authorization, database, and object storage.
- [x] Show current state, last successful validation, privacy-safe error code,
      and a bounded repair action.
- [x] Reuse existing readiness and metrics contracts; do not create a second
      operational truth.

Acceptance:

- A pilot administrator can isolate a failed dependency without terminal access
  or exposure of secrets and content.

## P2 — Performance and efficiency

### 8. Event-driven cache invalidation

- [x] Inventory every fixed `refetchInterval` and assign an authoritative event,
      visibility/focus fallback, or justified slow freshness interval.
- [x] Extend realtime/SSE events to invalidate only affected Project, Thread,
      Spec, work, Agent, and Inbox query keys.
- [x] Preserve bounded repair polling after connection loss.

Acceptance:

- Normal connected use has no 1.5–5 second fixed polling loop.
- Reconnect and missed-event tests converge to PostgreSQL truth.

Baseline polling inventory before this closure pass:

| Surface and query                                |            Current interval | Intended authority and fallback                                 |
| ------------------------------------------------ | --------------------------: | --------------------------------------------------------------- |
| App shell — Action Inbox                         |                        60 s | `inbox-changed` SSE invalidation; retain focus/reconnect repair |
| Pilot context — bootstrap                        |                         5 s | organization/configuration event; focus fallback                |
| Pilot context — Teams, Projects                  |                    2 s each | membership/project events; focus fallback                       |
| Communications — Team Pulse directory            |     configured slow refresh | pulse/member events; focus fallback                             |
| Person — Team Pulse                              |                        30 s | pulse event; visibility fallback                                |
| Person — Project overview, Project work          |                   10 s each | checkpoint/work events; focus fallback                          |
| Team Pulse — Team Pulse list                     |                        30 s | pulse event; reconnect repair                                   |
| Team Pulse — overview, Project work, Specs       |                    4 s each | checkpoint/work/spec events; focus fallback                     |
| Coordination — Threads                           |                         3 s | thread/message event; reconnect repair                          |
| Coordination — Team Pulse                        |                        30 s | pulse event; visibility fallback                                |
| Coordination — overview                          |                       1.5 s | checkpoint event; short bounded repair only                     |
| Coordination — automation                        |                         3 s | automation signal/decision event; focus fallback                |
| Project work — Project surface, Work Item detail |                    4 s each | scoped work event; focus fallback                               |
| Spec Review — Specs                              |                         4 s | scoped spec/comment event; reconnect repair                     |
| Agent Settings — connection overview             | 1.5 s issued, otherwise 5 s | connection lifecycle event; bounded setup polling               |
| Automation Settings — Project automation         |                         5 s | policy/signal event; focus fallback                             |
| Onboarding Settings — invitations                |                        10 s | invitation event; focus fallback                                |

### 9. Route-level bundle splitting

- [x] Lazy-load non-entry views and heavy admin, Communications, Spec Review,
      and Project work surfaces.
- [x] Keep authentication, shell, and the initial Team Pulse route small.
- [x] Add stable route-loading and route-error states plus focused bundle
      reporting in CI.

Acceptance:

- Initial Web JavaScript is split by destination and no single initial chunk
  triggers the current large-chunk warning.
- Navigating to every route remains covered by browser acceptance.

## Execution log

- 2026-07-29: started the first closure slice: startup environment propagation,
  Agent lifecycle alignment, visible realtime state, Action Inbox browser
  notifications, and route-level splitting.
- 2026-07-29: verified one-command Demo readiness across PostgreSQL, Worker,
  SpiceDB, realtime, object storage, API, and Web; fixed Demo reset to remove
  stale Graphile Worker deduplication state.
- 2026-07-29: Phase 6, Phase 7, and Agent-connection browser acceptance passed.
  Real degraded/recovered realtime state was also observed in Communications.
- 2026-07-29: lint passed; 14-package build passed; Web initial JS is
  205.71 kB and no Web JS chunk exceeds 500 kB; generic real-dependency tests
  passed 407/407, with the isolated Demo integration suite passing 2/2.
- 2026-07-29: added the backend-derived five-step first-use guide, browser
  notification click routing, exact Action Inbox focus, and one privacy-safe
  diagnostics center covering Agent, model, realtime, API, Worker, SpiceDB,
  PostgreSQL, and object storage.
- 2026-07-29: completed Agent timeout/retry/repair/revoke states, optimistic
  Work Item concurrency handling, explicit legacy/partial-migration details,
  and cross-project Coordination deep-link resolution.
- 2026-07-29: workspace events now drive scoped cache invalidation; normal
  connected use no longer relies on 1.5–5 second fixed polling. Reconnect keeps
  one bounded repair pass and Agent setup retains conditional 2-second polling.
- 2026-07-29: completed durable participant removal with retryable Centrifugo
  disconnect, PostgreSQL-backed multi-node realtime rate limiting, stable
  Organization rollout buckets, and local outage, fanout, and capacity smokes.
- 2026-07-29: isolated real-dependency verification passed 93 test files and
  423 tests with 0 skips. The 14-package build, format check, route browser
  acceptance (4/4), and Web bundle budget also passed; initial Web JS is
  209.44 kB and the largest lazy Web JS chunk is 405.32 kB.
- 2026-07-29: captured browser acceptance evidence under
  `output/playwright/product-closure/` for onboarding, notification opt-in,
  diagnostics, Agent recovery, Work Item save state, legacy degradation,
  Action Inbox focus, and live/offline Communications delivery state.
