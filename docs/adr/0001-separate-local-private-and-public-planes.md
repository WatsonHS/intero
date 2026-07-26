# ADR-0001: Separate local private and public planes

Status: accepted

Date: 2026-07-24

## Context

Intero needs private local evidence to understand active engineering work, but
it also needs an always-available Stand-in that can communicate while a
user's machine is offline. Uploading raw Coding Agent sessions would violate the
product's privacy and anti-surveillance boundary. Keeping everything local would
make team communication unavailable whenever a device is offline.

## Decision

Intero uses two trust planes under one logical Stand-in identity:

- The local private plane owns Workspace observation, private Claims, private
  Work State, credentials, local E2EE keys, and egress policy.
- The public plane owns synchronized Work Projections, chat, coordination,
  review, shared authorization, and the always-available Public Stand-in.

The local plane sends domain projections rather than raw execution logs. The
Public Stand-in uses only previously synchronized information when the
local runtime is offline and exposes freshness in its response.

## Consequences

Positive:

- Raw Coding Agent sessions are unnecessary.
- Offline public communication remains possible.
- Private policy is enforced on the user's device.
- Public state has an explicit source and freshness boundary.

Negative:

- Local and public data stores require synchronization and conflict handling.
- The Public Stand-in may have incomplete or stale context.
- Users and developers must understand that one identity has two runtimes.

## Rejected alternatives

- Server-only Stand-in with central raw-session collection.
- Local-only Stand-in with no offline public presence.
- Coding Agent as the Stand-in and source of team truth.
