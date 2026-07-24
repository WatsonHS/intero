# ADR-0002: Shared Representative core with event-driven runtimes

Status: accepted

Date: 2026-07-24

## Context

The Local and Public Representatives need consistent Work-State, Claim,
coordination, and policy behavior, but they have different tools and trust
boundaries. Keeping a permanent server process for every Representative would
also create unnecessary idle cost.

## Decision

Both runtimes share a pure TypeScript `representative-core` containing:

- event-driven Agent loop;
- Context Builder;
- Claim Resolver and Work-State reducers;
- public-projection logic;
- prompt compiler;
- policy contracts and runtime ports.

The Local Representative is a supervised TypeScript sidecar. The Public
Representative runs as idempotent Graphile Worker jobs. They inject distinct
storage, tool, authorization, and model ports.

Deterministic reducers run before model interpretation. Ordinary events are
grouped by Workstream; blockers, messages, coordination, and review wake a run
immediately. Different Workstreams may run concurrently while one Thread or
Workstream remains ordered.

## Consequences

Positive:

- Shared semantics reduce local/public behavior drift.
- Public Representatives scale with activity rather than user count.
- Model-disabled and offline operation can still reduce state.
- Runtime capabilities remain testable through common contracts.

Negative:

- Core abstractions must avoid filesystem, database, and framework leakage.
- Short-lived jobs need explicit context assembly and durable memory.
- Idempotency and ordering become required platform capabilities.

## Rejected alternatives

- Separate Local and Public Agent implementations.
- One permanent server process or Actor for every user.
- Public Representative calls the user's device for every interaction.
