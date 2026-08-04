# ADR-0010: Desktop-first product entry and controlled Coding Agent attachment

Status: accepted

Date: 2026-08-05

Builds on: ADR-0004, ADR-0005, ADR-0006, ADR-0007

Supersedes in part: the Web-first product-client priority and optional Desktop
onboarding language in ADR-0006 and ADR-0007

## Context

ADR-0006 correctly removed a required local daemon, sidecar, and Desktop proxy
from Intero's runtime. It also made `apps/web` the canonical product renderer.
Those decisions allowed the Web client and Coding Agents to use one
cloud-authoritative product without a persistent process on every developer
machine.

That runtime decision also made the browser the recommended product entry. In
practice, these are separate questions:

- where durable collaboration, authorization, and Work State run;
- which code owns the human interface;
- where a developer controls the local relationship between a repository,
  Project, and Coding Agent.

The browser can issue a copy-ready connection prompt, but it cannot reliably
detect native Coding Agent installations, select a local repository, preview
and constrain configuration writes, validate the native MCP configuration, or
repair and remove only Intero-managed entries. The user is left to paste a
prompt into an Agent and infer whether configuration, Project scope, and
revocation all succeeded.

This is not a secondary setup inconvenience. Intero's collaboration loop
depends on authorized Coding Agent Work State. The Golden Case begins after
Alex and Priya already have authorized Coding Agent connections, so it does not
prove that a new user can enter that loop safely and understand what is
attached.

The repository already contains useful Desktop foundations:

- an Electron shell that loads the canonical `apps/web` renderer;
- trusted main/preload IPC boundaries;
- Codex, Claude Code, and OpenCode integration detection;
- previewed install, repair, and uninstall of managed integration entries;
- direct-cloud MCP connection validation;
- optional, explicitly enabled, content-minimized Git awareness.

Intero needs to make this local control surface the recommended beginning of
the product without restoring a Desktop runtime dependency or forking the Web
experience.

## Decision

Intero adopts the following product topology:

> **Desktop-first product entry, Web-rendered interface, cloud-authoritative
> runtime.**

These terms have distinct meanings:

- **Desktop-first product entry:** the Electron application is the recommended
  daily entry for a person doing software-engineering work with Coding Agents.
- **Web-rendered interface:** `apps/web` remains the only canonical React
  product renderer and is loaded by both browsers and Electron. Intero will not
  maintain a second Desktop renderer.
- **Cloud-authoritative runtime:** the selected Intero deployment remains the
  authority for identity, authorization, Agent bindings, Work State,
  conversations, coordination, decisions, realtime delivery, and audit.
- **Direct-cloud Agent runtime:** after configuration, Coding Agents connect
  directly to the authenticated cloud MCP endpoint. Electron is not an MCP
  proxy, daemon, sidecar, or required hop.

The browser product remains supported for invitation acceptance,
administration, remote access, headless or remote-development environments,
and recovery when Desktop is unavailable. It is a complete compatibility
surface, but it is not the recommended everyday entry for developers.

### Meaning of Attach

`Attach Coding Agent` is the user-facing name for a controlled binding and
configuration flow. It does not mean process injection, prompt observation,
screen control, or unrestricted access to a running Agent.

An attachment relates:

- the authenticated Intero member;
- one Intero Project;
- one supported Coding Agent client;
- one explicitly selected local repository or workspace;
- one revocable, least-privilege MCP binding.

The native client's `intero` launcher registration may be installed once per
tool, but that registration is only a credential-free shared bridge. It is not
an attachment. Desktop derives an opaque local workspace bucket from the
explicitly selected repository and stores each client's credential, binding
metadata, and outbox there in encrypted form. The absolute path is neither
stored in the bucket metadata nor uploaded. Therefore attaching the same
client in a second repository does not replace or redirect the first
repository's Project connection.

The absolute local path remains local convenience state. Intero uploads no
path, file list, source content, diff, prompt, response, terminal output, or
tool payload merely because the user attaches an Agent.

### Recommended entry flow

The normal product flow is:

```text
open Intero Desktop
→ sign in or accept a Team invitation
→ select a local repository
→ select an authorized Intero Project
→ detect Codex, Claude Code, OpenCode, Cursor, or Grok Build
→ choose Attach for one client
→ preview the exact Intero-managed configuration targets
→ confirm one short-lived Project-scoped connection operation
→ write or merge only the managed MCP entry
→ run MCP initialize and intero.validate_connection
→ show one verified connected state
→ enter the collaboration product
```

Invitation acceptance may begin in a browser. When Desktop is installed, an
approved deep link may hand the authenticated product entry to Desktop without
placing a reusable credential in the URL. A user can always continue in the
browser instead.

### Attachment lifecycle

The product distinguishes local configuration from cloud authorization. A
single vague Connected label is insufficient.

The user-facing lifecycle must express at least:

- Agent not detected;
- Agent detected but not configured;
- configuration awaiting confirmation;
- configuration written and validation pending;
- connected and validated;
- unavailable or stale and needing repair;
- cloud access revoked;
- managed local configuration removed.

Implementation types may use more precise states, but the UI must not claim
Connected merely because a file was written. A binding becomes connected only
after the native client completes MCP `initialize` and
`intero.validate_connection` for the intended member, Project, client, and
workspace identity.

Attach uses the existing short-lived, single-use, Project-scoped connection
ticket and revocable opaque credential model. The local confirmation is bound
to the trusted Electron renderer, exact client, action, and previewed
configuration targets; it expires quickly and cannot be replayed after the
plan changes. After confirmation, Desktop persists the selected repository's
opaque workspace identity before requesting the ticket. The ticket records
that expected identity, and the bridge refuses to exchange it unless the same
identity already exists in the current repository bucket. Running a ticket
approved for repository A from repository B therefore fails before a Project
credential is issued or written.

If the native client supports it, Desktop may open a fresh task or window for
validation. Intero does not promise to attach silently to an already-running
session. Clients that load MCP configuration only at startup may require a new
session, and the UI must say so plainly.

### Repair, reconnect, and detach

- **Repair** reapplies only the current Intero-managed entry after showing the
  targets and receiving confirmation.
- **Reconnect** obtains a new short-lived Project-scoped connection operation
  and validates a new credential. It does not revive a revoked credential.
- **Detach** immediately revokes the cloud binding and then removes only the
  matching Intero-managed local entry. Cloud revocation remains successful and
  visible even if local cleanup fails.
- The shared, credential-free client launcher remains installed when another
  repository may use it. Detach removes the selected repository's matching
  encrypted client connection only after its Project, binding, client, and
  workspace metadata all match; a mismatch fails closed and can be retried.
- Unrelated MCP servers, Coding Agent settings, repository data, and local work
  are never removed.
- Detach does not terminate the Coding Agent or prevent it from coding without
  Intero.
- Every cloud binding, validation, revocation, and Project-scope change remains
  auditable. Local path values do not enter the cloud audit record by default.

Closing or updating Desktop does not disconnect a validated Agent. Revocation
is enforced by the cloud on every Project operation, not by trusting local
configuration state.

### Desktop responsibilities

Electron owns the capabilities that require explicit local authority:

- detect supported native Coding Agent clients and compatible versions;
- allow the user to select a local repository or workspace;
- preview and apply narrowly managed native configuration changes;
- launch native validation where supported;
- correlate local configuration state with authorized cloud binding state;
- present repair, reconnect, detach, and cleanup outcomes;
- provide native notifications and optional bounded Git awareness when those
  capabilities are separately authorized.

Electron does not own:

- a separate product renderer or domain model;
- durable Work State, decisions, conversations, or coordination truth;
- unrestricted filesystem, prompt, terminal, or Agent-session collection;
- a generic Coding Agent process manager;
- a local authorization bypass or service credential;
- a mandatory MCP transport or continuous local daemon.

### Web and remote-development fallback

Some Coding Agents run on a remote host, development container, SSH workspace,
CI worker, or machine without Intero Desktop. The Web connection prompt and
explicit CLI remain supported fallback paths using the same ticket, binding,
validation, revocation, and audit contracts.

The fallback does not weaken the Desktop-first product direction. It prevents
local packaging from becoming a runtime requirement and keeps Intero usable in
software-engineering environments where the browser and Coding Agent do not
share a filesystem.

## Security and privacy invariants

- The Electron renderer may call only allowlisted preload operations; it never
  receives Node.js or unrestricted filesystem access.
- Configuration mutation requires a preview, explicit confirmation, exact
  target digest, trusted sender, expiration, and serialized execution.
- Desktop writes only namespaced Intero-managed entries and preserves unrelated
  user configuration.
- Connection tickets are short-lived, single-use, and scoped to the current
  member, Project, client, intended binding operation, and, for the Desktop
  path, the repository workspace identity approved in the native confirmation.
- Opaque Agent credentials are least-privilege and revocable; the server checks
  current membership and Project access on every operation.
- The cloud does not trust Desktop-reported connection state. Native MCP
  validation and server-side authorization determine the binding state.
- Local repository selection does not authorize raw content upload or Team
  publication.
- Desktop absence or failure cannot widen access, leak data, or make a revoked
  binding usable.

## Implementation boundary

This decision should extend the existing architecture rather than create a new
runtime:

- `apps/web` keeps the canonical UI and conditionally uses the allowlisted
  `window.interoDesktop` capabilities when present;
- `apps/desktop` owns Electron main/preload, packaging, native detection,
  managed configuration, deep links, and local repository selection;
- `apps/mcp-stdio` remains the direct-cloud bridge and connection validator;
- the bridge resolves encrypted connection state by the current local
  repository plus client, never by client alone, and persists the workspace
  identity before ticket issuance; Desktop-bound exchange requires that exact
  pre-existing identity, while uncertain-response retries reuse it;
- server APIs keep issuing one-time tickets and enforcing Project-scoped
  bindings, validation, revocation, and audit;
- the existing Golden Case coordination kernel remains unchanged.

The first delivery slice should connect the currently separate local
integration status and cloud Project-binding status into one Attach flow. It
should not add Agent orchestration, Capability Health, a new project-management
surface, or broad filesystem observation.

## Acceptance evidence

Before Desktop becomes the documented recommended Pilot entry, prove:

1. a fresh supported Desktop build loads the same canonical renderer as Web;
2. a signed-in user selects one repository, one authorized Project, and one
   detected Coding Agent;
3. Attach shows the exact managed configuration targets before mutation;
4. cancel changes nothing;
5. confirmation creates one pending binding and one managed MCP entry;
6. native MCP initialization and validation create one connected binding;
7. API, Desktop, and Coding Agent retries do not duplicate credentials,
   bindings, configuration entries, or validation checkpoints;
8. closing Desktop does not interrupt the direct-cloud MCP connection;
9. Repair preserves unrelated configuration;
10. Detach revokes cloud access even when local cleanup is unavailable, and a
    later cleanup removes only the managed entry;
11. another Project, member, repository, or Agent cannot reuse the ticket or
    credential, including attempting to exchange a Desktop ticket approved for
    repository A while the bridge is running in repository B;
12. Web/CLI fallback can complete the same authorized lifecycle without
    Desktop;
13. one Electron acceptance run performs Attach before the compatible and
    conflict Golden Case branches.

Initial Pilot evidence may be macOS-first. Windows or Linux support must not be
claimed until packaging, native configuration paths, launch behavior, secure
credential storage, repair, detach, and update behavior pass on that platform.

## Consequences

### Positive

- Intero gains one simple recommended beginning instead of asking users to
  understand connection prompts, MCP configuration, and binding state.
- Local configuration changes become visible, narrow, confirmable, repairable,
  and reversible.
- The product can distinguish configuration success from a genuinely
  authorized and validated Agent connection.
- Desktop notifications and local context can support collaboration without
  moving cloud authority or private data into a local daemon.
- The canonical renderer and direct-cloud runtime avoid two products and a
  Desktop single point of failure.

### Costs and risks

- Desktop becomes a first-class release surface requiring code signing,
  packaging, secure updates, deep-link handling, and platform-specific
  acceptance.
- Local client detection and configuration formats may drift across Coding
  Agent versions and require adapter maintenance.
- Browser login, Desktop session transfer, native validation, and cloud binding
  state create more lifecycle edges than a copy-only prompt.
- Remote workspaces cannot always be controlled by a local Desktop and must use
  the fallback path.
- The UI must avoid overstating control over a third-party Agent process or
  session.

These costs are accepted because controlled Agent attachment is part of the
product's trust and activation model, not a decorative packaging enhancement.

## Rejected alternatives

### Keep Web copy-prompt onboarding as the recommended path

Retained as fallback but rejected as the primary experience. It cannot provide
one trustworthy local configuration and validation lifecycle.

### Put Electron or a daemon on the MCP runtime path

Rejected. It would make shutdown, update, sleep, and device failure interrupt
otherwise valid Agent work and would exclude remote or headless environments.

### Build a separate native Desktop renderer

Rejected. It would split product behavior, tests, accessibility, and design
between Web and Desktop.

### Attach to and monitor arbitrary running Agent processes

Rejected. Intero configures an authorized MCP relationship; it does not inject
into third-party processes or collect their private session activity.

## Transition

Until the acceptance evidence above passes, the current Web and prompt flow
remain operational and documentation must distinguish the accepted target
from implemented behavior. Implementation should then update the Pilot runbook,
README, packaging, and Golden Case entry sequence together so Desktop-first is
one tested recommendation rather than a documentation-only claim.
