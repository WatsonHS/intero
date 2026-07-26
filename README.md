# Intero

Intero is an AI-native coordination layer for engineering teams. Coding Agents
report semantic checkpoints to a privacy-preserving local runtime; Intero turns
those checkpoints into visible Work State, bounded Stand-in coordination,
durable project conversations, and versioned Spec Review.

The MVP is implemented as a TypeScript modular monolith plus a Rust privacy
daemon. Raw prompts, responses, terminal logs, tool payloads, and file contents
are outside the event contract.

## What is in the MVP

- Electron desktop surfaces for Team Pulse, Stand-in and Coordination
  Threads, Project Room, Spec Review, Action Inbox, and privacy settings.
- `interod`, a Rust daemon with authenticated local IPC, SQLCipher storage,
  OS-keyring support, Workspace authorization, structured memory, and OpenMLS.
- A local Stand-in sidecar with deterministic Work State reduction,
  projection control, run budgets, durable request results, and offline replay.
- Managed Codex, Claude Code, and OpenCode adapters plus a stateless MCP bridge.
- Fastify API and Graphile Worker backed by PostgreSQL/RLS, SpiceDB,
  Centrifugo, and S3-compatible attachment storage.
- Better Auth magic links, passkeys, optional GitHub linking, and Electron
  device authorization.
- Typed Action Envelopes, capability grants, Spec revisions, audit events,
  transactional outbox delivery, and cursor gap repair.

The detailed contracts and boundaries live in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Delivery status and the external
pilot boundary are recorded in
[`docs/plans/2026-07-24-intero-mvp-implementation-plan.md`](docs/plans/2026-07-24-intero-mvp-implementation-plan.md).

The cloud-first two-day pilot has a smaller runtime boundary and uses the
existing desktop renderer as its browser client. See
[`docs/PILOT_RUNBOOK.md`](docs/PILOT_RUNBOOK.md) for the exact local start,
Agent connection, two-client smoke, and validation limits.

Production-operability configuration, ordered migrations, health/metrics,
object-storage policy, backup/restore, and exact deployment boundaries are in
[`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Prerequisites

- Node.js 24 or newer with Corepack
- pnpm 10
- Rust stable
- Docker with Compose
- [just](https://github.com/casey/just)

## Start locally

```bash
corepack pnpm install
just up
```

`just up` starts PostgreSQL, SpiceDB, Centrifugo, and MinIO, applies migrations,
starts `interod`, and launches the application workspaces. Development
credentials are isolated to `compose.yaml` and `.env.example`; do not reuse them
outside local development.

The desktop starts in Simplified Chinese. Open **设置 → 界面语言** to switch to
English; the preference stays on that device. Team Pulse, conversations, Specs,
identity, Workspace enrollment, runtime health, and model-egress policy are
loaded from the API or the local privacy daemon. Local absolute Workspace paths
never enter the public API.

Normal startup does not seed sample Workstreams or Threads. To run an explicit
visual demo with deterministic fixtures, set:

```bash
INTERO_SEED_DEMO=true just up
```

For a real acceptance flow, enroll a Workspace through the authenticated local
`workspace.enroll` RPC, then open **设置 → Coding Agent 集成** to install Codex,
Claude Code, and OpenCode. The Settings cards write only Intero-owned config
nodes and can repair or remove them without restoring stale copies of the
user's global files. Codex deliberately remains in **信任状态未验证** because
Intero cannot read Codex's private trust state; the user approves Intero hooks
through Codex's native `/hooks` screen.

The same operation is available from the built bridge:

```bash
apps/mcp-stdio/dist/index.js integration install --adapter all
apps/mcp-stdio/dist/index.js integration status --adapter all
apps/mcp-stdio/dist/index.js integration uninstall --adapter all
```

Packaged desktop builds include `Contents/Resources/intero-mcp` (or
`intero-mcp.cmd` on Windows), backed by a self-contained JavaScript bundle and
the app's Electron runtime. Agent configuration therefore keeps a stable
launcher path without requiring a separately installed Node.js. Run
`pnpm --filter @intero/desktop package` to produce an unpacked acceptance
artifact.

Settings distinguishes text-only configuration, Agent-CLI configuration
validation, unsupported Agent versions, Codex's pending native hook trust, and
repair-required journals or locks. If `AGENTS.override.md` shadows the managed
Codex instructions, the card shows an explicit warning.

A supported Agent session in an enrolled root or linked Git worktree creates a
private Workstream automatically. The MCP server resolves the current
Workspace and Workstream internally, so Agent tool calls do not need Intero
UUIDs. Semantic checkpoints remain explicit Claims; unenrolled directories
remain unobserved.

Stop the stack without deleting its volumes:

```bash
just down
```

## Verify

```bash
just check
just backup-restore-smoke
```

`just check` regenerates API clients, type-checks TypeScript, checks Rust
formatting and Clippy, runs both test suites, and builds all production
artifacts. CI runs the same code-generation and dependency-backed integration
tests.

## Privacy defaults

- Only explicitly enrolled Workspace roots may emit work signals.
- Hook adapters subscribe only to content-free session lifecycle events and
  reject unknown or content-bearing event shapes.
- Administrator, lifecycle-hook, MCP, and Stand-in-sidecar IPC clients
  use separate local capabilities with explicit method allowlists.
- Managed integration state stores Intero-owned values and hashes only. Existing
  Agent configs, which may contain credentials, are never copied into Intero.
- Model egress is disabled by default and deterministic Work State remains
  available without a model or network. The setting is persisted by `interod`
  and applied to the running Local Stand-in.
- Local private state is encrypted with SQLCipher; production uses the OS
  credential store for its key.
- Public fallback responses disclose freshness and never silently impersonate
  the local runtime.
