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
- The Desktop App is optional and foreground-only. While open, it may enhance
  context collection and summaries after explicit opt-in. It performs no silent
  background observation and is never required for collection, MCP, management,
  access, or Stand-in runtime infrastructure.
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
The product requirements live in
[`docs/brainstorms/2026-07-24-intero-product-requirements.md`](docs/brainstorms/2026-07-24-intero-product-requirements.md).

## Post-Pilot product sequence

Phases 1–5 are implemented on `main`:

1. Phases 1–3: cloud collaboration core and production-operability foundation.
2. Phase 4: invite-only registration, onboarding, administration, and Settings.
3. Phase 5: Project work management, PI/Sprint planning, and Spec Review.

Phase 6 Action Inbox/notifications/search and Phase 7 deeper bounded Agent
automation remain future product scope.

Project content is Agent-first. A connected Agent with Project access may create
or update authorized Features, Work Items, and Specs through MCP, with actor,
time, provenance, immutable history, and revert behavior. Manual editing remains
available. Agents are never assignees and cannot change membership, roles, Team
associations, or visibility. Users can disconnect or revoke Agent Project
access.

Post-Pilot onboarding is invite-only through **Team Settings → Member
Management**. An admin enters the recipient's display name and exact email;
Intero creates an expiring/revocable email-bound link with
pending/accepted/expired/revoked lifecycle. V1 provides copy-link, regenerate,
and revoke without requiring SMTP; the admin shares the link through their own
channel.

The recipient uses a short **Accept Invitation** flow, confirms the
Organization/Team/name/email, and must log in or register with the invited
email. After joining, they see accessible Projects and may enter a Project or
Team Pulse, with an optional skippable **Connect Coding Agent** step. Deployment
endpoint, model keys, governance, invitations, and admin Settings are not shown.
The pre-set name becomes the initial display name and remains editable in
Personal Settings.

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

The pilot assumes an already-running Intero deployment. In product Setup, a team
administrator enters its base URL and validates connectivity before creating or
joining the team context, creating the first project, and enabling invitations.
Setup shows actionable validation errors without assuming a particular
transport protocol.

In **Team Settings → Member Management**, an Organization administrator creates
one expiring, revocable invitation for a recipient's display name and exact
email. V1 exposes copy, regenerate, and revoke without requiring SMTP. The
recipient accepts through the short **Accept Invitation** surface and must
authenticate or register with the matching email. Membership inherits the
administrator-approved Intero endpoint and team context; ordinary members do
not type the server URL. Reusable Pilot join links are historical and are not
the current onboarding path. Bulk email or CSV invitations, SCIM provisioning,
and domain-based automatic join remain deferred.

Organization is the structural tenant boundary and owns Projects. First Setup
creates one Organization implicitly or with a simple name. Teams contain
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
AI Stand-in, automated summaries, Agent Work State projection, automated
Team Pulse, Agent binding, and other AI-derived coordination features remain
disabled. Setup visibly distinguishes **Basic collaboration ready** from
**Stand-in needs administrator model configuration** and shows actionable
administrator status; provider setup does not block invitations or basic chat.

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

From a bound project page, **Connect Agent** provides a copy-ready one-time
prompt tailored to Codex, Claude Code, or OpenCode. The user pastes it into the
Agent; the Agent configures its own MCP connection and project binding, uses the
administrator-approved Intero deployment endpoint inherited from team context,
and reports connection success to Intero. Users do not generate, copy, or manage
personal API keys.

Internally, the prompt bootstraps authentication through a short-lived,
single-use, project-scoped connection ticket that is not surfaced as a
user-managed key. The project UI shows connection status and offers disconnect
and reconnect. Revocation invalidates the Intero connection without blocking
local coding. Generic MCP clients are outside the pilot.

As an optional acceleration, the Desktop App can configure MCP in one click for
the same three supported clients. It uses the same approved Intero endpoint and
short-lived project ticket, writes the selected client's MCP configuration, and
shows success, failure, and disconnect status. Web prompts remain the complete
Desktop-independent path; Desktop adds no required daemon or runtime dependency
and is never required for team operation.

The connection must not require a daemon, desktop process, local socket, or
Electron launcher. Intero does not require or expose absolute local paths by
default and minimizes remote or repository metadata.

Automatic Git or lifecycle observation is a separate, optional integration path
with a separately scoped credential. It remains content-safe and fails open
after bounded in-process retries. MCP returns a visible, non-blocking failure.
Neither path may block coding or Git commits.

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

While open in the foreground, an optional Desktop App may add explicitly
authorized device-local context and richer work summaries. It performs no silent
background observation. Browser, management, access, and Coding Agent paths
remain complete when the Desktop App is absent or closed.

## Repository and historical implementation

The active implementation on `main` is cloud-first and Web-first, with the
canonical `apps/desktop` renderer also serving the browser product. Direct cloud
MCP, private Work State, Stand-in processing, collaboration, authentication,
administration, Project work, and Spec Review are implemented and covered by
contract, integration, and browser tests.

The repository still retains historical local-runtime artifacts including
Electron packaging, `interod`, a Local Stand-in sidecar, SQLCipher, and local MCP
bridging. They remain compatibility and historical implementation evidence, not
requirements for the active cloud path.

Current local development commands remain:

```bash
corepack pnpm install
just up
just check
just backup-restore-smoke
```

These commands exercise the current implementation. See
[`docs/PILOT_RUNBOOK.md`](docs/PILOT_RUNBOOK.md) and
[`docs/OPERATIONS.md`](docs/OPERATIONS.md) for the validated local browser/MCP
flow and production-operability boundary.
