# Phase 5 browser validation

Validation date: 2026-07-26 (Asia/Shanghai)

## Boundary

- Product UI: the canonical `apps/desktop` renderer in its browser build at
  `http://127.0.0.1:5174`.
- API: `http://127.0.0.1:4313`.
- Database: PostgreSQL database `intero_stand_in_validation`.
- Model path: the already configured server-side Vercel AI SDK adapter pointed
  at the deterministic local development provider on port `4312`. This proves
  the provider adapter path, not an external production provider.
- Clients: two isolated Playwright sessions, `phase5-admin` (Alex Rivera) and
  `phase5-member` (Morgan Lee), both authenticated through the development
  magic-link path. No global development identity selector was used.
- Agent: the canonical one-time Connect Agent prompt was redeemed by the real
  `@intero/mcp-stdio` cloud client. Its connection state is encrypted under
  `output/playwright/phase5/cloud-client`.

## Reproducible flow

1. Start the existing validation stack and canonical renderer:

   ```sh
   pnpm --filter @intero/server-api dev:pilot-provider
   pnpm dev:pilot
   ```

   The standard command uses API `4310` and renderer `5173`. The captured run
   intentionally used the following offset ports because the standard ports
   were occupied:

   ```sh
   INTERO_API_PORT=4313 pnpm --filter @intero/server-api dev
   VITE_INTERO_API_URL=http://127.0.0.1:4313 \
     pnpm --filter @intero/desktop exec vite \
     --config vite.web.config.ts --host 127.0.0.1 --port 5174
   ```

2. In Settings, configure the server-only provider; in Project, create a PI.
   In Settings > Agent, generate and redeem the one-time Codex connection
   prompt.

3. Submit real Project work and Spec content through stdio MCP:

   ```sh
   pnpm --filter @intero/mcp-stdio exec node scripts/phase5-mcp-smoke.mjs seed
   ```

4. In the independent member browser:

   - observe the Agent-created peer Work Item in Team Pulse;
   - add a line-4 Spec comment and confirm v1;
   - add a threaded Work Item comment.

5. Let the connected Agent read current-version review context and publish v2:

   ```sh
   INTERO_PHASE5_SPEC_ID=<spec-id-from-seed> \
     pnpm --filter @intero/mcp-stdio exec node \
     scripts/phase5-mcp-smoke.mjs respond
   ```

   The response records `previousConfirmedRevision: 1`; the member browser then
   shows v1 still confirmed beside unconfirmed v2. Request review and confirm v2
   in the member browser.

6. In the admin browser, reply to the Work Item comment and move the Agent work
   to `ready_for_test`. The member browser receives the update and moves it to
   `done`.

7. Create one unfinished Work Item in Sprint 1, close Sprint 1 as the admin, and
   verify both clients show it in Sprint 2 as
   `Carryover · from Sprint 1`, still `in_progress`. The normal member does not
   see PI/Sprint governance controls.

## Evidence

- `02-agent-work-on-board.png`: Agent-created work on the canonical board.
- `03-work-item-detail.png`: canonical activity/context/code detail layout.
- `04-member-peer-team-pulse.png`: member B sees peer cards, readable status and
  no main/subtask hierarchy.
- `05-member-review-confirmed-v1.png`: version-bound comment and v1 confirmation.
- `06-agent-v2-previous-confirmed.png`: Agent-created v2 while v1 remains
  confirmed.
- `07-member-confirmed-agent-v2.png`: member confirmation advances the confirmed
  version to v2.
- `09-admin-thread-reply-ready-for-test.png`: admin sees the member comment and
  moves the Agent work to `ready_for_test`.
- `10-member-completes-agent-work.png`: a normal authorized member completes
  `ready_for_test` work.
- `12-member-sees-carryover.png`: member B sees source-Sprint carryover; governance
  actions are absent.
- `13-threaded-comments-and-evidence.png`: nested comment reply and optional
  completion evidence in the canonical Work Item detail.

## Automated validation

```sh
pnpm lint

DATABASE_URL=postgres://intero:intero@127.0.0.1:5432/intero_stand_in_validation \
DATABASE_APP_URL=postgres://intero_app:intero_app@127.0.0.1:5432/intero_stand_in_validation \
  pnpm test:ts

cargo test --workspace
pnpm build
```

Result: TypeScript lint passed; 156 TypeScript tests passed and 17
environment-gated non-Phase-5 integration tests were skipped; 19 Rust tests
passed; all 15 workspace builds passed. A disposable fresh database applied all
migrations and exposed all 14 Phase 5 RLS tables before it was removed.

The browser proof above is a reproducible real-browser manual smoke using two
isolated Playwright contexts. It is not represented as an API-only test or as a
single-client acceptance.
