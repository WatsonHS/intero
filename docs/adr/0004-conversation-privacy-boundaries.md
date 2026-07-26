# ADR-0004: Conversation privacy and Agent-readable boundaries

Status: accepted

Date: 2026-07-24

## Context

Intero needs normal human chat, one continuous Thread between a person and
their Stand-in, and transparent Stand-in-to-Stand-in
coordination. Human-only conversation can support E2EE, but a Public
Stand-in cannot participate in an E2EE Thread without access to message
plaintext.

## Decision

- Human-only direct and group Threads use OpenMLS E2EE.
- A person's Stand-in Thread is server-readable and synchronized across
  devices.
- Adding a Stand-in to an existing Human-only Thread is the explicit
  consent action that changes the same logical Thread to Agent-readable for
  subsequent messages.
- The transition creates a visible system event.
- Earlier MLS history remains inaccessible unless a participant separately
  grants relevant context or full history.
- Stand-in actions are visible, attributable, and auditable.

## Consequences

Positive:

- The product keeps one natural conversation instead of creating a confusing
  linked Thread.
- Agent access is explicit and has a visible temporal boundary.
- Previous E2EE history is not silently disclosed.
- Stand-in Threads can support public fallback and multi-device history.

Negative:

- One Thread may contain an encryption-mode boundary.
- Clients must render access and historical-availability state accurately.
- Users cannot assume E2EE continues after adding a Stand-in.

## Rejected alternatives

- Silently making the full historical Thread server-readable.
- Creating a separate linked Agent-readable Thread.
- Pretending a server-side Stand-in can participate in E2EE without
  plaintext access.
