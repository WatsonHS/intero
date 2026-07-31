---
title: "Intero Golden Case: Team-room conversation to cross-project coordination"
status: active
date: 2026-08-01
---

# Intero Golden Case

[简体中文](GOLDEN_CASE.zh-CN.md) · English

## Purpose

This is the canonical end-to-end product scenario for Intero. Product design,
Agent behavior, domain contracts, browser acceptance, and provider canaries
should tell this same story. It is not a claim that every team works this way;
it is the first repeatable case used to test whether the product thesis works.

The case must prove that a team can talk naturally in a Team Room containing
several Projects, mention only `@Intero`, and resolve a real cross-Project
conflict without manually routing context or exposing private Agent activity.

## Product model under test

| Role                    | Represents | Responsibility                                                                                                        |
| ----------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Personal Stand-in       | “Me”       | Protect private context, help one person, and share only authorized work state                                        |
| Intero in a shared Room | “Us”       | Understand authorized conversation, infer scope, coordinate shared work, and maintain human-confirmed project reality |
| External Coding Agent   | Execution  | Implement, inspect, and validate work within its granted scope                                                        |

Projects are internal state, authorization, and evidence scopes. They are not
separate bots that people must remember to mention. The visible shared-space
Agent is always named `Intero`.

## Fixed product decisions

1. A person in a Team Room mentions only `@Intero`.
2. Intero infers whether a discussion belongs to one Project, several Projects,
   the Team, or remains ambiguous.
3. Scope inference routes information but never grants access or widens
   visibility.
4. Authorized conversation is a signal of intent, observation, disagreement,
   or a candidate decision; it is not implementation truth by itself.
5. Personal Stand-ins share bounded semantic Work State, not raw prompts, files,
   diffs, terminal output, or private conversation.
6. Compatible work stays quiet. A high-confidence, evidence-backed conflict may
   create one reversible temporary discussion automatically.
7. Intero may speak as a group bot when asked or when a real coordination need
   deserves attention. It must not create a stream of status messages.
8. Human-facing output leads with plain language and reveals exact technical
   evidence on demand.
9. Priority, ownership, approval, schedule, external promises, and final
   commitments remain human-confirmed.
10. Repeated signals update the same coordination path instead of creating new
    Threads, Room messages, prompts, or Inbox items.

## Fixture

### Shared space

- Team: `Intero Lab`
- Team Room: `#engineering`
- Projects discussed in the same Room:
  - `Auth Platform`
  - `Mobile App`

### People and Agents

- Alex works primarily on `Auth Platform`.
- Priya works primarily on `Mobile App`.
- Alex and Priya each have a private personal Stand-in.
- Each person has an authorized Coding Agent connection.
- `Intero` is the only shared Agent identity visible in `#engineering`.

### Shareable work state

Alex's Coding Agent reports through Alex's Stand-in:

- Project: `Auth Platform`
- Intent: rename `retryDelayMs` to `retryAfterMs` and remove the old field
- Shared boundary: public retry configuration contract
- Planned removal: 2026-08-08
- Validation: Auth-side unit tests pass

Priya's Coding Agent reports through Priya's Stand-in:

- Project: `Mobile App`
- Intent: finish client retry handling
- Dependency: the client still reads `retryDelayMs`
- Shared boundary: the same public retry configuration contract
- Validation: migration to `retryAfterMs` is not complete

Neither shareable record contains raw prompts, source files, diffs, terminal
logs, or unrelated private Work State. No Coordination Thread, Room summary, or
Action Inbox item is seeded before the case starts.

## Main Golden Path

### 1. Natural Team-room conversation

Alex writes in `#engineering`:

> @Intero, can we remove `retryDelayMs` now?

Alex does not choose a Project Agent, fill in a form, or link a pre-existing
Feature, Spec, or Work Item.

### 2. Intero resolves the scope

Intero relates the message to the two shareable boundary claims and infers that
the question concerns both `Auth Platform` and `Mobile App`.

The scope is shown as correctable context:

> `Auth Platform` + `Mobile App` · cross-Project

Intero does not gain access to any additional private context because of this
inference.

### 3. Intero speaks once and opens coordination

Because the conflict is explicit, current, cross-owner, and backed by shared
claims, Intero creates or reuses exactly one temporary discussion and posts one
compact Room entry:

> **Removing `retryDelayMs` may break mobile retries.**
>
> Auth Platform plans to remove the field, while Mobile App still depends on
> it. The projects need to confirm a compatibility window.
>
> [Open discussion] [Why these Projects?] [Not related]

This first layer answers:

- what happened;
- why it matters;
- which Projects are involved; and
- what question needs resolution.

It does not expose internal Claim-matching vocabulary as the explanation a
person must decode.

### 4. Intero routes relevance without creating action

While Priya is viewing `#engineering`, the existing Room entry shows a local,
dismissible prompt:

> This may affect your mobile retry work. Take a look?

Passive relevance does not create an Action Inbox item, a new Room message, an
unread increment, or an ordinary notification. Priya can open, dismiss, mute,
or revisit the discussion.

### 5. The temporary discussion starts prepared

The discussion header contains three levels of detail.

**Understand in seconds**

- What changed: Auth Platform plans to remove `retryDelayMs`.
- Impact: Mobile App still reads it, so retries may stop working.
- Question: How long should the old field remain compatible?
- Action now: Alex and Priya need to agree on the compatibility window.

**Resolve the issue**

- Option A: keep both fields through 2026-08-08 while Mobile App migrates.
- Option B: delay removal until Mobile App supplies new validation evidence.
- No option is presented as a decision until people confirm it.

**Inspect the evidence**

- exact shared boundary and field names;
- source Project, person, Stand-in, Coding Agent binding, and Work State;
- observation time, freshness, and revision;
- current test and migration evidence;
- facts, Intero interpretation, suggestions, and unresolved uncertainty shown
  as different statement types.

### 6. People make the consequential decision

Alex and Priya choose Option A. They explicitly set the commitments:

- Priya will migrate Mobile App and provide retry validation by 2026-08-07.
- Alex will keep `retryDelayMs` compatible until that evidence is available and
  will not remove it before 2026-08-08.

Intero prepares a conclusion draft but does not invent owners or dates. If a
required confirmation is still missing, it creates or updates one deduplicated
Action Inbox item for the responsible person:

> Confirm the `retryDelayMs` compatibility window.

The discussion remains open until the required human confirmation is recorded.

### 7. Intero closes the loop

After confirmation, Intero:

1. closes the temporary discussion with the confirmed decision, actions,
   human-selected owners, dates, sources, and remaining uncertainty;
2. updates the original `#engineering` entry in place with the final result;
3. records the Decision and affected work context with provenance;
4. sends only the bounded confirmed outcome to the relevant personal Stand-ins
   and Coding Agents;
5. preserves the same Thread, Room message, relevance record, and Inbox item
   across retries and replay.

The final Room entry reads:

> **Compatibility window confirmed.**
>
> `retryDelayMs` remains supported through 2026-08-08. Priya will validate the
> Mobile App migration by 2026-08-07; Alex will remove the old field only after
> that evidence is available.
>
> [View decision and evidence]

The summary revision creates no new Room message, unread count, or ordinary
notification.

## Required comparison branches

### A. Compatible control stays quiet

Auth Platform adds `retryAfterMs` while explicitly retaining `retryDelayMs`.
Mobile App continues using the old field. The shared claims are compatible.

Expected result:

- no proactive Intero message;
- no Coordination Thread;
- no relevance prompt;
- no Action Inbox item;
- no conflict state.

If a person explicitly asks `@Intero`, Intero may answer the question plainly,
but still creates no coordination work.

### B. Ambiguous scope asks once

A person writes:

> @Intero, the retry logic looks wrong.

Several Projects contain retry behavior, and there is not enough evidence to
choose one safely.

Expected result:

> Which context do you mean?
>
> [Auth Platform] [Mobile App] [Cross-Project] [Not tied to a Project yet]

Intero creates no Bug, Thread, Inbox item, or authoritative Project relation
until the clarification is supplied.

### C. Correction changes the same path

Priya states that Mobile App already migrated and that her previous Work State
is stale. Intero records the correction, requests or reads authorized current
evidence, and updates the same Room entry and Thread.

If the new evidence removes the conflict, Intero closes or dismisses the
coordination path with a visible reason. It does not leave a false decision,
duplicate message, or duplicate action behind.

### D. Restricted context does not leak

Intero detects a possible relation to a Project that the current viewer cannot
access.

Expected result:

- no restricted Project name, message, work detail, participant, or evidence is
  disclosed;
- the current Room receives only the minimum policy-safe explanation, if any;
- an authorized person may receive a bounded review request without revealing
  the current Room's private content in return;
- scope inference never becomes permission.

### E. Replay remains idempotent

The same message, Work State, worker job, realtime event, or confirmation is
delivered three times.

Expected result:

- exactly one active Coordination Thread;
- exactly one source-Room summary entry;
- at most one relevant unresolved Action Inbox item;
- one current relevance state per person;
- one human-confirmed conclusion.

### F. A qualifying unprompted conflict may speak once

The same explicit cross-owner boundary conflict becomes shareable before
anyone mentions `@Intero`.

Expected result:

- Intero may proactively create the same single compact Room entry and bounded
  temporary discussion;
- the message explains why the issue deserves attention now;
- repeated evaluation updates that entry rather than posting again;
- lower-confidence interpretation remains silent or asks in context instead of
  announcing a conflict.

## Acceptance matrix

| Dimension         | Required evidence                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Agent model       | A person mentions only `@Intero`; personal Stand-ins do not speak publicly without authorization                         |
| Scope routing     | Single-Project, cross-Project, Team-level, and ambiguous cases are distinguishable and correctable                       |
| Detection         | The conflict names the correct shared boundary, sources, Projects, and affected people                                   |
| Low noise         | The compatible control creates zero proactive coordination artifacts                                                     |
| Bot behavior      | Intero answers when mentioned; a qualifying unprompted conflict produces at most one proactive Room entry                |
| Comprehension     | A person can explain what happened, why it matters, and whether they must act from the compact entry without translation |
| Evidence          | Exact technical identifiers and current sources are available without overwhelming the first layer                       |
| Authority         | Intero does not invent priority, owner, date, approval, or commitment                                                    |
| Attention routing | Passive relevance stays out of Action Inbox; required confirmation creates one deduplicated item                         |
| Privacy           | No raw or unauthorized personal, Agent, Room, or Project context crosses a visibility boundary                           |
| Consistency       | Room, Thread, Inbox, Decision, Work State, Stand-ins, and Coding Agents receive one compatible result                    |
| Recovery          | Correction, retry, replay, dismissal, and closure do not create duplicates or contradictory state                        |

## Test sequence

1. **Deterministic domain tests:** claim normalization, scope candidates,
   compatible control, qualifying conflict, stale and corrected evidence.
2. **Persistence and API tests:** authorization, provenance, deduplication,
   in-place summary revision, contextual relevance, confirmation, and closure.
3. **Browser acceptance:** run the full Team-room flow as Alex and Priya and
   verify the exact visible states and absence of noise.
4. **Real-provider canary:** generate the human-readable explanation and summary
   through the configured provider while deterministic evidence remains the
   reason a conflict exists.
5. **Target-environment canary:** prove the durable worker, realtime delivery,
   retry behavior, and release path outside the local fixture.

## Explicitly outside this Golden Case

- a separate user-visible Agent for every Project;
- autonomous prioritization, staffing, scheduling, approval, or release;
- full Product Capability reconstruction or Capability Health;
- replacement of every external chat, project-management, Git, CI, or test
  system;
- proof that the workflow generalizes to every team or delivery phase.

## Success statement

The Golden Case succeeds when Alex and Priya can talk naturally in a
multi-Project Team Room, rely on one visible Intero to find and explain the
cross-Project conflict, make the consequential decision themselves, and return
to work with every authorized surface carrying the same result—while the
compatible control remains quiet.
