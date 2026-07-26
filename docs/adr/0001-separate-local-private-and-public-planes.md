# ADR-0001: Separate local private and public planes

Status: superseded by ADR-0006

Date: 2026-07-24

## Context

Intero needs private local evidence to understand active engineering work, but
it also needs an always-available Representative that can communicate while a
user's machine is offline. Uploading raw Coding Agent sessions would violate the
product's privacy and anti-surveillance boundary. Keeping everything local would
make team communication unavailable whenever a device is offline.

## Decision

Intero uses two trust planes under one logical Representative identity:

- The local private plane owns Workspace observation, private Claims, private
  Work State, credentials, local E2EE keys, and egress policy.
- The public plane owns synchronized Work Projections, chat, coordination,
  review, shared authorization, and the always-available Public Representative.

The local plane sends domain projections rather than raw execution logs. The
Public Representative uses only previously synchronized information when the
local runtime is offline and exposes freshness in its response.

## Consequences

Positive:

- Raw Coding Agent sessions are unnecessary.
- Offline public communication remains possible.
- Private policy is enforced on the user's device.
- Public state has an explicit source and freshness boundary.

Negative:

- Local and public data stores require synchronization and conflict handling.
- The Public Representative may have incomplete or stale context.
- Users and developers must understand that one identity has two runtimes.

## Rejected alternatives

- Server-only Representative with central raw-session collection.
- Local-only Representative with no offline public presence.
- Coding Agent as the Representative and source of team truth.
