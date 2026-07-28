---
title: "explore: Product Capability Health as next-phase research"
type: exploration
status: discovery
date: 2026-07-29
origin: README.md
---

# Product Capability Health — next-phase research

## Status

Product Capability Health is a candidate for the next product-exploration
phase. It is not an accepted architecture, committed implementation target, or
claim that the current product already supports this model.

Do not add a new domain object, migration, API, top-level surface, or automated
health mutation until the discovery and validation gates in this document are
met. The immediate product sequence remains the conversation-driven conflict
and coordination loop.

## Origin in observed team work

This problem comes from the Intero exploration team's actual AI-first working
style:

- a useful capability may begin as an idea rather than a formal Feature, Spec,
  or Work Item;
- a person and Coding Agent explore across frontend, backend, product, and
  infrastructure boundaries until a usable outcome emerges;
- another person or Agent may later change a shared contract without knowing
  which informal capabilities now depend on it;
- each local task may appear complete while previously working product behavior
  drifts or regresses;
- a traditional tracker can show declared delivery but may not reconstruct what
  the product currently does or which evidence still supports it.

These observations are real for this team. Their prevalence and urgency in
other organizations remain an open research question.

## Product hypothesis

A Product Capability is a durable, observable product outcome that may be
declared intentionally or discovered from authorized work and validation
evidence.

Capability Health is a derived view of how strongly current evidence supports
that outcome. It is not a manually advanced delivery stage.

For example:

```text
A signed-in member can reconnect a Coding Agent without losing the selected
Project binding.
```

The Work State that produced this outcome may complete and leave the active
view. A formal Feature may never have existed or may be too broad. The
capability remains relevant because later work can preserve, invalidate, or
regress it.

| Concept            | Primary question                                     |
| ------------------ | ---------------------------------------------------- |
| Feature            | What did we intend to deliver and at what stage?     |
| Work State         | What is a person or Agent doing now?                 |
| Product Capability | What useful outcome can the product currently offer? |
| Capability Health  | What current evidence supports that outcome?         |

Use `ProductCapability` in domain language to avoid confusion with the existing
authorization `CapabilityGrant`.

## Candidate model, not a decision

A future Product Capability may need:

- a stable identity and concise outcome statement;
- Project and applicable environment or conditions;
- optional human steward without requiring exclusive implementation ownership;
- relations to Work State, Features, Specs, Decisions, contracts, artifacts,
  tests, Bugs, and other capabilities;
- sourced Claims and evidence with observation time, freshness, confidence,
  environment, and visibility;
- correction, merge, split, rename, and retirement history.

Candidate health language:

- `unknown`: the capability is known, but current evidence is insufficient;
- `supported`: qualifying fresh evidence supports the outcome;
- `at_risk`: a dependency, contract, implementation, or evidence boundary
  changed and targeted validation is needed;
- `regressed`: explicit contradictory or failing evidence shows the outcome no
  longer holds;
- `retired`: the team no longer intends to provide the outcome.

These names and transitions are hypotheses. In particular, `at_risk` must not
be treated as proof that a capability is broken.

## Discovery without heavyweight process

Explore whether Intero can:

- propose a capability candidate when completion, validation, discussion, and
  artifact evidence consistently describe a durable product outcome;
- explain why the candidate was inferred and which authorized evidence
  supports it;
- avoid silently publishing an inferred capability as confirmed product truth;
- deduplicate differently worded descriptions of the same outcome;
- avoid turning every implementation detail or passing test into a capability;
- let a person declare a known capability without requiring a full Spec or
  Feature;
- let people correct, merge, split, rename, reject, or retire a proposal.

## Intended Intero boundary

Capability Health should not become:

- a second planning board;
- a replacement for Feature, Bug, test, or release-management systems;
- a manually maintained green/yellow/red inventory;
- a reason to notify people whenever a related file changes;
- an unsupported AI assertion that a product works.

Intero may instead:

- show capability evidence and freshness through existing Project, Work State,
  search, and Stand-in surfaces;
- mark a capability `at_risk` only from an explainable affected relation;
- request the smallest useful validation;
- open a Coordination Thread when Work State, contract changes, or evidence
  disagree;
- create an Action Inbox item only when a person must choose, accept risk,
  supply missing validation, or confirm a regression;
- restore `supported` only from qualifying new evidence, not because an
  implementation task was marked complete.

## Three truths to validate separately

### 1. Problem truth

Does the Intero team repeatedly lose track of emergent product capabilities or
discover regressions only after later work has invalidated them?

This is already observed, but it should be documented as a corpus of concrete
incidents rather than remembered as a general feeling.

### 2. Mechanism truth

Can an evidence-backed Product Capability model identify real risk or regression
earlier without creating a noisy, expensive inventory?

This must be proven inside Intero before claiming a new product phase works.

### 3. Market truth

Do other AI-intensive teams experience the same collapse of role boundaries,
informal capability discovery, delayed synchronization, regression drift, and
decision pressure?

The Intero team's experience is a strong lead-user signal, not yet proof of a
broad market.

## Internal incident corpus

Before implementation, collect real cases with:

- the original idea or need;
- whether a Feature, Spec, or Work Item existed;
- how the capability emerged;
- the observable user or system outcome;
- supporting validation and environment;
- the later change that affected it;
- who first noticed the drift or regression and how long it took;
- whether earlier capability awareness could have changed the outcome;
- the coordination cost and user impact.

Prefer exact incidents and timelines over retrospective opinions.

## External problem discovery

Use a small, deliberately selected set of teams that already work heavily with
Coding Agents. Ask about the most recent real incident rather than whether the
Capability Health concept sounds useful.

Explore:

- how often people cross former role or subsystem boundaries;
- whether important capabilities begin without a formal Feature or Spec;
- how teams know what the product currently supports;
- how regressions are connected back to earlier informal work;
- how much manual synchronization remains after Agent adoption;
- whether decision and review volume has exceeded available human attention.

Record disconfirming evidence. The hypothesis should narrow or stop if other
AI-intensive teams retain reliable capability truth through existing practices,
do not experience meaningful regression drift, or would not trust inferred
capability records enough to act on them.

## First validation pair

1. Start with an informally discovered capability and no pre-seeded Feature,
   Spec, or Work Item.
2. Build its candidate identity from real completion and validation evidence,
   with a person able to correct the proposed outcome.
3. In the control case, apply a backward-compatible cross-boundary fix whose
   relevant validation still passes. The capability remains supported and no
   Coordination or Inbox noise is created.
4. In the conflict case, change a shared contract used by the capability and
   introduce contradictory or failing evidence. The capability becomes at risk
   or regressed and creates exactly one bounded coordination path.
5. Prove that the result comes from capability evidence and affected relations,
   not a Feature Tracker record.

## Candidate next-phase sequence

### N1 — Problem corpus and vocabulary

- [ ] Document recurring internal incidents.
- [ ] Interview external AI-intensive teams using recent-incident prompts.
- [ ] Define capability granularity, environment, evidence, freshness, and
      correction vocabulary from those cases.

### N2 — Read-only capability reconstruction

- [ ] Prototype capability candidates from existing authorized records without
      mutating product truth.
- [ ] Let people accept, correct, merge, split, or reject candidates.
- [ ] Measure duplicate, trivial, unsupported, and missing candidates.

### N3 — Passive health projection

- [ ] Derive `unknown`, `supported`, `at_risk`, and `regressed` without creating
      notifications or automatic work.
- [ ] Compare the projection with actual historical and live incidents.
- [ ] Require evidence and an explainable affected relation for every state.

### N4 — Bounded coordination integration

- [ ] Connect proven at-risk or contradictory states to one deduplicated
      Coordination Thread.
- [ ] Add Action Inbox only for required human action.
- [ ] Prove the control case remains quiet.

### N5 — Pilot decision

- [ ] Decide whether Capability Health belongs in Intero, should remain a
      read-only experiment, should integrate with another source of truth, or
      should be rejected.
- [ ] Write an ADR only after this decision.

## Discovery gates

Proceed beyond research only when:

- internal incidents show a recurring problem rather than one memorable failure;
- external discovery finds the same mechanism in more than one independent
  AI-intensive team or identifies a narrower lead-user market;
- people can agree on useful capability granularity;
- read-only reconstruction produces materially useful candidates with tolerable
  correction cost;
- supported, at-risk, and regressed states are explainable from evidence;
- the control case stays quiet while the conflict case triggers one useful
  coordination path;
- the model adds information not already represented adequately by Feature,
  Work State, tests, or existing project systems.

Failure to meet these gates is a valid research outcome.
