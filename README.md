# Intero

Intero is a cloud-first, Web-first coordination layer for engineering teams.
Coding Agents report semantic checkpoints directly to an authenticated Intero
team deployment's cloud MCP endpoint. Intero turns those checkpoints into
private Work State, bounded Stand-in coordination, durable
conversations, Team Pulse, Action Inbox items, and versioned Spec Review.

Intero cloud stores and processes user-private work data and runs the
Stand-in, Claim resolution, and Work State logic. Uploading data does not
make it team-visible. Sensitive data is private to the user by default;
personal spaces and unbound work stay in **Private Work**, while binding an
authorized team project silently enables safe collaboration summaries.

## Canonical terminology

The current product/domain term is **Stand-in** in English and **替身** in
Chinese. Prose uses `Stand-in`/`stand-in`; documented identifiers use
`stand_in` where an identifier cannot contain a hyphen and `stand-in` in
paths/slugs. Superseded ADRs may retain their literal historical terminology.
The active application, domain, MCP, schema, tests, and configuration use this
canonical vocabulary. `Representative` remains only in explicitly superseded
historical ADR evidence.

## Product baseline

- The Web application is the primary Intero client.
- Coding Agents connect directly to their selected team deployment's cloud MCP
  endpoint while it is online.
- The Stand-in is one cloud identity operating across
  user-private and authorized shared scopes.
- Claims retain provenance, confidence, freshness, and contradiction instead of
  using last-write-wins state.
- Capability Grants enforce Stand-in authority in code.
- Team Pulse and Action Inbox organize shared attention.
- Coordination Threads, reviewable Specs, and Decisions keep collaboration
  visible, attributable, and correctable.
- The Desktop App is optional. While open, its explicitly enabled Git-awareness
  control may observe bounded metadata for user-selected repositories. It
  performs no silent system-wide observation and is never required for
  collection, MCP, management, access, or Stand-in runtime infrastructure.
- Git and Coding Agent lifecycle hooks may report compact, content-safe events
  to a separate authenticated cloud event endpoint. Its protocol is a follow-up
  decision and is not defined by the current product baseline.

The cloud-first implementation is built behind durable working ports, not
throwaway code or decorative interfaces: Vercel AI SDK `ModelGateway`;
SpiceDB-backed `AuthorizationPort`; Centrifugo-backed `RealtimePort`;
MinIO-backed `ObjectStorePort` with product uploads disabled by default;
Graphile-backed durable `JobRunnerPort` and transactional outbox; and
Project-internal `CoordinationTransport`. General A2A gateway/federation remains
deferred.

Canonical Agent events, Work State, and domain policy contracts remain
adapter-independent. Every adapter conforms to contract tests, and a replacement
must pass the same tests. The repository includes normalized PostgreSQL
persistence and migrations, durable jobs/outbox, SpiceDB, Centrifugo, MinIO,
dependency readiness, privacy-safe telemetry, and operator runbooks.

The minimal model loop uses only authorized structured Work State to generate
safe Stand-in summaries and bounded coordination suggestions. It cannot
use raw content without explicit authorization, cross Organization/Workspace
boundaries, auto-commit, or become a general autonomous Agent.

The authoritative contracts and boundaries live in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`ADR-0006`](docs/adr/0006-cloud-first-web-first-runtime-and-private-by-default-data.md).
The accepted post-Pilot product model and delivery order live in
[`ADR-0007`](docs/adr/0007-post-pilot-product-model-and-delivery-sequence.md).
The bounded Phase 7 automation target lives in
[`ADR-0008`](docs/adr/0008-phase-7-bounded-stand-in-and-agent-automation.md).
The proposed production realtime conversation target lives in
[`ADR-0009`](docs/adr/0009-durable-authorized-realtime-conversations.md).
The product requirements live in
[`docs/brainstorms/2026-07-24-intero-product-requirements.md`](docs/brainstorms/2026-07-24-intero-product-requirements.md).

## Post-Pilot product sequence

Phases 1–6 are implemented on `main`:

1. Phases 1–3: cloud collaboration core and production-operability foundation.
2. Phase 4: invite-only registration, onboarding, administration, and Settings.
3. Phase 5: Project work management, PI/Sprint planning, and Spec Review.
4. Phase 6: Action Inbox, in-app notification preferences, and search.

Phase 7 is the active implementation target, not a claim of current
implementation. It adds bounded automation that:

- detects authorized blocker, dependency, stale or pending review, conflict, and
  coordination signals;
- creates or reuses a Project-scoped Coordination Thread with safe context and
  candidate next steps;
- lets the Stand-in or an authorized Agent derive and directly create or update
  execution work from a confirmed Spec, with provenance, immutable history, and
  revert;
- generates authorized cross-Project progress, risk, and decision summaries.

These jobs use the durable job runner and transactional outbox. Their results
appear in existing Project activity, Coordination, Action Inbox, in-app
notification, search, and Stand-in surfaces; Phase 7 adds no automation
dashboard. Automation cannot change membership, access, Project visibility,
priority, or ownership; invoke external providers or GitHub actions; disclose
raw content; or make an irreversible business decision or final human
commitment. External notification channels remain future scope.

Project content is Agent-first. A connected Agent with Project access may create
or update authorized Features, Work Items, and Specs through MCP, with actor,
time, provenance, immutable history, and revert behavior. Manual editing remains
available. Agents are never assignees and cannot change membership, roles, Team
associations, or visibility. Users can disconnect or revoke Agent Project
access.

Post-Pilot onboarding is invite-only through **Team Settings → Member
Management**. An admin enters the recipient's display name and exact email;
Intero creates a one-time, expiring/revocable email-bound account-activation
link with
pending/accepted/expired/revoked lifecycle. V1 provides copy-link, regenerate,
and revoke without requiring SMTP; the admin shares the link through their own
channel.

The recipient uses a short **Accept Invitation** flow, confirms the
Organization/Team/name/email, accepts with the exact invited email, and uses the
link only to bootstrap first credential setup. It is not a normal login link.
Passkey is the primary normal login; email plus password is the fallback.
After joining, the recipient enters Team Pulse directly. Coding Agent
connection remains an optional, contextual action on Team Pulse, Project, and
Spec Review surfaces rather than an onboarding step.
Deployment endpoint, model keys, governance, invitations, and admin Settings
are not shown. The pre-set name becomes the initial display name and remains
editable in Personal Settings.

Password recovery is not implemented. A future release must provide either an
administrator/manual recovery-link flow or an optional SMTP-backed recovery
path without turning SMTP into a V1 activation dependency.

Organization owns Projects; each Project has a primary Team and may include
additional Teams. Team roles are `member` and `leader`; Organization admins and
the primary Team's Leaders manage Project review policy and PI/Sprint settings.
The last Organization admin is protected from removal or demotion. The first
release is invite-only, supports one active Organization per account, and has no
Organization switcher.

The optional work hierarchy is Epic → Feature → Work Item. Epics are roadmap
objects and do not appear on the execution Board. Features may be executed
directly without Work Items. Each Project has one Board with separate Backlog
and current Sprint views. Backlog is scheduling state, not a Work Item status;
the fixed status contract is `todo`, `in_progress`, `ready_for_test`, or `done`.
Feature stage is `planned`, `in_development`, or `released`. Unfinished Sprint
work remains visibly `in_progress` with source-Sprint/carryover context rather
than being silently rescheduled.

Specs belong to one Project and use immutable full-version snapshots. Review is
started explicitly with `request_review`; version-bound inline comments,
confirmations, provenance, reviewer nomination, `list_confirmed`, and
`get_confirmed(specId)` define the initial review contract. The default policy
requires one non-author confirmation and allows another member's Agent to count.

Initial code associations are explicit PR, Commit, and branch references supplied
by a human or Agent; Intero does not infer them from branch names. Live
GitHub/GitHub Enterprise synchronization is deferred to a later Organization
installed, selected-repository, read-only GitHub App without personal access
tokens or write operations.

## Canonical Agent checkpoints

The frozen pilot protocol has exactly ten semantics:
`work_started`, `work_progressed`, `decision_recorded`,
`dependency_declared`, `blocker_raised`, `review_requested`,
`work_completed`, `coordination_requested`, `artifact_produced`, and
`validation_completed`.

Every event contains a bounded safe summary, stable client-generated
event/idempotency ID, Project identity, authenticated Agent identity,
source/provenance, occurred-at time, and schema version. The active checkpoint
contract is narrative schema v2 only: `currentFocus`, `completedOutcome`,
bounded `evidence`, `nextStep`, and explicit `collaboration` need/target.
Summary-only v1 checkpoints are rejected. Plan changes belong in
`work_progressed`; there is no separate plan event. Dependency, blocker, review,
and coordination/conflict events may feed bounded coordination.
Artifact/validation/completion feed Work State, status, and safe Team Pulse.
Raw prompts/files/diffs/terminal/tool logs and low-level file/resource touch
events are excluded.

## Team Pulse

Team Pulse is a person-per-column view of peers' current active work items. Each
column header shows a plain Stand-in-generated natural-language summary based on
authorized active work, blockers, recent outcomes, and freshness, together with
concurrently active and blocked counts. The header is non-interactive: it has no
citations, links, click-through, or state-setting behavior.

Work cards below are peer items ordered for reading. **N more** only compacts the
visible list. Intero has no primary/main/secondary/subordinate/focus task,
work-item, or Workstream model and does not infer rank from card order or
compaction.

## Pilot deployment and member setup

The pilot assumes an already-running Intero deployment. An uninitialized
deployment presents a one-time Admin Bootstrap for Organization, initial Team,
Provider, and first Project creation. Once initialized, these capabilities live
in Admin and Setup is no longer a normal destination. Ordinary members never
enter Bootstrap.

In **Team Settings → Member Management**, an Organization administrator creates
a one-time, expiring, revocable email-bound account-activation link for a
recipient's display name and exact email. V1 exposes copy, regenerate, and
revoke without requiring SMTP. The recipient accepts through the short **Accept
Invitation** surface with the matching email and bootstraps first credential
setup. The link cannot be reused for normal login. Membership inherits the
administrator-approved Intero endpoint and team context; ordinary members do
not type the server URL. Reusable Pilot join links are historical and are not
the current onboarding path. Bulk email or CSV invitations, SCIM provisioning,
and domain-based automatic join remain deferred.

Organization is the structural tenant boundary and owns Projects. Admin
Bootstrap creates one Organization implicitly or with a simple name. Teams contain
members; Team and Project are many-to-many. A Project may name one
primary/display Team and include additional participating Teams. Membership in
any associated Team grants V1 participation in that Project.

Agent connections, Claims/Work State, Team Pulse, collaboration posture, and
project conversation bind to Project identity independently of Team; cross-Team
Projects aggregate participating-Team context. 1:1 DMs remain same-Team member
relationships. Individual Project roles, ACLs, and restricted visibility are
post-pilot, and private raw-data controls remain separate.

The Intero deployment endpoint and AI Provider configuration may be
Organization-scoped; per-recipient email-bound invitations remain Team-scoped.
Multi-Organization switching, advanced
Organization administration, billing, enterprise identity, and advanced
cross-Team governance are deferred.

In a separate **AI Provider** section, the team administrator configures the
cloud model provider endpoint, secret API key, and default model together. The
provider endpoint is not the Intero deployment URL and is not an Agent/MCP
connection endpoint. The key stays server-side with encryption and secret
handling and is never returned to browsers or members. An administrator can
test the connection, rotate or replace the key, or disable the provider.

If no provider is configured or it is unavailable, identity, team/project
membership, invitations, and basic human collaboration and chat remain usable.
AI Stand-in, automated summaries, and other model-derived coordination features
remain disabled. Project-scoped Agent binding and structured checkpoint ingress
remain available because they do not invoke the configured model provider.
Admin visibly distinguishes **Basic collaboration ready** from **Stand-in needs
administrator model configuration** and shows actionable administrator status;
provider setup does not block invitations, basic chat, or Agent connection.

Productized self-deployment is outside the pilot: no deployment package,
Docker/install wizard, infrastructure workflow, DNS/TLS guidance, automated
tenant provisioning, or end-user self-hosting documentation is promised.
Detailed provider secret-management mechanics and multi-provider routing are
also not promised. A developer endpoint override may exist in non-product
configuration, but it is not a member-facing deployment picker.

Pilot acceptance uses two isolated browser/client sessions for two distinct team
users on the same approved Intero deployment endpoint. Browser-visible evidence
must cover reusable-link join, access to the Team's Project, a persistent A-B
direct-message exchange, safe shared Team Pulse state when AI is configured, and
cross-client privacy/pause/withdrawal propagation.
API-only or single-client evidence does not satisfy the pilot.

## Privacy defaults

- Default ingress uploads structured semantic checkpoints only. Raw prompts,
  files, diffs, terminal output, and tool input or output require explicit
  per-project authorization before upload.
- Already uploaded material may be processed by cloud models within the user's
  private scope.
- Cloud model processing stays within the authorized Workspace purpose. User
  data is not used to train public/general models and is not reused across
  customers or Workspaces. This is separate from publication visibility.
- Upload, model processing, Stand-in reuse, and publication remain
  separate enforcement and audit semantics, but users do not manage four
  everyday toggles.
- Personal and unbound work defaults to **Private Work**: permitted checkpoints
  upload, processing and Stand-in reuse build the private summary, and
  nothing is published.
- Joining or binding an authorized team project enables **Collaborate with
  Project** by default. That enrollment permits quiet publication of safe
  summaries, status, dependencies, blockers, and coordination signals to the
  team/project scope without per-event prompts.
- Raw prompts, files, diffs, terminal output, and tool input or output never
  become public through either posture.
- Privacy is a straightforward project setting and opt-out/refinement path.
  Users can switch to private or paused, narrow scope, inspect the audit trail,
  and withdraw publication without daily approval prompts.
- Posture changes, publication, and reuse record the actor, destination scope,
  policy version, provenance, and time. Broader automatic publication rules are
  deferred and must be auditable and revocable if later added.
- Raw prompts, responses, chain-of-thought, complete tool payloads, terminal
  logs, file contents, and credentials are not collected as work events by
  default.
- Same-team members can create, read, and send basic persistent 1:1 direct
  messages. DMs are participant-visible only by default. Adding a Stand-in
  makes only subsequent messages Agent-readable; earlier history requires a
  separate grant.
- Group DMs, attachments, reactions, DM search, read receipts, rich Threads,
  federation, and an end-to-end encryption promise are outside the pilot.
- Agent-readable and server-readable content remains participant-scoped unless
  separately published.
- Capability policy, tenant authorization, and visibility checks are enforced
  before every reuse, retrieval, or publication action.

Structured private Work State and Claims retain for 180 days. Explicitly
authorized raw uploads retain for 30 days by default. Published project
summaries retain for the life of the project and may be withdrawn. Users can
delete their own private data at any time; withdrawal cannot erase external
copies already exported by authorized recipients.

Routine diagnostics are content-minimized. Opening or escalating a support case
that requests developer intervention authorizes designated support/developer
staff to inspect only the private data necessary for that ticket and affected
Workspace/project. The access is time-limited, auditable, continuously visible,
and revoked when the case is closed or withdrawn. Team-admin status alone never
grants private user-data access.

Backup-deletion timing, legal holds, regional storage, precise support-role/legal
process, and subprocessor selection/contracts remain deliberate pre-pilot
decisions without weakening the no-training or no-cross-customer/Workspace-reuse
boundary. A non-uploaded, client-only mode is outside the MVP and is not promised.

## Coding Agent integration

Codex, Claude Code, and OpenCode use one canonical MCP tool surface:

```text
stand_in.lookup_team_context
stand_in.current_context
stand_in.request_coordination
stand_in.request_spec_review
stand_in.lookup_decision
stand_in.check_scope
stand_in.report_checkpoint
```

Team Pulse, Project, Spec Review, and Settings all route to one Project-scoped
Coding Agent connection center. It requires an explicit Project selection and
provides a Codex App deep link as the primary path, with a copy-ready
configuration task for Codex, Claude Code, or OpenCode as fallback. The Agent
uses a single-use setup ticket to obtain a Project-scoped Bearer credential,
stores that credential in its native project configuration, and connects to the
canonical `INTERO_PUBLIC_URL`. The same origin is used for invitations, team
join links, setup-ticket exchange, MCP, and Hooks.

Better Auth issues the signed-in member's one-time setup token, stores only its
hash, expires it after ten minutes, and consumes it once. Intero binds the
resulting opaque credential to one member, one Project, one Agent client, and
one local workspace; only its hash is persisted. The connection becomes active
after the native MCP `initialize` request and
`intero.validate_connection` tool call both succeed. Disconnecting revokes all
Project tools immediately while leaving an unprivileged
`intero.connection_status` MCP surface available, so a configured repository
can continue starting coding tasks.

Product runtime requires one canonical `INTERO_PUBLIC_URL`. A LAN pilot may use
an HTTP private IP or mDNS hostname so teammates can open invitations and MCP
connections without installing a private CA. Browsers do not expose Passkeys on
that insecure origin, so invitation activation and login use passwords. This
mode is intended for a trusted network and disposable pilot data. A public or
sensitive deployment should use a real HTTPS domain.
Organization settings display this effective origin but cannot override it
independently of the authentication service.

As an optional acceleration, the Desktop App can configure MCP in one click for
the same three supported clients. It opens the selected repository in the
native client with the same single-use connection task and shows
pending, connected, and disconnected status. Web prompts remain the complete
Desktop-independent path; Desktop adds no required daemon or runtime dependency.

The connection must not require a daemon, desktop process, local socket, or
Electron launcher. Intero does not require or expose absolute local paths by
default and minimizes remote or repository metadata.

Desktop Git awareness is a separate, optional integration path. From **Settings
→ Coding Agent**, the user follows the shared connection center, selects a
repository, chooses one already connected
Coding Agent, and explicitly enables or pauses observation. The Desktop process
listens to `HEAD`, index, and ref metadata events with debounce; it does not run
a timer, enumerate files, read diffs, or store local Work State. A change emits
one branch/short-commit/staged-state checkpoint through the selected Agent's
existing direct-cloud MCP configuration and bounded outbox. Failures are
non-blocking and visible beside the repository. Neither path may block coding or
Git commits.

When cloud ingress is unavailable, the MCP client, Hook client, or explicit CLI
may place the already-permitted event payload in a lightweight client-owned,
encrypted outbox. Each user is limited to 10,000 events or 50 MiB, whichever is
reached first, with a seven-day maximum age. Only schema-permitted payloads may
be queued; raw content requires the project's explicit raw-upload authorization.

Payloads use an OS-provided credential or key store and neither keys nor queue
contents sync to Intero. Each event has a stable client-generated ID and
per-project order metadata. The next MCP or Hook invocation, or an explicit CLI
flush, attempts FIFO delivery with at most three short bounded-exponential-backoff
retries; later invocations resume. Cloud ingestion is idempotent and no retry
daemon runs.

Capacity and TTL eviction removes oldest non-terminal events first and preserves
`work_completed`, `blocker_raised`, and `decision_recorded` events where
possible. A non-sensitive gap
marker records loss. Missing/reset keys, revoked authorization, or now-disallowed
payloads are securely discarded without recovery or export; expired/revoked
tokens require re-authentication. Delivery remains best-effort and never blocks
coding or Git commits.

## Web and optional Desktop clients

The Web application provides the complete collaboration experience: sign-in,
Team Pulse, Stand-in conversations, Coordination, Action Inbox, Spec
Review, Decisions, privacy controls, and integration management.

An optional Desktop App may add a lightweight Git-awareness enhancement. It
observes only user-selected repositories and only compact repository-name,
branch, short-commit, and staged-state signals before sending them to Intero
Cloud. It is an optional packaging enhancement, not a local product core:
browser, management, access, and Coding Agent paths remain complete when the
Desktop App is absent or closed.

## Repository implementation

The active implementation on `main` is cloud-first and Web-first, with the
canonical React product in `apps/web`. The optional Electron app loads that same
Web application and keeps only its shell, preload bridge, packaging, integration
configuration, and explicitly enabled local Git-awareness under `apps/desktop`.
Direct cloud MCP, private Work State, Stand-in processing, collaboration,
authentication, administration, Project work, and Spec Review are implemented
and covered by contract, integration, and browser tests.

The active repository contains no local product runtime or local Work State
implementation. The optional Desktop Git enhancement is deliberately narrow:
while the Desktop App is open, an explicitly enabled repository is observed
through debounced Git metadata events and a bounded branch/commit/staged-state
checkpoint is sent through the existing direct-cloud MCP outbox. It does not
run a daemon, inspect file names or diffs, or persist Work State locally.

Current local development commands remain:

```bash
corepack pnpm install
just up
pnpm dev:pilot
pnpm dev:desktop # optional Electron client plus cloud services
just check
just backup-restore-smoke
```

These commands exercise the current implementation. See
[`docs/PILOT_RUNBOOK.md`](docs/PILOT_RUNBOOK.md) and
[`docs/OPERATIONS.md`](docs/OPERATIONS.md) for the validated local browser/MCP
flow and production-operability boundary.
