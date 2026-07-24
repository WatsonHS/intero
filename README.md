# Intero

Intero is an AI-native coordination layer for engineering teams. Coding Agents
report semantic checkpoints to a privacy-preserving local runtime; Intero turns
those checkpoints into visible Work State, bounded Representative coordination,
durable project conversations, and versioned Spec Review.

The MVP is implemented as a TypeScript modular monolith plus a Rust privacy
daemon. Raw prompts, responses, terminal logs, tool payloads, and file contents
are outside the event contract.

## What is in the MVP

- Electron desktop surfaces for Team Pulse, Representative and Coordination
  Threads, Project Room, Spec Review, Action Inbox, and privacy settings.
- `interod`, a Rust daemon with authenticated local IPC, SQLCipher storage,
  OS-keyring support, Workspace authorization, structured memory, and OpenMLS.
- A local Representative sidecar with deterministic Work State reduction,
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
- Hook adapters normalize bounded metadata and reject raw session content.
- Model egress is disabled by default and deterministic Work State remains
  available without a model or network.
- Local private state is encrypted with SQLCipher; production uses the OS
  credential store for its key.
- Public fallback responses disclose freshness and never silently impersonate
  the local runtime.
