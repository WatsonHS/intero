# Intero

English · [简体中文](README.zh-CN.md)

## Vision

Intero is a working exploration of what collaboration software and software
engineering should become in an AI-native era.

### What changed

The previous generation of software engineering was shaped by scarce individual
capacity and relatively stable specialization. Frontend, backend, product,
design, operations, and architecture work were divided among people, and many
coordination practices grew around those handoffs.

AI changes that premise. A person working with Coding Agents can cross several
of those boundaries in one session. People can explore and implement more
independently, and work that once required several specialists can now be
completed by one person and their Agents.

### Problems we are experiencing

1. **Greater autonomy removes natural synchronization points.** Someone
   implementing a frontend feature may notice a backend defect and fix it
   directly instead of handing it to another specialist. The backend maintainer
   may never know that the behavior changed, the fix may violate an assumption
   the author did not know existed, and another Agent may continue building on
   the previous contract.
2. **Delivery grows faster than the team's understanding of the product.** Some
   important capabilities begin as an idea or experiment rather than a formal
   Feature, Spec, or ticket. Traditional trackers can record declared work, but
   they may not describe what the product has actually become, which evidence
   supports a capability, or whether later changes have put it at risk. Each
   local task can appear complete while an older working behavior quietly
   regresses.
3. **AI output exceeds human review and decision capacity.** AI can produce
   plans, Specs, alternatives, and implementations before a person has learned
   enough about an unfamiliar domain to recognize a false assumption,
   unnecessary abstraction, indirect design, or simpler alternative. It also
   creates far more decisions per day. Under sustained decision fatigue, people
   are least able to find the problems that most need judgment.

These problems share one pattern: execution has accelerated beyond the team's
ability to maintain shared understanding, reliable validation, and focused
human attention.

We do not think the answer is to restore rigid role boundaries, require human
approval for every change, or place another unbounded autonomous Agent above the
team. We want to explore harder questions:

- How can individual capability remain fluid while responsibility for shared
  contracts and system invariants stays clear?
- How can a team distinguish a safe cross-boundary fix from a change that needs
  coordination, review, or new validation?
- How can a collaboration system discover incompatible work before it becomes a
  regression without collecting raw private activity or creating surveillance?
- How can the right people enter a temporary, bounded discussion while everyone
  else receives only a quiet, useful summary?
- How can human attention be reserved for decisions that genuinely require
  judgment instead of turning every Agent action into another approval?
- How can a team know that its product remains coherent and usable while many
  people and Agents change it in parallel?
- How can capabilities discovered through informal exploration remain visible
  and verifiable even when no Feature, Spec, or ticket existed first?

Our working thesis is that execution can become highly distributed, but
coordination, validation, and responsibility must remain continuous. People and
Agents should be able to work independently while a collaboration layer
maintains authorized shared Work State, notices possible conflicts, routes
attention, preserves evidence and uncertainty, and carries human-confirmed
outcomes back into the work.

The larger purpose of Intero is not a particular stack, model, or list of AI
features. It is to make these questions concrete enough to build against, test,
falsify, and refine. The current product is one experimental answer, not a claim
that Intero should own every task, test, Spec, decision, or Agent workflow. We
will judge the exploration by whether a team can remain autonomous and fast
without losing a shared, trustworthy reality.

## Current product direction

Intero is a coordination layer for software teams working with Coding Agents.
It turns structured Agent checkpoints into durable, privacy-aware team context:
current work, blockers, decisions, review state, and the next coordination
action.

Intero is not a transcript collector or a general autonomous Agent. It is
designed to preserve human authority, provenance, and project boundaries while
making Agent-assisted work legible to the rest of the team.

> **Project status:** Intero is under active, pre-1.0 development. The current
> repository supports pilot deployments, but APIs, migrations, and operational
> procedures may still change.

## What Intero provides

- **Structured Agent reporting** through an authenticated MCP endpoint for
  Codex, Claude Code, OpenCode, and compatible clients.
- **Private Work State** that records progress, evidence, blockers, decisions,
  and validation without ingesting raw prompts, diffs, files, or terminal logs.
- **Team Pulse** for a concise view of what teammates are working on and where
  coordination is needed.
- **Action Inbox** for review requests, blockers, commitments, and other
  human-owned decisions.
- **Project work and Spec Review** with immutable revisions, comments,
  confirmations, provenance, and reversible Agent-authored changes.
- **Realtime conversations** across direct messages, team chat, project
  coordination, and personal Stand-in interactions.
- **Bounded Stand-in automation** that may summarize authorized work or propose
  reversible coordination steps, but cannot change membership, ownership,
  access, or make final human commitments.
- **Invite-only access** with organization and team administration, password
  authentication, Passkeys, and revocable Agent bindings.

## Design principles

1. **Private by default.** Uploading or processing information does not make it
   visible to a team.
2. **Structured signals over surveillance.** Intero accepts semantic
   checkpoints, not ambient capture of developer activity.
3. **Provenance is part of the data model.** Shared state retains its actor,
   source, timestamp, confidence, and revision history.
4. **Human authority stays explicit.** Agents cannot silently expand scope,
   alter access, or make irreversible decisions.
5. **Authorization is enforced at every adapter boundary.** Organization,
   Team, Project, and private-user scopes are not inferred from UI state.

The complete trust model and technical boundaries are documented in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Architecture

```mermaid
flowchart LR
    subgraph Clients["Clients"]
        Agents["Coding Agents"]
        Web["Web app"]
        Desktop["Optional desktop app"]
    end

    subgraph Intero["Intero service"]
        MCP["Authenticated MCP"]
        API["Product API"]
        Policy["Authorization and privacy policy"]
        Worker["Durable jobs and Stand-in"]
        DB[("PostgreSQL")]
    end

    Agents --> MCP
    Web --> API
    Desktop --> API
    MCP --> Policy
    API --> Policy
    Policy --> DB
    Policy --> Worker
    Worker --> DB

    Policy --> SpiceDB["SpiceDB"]
    API --> Realtime["Centrifugo"]
    API --> Objects["S3 / MinIO"]
    Worker --> Models["Configured model provider"]
```

PostgreSQL is the authoritative store. SpiceDB enforces relationship-based
authorization, Centrifugo provides realtime delivery, and Graphile Worker plus
a transactional outbox run durable background work. Object storage is
S3-compatible and disabled at the product layer unless explicitly configured.

## Repository layout

| Path                          | Purpose                                                          |
| ----------------------------- | ---------------------------------------------------------------- |
| `apps/web`                    | Primary React web client                                         |
| `apps/desktop`                | Optional Electron desktop client                                 |
| `apps/server-api`             | HTTP, authentication, MCP, and product API                       |
| `apps/server-worker`          | Durable jobs, outbox processing, and Stand-in work               |
| `apps/mcp-stdio`              | Local stdio bridge for compatible Coding Agents                  |
| `packages/domain`             | Core identities, events, policies, and domain contracts          |
| `packages/stand-in-core`      | Stand-in reasoning and policy logic                              |
| `packages/project-management` | Project work and Spec Review domain logic                        |
| `packages/api-contracts`      | Generated and source API contracts                               |
| `packages/config`             | Runtime configuration and validation                             |
| `packages/integrations`       | Coding Agent integration adapters                                |
| `infra`                       | Local infrastructure configuration                               |
| `docs`                        | Architecture records, operations, plans, and validation evidence |

The repository is a pnpm workspace orchestrated with Turborepo.

## Prerequisites

- Node.js 24 or newer
- pnpm 10.33.2 through Corepack
- Docker with Docker Compose
- [just](https://github.com/casey/just)
- [Gitleaks](https://github.com/gitleaks/gitleaks) for optional local secret scans

## Quick start

Install dependencies and start the local development stack:

```bash
corepack enable
just setup
just up
```

`just up` starts PostgreSQL, SpiceDB, Centrifugo, and MinIO, applies the
required migrations, and launches the Web, API, and worker development
processes.

The default local endpoints are:

| Service         | URL                     |
| --------------- | ----------------------- |
| Web application | `http://localhost:5173` |
| API             | `http://localhost:4310` |
| Centrifugo API  | `http://localhost:8000` |
| MinIO API       | `http://localhost:9000` |

Stop the infrastructure services with:

```bash
just down
```

The included credentials and tokens are development-only defaults. Never reuse
them for a shared or production deployment.

## Configuration

Intero reads runtime configuration from environment variables. The supported
development settings and safe placeholders are documented in
[.env.example](.env.example).

To customize the local stack:

```bash
cp .env.example .env
```

Important configuration groups include:

- canonical deployment URL and trusted origins;
- PostgreSQL application, migration, and worker connections;
- provider-secret encryption and authentication secrets;
- SpiceDB, Centrifugo, and optional object storage;
- model provider endpoint, API key, and default model configured through the
  administrator UI.

Server-side secrets are never returned through member-facing APIs. Production
deployments must use unique random credentials, HTTPS, persistent volumes,
backups, and environment-specific secret management. See
[docs/OPERATIONS.md](docs/OPERATIONS.md) for the operational baseline.

## Development

Common commands:

```bash
just dev-deps       # start infrastructure only
just dev            # start Web, API, and worker processes
pnpm dev:desktop    # start the optional desktop client
pnpm generate       # regenerate API contracts
pnpm lint           # TypeScript validation
pnpm test           # unit and integration-capable test suite
pnpm build          # production builds
just check          # generate, lint, test, and build
```

Some integration tests require the Docker services started by `just dev-deps`.
Environment-gated tests skip when their external dependency is unavailable.

Demo fixtures are opt-in and must never be run against a production database.
See [docs/DEMO_DATA.md](docs/DEMO_DATA.md) for the safety checks and commands.

## Security and privacy

Intero handles private engineering context and should be treated as a
security-sensitive service.

- Do not commit `.env` files, database snapshots, credentials, or raw browser
  test output.
- Do not expose a development deployment to an untrusted network.
- Keep model-provider keys server-side and rotate them after suspected
  disclosure.
- Run the repository secret scan before publishing history:

  ```bash
  gitleaks git --config .gitleaks.toml
  ```

- Review [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data and trust
  boundaries before changing authentication, authorization, publication, or
  Agent capabilities.

Please do not report suspected vulnerabilities in a public issue until a
dedicated security policy and private reporting channel are published.

## Documentation

- [Technical architecture](docs/ARCHITECTURE.md)
- [Operations](docs/OPERATIONS.md)
- [Pilot runbook](docs/PILOT_RUNBOOK.md)
- [Demo-data safety](docs/DEMO_DATA.md)
- [Architecture decision records](docs/adr/README.md)
- [Product requirements](docs/brainstorms/2026-07-24-intero-product-requirements.md)
- [Conversation-driven collaboration exploration](docs/plans/2026-07-29-002-conversation-driven-collaboration-todo.md)
- [Product Capability Health next-phase research](docs/plans/2026-07-29-003-product-capability-health-roadmap.md)

## Contributing

Intero is still stabilizing its core contracts. Keep changes scoped, include
tests for behavior changes, preserve privacy and authorization boundaries, and
run `just check` before submitting a pull request.

A dedicated contribution guide will be added as the public development process
is finalized.

## License

Intero is licensed under the
[Apache License 2.0](LICENSE).
