---
title: "Intero product roadmap: evidence before expansion"
status: active
date: 2026-07-31
---

# Intero product roadmap

[简体中文](PRODUCT_ROADMAP.zh-CN.md) · English

## Purpose

Intero is not committing to one universal AI-native software-engineering
method. Team structure, coordination cost, and useful process may differ
between exploration, rapid delivery, stabilization, and maintenance. Those
differences are part of the research rather than assumptions the product may
hide.

The roadmap therefore advances through evidence gates, not feature volume or a
fixed calendar. Each stage must prove a narrower claim before Intero expands
its product surface or authority.

## Product thesis

Intero begins as a coordination and interoception layer for software teams in
which people and Coding Agents work with increasing autonomy:

> Help a team notice when independent work requires shared understanding,
> coordination, or validation, without monitoring private activity or turning
> every Agent action into an interruption.

This thesis can survive different delivery phases. What changes between phases
is the signal, risk threshold, and required evidence—not the need for a team to
maintain a trustworthy shared reality.

The longer-term ambition is an AI-native software-engineering and
project-management platform where project reality grows from authorized
conversation, actual work, decisions, and evidence. Automatic coordination is
the initial wedge and, if the evidence supports it, the engine beneath that
broader platform. The roadmap does not assume in advance that every traditional
project-management object or workflow belongs inside Intero.

## Product shape

### Core product

These capabilities must become trustworthy and coherent:

- authorized conversation as a first-class source of human intent, questions,
  disagreement, and candidate decisions—without treating discussion as truth;
- privacy-bounded Agent Work State and explicit shared Claims;
- correlation with repository, test, CI, and runtime evidence where available;
- Team Pulse as ambient awareness rather than task ranking;
- explainable conflict, dependency, and relevance detection;
- bounded Coordination Threads;
- Action Inbox for specific human decisions and commitments;
- plain-language coordination briefs with exact technical evidence available
  on demand;
- provenance, authorization, correction, deduplication, and recovery.

### Agent roles and scope routing

The product exposes two Intero Agent roles:

- a personal Stand-in represents one person and protects their private context;
- Intero in a shared Room represents the shared space and maintains authorized,
  human-confirmed team reality.

External Coding Agents execute work. Projects remain scoped state, policy, and
evidence contexts behind Intero rather than user-addressable Project Agents. A
Team Room may discuss several projects; people mention only `@Intero`. Intero
infers a single-Project, cross-Project, Team-level, or unresolved scope from the
conversation, linked work, participants, and shareable Work State. Scope
inference may route information but never grant access or widen visibility. If
the evidence is ambiguous, Intero asks for one lightweight clarification rather
than silently choosing a Project.

### Compatibility context

Project, Epic, Feature, Work Item, Sprint, Spec Review, code references, and
future provider integrations help Intero understand declared work. They are
useful context, but they are not the product thesis and must not require Intero
to own every team system of record in the initial coordination phase. Evidence
may later justify making some of them first-class parts of the wider platform;
that is not a prerequisite for proving the first wedge.

### Research track

The following remain falsifiable hypotheses:

- semantic discovery of relationships that Agents did not declare;
- phase- or risk-adaptive coordination thresholds;
- Product Capability reconstruction and Capability Health;
- broader models of AI-native team software engineering.

Research may run in parallel as read-only discovery. It does not earn a domain
object, migration, automated mutation, or top-level product surface until its
own evidence gate is met.

## Interaction model

Intero should escalate attention gradually:

```text
ambient awareness
→ contextual relevance
→ explicit human action
→ human-confirmed consequence
```

| Level                 | Product behavior                                                                 |
| --------------------- | -------------------------------------------------------------------------------- |
| Ambient awareness     | Team Pulse and silently refreshed summaries; no routine interruption             |
| Contextual relevance  | A local, explainable, dismissible prompt while an affected person views context  |
| Explicit human action | One deduplicated Action Inbox item for a decision, review, or commitment         |
| Confirmed consequence | Previewed, authorized, auditable, idempotent, and revertible mutation or closure |

A possible relationship is not automatically an action. A model confidence
score is not permission to notify someone.

Human-facing coordination should also reveal detail gradually:

```text
what happened, why it matters, and whether I need to act
→ the conflicting work, unresolved question, and available choices
→ exact identifiers, sources, evidence, freshness, and uncertainty
```

The first layer must use plain language. Exact API, field, module, test, and
revision names remain available as technical anchors. Facts, model
interpretation, suggestions, and human-confirmed decisions must never be
presented as the same kind of statement.

## Evidence-gated roadmap

The `R` stages are research and delivery gates, not release-number promises.

### R0 — Trustworthy product baseline

Finish the current product-closure work and target-infrastructure release
evidence before adding another major surface.

Exit evidence:

- the canonical Agent, Work State, realtime, Action Inbox, and authorization
  paths are recoverable and observable;
- the release baseline is green;
- production-like capacity, failover, and canary checks pass in the intended
  environment;
- privacy or human-authority failures remain hard blockers.

### R1 — Prove the coordination kernel

Implementation status (2026-07-31): the explicit shared-Claim contract,
deterministic matcher, multi-source persistence, MCP evaluation pair, and
canonical conflict materialization are implemented and locally validated.
Browser acceptance, a deployed durable-worker canary, and target-environment
release evidence are still required before this gate is marked proven.

Run one controlled pair through real authorized Work State:

1. A compatible cross-boundary change stays quiet.
2. An incompatible assumption about the same shared boundary creates exactly
   one bounded Coordination Thread.

The first implementation should prefer explicit, structured, shareable
boundary Claims and deterministic matching. Model inference may explain a
candidate, but must not be the only reason the product declares a conflict.

Exit evidence:

- the control case creates no Thread, prompt, or Inbox item;
- the conflict case identifies the correct boundary, sources, and people;
- replay produces no duplicate signal or Thread;
- no raw prompt, file, diff, terminal output, or private Work State is exposed;
- the path originates from the real MCP and worker flow, not seeded
  Coordination data.

### R2 — Prove low-noise collaboration

Implementation status (2026-07-31): the canonical child Thread, one
in-place-updated Room summary, contextual dismiss/mute/revisit controls,
confirmation-only Action Inbox routing, and specialized idempotent closure are
implemented and locally validated. The user-visible browser evaluation and
real-provider canary remain open evidence.

Turn the detected conflict into a complete user interaction:

- show one temporary-discussion entry in the source Room;
- update its compact summary silently in place;
- explain the conflict, impact, and unresolved question in plain language while
  keeping exact technical evidence available on demand;
- show an explainable relevance prompt only in context;
- route only a required decision or confirmation into Action Inbox;
- close with a human-confirmed structured result in the same Room entry.

Exit evidence:

- summary refresh adds no message, unread count, or ordinary notification;
- passive relevance adds no Action Inbox item;
- the affected people can resolve the conflict without an out-of-band
  explanation;
- an affected person can understand what happened, why it matters, and whether
  they need to act from the compact brief without decoding internal ontology;
- the expanded view preserves the exact boundary, sources, uncertainty, and
  human-confirmed result;
- the Room, Coordination Thread, Inbox, and affected work do not disagree;
- correction, dismissal, retry, and replay remain safe.

### R3 — Pilot across work phases

Use research labels—not a new workflow-mode engine—to compare:

- exploration;
- rapid delivery;
- stabilization;
- maintenance.

Observe whether the relevant signals, acceptable uncertainty, and intervention
thresholds change with reversibility, blast radius, product maturity, and
operational risk.

Exit evidence:

- useful coordination repeats across multiple real incidents; and
- Intero either demonstrates value in more than one work phase or deliberately
  narrows its target to the phase and team profile where the value is real.

### R4 — Read-only Capability Health experiment

Collect an internal incident corpus, conduct external problem discovery, and
reconstruct Product Capability candidates from existing authorized
conversation, work, and validation evidence. Conversation may reveal intent or
an observed outcome, but does not prove that a capability works. People must be
able to accept, correct, merge, split, or reject every candidate. Health
projection remains passive before it can create coordination.

Exit evidence:

- Capability Health adds information not already represented by Feature
  tracking, Work State, tests, or an existing project system;
- candidate granularity and correction cost are tolerable;
- `supported`, `at_risk`, and `regressed` are explainable from current evidence;
- a compatible control stays quiet while contradictory evidence creates one
  useful coordination path.

### R5 — Decide the product boundary

Use the accumulated evidence to decide whether Intero should:

- remain primarily a conflict and attention coordination layer;
- pursue the long-term ambition of an AI-native project-management and shared
  product-reality platform;
- retain Capability Health as a read-only aid;
- integrate rather than own more project-management context;
- narrow to a specific class of AI-intensive teams; or
- stop a hypothesis that did not survive testing.

Narrowing or rejecting a direction is a valid outcome.

## Evaluation

Intero should not optimize for the number of summaries, Threads, tasks, or
notifications it creates. Evaluate:

- useful conflict precision and sampled missed-conflict rate;
- false prompts and Inbox interruptions per person;
- time from conflicting state to detection and human-confirmed resolution;
- out-of-band explanation still required;
- whether a person can understand the event, impact, relevance, and required
  action from the compact brief without asking for a translation;
- manual status reporting, context transfer, follow-up, and project-record
  maintenance avoided;
- regressions or incompatible changes caught before integration or release;
- human correction and dismissal rate;
- privacy, authorization, and irreversible-authority violations, which must be
  zero.

The long-term outcome is:

> Preserve team autonomy and delivery speed while reducing the number of times
> the team's shared reality silently diverges.

## Deliberate non-goals

The current roadmap does not commit Intero to:

- a central AI manager that assigns or approves all work;
- a generic Agent orchestrator or AI decision-editor framework;
- a drop-in replacement for chat, Git, CI, test, or existing
  project-management systems before the coordination thesis is proven;
- one mandatory software-engineering process for every product phase;
- automatic Product Capability truth inferred without reviewable evidence.

These are boundaries on the current evidence-gated sequence, not a rejection
of the longer-term platform ambition.

## Current plan map

- [Golden Case: Team-room conversation to cross-project coordination](GOLDEN_CASE.md)
  is the canonical end-to-end product and acceptance scenario.
- [Core product closure and pilot UX](plans/2026-07-29-001-product-closure-and-ux-plan.md)
  supplies R0.
- [Conversation-driven AI-native collaboration](plans/2026-07-29-002-conversation-driven-collaboration-todo.md)
  defines the product hypothesis and evaluation pair for R1 and R2.
- [R1/R2 coordination-kernel implementation plan](plans/2026-07-31-001-r1-r2-coordination-kernel-implementation-plan.md)
  maps that experiment onto the current codebase.
- [Product Capability Health research](plans/2026-07-29-003-product-capability-health-roadmap.md)
  remains the R4 discovery track.
