# ADR-0003: TypeScript modular monolith with a Rust privacy daemon

Status: accepted

Date: 2026-07-24

## Context

Intero's product logic changes quickly and is dominated by database, realtime,
authorization, and model I/O. The local trust boundary requires stronger
control over privileged filesystem access, encrypted storage, credentials, and
cross-platform IPC. The desktop application must use Electron rather than
Tauri.

## Decision

- Electron, React, and TypeScript implement the desktop product.
- A Rust `interod` process owns local privacy, SQLCipher, credentials,
  Workspace access, and synchronization queues.
- A TypeScript Local Stand-in sidecar owns local Agent reasoning.
- Node.js 24, TypeScript, and Fastify implement a modular-monolith API.
- A separate Graphile Worker process runs background and Public Stand-in
  jobs from the same codebase.
- PostgreSQL and Drizzle store shared domain data.
- SpiceDB provides shared ReBAC; PostgreSQL RLS enforces tenant boundaries.
- Centrifugo provides realtime delivery; PostgreSQL remains authoritative.
- S3-compatible object storage holds attachments and large artifacts.

## Consequences

Positive:

- Product and Stand-in behavior share one TypeScript ecosystem.
- Rust is limited to the local boundary where its complexity earns value.
- The modular monolith supports fast development without premature services.
- Queue, realtime, authorization, and storage remain replaceable behind ports.

Negative:

- Releases contain Electron, Node, and Rust artifacts.
- Local IPC and cross-language API generation require compatibility tests.
- TypeScript and Rust build systems need one orchestration layer.

## Rejected alternatives

- Tauri desktop.
- All product and Stand-in logic in Rust.
- Electron Main as the privacy kernel or Agent runtime.
- Go or Rust microservices from the first release.
- Redis and BullMQ as mandatory MVP infrastructure.
