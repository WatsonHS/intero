# Intero cloud-first pilot runbook

This pilot uses the canonical `apps/web` product in a browser. The desktop
binary is optional and loads the same Web application through its Electron
shell; it has no separate product renderer.

## Start locally

Prerequisites: Node.js 24+, Corepack, and pnpm 10.

```bash
corepack pnpm install
pnpm --filter @intero/mcp-stdio build
pnpm dev:pilot
```

`pnpm dev:pilot` starts the Fastify API at `http://127.0.0.1:4310` and the
canonical Intero Web application at `http://127.0.0.1:5173`.

For a persistent PostgreSQL pilot, migrate with an administrator connection,
then run the API with the RLS-constrained application connection and a
deployment-only provider encryption key:

```bash
export DATABASE_URL='postgresql://migration-user:...@host/intero'
export INTERO_DATABASE_URL='postgresql://intero_app:...@host/intero'
export INTERO_PILOT_PERSISTENCE='postgres'
export INTERO_PROVIDER_ENCRYPTION_KEY='replace-with-a-long-random-secret'
pnpm --filter @intero/server-api migrate
pnpm dev:pilot
```

### Phase 2 reliable collaboration services

The persistent Pilot path uses three explicitly selected adapters:

- normalized PostgreSQL plus Graphile Worker for durable Stand-in jobs
  and the transactional outbox;
- SpiceDB for organization/team/project authorization, with normalized
  membership as the relationship source of truth;
- Centrifugo for project-scoped realtime fanout. Polling remains available as
  repair/fallback behavior.

For local validation, start only the Phase 2 dependencies (MinIO is not part of
this phase), apply both schemas, and initialize Graphile Worker:

```bash
docker compose up -d postgres spicedb centrifugo

export DATABASE_URL='postgres://intero:intero@127.0.0.1:5432/intero'
export INTERO_DATABASE_URL='postgres://intero_app:intero_app@127.0.0.1:5432/intero'
export INTERO_WORKER_DATABASE_URL='postgres://intero_worker:intero_worker@127.0.0.1:5432/intero'
export INTERO_PROVIDER_ENCRYPTION_KEY='replace-with-a-long-random-secret'
export INTERO_PILOT_PERSISTENCE='postgres'
export INTERO_PILOT_STAND_IN_JOBS='transactional-outbox'
export INTERO_PILOT_AUTHORIZATION='spicedb'
export INTERO_SPICEDB_ENDPOINT='127.0.0.1:50051'
export INTERO_SPICEDB_TOKEN='intero-development'
export INTERO_SPICEDB_INSECURE='true'
export INTERO_PILOT_REALTIME='centrifugo'
export INTERO_CENTRIFUGO_API_URL='http://127.0.0.1:8000'

pnpm --filter @intero/server-api migrate
pnpm --filter @intero/server-api migrate:spicedb
pnpm --filter @intero/server-worker migrate
```

Run `pnpm --filter @intero/server-worker dev` in one terminal, then
`pnpm dev:pilot` in another. The API accepts an MCP checkpoint without waiting
for the model and returns Stand-in `pending`; the worker later publishes
the safe projection. `/ready` reports PostgreSQL, worker-heartbeat, and SpiceDB
state. A missing/stale worker is degraded, while unavailable PostgreSQL or
SpiceDB is not ready.

Stand-in work is serialized per Project. Model calls run outside
database locks. Completion uses compare-and-set writes so Graphile's
at-least-once delivery has one domain effect. Provider failures use bounded
Graphile retries; attempt 8 records terminal failure/dead-letter metadata.
The reconciler repairs a pending-state/enqueue crash window, and the worker
writes a heartbeat and shuts down gracefully.

The realtime dispatcher publishes the same durable domain outbox to
`intero:project:<project-id>`. Failed Centrifugo delivery leaves the outbox row
retryable with backoff; successful delivery records completion. Clients must
also refresh through the existing polling path after reconnect, so realtime
delivery is an acceleration rather than a second source of truth.

Without `INTERO_DATABASE_URL`, pilot state is in memory and resets when the API
restarts. When `INTERO_DATABASE_URL` is set, normalized PostgreSQL tables are
the sole Pilot source of truth. The historical `pilot_state` JSONB table is not
read, backfilled, shadow-compared, or updated.

The API exposes:

- `/health` for process liveness and backward-compatible connectivity checks;
- `/ready` for dependency readiness. PostgreSQL/schema failure returns `503`;
  optional future adapters may report degraded status without widening access.

### Validation-stage initialization and reset

Migrations `0012_normalized_pilot_state.sql` and
`0013_rainy_gunslinger.sql` are additive. Apply both before starting an API
configured with `INTERO_PILOT_PERSISTENCE=postgres`; `0013` adds durable
Stand-in jobs and worker heartbeats.

Previous validation-stage Pilot data is intentionally not migrated. To discard
normalized Pilot data for exactly one known development Organization, use the
guarded reset command. It requires both the target Organization UUID and an
exact confirmation containing that UUID:

```bash
export DATABASE_URL='postgresql://migration-user:...@host/intero'
export INTERO_RESET_ORGANIZATION_ID='019b5ac0-7600-7000-8000-000000000001'
export INTERO_RESET_CONFIRM="DELETE_NORMALIZED_PILOT_DATA:${INTERO_RESET_ORGANIZATION_ID}"
pnpm --filter @intero/server-api reset:pilot
```

The command prints the selected database host/name and Organization before
deleting. Never run it against a shared or unknown target. It removes only
normalized Pilot rows plus their Pilot Activity Events/outbox entries; it does
not drop schema or automatically delete the Organization.

Rollback is code/config rollback, not a destructive down migration. The
additive normalized tables remain in place. An older snapshot-based build
cannot read the new normalized Pilot data; at this validation stage either roll
forward again or explicitly reset/reinitialize the known development
Organization. No compatibility or legacy-data migration promise is made.

## Internal pilot prerequisites

In development, open canonical **Settings → Test Setup** deliberately; the Web
renderer never forces Setup and does not replace the product navigation. In
**Setup → 模型服务**, the deployment administrator enters an
OpenAI-compatible provider base URL, API key, and default model. The key is sent
only to the API, encrypted at rest with AES-GCM, and never returned in browser
responses.

For local flow validation without spending provider credits, start the bundled
test-only OpenAI-compatible fixture in another terminal:

```bash
pnpm --filter @intero/server-api dev:pilot-provider
```

Then enter:

- Endpoint: `http://127.0.0.1:4312/v1`
- API key: any non-empty local test value
- Model: `intero-pilot-model`

This fixture proves that the real Vercel AI SDK adapter, structured-output
schema, server-only credentials, and application orchestration are exercised.
It is an internal adapter regression fixture only. It does **not** satisfy the
Stand-in acceptance scenario below, which must use an administrator-
configured real provider endpoint and model.

The dev identity selector is available only inside Test Setup. Complete the
internal setup once so that two isolated browser contexts represent different
members of one Team, share one collaborative Project, and have an active Codex,
Claude Code, or OpenCode connection. Setup/provider checks, policy controls,
adapter contracts, privacy withdrawal, and canonical-navigation regression are
prerequisites and regression checks; they are not additional user-facing
acceptance scenarios.

### Phase 4 invite-only onboarding validation

Production access is session-based and invite-only. Start the API with a stable
Better Auth secret, a delivery webhook, and the exact renderer origin:

```bash
export INTERO_AUTH_SECRET='replace-with-at-least-32-random-characters'
export INTERO_MAGIC_LINK_WEBHOOK='https://operator.example/magic-link'
export INTERO_AUTH_TRUSTED_ORIGINS='http://127.0.0.1:5173,http://127.0.0.1:4310'
pnpm dev:pilot
```

For local browser validation only, the webhook may be replaced by the explicit
development-link switch:

```bash
export INTERO_AUTH_DEVELOPMENT_LINKS='true'
```

Do not enable `INTERO_ALLOW_DEVELOPMENT_IDENTITY` for this test. It is an
explicit development fallback, not the normal onboarding path.

Use two isolated browser contexts against the same renderer and API:

1. As an Organization Admin, open canonical **设置 → 团队 · 成员管理**,
   enter one recipient's display name and exact email, then choose
   **创建并复制链接**.
2. Confirm the invitation is shown as pending and that it can be copied,
   regenerated, or revoked without SMTP.
3. Open the copied link in the recipient context. Confirm the distinct
   invitation page shows the Organization, Team, preset name, and invited
   email—but no endpoint, provider, or admin controls.
4. Sign in with the exact invited email through the real Better Auth magic-link
   route and accept. A mismatched email must be denied.
5. Confirm the recipient enters the canonical Team Pulse, the preset name is
   editable in Personal Settings, and the admin sees the persistent membership
   plus accepted invitation state.
6. In canonical **通讯**, let the recipient create a participant-only 1:1 DM,
   send a message, and let the admin reply. Confirm both isolated contexts see
   the ordered persistent exchange.

Phase 4 browser evidence is stored under `output/playwright/phase4/`. The
validated sequence uses `01-admin-created-invite.png` through
`07-recipient-dm-reply-visible.png`; it contains no reusable invitation token
or provider secret. This proof covers the browser/session/invitation/member/DM
path. Provider-backed MCP-to-Stand-in acceptance remains the separate scenario
below and must not be inferred from the onboarding screenshots.

## User-facing pilot acceptance — exactly two scenarios

Run both scenarios with two independent browser profiles or isolated contexts
against the same approved Intero deployment endpoint.

### Scenario 1 — two team members exchange persistent direct messages

1. Client A and Client B enter the restored canonical **通讯** view as two
   different members of the same Team.
2. B creates a 1:1 conversation with A using the member picker.
3. B sends a message and A replies in the same thread.
4. Reload or reopen the thread in both isolated clients. Both messages remain
   visible, in order, and only the two participants can read the thread.

Pass evidence: one screenshot from each isolated client showing the same
two-way conversation, plus a reload/reopen assertion in the browser E2E.

### Scenario 2 — MCP Work State drives a grounded Stand-in conversation

1. The actively working coding session uses its real Intero MCP connection to
   submit one real structured result/checkpoint from the work being performed.
   With the built bridge, the equivalent connection command is:

   ```bash
   agent_data_dir=$(mktemp -d /tmp/intero-pilot-agent.XXXXXX)
   node apps/mcp-stdio/dist/index.js cloud connect \
     --client codex \
     --cloud-url http://127.0.0.1:4310 \
     --connect-ticket 'ticket_FROM_THE_UI' \
     --cloud-data-dir "$agent_data_dir"
   ```

   The connect command submits an optional connection-validation checkpoint,
   but that synthetic validation does not replace the real acceptance event.
   Submit the actual ongoing-work result:

   ```bash
   node apps/mcp-stdio/dist/index.js cloud checkpoint \
     --client codex \
     --cloud-data-dir "$agent_data_dir" \
     --event-type review_requested \
     --client-event-id billing-export-review-0001 \
     --workstream-key billing-csv-export \
     --workstream-title '客户账单 CSV 导出' \
     --phase validating \
     --current-focus '正在让大批量账单导出满足财务月度对账要求。' \
     --completed-outcome '已实现可恢复的导出任务，并生成首份完整账单 CSV。' \
     --evidence '预发环境成功导出 12,480 行发票。' \
     --evidence '账单导出集成测试 18/18 通过。' \
     --next-step '由财务确认列名后合并并发布导出功能。' \
     --needs-help \
     --help-request '请确认税区和发票状态是否应保留为两个独立列。' \
     --requested-from '财务负责人'
   ```

2. Verify the API accepted the MCP event and persisted the originator's private
   Work State. The configured real ModelGateway/Stand-in must generate the
   published safe summary; do not substitute an API fixture or hard-coded
   response.
3. Client B opens canonical **Team Pulse**. Verify the resulting summary,
   freshness, `direct_cloud_mcp` provenance, Agent client/connection, and stable
   client event ID are visible. Private Claims and evidence references must not
   be exposed.
4. Client B opens canonical **通讯**, selects the Project Stand-in
   conversation, and asks a grounded status or coordination question about that
   work, for example: `当前 pilot 实现验证到了什么状态？`
5. Verify the response came through the same administrator-configured real
   provider path, is supported by the submitted structured Work State, and
   visibly lists its Work State source, MCP client/connection, and freshness.
   Unsupported claims or uncited answers fail this scenario.

Pass evidence: the real MCP command/result boundary, Client B's canonical Team
Pulse source/freshness view, and Client B's canonical Stand-in answer with
its visible source/freshness card.

## Offline and failure behavior

The MCP client flushes its outbox at the start of the next MCP/CLI invocation.
When delivery fails, coding continues and the structured event is encrypted and
queued. The outbox is bounded to 10,000 events, 50 MiB, and seven days, uses
client-generated idempotency IDs, and records expiry/overflow gap markers.

On macOS the encryption key is stored in Keychain when available. Other
platforms, or macOS Keychain failures, fall back to a mode-`0600` local key
file. This fallback is the pilot's documented platform limitation; it is not a
claim of hardware-backed storage.

Provider/model failure also does not reject the private checkpoint. On the
persistent Phase 2 path the API returns `stand_in.status = pending`;
private Work State remains stored while the worker retries. Only a terminal
failure marks the Stand-in unavailable, and no Team Pulse summary is
published for the failed job.

## Phase 2 adapter validation

The following commands exercise the common port contracts and real local
adapters:

```bash
INTERO_SPICEDB_ENDPOINT=127.0.0.1:50051 \
INTERO_SPICEDB_TOKEN=intero-development \
pnpm vitest run \
  apps/server-api/src/spicedb-authorization.integration.test.ts \
  apps/server-api/src/spicedb-pilot-authorization.integration.test.ts

DATABASE_URL=postgres://intero:intero@127.0.0.1:5432/intero \
DATABASE_APP_URL=postgres://intero_app:intero_app@127.0.0.1:5432/intero \
DATABASE_WORKER_URL=postgres://intero_worker:intero_worker@127.0.0.1:5432/intero \
pnpm vitest run apps/server-worker/src/pilot-jobs.integration.test.ts

DATABASE_URL=postgres://intero:intero@127.0.0.1:5432/intero \
DATABASE_APP_URL=postgres://intero_app:intero_app@127.0.0.1:5432/intero \
INTERO_CENTRIFUGO_API_URL=http://127.0.0.1:8000 \
pnpm vitest run apps/server-worker/src/outbox.integration.test.ts
```

The job suite covers API/worker restart boundaries, idempotent enqueue,
at-least-once execution with exactly-once publication effect, provider
outage/recovery, terminal failure metadata, per-Project ordering, reconciliation,
and heartbeat readiness. The SpiceDB suite runs the same membership contract,
proves outage fail-closed behavior and recovery, and proves a stale tuple cannot
widen normalized membership. The Centrifugo suite first forces publish failure,
then retries the retained outbox row and asserts that two independent WebSocket
clients receive the same project-scoped event; it also checks retained history
for cursor repair.

## Optional Desktop Git-awareness smoke

This path is optional and never substitutes for the direct-cloud MCP/browser
acceptance above.

1. Build `@intero/mcp-stdio`, then start the canonical Web application inside
   the optional Desktop shell:

   ```bash
   pnpm --filter @intero/mcp-stdio build
   pnpm dev:desktop
   ```

2. Open **Settings → Coding Agent** and connect or select an existing Codex,
   Claude Code, or OpenCode binding for the current Project.
3. Under **桌面 Git 感知**, choose one disposable repository and explicitly
   enable it. The repository path is shown only in the local Desktop UI.
4. Edit an ordinary working-tree file without staging it. Verify no checkpoint
   is emitted.
5. Stage the file, switch branch, or create a commit. Verify one debounced
   checkpoint reaches private Work State through direct-cloud MCP and that the
   bounded outbox keeps the action non-blocking during service failure.
6. Inspect the checkpoint and confirm it contains only repository name, branch,
   short commit, and staged-state text—never an absolute path, file name, diff,
   source content, or local Work State.
7. Pause or remove the repository and verify later Git metadata changes emit
   nothing. Quit the Desktop App and verify no watcher or background process
   remains.

The focused automated check is:

```bash
pnpm vitest run \
  apps/desktop/src/main/git-awareness.test.ts \
  apps/web/src/views/settings/GitAwarenessSettings.test.tsx
```

## Validation boundary

Updated evidence belongs under `output/playwright/pilot-e2e/` and must be
captured from two isolated contexts using canonical renderer selectors:

- `01-scenario-1-member-a-dm.png`
- `02-scenario-1-member-b-dm.png`
- `05-readable-team-pulse.png`
- `06-readable-stand-in-answer.png`
- `07-two-client-dm.png`
- `08-coordination-master-detail.png`
- `09-withdrawal-propagated.png`
- `10-member-a-dm-after-reply.png`

`03-scenario-2-team-pulse-grounding.png` and
`04-scenario-2-stand-in-answer.png` are the before-correction evidence:
they demonstrate why generic validation prose and metadata-first answers were
not readable enough. Files `05` and `06` are the corresponding after evidence.

The E2E must also assert that canonical Team Pulse, Communications,
Coordination, Action Inbox, Person drill-in, and Settings navigation remain
available. Those assertions protect the established renderer but do not create
more user acceptance scenarios.

Record separately whether the run used in-memory or PostgreSQL persistence and
the exact real provider endpoint/model class (never its API key). Do not claim
scenario 2 passed when using the bundled fixture. Phase 2 validates local
SpiceDB authorization and two-client Centrifugo fanout in addition to the Pilot
flows. MinIO/object storage, production deployment operations, generic A2A
federation, and any local product runtime remain outside this phase.
