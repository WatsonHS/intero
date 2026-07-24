# Intero MVP Implementation Plan

Status: proposed

Date: 2026-07-24

Inputs:

- `docs/brainstorms/2026-07-24-intero-product-requirements.md`
- `docs/ARCHITECTURE.md`

## 1. MVP outcome

The MVP proves one end-to-end coordination loop:

```text
Engineer starts Coding Agent work in an authorized Workspace
→ hooks and semantic checkpoints reach the Local Representative
→ the Representative maintains a private Workstream
→ meaningful state appears in Team Pulse
→ the Coding Agent requests team context at a branch point
→ Representatives coordinate in a visible Thread
→ the Coding Agent receives a structured result
→ a high-impact plan can become a versioned Spec Review
```

The MVP is successful only if this loop works without collecting a raw Coding
Agent session and while the Public Representative can provide an honest,
freshness-labeled fallback when the user's machine is offline.

## 2. Delivery principles

- Build vertical slices before broad feature completeness.
- Treat privacy and authorization as acceptance gates, not later hardening.
- Keep Local and Public Representative behavior contract-compatible.
- Make deterministic state reduction work before adding model interpretation.
- Start with OpenCode as the richest hook integration, then bring Codex and
  Claude Code to the same adapter contract.
- Keep project management modular and minimal.
- Do not implement A2A Gateway, local Embeddings, mobile, or full Jira parity in
  the MVP.

## 3. Milestone map

```mermaid
flowchart LR
    M0["M0 Foundation"] --> M1["M1 Local Work State"]
    M1 --> M2["M2 Shared Platform"]
    M2 --> M3["M3 Representative Coordination"]
    M3 --> M4["M4 Spec Review and Attention"]
    M4 --> M5["M5 Pilot Hardening"]
```

## 4. M0 — Repository and contract foundation

### Deliverables

- Initialize the pnpm/Turborepo and Cargo workspaces.
- Create Electron, server API, server Worker, Local Representative, and
  `interod` application shells.
- Add a root Justfile for setup, generation, lint, test, and local development.
- Establish Zod-to-OpenAPI generation and the generated Rust/TypeScript client
  checks.
- Add shared domain identifiers, clocks, idempotency keys, and event envelopes.
- Stand up local PostgreSQL, SpiceDB, Centrifugo, and S3-compatible development
  dependencies.
- Add OpenTelemetry, Pino, and Rust `tracing` bootstraps with content-safe
  defaults.

### Exit criteria

- One command starts all development dependencies and application shells.
- OpenAPI generation is deterministic and CI detects drift.
- TypeScript and Rust tests run from the root.
- Telemetry tests prove message, prompt, file, and secret fields are excluded.
- No application module imports another module's database implementation.

## 5. M1 — Local private plane and Coding Agent adapters

### M1.1 Privacy daemon

- Implement local IPC over Unix Domain Socket and Windows Named Pipe.
- Add OS-user-bound local authentication.
- Add SQLCipher storage and OS credential-store key management.
- Implement Workspace enrollment, repository identity, trusted-parent rules,
  worktree discovery, sensitive-path defaults, and revocation.
- Implement local event queue and synchronization cursor.
- Expose bounded read-only workspace and Git tools.

### M1.2 Local Representative

- Add the event-driven Representative loop using `representative-core`.
- Implement deterministic Workstream and Claim reducers before model calls.
- Add structured local memory and SQLite FTS5.
- Add model egress modes: managed API, user-provided API, and disabled.
- Add Context Builder, prompt compiler, run budgets, and provenance.
- Implement meaningful public-projection diff generation.

### M1.3 Adapter contract

- Implement the stateless MCP stdio bridge.
- Define the common MCP tools and checkpoint schema.
- Implement an adapter conformance test suite around Canonical Work Events.
- Implement OpenCode integration:
  - managed global plugin;
  - user-level instruction file;
  - MCP registration;
  - session, file, todo, validation, and tool lifecycle normalization.
- Implement Claude Code and Codex adapters with graceful capability detection.
- Add reversible install, upgrade, diagnostics, and uninstall operations.

### Exit criteria

- Unregistered directories produce zero persisted work signals.
- Registered Workspace events create and update multiple local Workstreams.
- `report_checkpoint` produces a sourced Claim rather than directly overwriting
  state.
- Hooks never persist raw prompts, assistant responses, tool input/output,
  terminal logs, or file contents as events.
- Local Work State remains queryable with the network and model disabled.
- OpenCode, Codex, and Claude Code can all invoke the same MCP contract.

## 6. M2 — Shared platform, chat, and Team Pulse

### M2.1 Identity and authorization

- Implement Better Auth email magic link, passkey, optional GitHub account
  linking, and Electron device authorization.
- Introduce stable Intero principals independent of auth-provider IDs.
- Add organizations, memberships, projects, and project-management module
  boundaries.
- Implement RLS tenant boundaries.
- Add SpiceDB schemas and the shared Authorization port.
- Implement structured Capability Grants and policy-version audit.

### M2.2 Domain and synchronization

- Implement Workstreams, Claims, resolved Work State, public projection,
  Artifacts, and typed relations.
- Use one transaction for domain updates, Activity Events, and outbox entries.
- Add Graphile Worker idempotency and retries.
- Implement UUIDv7 client IDs, organization offsets, Thread sequence, and
  cursor-based repair.
- Add public full-text and trigram search; keep vector indexing optional.

### M2.3 Conversation platform

- Implement Representative Threads, direct/group Human Threads, project Rooms,
  and structured Thread foundations.
- Integrate Centrifugo delivery with API gap repair.
- Implement OpenMLS for Human-only Threads.
- Implement the explicit transition from Human-only to Agent-readable when a
  Representative is added, including the visible boundary event and withheld
  history.
- Add attachments through S3-compatible storage with checksum and scan gates.

### M2.4 Core desktop surfaces

- Implement Team Pulse as the default route.
- Implement a person's concurrent Workstreams with freshness and confidence.
- Implement Representative Thread with Local/Public runtime and freshness
  indicators.
- Implement project Room and ordinary IM conversation behavior.
- Implement integration, Workspace, privacy, and model-policy settings.

### Exit criteria

- A local projection reaches the correct organization and updates Team Pulse.
- A user can sign in with magic link, add a passkey, and complete Electron device
  authorization on supported desktop platforms.
- SpiceDB and RLS deny cross-project or cross-organization reads.
- Representative Thread messages sync across devices and are server-readable.
- Human-only messages remain E2EE until the explicit Agent-readable transition.
- Local offline state is visible as stale rather than silently treated as fresh.

## 7. M3 — Public Representative and transparent coordination

### M3.1 Public Representative jobs

- Implement event-driven Public Representative runs through Graphile Worker.
- Reuse Context Builder, Claim Resolver, prompt compiler, and policy contracts
  from `representative-core`.
- Serialize one Thread and one Workstream while permitting unrelated
  Workstreams to run concurrently.
- Add model, tool, step, token, retry, and per-user budget enforcement.
- Implement public fallback responses from synchronized state.

### M3.2 Coordination Protocol

- Implement strongly typed Action Envelopes with human-readable messages.
- Implement status query/response, ownership declaration, dependency request,
  conflict notice, coordination request, correction, withdrawal, and human
  escalation.
- Enforce Capability Grants at command execution.
- Link Coordination Threads to Workstreams, Claims, evidence, participants, and
  result.
- Return bounded structured coordination results through MCP.

### M3.3 Action Inbox

- Create Action items only for human decisions, scope expansion, consequential
  commitments, unresolved high-impact contradictions, review requests, and
  imminent blockers.
- Keep ordinary progress in Team Pulse.
- Add in-app and system-notification thresholds.

### Exit criteria

- A Coding Agent can request coordination and receive a structured answer.
- Every Representative action is visible in the linked Thread and has an
  enforceable grant reference.
- A Representative can declare ownership only inside existing authorized scope.
- Scope expansion creates one actionable user item instead of an Agent promise.
- Job retry cannot duplicate a message, action, ownership claim, or Inbox item.
- Public fallback states the freshness of its information.

## 8. M4 — Spec Review, Decisions, and durable memory

### M4.1 Spec authoring and revisions

- Implement Markdown Spec editing with CodeMirror and preview.
- Persist versioned Spec revisions.
- Generate stable block records from parsed Markdown for revision-specific
  comments.
- Implement revision diff summaries and affected-reviewer calculation.

### M4.2 Review

- Allow Coding Agents to request Spec Review through MCP.
- Let the Representative publish the review and select or propose affected
  reviewers.
- Distinguish Representative impact analysis, human acknowledgement, approval,
  conditional approval, and changes requested.
- Invalidate only approvals affected by a material revision.

### M4.3 Decisions and memory

- Generate Decision Records from confirmed Spec and Coordination outcomes.
- Add supersession and affected-scope relationships.
- Add Workstream, Claim, Decision, Spec, Artifact, and participant retrieval to
  Context Builder.
- Add user-visible provenance navigation.

### Exit criteria

- A Coding Agent can turn a plan into a Review request without directly
  publishing or approving it.
- Inline comments remain attached to the revision and block they reviewed.
- A material public-interface change invalidates affected review only.
- A Representative review never counts as human approval.
- Confirmed outcomes are retrievable as versioned Decisions with sources.

## 9. M5 — Pilot hardening

### Reliability

- Exercise desktop update rollback and daemon/sidecar version compatibility.
- Add database backup and restore tests.
- Add local queue crash recovery and public Worker retry chaos tests.
- Validate Centrifugo gap repair and cursor compaction.
- Validate S3 scan failure and orphan cleanup.
- Run SpiceDB-unavailable fail-closed tests.

### Privacy and security

- Threat-model local IPC, Workspace path escape, symlink traversal, integration
  configuration injection, prompt injection into Action Envelopes, and stale
  Capability Grants.
- Add privacy regression fixtures for every Coding Agent adapter.
- Verify logs, traces, crash reports, and diagnostic exports against the
  telemetry allowlist.
- Validate passkeys on Windows Hello, macOS, and supported Linux browser flows.

### Pilot

- Select one engineering team and one cross-cutting feature.
- Enroll only the repositories needed for that feature.
- Capture baseline manual coordination behavior.
- Run Team Pulse, one Coding Agent coordination branch, and one Spec Review.
- Collect false publication, missed state, unnecessary Inbox item, stale answer,
  and unauthorized action metrics.

### Exit criteria

- The pilot team can reconstruct why a public state, ownership action, or review
  request exists from visible evidence.
- No raw Coding Agent transcript crosses the privacy boundary.
- False or noisy public updates are correctable without deleting history.
- Offline Local and unavailable model modes fail usefully.
- The team reports less manual status chasing on the pilot feature.

## 10. Cross-cutting test matrix

| Area | Unit | Integration | End-to-end |
|---|---|---|---|
| Claim resolution | reducer fixtures | SQLite/PostgreSQL parity | conflicting completion report |
| Workspace privacy | path-policy tests | daemon IPC | unregistered directory produces nothing |
| Agent adapters | event fixtures | managed integration install | checkpoint to Team Pulse |
| Authorization | policy tests | RLS + SpiceDB | cross-project denial |
| Coordination | command tests | Worker idempotency | Agent branch to visible result |
| Conversation | message state | Centrifugo repair | Human-only to Agent-readable boundary |
| Spec Review | revision matching | storage and review state | material revision reconfirmation |
| Offline | queue tests | reconnect replay | public freshness fallback |

## 11. Migration and replacement boundaries

The MVP must keep these dependencies behind ports:

- Graphile Worker behind Queue.
- Centrifugo behind Realtime.
- PostgreSQL search behind Search.
- SpiceDB behind Authorization.
- S3-compatible storage behind ObjectStore.
- Vercel AI SDK providers behind Model.
- Coding Agent specifics behind IntegrationAdapter.

The plan does not build alternative implementations. It only prevents domain
types from depending on vendor-specific identifiers.

## 12. Explicitly excluded from this plan

- A2A Gateway implementation.
- `team-presence` code or frontend reuse.
- Raw Coding Agent session import.
- Representative file editing or arbitrary shell execution.
- Agent-generated Coding Agent subagents.
- Local Embedding download and lifecycle.
- Full issue-tracker migration.
- Mobile clients.
