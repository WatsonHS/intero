# ADR-0004: Conversation privacy and Agent-readable boundaries

Status: accepted; pilot messaging scope amended by ADR-0006

Date: 2026-07-24

## Context

Intero needs normal human chat, one continuous Thread between a person and their
Stand-in, and transparent Stand-in coordination. Human-only
conversation can support E2EE later, but ADR-0006 narrows the pilot to
participant-visible same-team 1:1 messages without an E2EE promise.

## Decision

- Pilot Human-only messaging is basic persistent same-team 1:1 direct messages,
  visible only to the two participants by default. Group DMs and E2EE are not
  pilot commitments.
- A person's Stand-in Thread is server-readable and synchronized across
  devices, but remains visible only to its authorized participants.
- Adding a Stand-in to an existing Human-only Thread is the explicit
  consent action that changes the same logical Thread to Agent-readable for
  subsequent messages.
- The transition creates a visible system event.
- Earlier Human-only history remains inaccessible unless a participant separately
  grants relevant context or full history.
- Stand-in actions are visible, attributable, and auditable.
- Server-readable or cloud-stored content is not automatically team-visible.
  Stand-in reuse and team, project, or organization publication require
  separate authorization.

## Consequences

Positive:

- The product keeps one natural conversation instead of creating a confusing
  linked Thread.
- Agent access is explicit and has a visible temporal boundary.
- Previous Human-only history is not silently disclosed.
- Stand-in Threads can support multi-device history without becoming
  team-visible.

Negative:

- One Thread may contain an Agent-readability boundary.
- Clients must render access and historical-availability state accurately.
- Clients must not imply that pilot DMs are end-to-end encrypted.

## Rejected alternatives

- Silently making the full historical Thread server-readable.
- Creating a separate linked Agent-readable Thread.
- Pretending a server-side Stand-in can participate in E2EE without
  plaintext access.
