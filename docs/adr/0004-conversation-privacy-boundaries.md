# ADR-0004: Conversation privacy and Agent-readable boundaries

Status: accepted

Date: 2026-07-24

## Context

Intero needs normal human chat, one continuous Thread between a person and
their Representative, and transparent Representative-to-Representative
coordination. Human-only conversation can support E2EE, but a Public
Representative cannot participate in an E2EE Thread without access to message
plaintext.

## Decision

- Human-only direct and group Threads use OpenMLS E2EE.
- A person's Representative Thread is server-readable and synchronized across
  devices.
- Adding a Representative to an existing Human-only Thread is the explicit
  consent action that changes the same logical Thread to Agent-readable for
  subsequent messages.
- The transition creates a visible system event.
- Earlier MLS history remains inaccessible unless a participant separately
  grants relevant context or full history.
- Representative actions are visible, attributable, and auditable.

## Consequences

Positive:

- The product keeps one natural conversation instead of creating a confusing
  linked Thread.
- Agent access is explicit and has a visible temporal boundary.
- Previous E2EE history is not silently disclosed.
- Representative Threads can support public fallback and multi-device history.

Negative:

- One Thread may contain an encryption-mode boundary.
- Clients must render access and historical-availability state accurately.
- Users cannot assume E2EE continues after adding a Representative.

## Rejected alternatives

- Silently making the full historical Thread server-readable.
- Creating a separate linked Agent-readable Thread.
- Pretending a server-side Representative can participate in E2EE without
  plaintext access.
