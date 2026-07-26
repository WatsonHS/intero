---
title: "feat: Phase 7 bounded Stand-in and Agent automation"
type: feat
status: target-plan
date: 2026-07-26
origin: docs/adr/0008-phase-7-bounded-stand-in-and-agent-automation.md
---

# Phase 7 bounded Stand-in and Agent automation

## Outcome

Implement the bounded automation accepted in ADR-0008 on top of implemented
Phases 1–6. Phase 7 is the active implementation target and is not yet complete.

The implementation reuses durable jobs, transactional outbox, Coordination
Threads, Action Inbox, activity timelines, in-app notification preferences,
search, and Stand-in conversations. It adds no automation dashboard.

## Unit 1 — Authorized signal detector

- Detect structured blockers, dependencies, stale/pending reviews, explicit
  coordination requests, and conflicts.
- Apply Organization/Project/object authorization before evaluation.
- Persist source/version, reason, freshness, policy, actor, and stable
  idempotency key.
- Deduplicate repeated/replayed signals.

Acceptance:

- Authorized fixtures trigger once.
- Unauthorized, withdrawn, stale-beyond-policy, and duplicate inputs do not
  create duplicate actions.

## Unit 2 — Automatic Project coordination

- Create or reuse one Project-scoped Coordination Thread.
- Add safe context, candidate next steps, affected participants, and explicit
  human-action boundary.
- Let the Stand-in collect responses and clarification in that Thread.
- Reject raw disclosure, cross-Project scope, external action, and final
  commitment.

Acceptance:

- Browser-visible Thread evidence shows source, safe context, clarification,
  audit, and deduplication.
- Boundary attempts fail closed and remain auditable.

## Unit 3 — Confirmed-Spec execution derivation

- Read only the most recently confirmed immutable Spec version.
- Let an authorized Stand-in/Agent create or update Features, Work Items,
  relations, comments, and Spec links.
- Record source version, derived fields, actor, policy, before/after history,
  Activity Event, revert operation, and idempotency ID.
- Leave new work unassigned unless a human assigns it.
- Never set/change priority or ownership without authorized human action; route
  missing required choices to Action Inbox.

Acceptance:

- Confirmed Spec derivation is deterministic and idempotent.
- Unconfirmed versions cannot mutate execution work.
- Revert restores prior mutable state through a new Activity Event.

## Unit 4 — Cross-Project progress/risk/decision summaries

- Assemble only Projects visible to the requesting principal.
- Use safe structured progress, risks, freshness, and confirmed Decisions.
- Distinguish facts from interpretation.
- Render through existing search, Inbox, or Stand-in conversation surfaces.
- Grant no cross-Project mutation or commitment authority.

Acceptance:

- Cross-Project authorization tests deny hidden Projects.
- Summary generation mutates no Project and preserves source freshness.

## Unit 5 — Durable delivery and attention

- Execute detection, derivation, coordination, summary, and notification fan-out
  as idempotent durable jobs with transactional outbox records.
- Retry safely and expose terminal failure through existing operational
  visibility.
- Create/update deduplicated Action Inbox items for required human choices.
- Honor in-app notification preferences for informational automation notices.
- Cancel or invalidate queued work after relevant revocation/withdrawal/policy
  change where safe.

Acceptance:

- Retry/replay creates no duplicate Thread, work mutation, Inbox item, or
  notification.
- Failures never block coding or Git.
- External notification channels are not invoked.

## Cross-cutting authority tests

Fail closed and record audit for attempts to:

- mutate membership, access, Team/Project association, or visibility;
- call GitHub/model-provider administration or another external provider;
- merge code or write provider comments;
- set/change priority or ownership without authorized human action;
- make an irreversible business decision or final human commitment;
- disclose raw content or cross Project/Organization authorization.

## Completion gate

Phase 7 is complete only when:

- Units 1–5 pass unit, integration, and browser-visible acceptance;
- provenance/history/revert and idempotency are proven under retries;
- two authorized users can inspect automatic coordination and required human
  choices through existing surfaces;
- no new dashboard or external notification/provider action exists;
- documentation status is updated from target to implemented with evidence.
