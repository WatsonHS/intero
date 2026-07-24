# Intero

> The coordination layer for human-agent engineering teams.

Intero is an AI-native engineering coordination platform. Every team member
has a continuously available Digital Representative that understands their
authorized work state, communicates transparently with people and other
Representatives, and gives Coding Agents organization-aware context at the
moment they encounter a dependency, blocker, or architectural branch.

Intero is not a coding agent, an employee-surveillance system, or a complete
replacement for every project-management tool. Coding agents continue to do the
implementation work. Intero supplies the missing organization-awareness and
coordination layer around them.

## Core loop

```text
Codex / Claude Code / OpenCode
        │ Hooks + MCP + semantic checkpoints
        ▼
Local Private Plane
        │ private Work State + policy-controlled projection
        ▼
Public Representative
        │ visible coordination, chat, review, and team state
        ▼
Team Pulse / Action Inbox / Coordination / Spec Review
```

- A Rust privacy daemon accepts Coding Agent hooks, enforces the Workspace
  registry, stores private state, and exposes narrow read-only workspace tools.
- A separate TypeScript Local Representative interprets private signals and can
  continue operating from existing information while offline.
- A TypeScript Public Representative remains available through event-driven
  server jobs and uses only synchronized public state when the local runtime is
  offline.
- Built-in chat supports human-to-human, human-to-Representative, and
  Representative-to-Representative communication with visible attribution and
  auditable structured actions.
- Workstreams, Claims, Coordination Threads, Specs, Decisions, Artifacts, Team
  Pulse, and Action Inbox are first-class product objects.
- Project management is a module inside Intero, not its foundation.
  `team-presence` is a product reference only; its raw session collector and
  frontend are not reused.

## Current status

Architecture and MVP definition:

- [Product requirements](docs/brainstorms/2026-07-24-intero-product-requirements.md)
- [Technical architecture](docs/ARCHITECTURE.md)
- [MVP implementation plan](docs/plans/2026-07-24-intero-mvp-implementation-plan.md)
- [Architecture decisions](docs/adr/README.md)
