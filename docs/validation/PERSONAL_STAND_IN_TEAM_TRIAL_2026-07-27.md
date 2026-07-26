# Personal Stand-in Team Trial — 2026-07-27

## Result

**PASS.**

The configured external-provider canary passed on the exact b238 worktree,
followed by three successful three-role runs. Every counted run started from a
new Project and used the product-issued Settings connection prompt plus the
direct-cloud MCP client.

The corrected product model held throughout:

- no Project Stand-in identity or generic Project Stand-in conversation;
- exactly one default personal Stand-in conversation in Communications;
- `@` listed eligible personal Stand-ins for current Project-team members;
- the selected target ID was the human owner of the answering personal
  Stand-in;
- the Stand-in answer used only that owner's published Project Work State;
- private Work State, private DM history, raw prompts, files, diffs, terminal
  output, and provider secrets were not exposed to the answering path.

## Configured provider canary

| Record | ID |
| --- | --- |
| Project | `019f9f5d-27c0-73f7-92a1-dce6aa1e78f1` |
| MCP client event | `provider-canary-ms21l5q8-wbihqg` |
| Work State | `019f9f5d-3cd3-7348-9fe4-f538d221a216` |
| Personal Stand-in exchange | `019f9f5d-6637-710c-addd-2c0d226b3cee` |

The Collaborator selected Alex's personal Stand-in through the `@` picker.
The persisted exchange recorded Alex as the Stand-in owner and cited the exact
Work State above.

## Successful three-role runs

| Run | Project | Dependency / final event | Work State | Coordination | Personal Stand-in exchanges |
| --- | --- | --- | --- | --- | --- |
| 1 — target routing | `019f9f5e-1290-73ca-b7ae-0126b0b0e68f` | `collab-r1-ms21mgm1-a7x4mu-dependency` / `collab-r1-ms21mgm1-a7x4mu-validated` | `019f9f5e-2a48-7062-9529-11778704f569` | `019f9f5e-6126-74de-8ea1-1e127fdc5ae2` | `019f9f5e-7be2-7e12-a464-89fbd5a2cb6a`, `019f9f5e-8ab1-7c0d-a30e-f087f5afc688` |
| 2 — path correlation | `019f9f5f-ec68-7319-b5ad-491e13d2383b` | `collab-r2-ms21p1sn-06gb8v-dependency` / `collab-r2-ms21p1sn-06gb8v-validated` | `019f9f60-01d5-7e6d-8be8-23f472b2240d` | `019f9f60-1db0-7670-be71-d59995b9a687` | `019f9f60-569a-731d-a74c-dcd8ec4fb508`, `019f9f60-629d-7e60-8496-7265b68f1f24` |
| 3 — session / withdrawal | `019f9f60-830f-7cd7-807b-681b84e9b211` | `collab-r3-ms21pvpy-pu9kd6-dependency` / `collab-r3-ms21pvpy-pu9kd6-validated` | `019f9f60-9961-70f8-98bd-b4c6c3aa5f3a` | `019f9f60-d4df-74ee-b714-5ffd0bedaef5` | `019f9f60-fc4c-7767-a9ee-cf4ad9cb0f2e`, `019f9f61-0a69-76c1-a3c0-629f72dbc699` |

Alex was the Agent-backed executor and personal Stand-in owner. The
Collaborators were Priya, Morgan, and Jordan. The independent Evaluators were
Morgan, Jordan, and Priya. Every role ran in a separate browser context and was
limited to authorized product surfaces.

## Scorecard

All five dimensions are Accuracy / Legibility / Timeliness / Actionability /
Privacy and scope.

| Scenario | Run 1 | Run 2 | Run 3 | Passes |
| --- | ---: | ---: | ---: | ---: |
| C1 — Progress is legible | 2/2/2/2/2 = **10** | 2/2/2/2/2 = **10** | 2/2/2/2/2 = **10** | **3/3** |
| C2 — Useful coordination | 2/2/2/2/2 = **10** | 2/2/2/2/2 = **10** | 2/2/2/2/2 = **10** | **3/3** |
| C3 — Grounded personal Stand-in | 2/2/2/2/2 = **10** | 2/2/2/2/2 = **10** | 2/2/2/2/2 = **10** | **3/3** |
| C4 — Withdrawal | 2/2/2/2/2 = **10** | 2/2/2/2/2 = **10** | 2/2/2/2/2 = **10** | **3/3** |

## Correlation, timing, and withdrawal

| Run | Dependency-to-shared-view | Withdrawal-to-shared-view | Withdrawn at | Retry |
| --- | ---: | ---: | --- | --- |
| 1 | 15.726 s | 922 ms | `2026-07-26T17:00:02.589Z` | `duplicate=true`; first timestamp retained |
| 2 | 17.228 s | 801 ms | `2026-07-26T17:02:04.010Z` | `duplicate=true`; first timestamp retained |
| 3 | 20.255 s | 904 ms | `2026-07-26T17:02:46.662Z` | `duplicate=true`; first timestamp retained |

Each run produced exactly one Work-State-correlated Coordination thread. The
structured `targetPrincipalId` was a current Project participant. The
Collaborator proposed a reversible conclusion and confirmed it as a human
decision. Withdrawal removed the public Pulse entry while retaining the
Executor's private Work State, and the retry produced no second public effect.

## Browser evidence

- [Canary personal Stand-in grounding](../../output/playwright/collaboration-chain/00-provider-canary-stand-in.png)
- [Run 1 personal Stand-in grounding](../../output/playwright/collaboration-chain/r1-02-stand-in-grounding.png)
- [Run 2 personal Stand-in grounding](../../output/playwright/collaboration-chain/r2-02-stand-in-grounding.png)
- [Run 3 personal Stand-in grounding](../../output/playwright/collaboration-chain/r3-02-stand-in-grounding.png)

The harness also asserted that Communications contained exactly one default
personal Stand-in row and no row named after the Project.

## Excluded calibration attempts

The following attempts were not counted:

- an isolated-origin canary reached no Project because a browser runtime import
  pulled `node:crypto` into Vite; the browser-safe identity mapping fixed it;
- one canary completed MCP and Work State processing but used a stale fixture
  display name in a UI assertion; target authorization remained ID-based;
- runs 2 and 3 once stopped at sign-in before Project creation after exceeding
  the product's five-sign-ins-per-60-seconds limit; rerunning after the window
  cleared produced the counted results above.

No excluded Project or result was reused in the scorecard.

## Validation boundary

The exact implementation ran from
`/Users/example/.codex/worktrees/b238/intero`:

- TypeScript lint passed.
- Focused personal-Stand-in, Communications, route, domain, adapter, and port
  tests passed.
- Normalized PilotStore and automation integration tests passed 8/8 on a
  disposable PostgreSQL database.
- The demo seeding regression passed 1/1 on a separate disposable PostgreSQL
  database and confirmed that canonical demo data seeds no default Stand-in
  thread.
- Server API and desktop production builds passed.
- The full TypeScript suite reported 162 passed, 43 environment-gated tests
  skipped, and one failure in the separately owned language patch: the test
  expects `界面语言`, while the dirty language work renders
  `界面与协作语言`.
- The real provider canary and browser suite ran against the b238 API and
  renderer on isolated ports, using opaque configured Settings/provider state.

Both disposable databases were dropped. Product-issued Agent bindings were
disconnected and temporary encrypted cloud-client directories were deleted by
the harness. No model API key was read, printed, or retained.
