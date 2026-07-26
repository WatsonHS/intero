# ADR-0008: Phase 7 bounded Stand-in and Agent automation

Status: accepted implementation target

Date: 2026-07-26

Builds on: ADR-0004, ADR-0005, ADR-0006, ADR-0007

## Context

Phases 1–6 are implemented. Intero has authenticated Organizations, Teams and
Projects; Work State and Claims; Project work and confirmed Specs; Coordination
Threads; Action Inbox; in-app notification preferences; search; durable jobs;
and transactional outbox delivery.

Phase 7 may automate repeated coordination and execution preparation, but it
must not turn Intero into an unbounded autonomous operator. Automation must use
the existing authorization, provenance, history, revert, Inbox, and
Coordination surfaces.

## Decision

Phase 7 is the active implementation target. It is not yet an implementation
claim.

### Authorized signal detection

Durable jobs may evaluate authorized structured state for:

- blockers and dependencies;
- stale review requests;
- pending reviews that need attention;
- explicit coordination requests or conflicts.

Detection uses only data the acting Stand-in or Agent may access. Jobs must
record source object/version, Project, actor or automation identity, policy
version, detection reason, occurred-at time, and stable idempotency key.
Duplicate or replayed signals cannot create duplicate work or Threads.

### Bounded automatic coordination

For a qualifying signal, Intero may automatically create or reuse one
Project-scoped Coordination Thread. The Thread contains:

- the structured reason and source references;
- a safe summary limited to authorized Project context;
- candidate next steps;
- affected participants or Stand-ins within that Project;
- a visible statement of what still requires human action.

The Stand-in may collect responses and drive clarification inside the Thread.
It cannot cross Project scope, disclose raw or unauthorized content, perform an
external action, or convert a proposal into a final commitment.

### Execution work from confirmed Specs

A Project Stand-in or authorized connected Agent may derive execution work from
the most recently confirmed version of a Project Spec and directly create or
update authorized Features, Work Items, relations, comments, and Spec links.

Every mutation records:

- confirmed `specId` and immutable version;
- initiating Stand-in/Agent and authenticated user context;
- derived fields and source passages or structured references;
- policy and authorization decision;
- before/after history, Activity Event, and revert operation;
- stable operation/idempotency ID.

Automation may only use confirmed content. It cannot silently reinterpret an
unconfirmed version. It creates new work unassigned unless an authorized human
explicitly assigns it. It cannot set or change priority or ownership without an
authorized human action. If required priority/ownership is absent, the
automation creates only the work that can be represented without inventing
those decisions and routes the missing choice to Action Inbox.

### Cross-Project summaries

Stand-ins may generate Organization-scoped progress, risk, and decision
summaries across Projects that the requesting principal is authorized to view.
The summary:

- uses safe structured Project state and confirmed Decisions;
- preserves Project boundaries and source freshness;
- never widens source visibility;
- distinguishes facts, risks, and proposed interpretation;
- cannot mutate Project state or create a cross-Project commitment.

Cross-Project summaries appear through existing authorized search, Inbox, or
Stand-in conversation surfaces. Phase 7 adds no separate automation dashboard.

### Durable execution, audit, revert, and notifications

- Detection, derivation, coordination creation, summary generation, and
  notification fan-out run through durable idempotent jobs and the transactional
  outbox.
- Jobs retry safely, expose terminal failure through existing operational
  visibility, and never block coding or Git.
- Every automatic action is visible in the affected object's Activity timeline
  and, for coordination, in the Coordination Thread.
- Revert restores the prior mutable state through a new audited mutation; it
  never erases the original automation event.
- Actions requiring a person—priority, ownership, access, visibility, or final
  commitment—create or update a deduplicated Action Inbox item.
- Informational automation notices respect implemented in-app notification
  preferences. External notification channels remain future scope.
- Withdrawal, revocation, or policy changes stop future automation and cancel
  or invalidate queued work where safe; already-visible audit history remains.

### Hard authority boundaries

No Phase 7 automation may:

- add, remove, invite, promote, or demote members;
- change Organization, Team, Project access, association, or visibility;
- call GitHub, model-provider administration, or another external provider
  action;
- merge code, write provider comments, or mutate external repositories;
- set or change Project priority or human ownership without an authorized human
  action;
- make an irreversible business decision;
- declare a human commitment, approval, or decision final;
- disclose raw content or cross Organization/Project authorization boundaries.

## Consequences

- Intero can reduce coordination latency while keeping consequential authority
  with people.
- Confirmed Specs become executable sources without becoming autonomous
  commitments.
- Durable jobs and outbox delivery make automation recoverable and idempotent.
- Existing Inbox, coordination, activity, search, and Stand-in surfaces remain
  the only product interaction model.
- Cross-Project summaries increase awareness without creating cross-Project
  mutation authority.

## Acceptance

1. An authorized blocker creates or reuses one Project Coordination Thread with
   safe context and candidate steps; replay creates no duplicate.
2. Unauthorized, raw, or cross-Project context never enters the Thread.
3. Stale/pending review detection respects freshness and creates a deduplicated
   Inbox/coordination attention item.
4. A Stand-in derives execution work from a confirmed Spec version with
   provenance, history, and a working revert.
5. An unconfirmed Spec version cannot drive execution mutation.
6. Missing priority or owner is routed to a human; automation does not invent or
   change either.
7. A cross-Project summary includes only Projects visible to the requester,
   separates progress/risk/decision facts, and performs no mutation.
8. Durable retry and replay remain idempotent; terminal failure is visible
   without blocking coding or Git.
9. In-app notification preferences are honored and no external notification is
   sent.
10. Attempts to change membership, visibility, external providers, priorities,
    ownership, or final commitments fail closed and leave an audit record.
11. Revert creates a new Activity Event and preserves the original automation
    event.
12. Browser-visible evidence uses existing Coordination, Action Inbox, activity,
    search, and Stand-in surfaces; no automation dashboard is introduced.

## Deferred

- External notification channels.
- General A2A gateway or federation.
- Provider/GitHub write actions.
- Autonomous priority, ownership, scheduling, approval, or commitment.
- Cross-Organization automation.

## Rejected alternatives

- A new automation-control dashboard.
- Unbounded autonomous project management.
- Treating unconfirmed Specs as executable authority.
- Silent background mutations without Activity history and revert.
- Direct external-provider actions from Stand-in suggestions.
