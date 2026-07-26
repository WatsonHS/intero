# ADR-0006: Cloud-first, Web-first runtime with private-by-default cloud data

Status: accepted

Date: 2026-07-25

Supersedes: ADR-0001, ADR-0002, ADR-0003

Updated by: ADR-0007 for per-recipient invitation onboarding and the Phase 4–5
product model

## Context

Intero's first implementation coupled private Work State to a required local
daemon, a Local Stand-in sidecar, and an Electron distribution. That
topology made deployment location stand in for disclosure: local data was
private, while synchronized cloud data was treated as public.

The product no longer uses that coupling. Intero must be useful from the Web and
from Coding Agents without requiring a desktop application or persistent local
runtime. At the same time, uploading data for durable storage or model
processing must not make that data visible to a team. For the pilot, cloud-first
describes the service topology rather than a single vendor-hosted origin: a team
may use an Intero-operated or self-hosted cloud deployment without changing the
privacy or runtime model.

## Decision

Intero is cloud-first and Web-first.

- The pilot is a thin vertical slice behind durable ports, not a throwaway
  topology. Canonical Agent event and Work State contracts remain
  transport-independent.
- Implemented adapters are `ModelGateway` with Vercel AI SDK,
  SpiceDB-backed `AuthorizationPort`, Centrifugo-backed `RealtimePort`,
  MinIO-backed `ObjectStorePort` with product uploads disabled, Graphile-backed
  durable `JobRunnerPort` plus transactional outbox, and
  `CoordinationTransport` using the bounded Project-internal protocol.
  Additional providers, Temporal, and general A2A gateway/federation remain
  deferred.
- Ports are not decorative interfaces: pilot adapters make the two-day vertical
  slice work, contract tests define required behavior, and replacements must
  pass those tests. Canonical Agent events, Work State, and domain policy cannot
  depend on adapter-specific types.
- The model loop generates safe Stand-in summaries and bounded
  coordination suggestions from authorized structured Work State only. It
  cannot use unauthorized raw content, cross Organization/Workspace boundaries,
  auto-commit, or become a general autonomous Agent.
- Coding Agents connect directly to the authenticated MCP endpoint of their
  selected Intero team deployment whenever the service is online.
- The product assumes an already-running Intero deployment. The team
  administrator enters its base URL in Web `/setup` and validates connectivity
  before creating or joining the team
  context, creating the first project, and enabling invitations. Validation
  errors are explicit and actionable without prescribing a wire protocol.
- Normal onboarding uses per-recipient invitations in **Team Settings → Member
  Management**. An Organization administrator enters the recipient's display
  name and exact email; Intero creates a one-time, expiring, revocable,
  email-bound account-activation link with `pending`, `accepted`, `expired`, or
  `revoked` lifecycle and copy, regenerate, and revoke actions. V1 requires no
  SMTP.
- The matching-email recipient accepts through the short **Accept Invitation**
  surface. The link only bootstraps first credential setup and is not valid for
  normal login. Passkey is the primary normal login; email plus password is the
  fallback. Product Magic Link login is removed. Membership associates the Web
  experience, credentials, and Agent/MCP connection instructions with the
  administrator-approved Intero deployment endpoint and team automatically, so
  members do not manually enter a server URL. Reusable team-join links remain
  historical Pilot evidence only.
- Password recovery is not implemented. A future administrator/manual recovery
  link or optional SMTP-backed recovery path requires a separate decision.
- After identity and invite association, the user still explicitly selects the
  Workspace and project binding. Deployment-origin association must not infer a
  repository or project binding.
- Organization is the structural tenant boundary and owns Projects. First Setup
  creates one Organization implicitly or with a simple name; it is not a
  prominent daily UI or permission surface.
- Team contains members. Team and Project have a many-to-many association: a
  Project may have one primary/display Team and zero or more additional
  participating Teams. V1 membership in any associated Team is sufficient to
  view and participate in the Project. Individual Project roles, ACLs, and
  restricted visibility are post-pilot.
- The Intero deployment endpoint and AI-provider configuration may be
  Organization-scoped. Per-recipient email-bound invitations are Team-scoped.
- Agent connections, Claims and Work State, Team Pulse, collaboration posture,
  and project conversation bind to Project identity independently of Team.
  Cross-Team Projects aggregate participating-Team context. Direct messages are
  relationships between members of the same Team. Private raw-data upload,
  reuse, and publication boundaries remain independently enforced.
- Intero cloud runs the Stand-in, Claim resolution, Work State,
  coordination, review, and durable memory logic.
- Default ingress accepts structured semantic checkpoints only. Raw prompts,
  files, diffs, terminal output, and tool input or output require explicit
  per-project authorization before upload.
- The frozen pilot protocol has exactly ten semantics: `work_started`,
  `work_progressed`, `decision_recorded`, `dependency_declared`,
  `blocker_raised`, `review_requested`, `work_completed`,
  `coordination_requested`, `artifact_produced`, and `validation_completed`.
- Every checkpoint has a bounded safe summary plus stable client-generated
  event/idempotency ID, Project identity, authenticated Agent identity,
  source/provenance, occurred-at time, and schema version. Plan changes belong
  inside `work_progressed`, not a separate event.
- Dependency, blocker, review, and coordination/conflict signals may feed
  bounded automatic coordination. Artifact, validation, and completion feed
  Work State, status, and safe Team Pulse projection.
- Raw prompts/files/diffs/terminal/tool logs and low-level file/resource touch
  events are excluded from the canonical protocol.
- Intero cloud may process already uploaded material within the user's private
  cloud scope. Storage and private processing do not authorize Stand-in
  reuse or human disclosure; both remain separate controls.
- Cloud models may process user data only within the user's authorized Workspace
  scope. User data is not used to train public or general models and is not
  reused across customers or Workspaces. Model processing remains independent
  from publication visibility.
- Cloud AI provider setup is a separate team-administrator step. The
  administrator configures the provider endpoint, secret API key, and default
  model together in an **AI Provider** section. The provider endpoint is
  distinct from the administrator-entered Intero deployment base URL and from
  the derived Agent/MCP connection endpoints.
- The provider key is stored only server-side using appropriate encryption and
  secret handling and is never returned to browsers or members. The
  administrator can test the connection, rotate or replace the key, or disable
  the provider.
- Without a configured and available provider, identity, team/project
  membership, invitations, and basic human collaboration and chat remain
  available. AI Stand-in functionality, automated summaries, Agent Work
  State projection, Team Pulse automation, Agent binding, and other AI-derived
  coordination features remain disabled.
- Setup visibly distinguishes **Basic collaboration ready** from
  **Stand-in needs administrator model configuration** and provides
  actionable administrator status when the provider is missing, invalid,
  disabled, or unavailable. Provider configuration gates AI activation, not the
  whole Workspace or member invitations.
- The underlying upload, processing, Stand-in-reuse, and publication axes
  remain independently enforced and audited, but they are not presented as four
  everyday toggles.
- Team Pulse is a person-per-column view of authorized current active work
  items. Each column header contains a plain, non-interactive Stand-in summary
  based on that person's active work, blockers, recent outcomes, and freshness,
  plus concurrently active and blocked counts. The summary exposes no citations,
  links, click-through, or state-setting action.
- Work cards within a person's column are peer items ordered for reading. Pulse
  has no primary, main, secondary, subordinate, or focus work/task model and
  stores no inferred rank. An **N more** disclosure is visual compaction only,
  not hierarchy or domain state.
- Personal spaces and unbound work default to **Private Work**. Permitted
  structured checkpoints upload silently; private cloud processing and
  Stand-in reuse maintain the user's private work summary, and nothing is
  published.
- Joining or explicitly binding a Workspace to an authorized team project
  enables **Collaborate with Project** by default. Project enrollment is the
  user's authorization for quiet publication of safe summaries, status,
  dependencies, blockers, and coordination signals to that team/project scope
  without per-event approval prompts.
- Privacy remains a straightforward project setting. A user may refine the
  authorized scope or switch to an explicit private or paused posture. The
  product shows concise current posture and visibility, keeps an audit trail,
  and supports inspection and withdrawal of published state.
- Neither posture makes raw prompts, files, diffs, terminal output, or tool input
  or output public. Uploading those data classes still requires explicit
  per-project authorization and publication is not implied.
- General rule-based auto-publication beyond the team-project collaboration
  posture is deferred and must be attributable, auditable, and revocable if
  introduced later.
- Explicit structured blocker, dependency, review, conflict, or coordination
  signals may automatically open a Project-scoped Stand-in coordination
  Thread/request with safe summary/context and candidate next steps. The
  Stand-in may collect responses and drive clarification in that Thread.
- It cannot cross Project scope, disclose raw content, change priorities, act
  externally, make irreversible commitments, or declare a human/business
  decision final. Outcomes remain visible/auditable, and commitments require
  responsible-participant confirmation.
- A posture change, publication, or reuse decision records its actor, scope,
  policy version, provenance, and time. Upload alone is never evidence of
  consent to publish.
- Structured private Work State and Claims retain for 180 days. Explicitly
  authorized raw uploaded content retains for 30 days by default. Published
  project summaries retain for the life of the project and remain withdrawable.
  Users may delete their own private data at any time.
- Withdrawal or revocation stops future authorized use and visibility but cannot
  promise deletion from external copies already exported by authorized
  recipients.
- Routine diagnostics are content-minimized and may run automatically. When a
  user deliberately opens or escalates a support case requesting developer
  intervention, that action contextually authorizes designated support or
  developer staff to inspect only the private data necessary for the stated
  issue. No additional consent modal is required in that normal flow.
- Support access is scoped to the ticket and affected Workspace/project,
  time-limited, auditable, continuously visible to the user, and revoked when
  the user closes or withdraws the case. Team administrators do not gain private
  user-data access merely by being administrators.
- MVP Agent clients use least-privilege, revocable personal or device-scoped
  credentials. MCP and event-ingress permissions are separate scopes; neither
  credential class inherits the other's authority. Exact OAuth or transport
  mechanics remain an implementation decision.
- Users do not manually generate, copy, or manage personal API keys for Agent
  onboarding. From a bound project page, **Connect Agent** provides a copy-ready
  one-time prompt tailored to Codex, Claude Code, or OpenCode.
- The user pastes the prompt into the selected Coding Agent. The Agent performs
  its own MCP configuration and project binding using the administrator-approved
  Intero deployment endpoint carried by team context, then reports connection
  success to Intero.
- Internally, onboarding uses a short-lived, single-use, project-scoped
  connection ticket. It authenticates and bootstraps a revocable connection but
  is never presented as a user-managed key.
- The project UI shows connection status and supports disconnect and reconnect.
  Revocation invalidates the Intero connection without blocking local coding.
  The pilot supports these three tailored clients; generic MCP client onboarding
  is not promised.
- The optional Desktop App may accelerate onboarding with one-click MCP
  configuration for the same three clients. It uses the same approved Intero
  endpoint and short-lived, single-use, project-scoped connection ticket, writes
  the selected client's MCP configuration, and shows success, failure, and
  disconnect status. Web prompts remain the universal Desktop-independent path,
  and this action adds no required daemon or runtime dependency.
- Repository context uses explicit user-selected Workspace and project binding.
  Intero does not require absolute local paths and does not collect or expose
  them by default. Remote and repository metadata are minimized to what binding
  and audit require.
- The Web application is the primary product client. The Desktop App is
  optional. While open in the foreground, it may collect additional context and
  produce better work summaries only after explicit opt-in. As a separately
  authorized packaging enhancement, it may provide local Git awareness for
  user-selected repositories and emit only compact permitted branch, commit,
  and Git-state signals to cloud ingress. It is never required for collection,
  MCP, management, access, or Stand-in runtime infrastructure, and does not
  restore a local Stand-in, Work State, IPC service, long-lived daemon, or local
  persistent-state database.
- Git and Coding Agent lifecycle hooks may send compact, content-safe events to
  a separate authenticated cloud event endpoint. MCP failures return a visible,
  non-blocking failure. The MCP client, Hook client, or explicit CLI may write an
  already-permitted event payload to a lightweight client-owned outbox. It never
  runs continuously, observes system activity, or depends on the Desktop App.
- The per-user outbox holds at most 10,000 events or 50 MiB, whichever limit is
  reached first, and expires events after seven days. It retains only
  schema-permitted payloads and never retains raw content unless the project has
  explicit raw-upload authorization.
- Outbox payloads are encrypted at rest using an OS-provided credential or key
  store. Queue keys and payloads never synchronize to Intero cloud. If the key
  is unavailable or reset, or authorization is revoked, the client securely
  discards unreadable or now-disallowed data with no recovery or export promise
  and later sends only a non-sensitive delivery-gap or freshness marker where
  possible.
- Each queued event has a stable client-generated ID and per-project ordering
  metadata; cloud ingestion is idempotent. On the next MCP invocation, Hook
  invocation, or explicit CLI flush, the client attempts FIFO delivery with at
  most three short in-process retries using bounded exponential backoff. Later
  invocations resume delivery. There is no persistent retry daemon.
- When capacity or TTL is exceeded, the outbox evicts the oldest non-terminal
  events first, preserves `work_completed`, `blocker_raised`, and
  `decision_recorded` events where
  possible, and records a non-sensitive gap marker. Expired or revoked
  credentials stop delivery and require re-authentication; credentials are not
  recovered automatically. Coding and Git commits remain non-blocking and
  delivery is best-effort.
- A non-uploaded/client-only work mode is deferred and outside the MVP. The
  cloud-first privacy model does not promise offline private Work State.
- Pilot end-to-end acceptance requires two isolated browser or client contexts
  representing distinct team users against the same administrator-approved
  Intero deployment endpoint. Browser-visible evidence must prove an
  admin-created invitation, matching-email acceptance, basic human
  conversation/collaboration between the users, safe shared Team Pulse
  visibility when AI is configured, and
  privacy/pause/withdrawal propagation to the other client. API-only or
  single-client proof is insufficient.

The cloud Stand-in uses one identity across private and shared scopes.
“Private” and “shared” describe authorization and permitted use, not separate
local and public runtimes.

The pilot includes basic persistent same-team 1:1 direct messages, visible only
to the two participants by default. It does not promise group DMs, attachments,
reactions, search, read receipts, rich Threads, federation, or end-to-end
encryption. Adding a Stand-in to that same conversation makes only
subsequent messages Agent-readable; earlier history remains inaccessible unless
separately granted. Agent-readable and server-readable do not imply
team-visible.

## Consequences

Positive:

- Coding Agents and the Web product work without installing or running a daemon
  or Desktop App.
- Private cloud storage can support multi-device continuity and model-assisted
  Work State without silently publishing sensitive material.
- Silent project defaults keep everyday privacy understandable without
  sacrificing enforceable policy and audit semantics.
- One cloud runtime removes local/public synchronization and freshness
  ambiguity.
- Optional desktop capabilities can evolve without becoming product
  availability dependencies.

Negative:

- Cloud authentication, tenant isolation, retention, deletion, model-provider
  policy, and publication enforcement become primary trust boundaries.
- Offline delivery is best-effort and bounded; Intero does not promise
  continuously running local processing or offline private Work State while the
  cloud service is unreachable.
- Repository identity and Workspace authorization can no longer rely on a local
  daemon as the sole authority.
- Existing local-runtime implementation evidence does not validate this
  architecture and must remain labeled as historical.
- Self-hosted pilot teams require provisioned infrastructure followed by
  administrator entry and connectivity validation of the Intero deployment base
  URL in `/setup` before team activation and invitations.

## Deferred implementation and pre-pilot decisions

- Exact issuance and transport mechanics for personal or device-scoped
  credentials, without weakening the separate least-privilege MCP and
  event-ingress scopes or the user-hidden, short-lived, single-use,
  project-scoped connection-ticket contract.
- The event endpoint's closed schemas, size limits, authentication mechanics,
  and installation details, consistent with scoped credentials and idempotent
  ingestion.
- Invitation defaults beyond the implemented product contract, including the
  default expiry duration and optional future SMTP delivery/status semantics.
- Password recovery through an administrator/manual recovery link or optional
  SMTP delivery. No current recovery implementation is claimed.
- Detailed provider secret-management mechanics and multi-provider routing are
  outside the pilot contract. The pilot supports one configured cloud AI
  provider endpoint, secret key, and default model with test, rotate/replace,
  disable, and explicit AI-disabled/setup-status behavior.
- Backup-deletion timing, legal-hold handling, regional storage, precise support
  staff role mapping and legal process, and subprocessor selection and contracts.
  These require an explicit pre-pilot implementation or governance decision and
  may not weaken the no-training or no-cross-customer/Workspace-reuse boundary.
- Rule-based auto-publication beyond project binding and
  non-uploaded/client-only operation are post-MVP possibilities, not MVP
  commitments. The team-project **Collaborate with Project** posture is the only
  MVP quiet-publication rule.
- Bulk email or CSV invitations, SCIM provisioning, and domain-based automatic
  join are outside the pilot.
- Productized self-deployment is outside the pilot: no deployment package,
  Docker or install wizard, infrastructure provisioning workflow, DNS/TLS
  guidance, tenant-provisioning automation, or end-user self-hosting
  documentation is promised.
- Multi-Organization switching, advanced Organization administration, billing,
  enterprise identity, and advanced cross-Team governance are outside the
  pilot.
- In-product trial feedback forms, issue capture, product analytics dashboards,
  and feedback-triage workflows are outside the pilot. Members provide pilot
  feedback directly to the product owner outside Intero.

## Rejected alternatives

- Keep the daemon or Desktop App as a required MCP relay.
- Treat every cloud-stored object as team-visible.
- Allow model processing or Stand-in access to imply publication.
- Preserve separate Local and Public Stand-in identities or runtimes.
- Design the hook event protocol inside this topology decision.
- Ask ordinary members to discover or type the Intero deployment URL already
  approved by their team administrator.
- Conflate Intero's deployment origin, the cloud AI provider endpoint, and
  Agent/MCP connection endpoints.
- Return the cloud AI provider secret to a browser or ordinary member.
