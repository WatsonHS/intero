---
title: "explore: conversation-driven AI-native collaboration"
type: exploration
status: todo
date: 2026-07-29
---

# Conversation-driven AI-native collaboration

Roadmap placement and the code-level delivery design are maintained in:

- [Intero product roadmap](../PRODUCT_ROADMAP.md)
- [R1/R2 coordination-kernel implementation plan](2026-07-31-001-r1-r2-coordination-kernel-implementation-plan.md)

## Product hypothesis

Existing collaboration tools preserve messages, while project tools preserve
tasks. People still have to notice when a conversation has become real work,
find the affected participants, move context between tools, maintain a shared
understanding, and carry the conclusion back to the team.

In an AI-native collaboration model, Intero should help turn authorized
conversation and Agent Work State into bounded coordination:

```text
work becomes related or contradictory
→ Intero detects a possible coordination need
→ a temporary Coordination Thread is proposed or opened
→ affected people and Stand-ins clarify the issue
→ required human actions enter Action Inbox
→ the source Room shows one silently refreshed summary
→ the conclusion updates the relevant work context
```

The goal is not to make chat noisier or let an Agent manage the team
autonomously. The goal is to shorten coordination latency while keeping
authority, attention, privacy, and final commitments with people.

## Primary validation scenario: two people create a real conflict

Use one clean disposable Project with two people, two Coding Agent connections,
and no seeded Coordination records.

### Initial Work State

- Alex is changing a shared API contract from `retryDelayMs` to
  `retryAfterMs` and intends to remove the old field.
- Priya is implementing client retry behavior against `retryDelayMs` and
  reports that the client path is ready for validation.
- Both updates belong to the same Project and refer to the same authorized
  contract, but neither person reads the other's private Agent session.

### Expected collaboration path

1. Both Coding Agents publish normal structured Work State through the
   canonical MCP path.
2. The Stand-in detects that the two active efforts share an affected contract
   and contain incompatible assumptions.
3. Intero creates or reuses exactly one Project-scoped temporary Coordination
   Thread. It explains the possible conflict, cites the safe source Work State,
   identifies the unresolved contract choice, and proposes next steps.
4. The source Project Room shows one compact entry for the temporary discussion.
   Its summary updates silently in place as the discussion develops. Refreshing
   it does not create new chat messages, unread counts, or notification noise.
5. Priya, while actively viewing the Room, sees a dismissible prompt on the
   temporary-discussion entry:
   `This may affect your retry work. Take a look?`
   The prompt explains why Intero considers the discussion relevant.
6. If Priya must choose or confirm something, Intero creates or updates one
   deduplicated Action Inbox item. Passive relevance alone does not create an
   Inbox item.
7. Alex and Priya agree on a compatibility window. A human confirms the
   conclusion; Intero does not invent the commitment.
8. The Thread closes with a structured result: decision, affected work,
   actions, owners explicitly chosen by people, unresolved questions, sources,
   and freshness.
9. The source Room keeps the same compact entry and silently replaces its
   working summary with the final result.

### What this scenario must prove

- Conflict detection is derived from real authorized Work State rather than a
  fabricated Coordination fixture.
- The detected conflict names the correct shared boundary and participants.
- Retry or replay creates no duplicate Thread, summary entry, Inbox item, or
  prompt.
- Neither participant receives the other's raw prompt, files, diffs, terminal
  output, or private Work State.
- The summary distinguishes source facts, model interpretation, uncertainty,
  and the human-confirmed conclusion.
- The visible flow helps the two people resolve the conflict without requiring
  an out-of-band explanation.

## Interaction model to explore

### Temporary discussion entry

- [ ] Detect explicit references to a Spec, Work Item, Bug, User Story,
      Decision, code boundary, or other supported Project object.
- [ ] Detect semantic triggers such as a contradiction, blocker, dependency,
      defect suspicion, review need, or explicit coordination request.
- [ ] Offer `Open temporary discussion`, `Create work draft`,
      `Link existing work`, and `Ignore` when more than one response is valid.
- [ ] Bind the discussion to a Project, source Room, initiating message or Work
      State, affected objects, and a concrete question to resolve.
- [ ] Give the discussion an explicit lifecycle:
      `proposed`, `active`, `waiting`, `resolved`, `closed`, or `dismissed`.
- [ ] Reuse an existing discussion when the same unresolved condition is
      detected again.

### Silent summary refresh

- [ ] Render one compact summary entry in the source Room instead of posting
      repeated summary messages.
- [ ] Update that entry in place without changing unread counts or triggering
      ordinary message notifications.
- [ ] Show a subtle freshness indicator when the summary changes.
- [ ] Summarize current conclusion, unresolved question, affected people, and
      whether anyone needs to act.
- [ ] Publish a final structured result into the same entry when the discussion
      closes.
- [ ] Keep full realtime summarization inside the temporary discussion rather
      than streaming it into the source Room.

### Relevance prompt and attention routing

- [ ] When an affected person is actively viewing the source Room, attach a
      small, dismissible relevance prompt to the temporary-discussion entry.
- [ ] Explain relevance in plain language, for example ownership, dependency,
      shared interface, requested review, or conflicting Work State.
- [ ] Let the person open, dismiss, mute, or revisit the discussion.
- [ ] Do not treat model confidence alone as permission to interrupt someone.
- [ ] Route an item to Action Inbox only when a specific human decision,
      confirmation, review, ownership choice, or commitment is required.
- [ ] Deduplicate repeated relevance signals and respect notification
      preferences.

### Inside the temporary discussion

- [ ] Maintain a quiet working summary of facts, interpretations, decisions,
      action items, and unresolved questions.
- [ ] Suggest participants but explain why each person may be relevant.
- [ ] Never add a participant or widen visibility beyond policy without an
      authorized action.
- [ ] Let a participant correct the summary or mark an inference as wrong.
- [ ] Preserve source, time, freshness, confidence, and policy for derived
      statements.
- [ ] Require human confirmation for priority, ownership, approval, scheduling,
      external action, or final commitment.

### Closing and returning to work

- [ ] Close with the confirmed conclusion, remaining uncertainty, explicit
      actions, human-selected owners, and affected objects.
- [ ] Offer bounded updates to related Specs, Bugs, Work Items, Decisions, and
      review state with provenance and preview.
- [ ] Make consequential mutations human-confirmed, auditable, idempotent, and
      revertible.
- [ ] Return only the material outcome to the source Room and relevant Project
      surfaces.
- [ ] Detect abandoned or stale temporary discussions and ask whether to close,
      reassign, or keep waiting.

## Follow-up collaboration needs

- [ ] **Defect drafting and duplicate detection:** turn statements such as
      "this logic seems wrong" into a reviewable Bug draft, first searching for
      related existing work.
- [ ] **Decision capture and decision debt:** recognize proposed decisions and
      repeated unresolved debates; offer a versioned Decision record without
      declaring it final.
- [ ] **Spec and conversation drift:** identify when new discussion conflicts
      with a confirmed Spec or prior Decision and offer to reopen review.
- [ ] **Parallel-work collision:** detect incompatible changes to the same API,
      schema, permission boundary, module, or release assumption.
- [ ] **Orphaned asks:** surface questions with no response, actions with no
      human-selected owner, and discussions waiting on someone who was never
      notified.
- [ ] **Human-Agent handoff:** generate bounded execution context for a Coding
      Agent and return validation evidence to the originating discussion.
- [ ] **Impact exploration:** propose affected Specs, work, tests, reviewers,
      and discussions when a decision or contract changes.
- [ ] **Semantic catch-up:** summarize decisions, required actions, relevant
      changes, and safely ignorable activity instead of presenting only unread
      message counts.

## Deferred next-phase exploration

Product Capability Health is intentionally outside this implementation
sequence. The problem comes from real team experience, but its discovery model,
evidence semantics, health projection, and product surface are not settled.

Continue that work in
[Product Capability Health — next-phase research](2026-07-29-003-product-capability-health-roadmap.md).

## Delivery sequence

### P0 — Prove the collaboration mechanism

- [ ] Build the clean two-person conflict fixture and repeatable evaluation.
- [ ] Detect the incompatible Work State and create exactly one Coordination
      Thread.
- [ ] Complete the human-confirmed resolution through real product surfaces.
- [ ] Record timing, provenance, privacy, deduplication, and browser evidence.

### P1 — Prove the low-noise interaction

- [ ] Add the temporary-discussion entry to the source Room.
- [ ] Implement silent in-place summary refresh.
- [ ] Add the in-context relevance prompt for an affected active viewer.
- [ ] Route required human action into Action Inbox.
- [ ] Validate that passive relevance creates no unread or notification noise.

### P2 — Close the loop

- [ ] Add structured discussion closure and final source-Room summary.
- [ ] Preview and apply authorized updates to linked work objects.
- [ ] Add correction, provenance, audit, deduplication, and revert behavior.
- [ ] Measure whether the flow reduces coordination latency and out-of-band
      explanation.

## Evaluation gates

- [ ] A possible conflict appears within 30 seconds of the second qualifying
      Work State becoming shareable.
- [ ] Three replayed signals still produce exactly one active Coordination
      Thread and one relevant Action Inbox item at most.
- [ ] Silent summary refresh produces no new Room message, unread increment, or
      ordinary message notification.
- [ ] A relevance prompt appears only to an authorized affected person who is
      actively viewing the source Room, and it is explainable and dismissible.
- [ ] Passive relevance creates no Action Inbox item; a required human choice
      does.
- [ ] The confirmed resolution is visible from the Coordination Thread, source
      Room, and affected work context without contradictory state.
- [ ] An evaluator can explain the conflict, resolution, responsible human
      actions, and remaining uncertainty without reading private Agent context.
- [ ] Authorization, privacy, provenance, idempotency, and human-authority
      failures remain hard failures regardless of usability score.
