# ADR-0007: Post-Pilot product model and delivery sequence

Status: accepted

Date: 2026-07-26

Builds on: ADR-0004, ADR-0005, ADR-0006

## Context

Phase 3 completed the infrastructure foundation and thin cloud-first vertical
slice. The next product work must turn that foundation into an Agent-first
engineering collaboration product without implying that the post-Pilot
features already exist.

The product needs one coherent model for onboarding, governance, project work,
Spec Review, attention, and deeper Agent automation. It must preserve the
cloud-first privacy, provenance, visibility, revocation, and adapter boundaries
settled in ADR-0006.

## Decision

The canonical product/domain term in this decision is **Stand-in** in English
and **替身** in Chinese. Documented identifiers use `stand_in`; paths/slugs use
`stand-in`. The active code and persisted identifiers now implement this
canonical rename.

### Delivery sequence

Post-Pilot work follows this functional sequence:

1. **Phase 4 — onboarding and administration:** invite-only registration,
   Organization/Team administration, email-bound invitations, Settings, roles,
   deployment/provider setup, and access revocation.
2. **Phase 5 — project work and Spec Review:** Projects, optional
   Epic/Feature/Work Item hierarchy, one Project Board, PI/Sprint planning,
   Agent-first content mutation, and versioned Spec Review.
3. **Phase 6 — attention and retrieval:** Action Inbox, in-app notification
   preferences, and search over authorized product data.
4. **Phase 7 — deeper Agent automation:** more capable bounded Agent workflows
   after the preceding authority, provenance, review, and attention surfaces are
   established.

Phases 1–6 are implemented on `main`. Phase 7 is now the active bounded
automation implementation target defined by ADR-0008; this status does not claim
that Phase 7 is implemented. External notification channels remain future
product scope.

Phase 7 detects authorized coordination signals, creates Project-scoped
Coordination Threads with safe context, derives revertible execution work from
confirmed Specs, and generates authorized cross-Project progress/risk/decision
summaries. It uses durable jobs/outbox and the existing Inbox, notification,
search, coordination, activity, and Stand-in surfaces. It cannot administer
membership/access/visibility, change priority or ownership without human
authorization, act on external providers or GitHub, disclose raw data, or make
irreversible decisions or final human commitments.

### Identity, membership, and governance

- Registration is invite-only. Open signup is not available in the first
  release.
- An admin creates an invitation from **Team Settings → Member Management** by
  entering the recipient's display name and exact email address. Intero creates
  a one-time, expiring, revocable account-activation link bound to that email.
- V1 does not require SMTP or an email service. The UI exposes copy-link; the
  admin shares it through their own channel. Invitation lifecycle is
  `pending`, `accepted`, `expired`, or `revoked` and supports copy, resend by
  regenerating the link, and revoke. SMTP is optional later deployment
  configuration.
- The recipient uses a short **Accept Invitation** surface separate from
  administrator Setup or Test Setup:
  1. Confirm the Organization, Team, admin-specified display name, invited
     email, and explicit Accept action.
  2. Use the matching invited email to accept and bootstrap first credential
     setup; mismatch is denied. The activation link is not normal login.
  3. See the joined Team and accessible Projects, then enter a Project or Team
     Pulse, with a skippable **Connect Coding Agent** entry.
- The recipient surface does not expose deployment endpoint, model-provider
  secrets, governance, invitation management, or administrator Settings. The
  pre-set name becomes the initial personal display name and is editable later
  in Personal Settings.
- Passkey is the primary normal login. Email plus password is fallback. Product
  Magic Link login is removed.
- Password recovery is not implemented. A future release may add an
  administrator/manual recovery link or optional SMTP-backed recovery.
- An account has one active Organization. Multi-Organization switching and an
  Organization switcher remain later work.
- Organization owns Projects. A Project has one primary Team and may associate
  additional Teams. Membership in any associated Team grants the simple V1
  Project visibility and participation baseline.
- Team membership role is `member` or `leader`. A Team may have multiple
  Leaders or no Leader.
- Organization admins are the governance fallback. The last Organization admin
  cannot be removed or demoted until another Organization admin exists.
- Organization admins and Leaders of a Project's primary Team may edit Project
  governance, including review policy and PI/Sprint configuration.
- This does not introduce individual Project roles or ACLs. Agents cannot change
  membership, roles, Project-Team associations, or access visibility.

### Agent-first project content

- A connected Agent with Project access may create and update authorized
  project-management and Spec content through MCP.
- Manual editing remains available for people but is not the default workflow.
- Every Agent or human mutation records actor, time, provenance, immutable
  history, and a recoverable/revertible prior state.
- Users can disconnect or revoke an Agent's Project access. Revocation stops
  future access without blocking local coding.
- Canonical Agent checkpoints remain distinct from content mutation contracts.
  Agent events, Work State, and domain policy remain transport- and
  adapter-independent.

### Project work model

The hierarchy is optional:

```text
Epic (optional)
└── Feature (zero or more)
    └── Work Item (zero or more)
```

- An Epic is a Project roadmap/overview object. It does not appear on the
  execution Board.
- A Feature belongs to at most one Epic. A Feature may have no Work Items and
  may be directly owned and executed by one person with their Agent.
- Feature stage is `planned`, `in_development`, or `released`.
- A Work Item is the execution unit on the Project Board. Agents are
  provenance/execution actors, never assignees.
- Every Project has one Board. There is no Team-wide Board in this phase.
- Backlog and current Sprint are two views of the same Project work surface.
  Backlog is a separate view, not a Board column shown in the active Sprint
  view.
- Backlog is scheduling state, not a Work Item status. Work Item status is
  exactly `todo`, `in_progress`, `ready_for_test`, or `done`.
- Any authorized participant or connected Agent may move a
  `ready_for_test` Work Item to `done`. Evidence is optional; actor and time are
  always recorded.
- At Sprint end, unfinished work stays visibly `in_progress` with its source
  Sprint and a carryover marker. Intero does not silently reschedule it.

A Work Item contains:

- title, description, and status;
- one human owner or `unassigned`;
- optional linked Spec;
- priority `P0`, `P1`, `P2`, or `P3`;
- optional free numeric Points;
- typed relations: `blocks`/`blocked-by`, `related`, and
  `duplicate`/`duplicated-by`;
- associated Coordination Thread references;
- human and Agent comments and replies;
- first-class explicit PR, Commit, and branch associations.

An explicit Agent MCP report may attach code associations automatically. Intero
never infers them from branch names. Authorized humans may correct or remove
associations. The comment model reserves stable links for replies and future
code, Spec, and coordination references.

### Team Pulse projection

Team Pulse remains an ambient person-per-column view, not a task hierarchy:

- one column represents one person;
- the header contains a Stand-in-generated natural-language summary derived
  from authorized active work items, blockers, recent outcomes, and freshness;
- the header also shows concurrently active and blocked counts;
- header summary text is plain and non-interactive, with no citations, links,
  click-through, or state-setting;
- work cards below are peer current active work items, ordered only for reading;
- **N more** compacts the visible list and does not create hierarchy or domain
  state.

The Pulse projection has no primary, main, secondary, subordinate, or focus
field for tasks, work items, or Workstreams. It does not infer importance or
rank. Project Epic/Feature/Work Item relationships remain Project-management
relationships and never determine a Pulse card's display status.

### PI and Sprint

- Use **PI** and **Sprint** only. Do not introduce Cycle, Iteration, or Release
  as planning-container terminology.
- PI and Sprint belong to a Project and are managed by Organization admins or
  Leaders of the Project's primary Team.
- Creating a PI accepts a start date, number of Sprints, and Sprint duration in
  weeks. Intero generates `PI N`, `Sprint 1` through `Sprint N`, and their date
  ranges. Users do not supply free names.
- Project timezone determines status automatically: `planned` before the start,
  `active` at the start, and `ended` after the end. An authorized administrator
  or Leader may end a PI or Sprint early.
- Features and Work Items may remain in Backlog, be assigned to a PI only, or be
  assigned to a Sprint. Sprint assignment implies its parent PI.

### Spec Review

- A Spec belongs to exactly one Project. A Project may contain multiple Specs.
- Every create or update operation creates a new immutable Spec version.
- MCP provides `list_confirmed` and `get_confirmed(specId)`. An Agent chooses a
  confirmed Spec explicitly. `get_confirmed` returns the most recently confirmed
  version until a newer version is confirmed.
- Review starts only through explicit `request_review`; create or update never
  starts review automatically.
- Inline/line comments are required review mechanics and bind only to the
  reviewed immutable version. V1 has no comment re-anchoring or diff UI; review
  presents the full version snapshot.
- Any Project-visible Team member or their connected Agent may comment, reply,
  resolve, or reopen comments. Intero records human/Agent provenance.
- Agents receive unresolved review comments on their next MCP connection and
  may respond or create a new version. A comment does not force an Agent to
  change content.
- A change after confirmation creates a new version and notifies reviewers. The
  confirmed version remains the result of `get_confirmed` until the new version
  is confirmed. There is no branch/freeze UI.
- Team members reach all Specs they can access through one Team-level **Spec
  Review** page with a Project filter. A Project page deep-links into that page
  with the filter applied.
- An unassigned pending review contributes a compact Team Pulse count but does
  not create an Action Inbox item.
- A Spec initiator may nominate reviewers. Nominations are nonexclusive and
  create targeted Action Inbox notifications; any authorized member may still
  review.

Project review policy is editable by an Organization admin or Leader of the
Project's primary Team:

- required confirmations: `1`, `2`, or `3`;
- whether another member's Agent confirmation counts;
- whether author-self-confirmation is allowed.

The default is one non-author confirmation, and another member's Agent counts.
A creator or most recent modifying Agent cannot confirm its own version unless
author-self-confirmation is enabled. Confirmation is version-specific.

### Code provider boundary

- The initial product stores explicit human- or Agent-supplied PR, Commit, and
  branch references. There is no live GitHub or GitHub Enterprise sync.
- A later enterprise GitHub App may be installed at Organization scope, limited
  to selected repositories, read-only, and synchronized through webhooks.
- Intero will not require personal access tokens and will not merge code or
  write GitHub comments through that integration.

### Canonical UX

New capabilities extend the existing Intero visual system and detail structure.
They do not introduce a separate administration or dashboard visual system.

Work Item detail uses:

- activity and coordination timeline in the center;
- facts, context, relations, and code associations in the right rail;
- comment composition at the bottom.

Settings contains onboarding, membership, governance, integration, and
revocation controls appropriate to the user's authority.

## Consequences

- Agent-first mutation requires explicit MCP content contracts, authorization,
  provenance, version history, and revert behavior before deeper automation.
- Post-Pilot onboarding uses auditable per-recipient invitations rather than the
  historical reusable Pilot join link. SMTP remains optional.
- Team Leader authority is scoped through the Project's primary Team; an
  Organization admin provides deterministic fallback when a Team has no Leader.
- Optional hierarchy supports AI-native Feature execution without forcing
  decomposition into Work Items.
- Team Pulse stays a peer-work awareness surface and cannot become an inferred
  work-priority model.
- Spec Review is snapshot- and version-oriented, while Action Inbox remains a
  targeted attention surface rather than a queue for every open review.
- GitHub integration can be added later without coupling initial work management
  to provider credentials or inferred repository state.

## Deferred nonblocking decisions

- External notification channels and delivery adapters.
- Default invitation expiry duration.
- Search ranking, indexing cadence, and retention-derived deletion behavior.
- Revert conflict presentation when a newer mutation exists.
- Whether early-ending a Sprint also marks its parent PI for administrator
  review.
- Exact copy and placement for Team-level Spec Review filters within the
  existing visual system.
- Optional SMTP delivery configuration and delivery-status semantics.
- Password-recovery implementation and audit semantics.

These decisions do not block the active Phase 7 target.

## Rejected alternatives

- Open signup in the first release.
- Requiring SMTP for V1 invitation delivery.
- Sending recipients through administrator Setup or exposing administrator
  configuration on the Accept Invitation surface.
- Agents as Work Item assignees or membership/access administrators.
- Mandatory Epic/Feature/Work Item decomposition.
- Epic cards on the execution Board or a Team-wide Board.
- Silent Sprint carryover or automatic rescheduling.
- Branch-name inference for code associations.
- Live GitHub sync through personal access tokens.
- Automatic review after Spec creation or update.
- A separate visual language for administration and work management.
- Primary/secondary/focus work classifications or interpreting **N more** as
  hierarchy.
