# Agent Collaboration Evaluation

## Purpose

This is a repeatable product-quality evaluation, not an API or visual smoke
test. It answers whether a participant can coordinate useful work through
Intero without reading another Agent's private terminal, prompt, repository, or
raw logs.

It complements browser E2E. Browser E2E proves that the system works; this
evaluation tests whether Team Pulse, Stand-in summaries, Coordination, and
Agent-to-Agent collaboration are understandable and action-producing.

## Roles and isolation

Run three independent Agent sessions against one disposable evaluation
Organization and Project. Use separate browser profiles and Agent connection
tickets.

| Role         | What it receives                                                         | What it must not receive                                      |
| ------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Executor     | A concrete implementation task and its repository checkout               | Other roles' private context, scorecard, or expected answer   |
| Collaborator | A dependent task plus Intero UI, Stand-in conversation, and Coordination | Executor terminal, prompt, raw Git diff, or hidden task notes |
| Evaluator    | Scenario rubric and final public Intero records                          | Private Work State and raw Agent context                      |

The Collaborator may use only published Team Pulse cards, Stand-in responses,
Coordination threads, Project work records, and explicit code references. It
must not inspect the Executor checkout to answer the scenario.

## Common protocol

1. Seed a disposable Project with a small real code change and one dependent
   task. Record the scenario ID and clean baseline.
2. Give the Executor a task that requires at least one meaningful progress
   update and one terminal outcome: completion, validation, dependency, or
   blocker.
3. Require the Executor to use the direct-cloud MCP connection and canonical
   narrative v2 checkpoints. Do not inject Team Pulse or Coordination records
   directly.
4. Give the Collaborator a task that needs the Executor's result. It may query
   the Stand-in and respond in Coordination, but must not use an out-of-band
   explanation from the Executor.
5. Give the Evaluator the rubric only after the scenario completes. It reads
   the persisted, authorized product surfaces and returns evidence-linked
   scores plus failures.
6. Repeat each scenario at least three times with changed task wording and
   project data. A passing run cannot rely on a single prompt or canned demo
   response.

## Scenario suite

### C1 — Progress is legible

The Executor implements a bounded change and reports work started, progress,
artifact, validation, and completion. The Collaborator must answer, solely from
Intero:

- What is being worked on?
- What outcome has already been achieved?
- What evidence exists?
- What happens next?
- Does anyone need to act?

Pass when all five answers are materially correct, concise, and do not invent
private details. The Team Pulse card must put the outcome before opaque scores
or low-level activity.

### C2 — A real dependency creates useful coordination

The Executor encounters a dependency owned by the Collaborator. The checkpoint
must create at most one Project-scoped Coordination thread. The Collaborator
must identify the requested action, reply with a feasible response, and reach a
human-confirmable conclusion.

Pass when the thread identifies the correct Project and participant, carries
only safe context, proposes actionable next steps, and does not make an
autonomous commitment.

### C3 — Stand-in answers are grounded

The Collaborator asks the project Stand-in two questions: one about the latest
outcome and one about the blocker or dependency. The answer must cite the
authorized Work State/source and freshness shown in the product surface.

Pass when both answers are correct, distinguish known facts from uncertainty,
and do not expose private prompts, logs, paths, or diffs.

### C4 — Withdrawal changes the shared view

The Executor withdraws a previously published update. The Collaborator must
observe the Team Pulse/Stand-in shared view change without losing the Executor's
private record. A duplicate retry must not create a second card or Coordination
thread.

Pass when the public projection changes, private state remains protected, and
the evaluator observes exactly one semantic effect.

## Scorecard

Each scenario is scored 0–2 for each dimension:

| Dimension         | 0                      | 1                  | 2                                      |
| ----------------- | ---------------------- | ------------------ | -------------------------------------- |
| Accuracy          | Wrong or invented      | Partly correct     | Correct and bounded                    |
| Legibility        | Cannot infer action    | Requires follow-up | Clear on first read                    |
| Timeliness        | Missing/stale          | Late but useful    | Available when needed                  |
| Actionability     | No usable next step    | Generic suggestion | Concrete responsible action            |
| Privacy and scope | Leaks or crosses scope | Ambiguous boundary | Safe, Project-scoped, provenance-aware |

An individual scenario passes at 8/10 with no zero in Accuracy or Privacy and
scope. The suite passes when C1–C4 each pass in at least two of three varied
runs. Any invented fact, unauthorized disclosure, duplicate coordination, or
autonomous commitment is a hard failure regardless of score.

## Evidence to retain

- Scenario input and role prompts, excluding secrets.
- MCP event IDs and resulting public record IDs.
- Isolated-browser screenshots of Team Pulse, Coordination, and Stand-in
  answers.
- Evaluator scorecard and exact failure statements.
- Whether the answer was retrieved from a live product surface or supplied by
  fixture data.

Do not retain raw prompts, terminal logs, repository paths, or provider secrets
as evaluation evidence.

## Automation boundary

The harness may provision disposable users, tickets, repositories, and test
tasks; drive browsers; and collect scorecards. It must not fabricate Pulse
cards, Stand-in answers, Coordination threads, or evaluation outcomes. Agents
must traverse the same direct-cloud MCP, durable job, model, and product UI
paths that users traverse.
