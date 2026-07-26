# ADR-0005: Internal coordination protocol before A2A

Status: accepted

Date: 2026-07-24

## Context

Intero requires strong semantics for Workstreams, Claims, Ownership,
Dependencies, Capability Grants, Spec Review, Decisions, privacy projection, and
human-visible correction. A2A provides useful interoperability primitives but
does not define these product-domain semantics.

## Decision

Intero uses a versioned internal Coordination Protocol. Every Stand-in
exchange contains:

- a human-readable message;
- a typed Action Envelope;
- actor and authority references;
- related scope, Claims, evidence, and requested actions.

The MVP does not implement an A2A Gateway. Internal objects preserve a clean
future mapping to A2A Agent Cards, Messages, Tasks, Artifacts, contexts, and
extensions.

After the internal product stabilizes, an A2A Gateway may expose the Public
Stand-in. External Agents map to Intero principals and remain subject
to Capability Policy, SpiceDB, and public projection. Agent discovery never
grants authorization.

## Consequences

Positive:

- Internal semantics remain type-safe and product-oriented.
- User-visible messages and machine state changes stay linked.
- A2A evolution does not force domain migrations during MVP.
- Future external interoperability has a defined boundary.

Negative:

- Intero owns an internal protocol and its versioning.
- The later gateway needs explicit semantic mapping and conformance tests.
- External A2A Agents are not available in the MVP.

## Rejected alternatives

- Use A2A as the internal source of truth and encode every Intero concept as
  generic metadata or extensions.
- Ignore interoperability entirely and make later mapping accidental.
