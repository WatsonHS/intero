# Agent Collaboration Evaluation — 2026-07-26

## Result

**Suite result: FAIL.**

This run exercised three isolated coding-Agent connections and three isolated
browser sessions against the same disposable Intero deployment. All 15
narrative-v2 checkpoints reached the real direct-cloud MCP ingress and were
accepted with stable client event IDs. The corresponding executor tests passed,
but the collaboration surfaces did not complete the end-to-end contract:

- no evaluation-specific Team Pulse card became visible;
- the Stand-in returned no answer in two runs and its conversation was
  unavailable in the third;
- Coordination showed safe, human-confirmable proposals, but the visible run
  mapping was not reliable enough to attribute the correct dependency;
- no public projection existed to exercise withdrawal.

The configured external model provider was unavailable. The bundled
deterministic demo provider was deliberately excluded from this evaluation and
was not counted as evidence.

## Isolation and scenario record

| Run | Executor outcome                                    | Direct-cloud event IDs                                                                                                                | Collaborator |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | Retry-delay change; executor validation 7/7         | `eval-r1-work-started`, `eval-r1-work-progressed`, `eval-r1-blocker-raised`, `eval-r1-validation-completed`, `eval-r1-work-completed` | Priya        |
| 2   | Feature-flag normalization; executor validation 4/4 | `eval-r2-work-started`, `eval-r2-work-progressed`, `eval-r2-blocker-raised`, `eval-r2-validation-completed`, `eval-r2-work-completed` | Morgan       |
| 3   | Release-label change; executor validation 4/4       | `eval-r3-work-started`, `eval-r3-work-progressed`, `eval-r3-blocker-raised`, `eval-r3-validation-completed`, `eval-r3-work-completed` | Jordan       |

The Executor could access only its isolated task checkout and direct-cloud
connection. The Collaborator used only the canonical browser UI. The Evaluator
received the rubric, screenshots, event IDs, and public executor outcomes; it
did not inspect source code, databases, logs, private Work State, or executor
checkouts.

## Independent scorecard

Scores are Accuracy / Legibility / Timeliness / Actionability / Privacy and
scope.

| Scenario                 |                  Run 1 |                  Run 2 |                  Run 3 | Passes |
| ------------------------ | ---------------------: | ---------------------: | ---------------------: | -----: |
| C1 — Progress is legible |      0/0/0/0/2 = **2** |      0/0/0/0/2 = **2** |      0/0/0/0/2 = **2** |    0/3 |
| C2 — Useful coordination |      0/1/2/2/2 = **7** |      1/1/2/2/2 = **8** |      0/1/2/2/2 = **7** |    0/3 |
| C3 — Grounded Stand-in   |      0/0/0/0/2 = **2** |      0/0/0/0/2 = **2** |      0/0/0/0/2 = **2** |    0/3 |
| C4 — Withdrawal          | **not executed: 0/10** | **not executed: 0/10** | **not executed: 0/10** |    0/3 |

The evaluator treated the visible `6 / 6` Coordination state as a hard failure
against the scenario's single-effect requirement. Because the evaluation used
the seeded demo Project rather than a clean Project, the screenshots alone
cannot distinguish pre-existing threads from duplicate scenario effects. The
run therefore proves neither correct deduplication nor a duplicate domain
effect; clean-project isolation is required before C2 can pass. C1, C3, and C4
fail independently of this ambiguity.

## Findings

### C1 — Progress is legible

No `collab-eval-r1`, `collab-eval-r2`, or `collab-eval-r3` card was visible in
Team Pulse. The Collaborator could not answer what was being worked on, the
completed outcome, evidence, next step, or who needed to act. Executor test
results and MCP acceptance do not substitute for a published product surface.

### C2 — A dependency creates useful coordination

The visible Coordination records stayed Project-scoped, exposed safe context
only, showed `request_coordination` rather than commitment authority, and
required an explicit human confirmation. Those privacy and autonomy boundaries
worked.

The selected records did not reliably match the intended run:

- Run 1 showed release-candidate numbering rather than retry-attempt indexing.
- Run 2 showed the expected unknown-value/fail-closed topic, but attributed
  final confirmation to Alex rather than the dependency owner.
- Run 3 showed retry-attempt indexing rather than release-candidate numbering.

The Collaborator submitted only reversible proposed conclusions and did not
make an autonomous commitment.

### C3 — Stand-in answers are grounded

Priya and Morgan each submitted both required questions through the canonical
Stand-in conversation. Neither received an answer, source, or freshness, and
the UI showed `通讯暂不可用。` Jordan's conversation never became usable, so
neither question could be submitted. No fixture answer was substituted.

### C4 — Withdrawal changes the shared view

No evaluation-specific public Pulse projection existed, so withdrawal could
not be exercised. There is no before/after public evidence and no claim that
private-state retention or exactly-one withdrawal effect was validated.

## Browser evidence

### Run 1 — Priya

- [Team Pulse](../../output/playwright/agent-collaboration-eval/run1-priya-team-pulse-no-collab-eval-r1.png)
- [Stand-in](../../output/playwright/agent-collaboration-eval/run1-priya-stand-in-two-questions-no-reply.png)
- [Coordination](../../output/playwright/agent-collaboration-eval/run1-priya-coordination-submitted.png)

### Run 2 — Morgan

- [Team Pulse](../../output/playwright/agent-collaboration-eval/run2-morgan-team-pulse-no-collab-eval-r2.png)
- [Stand-in](../../output/playwright/agent-collaboration-eval/run2-morgan-stand-in-two-questions-no-reply.png)
- [Coordination](../../output/playwright/agent-collaboration-eval/run2-morgan-coordination-submitted.png)

### Run 3 — Jordan

- [Team Pulse](../../output/playwright/agent-collaboration-eval/run3-jordan-team-pulse-no-collab-eval-r3.png)
- [Stand-in](../../output/playwright/agent-collaboration-eval/run3-jordan-stand-in-communications-unavailable.png)
- [Coordination](../../output/playwright/agent-collaboration-eval/run3-jordan-coordination-submitted.png)

The retained `*-auth-gate.png` screenshots document the unauthenticated state
encountered before the three users signed in through the canonical password
form. They are not success evidence.

## Exact validation boundary and rerun prerequisites

Validated:

- three isolated Agent connections used the real direct-cloud MCP ingress;
- narrative-v2 event IDs were accepted idempotently;
- three isolated users signed in through the canonical UI;
- Team Pulse, Stand-in conversation, and Coordination were inspected through
  product surfaces;
- Coordination proposals remained bounded and human-confirmable.

Not validated:

- real ModelGateway completion and safe-summary publication;
- grounded Stand-in answers with source and freshness;
- one scenario-specific Coordination effect on a clean Project;
- public withdrawal propagation with private state retained.

A valid rerun needs a real administrator-configured provider and a clean
disposable evaluation Organization/Project with no seeded Coordination or Pulse
records. The current Codex-host Intero MCP configuration also still points at a
stale local-runtime connection file and asks for `interod`; the evaluation used
new isolated direct-cloud connections instead. That host configuration is not
accepted as evidence for the removed product runtime.
