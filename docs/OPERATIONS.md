# Intero production-operability foundation

The supported persistent single-Mac deployment path is documented in
[`MAC_PRODUCTION_DEPLOYMENT.md`](./MAC_PRODUCTION_DEPLOYMENT.md). It packages
the built API, worker, and Web artifacts in production containers, persists
SpiceDB in PostgreSQL, and installs launchd recovery/backup jobs.

Phase 3 supplies an operator path for the existing cloud-first API and worker.
It does not add a deployment installer, productized self-hosting workflow,
attachment UI, upload API, raw capture, generic A2A federation, or a new local
runtime.

## Runtime boundary

The authoritative services are:

1. PostgreSQL: domain state, private Work State, published projections,
   idempotency, jobs, transactional outbox, object metadata, and worker
   heartbeat.
2. SpiceDB: authorization enforcement. Normalized PostgreSQL membership remains
   the relationship source of truth.
3. Graphile Worker: durable Stand-in and outbox processing.
4. Centrifugo: non-authoritative realtime acceleration. Polling repairs missed
   delivery.
5. MinIO: required persistent object bytes. Conversation-image upload and
   download are exposed through authenticated, same-origin API routes.

The API and worker consume server-side environment variables directly. No
provider, database, SpiceDB, Centrifugo, or object-store secret is returned to
browser clients or emitted as a metric label.

## Configuration

Start from `.env.example`. Production must inject secrets from its secret
manager rather than committing an environment file.

Required for the persistent API:

- `INTERO_DATABASE_URL`: RLS-constrained application connection.
- `INTERO_PROVIDER_ENCRYPTION_KEY`: at least 16 characters, server only.
- `INTERO_PILOT_PERSISTENCE=postgres`.
- `INTERO_PILOT_STAND_IN_JOBS=transactional-outbox`.
- `INTERO_SPICEDB_ENDPOINT` and `INTERO_SPICEDB_TOKEN` when the SpiceDB adapter
  is selected.

Required for the worker:

- the same persistent Pilot and provider settings;
- `INTERO_WORKER_DATABASE_URL`;
- optional `INTERO_WORKER_CONCURRENCY` (1-64);
- optional metrics bind at `INTERO_WORKER_METRICS_HOST:INTERO_WORKER_METRICS_PORT`.

`INTERO_SPICEDB_INSECURE=true` is local-development-only. Omit it in production.
Authentication is enabled only when both `INTERO_AUTH_SECRET` and
`INTERO_MAGIC_LINK_WEBHOOK` are present. GitHub OAuth likewise requires both
client ID and client secret.

Object storage requires `INTERO_OBJECT_STORAGE=minio`, endpoint, access key,
server-only secret key, and bucket. Supported
encryption modes are `AES256` and `aws:kms`; KMS mode also requires
`INTERO_OBJECT_STORAGE_KMS_KEY_ID`. The local Compose stack uses a development
static KMS key only. Production must use MinIO KMS/KES or an equivalent managed
KMS and must not reuse Compose credentials.

## Ordered startup

Bring up dependencies and wait for their health checks:

```bash
docker compose up -d --wait postgres spicedb centrifugo minio
```

Apply migrations with an administrator connection. The single command applies
PostgreSQL migrations (including RLS), Graphile Worker migrations, then the
SpiceDB schema:

```bash
export DATABASE_URL='postgres://migration-user:...@db/intero'
export INTERO_WORKER_DATABASE_URL='postgres://worker-migration-user:...@db/intero'
export INTERO_SPICEDB_ENDPOINT='spicedb.internal:50051'
export INTERO_SPICEDB_TOKEN='server-only-token'
pnpm --filter @intero/server-worker migrate:all
```

Start the worker before accepting MCP traffic, then start the API and renderer.
Production should run built artifacts under its service supervisor:

```bash
pnpm build
node apps/server-worker/dist/index.js
node apps/server-api/dist/index.js
```

For the durable chat-stream migration (`0030_chat_experience`), preserve that
order during a rolling release: migrate first, roll every worker, then roll the
API and Web processes. The new worker can finish questions enqueued by the
previous API without a stream placeholder; starting the new API against an old
worker is intentionally not supported because the old worker cannot revise the
placeholder message.

Both processes handle graceful shutdown. Stop new traffic, send `SIGTERM`, wait
for the worker heartbeat to become `stopped`, then stop dependencies.

## Health and metrics

API:

- `GET /health`: process liveness only.
- `GET /ready`: PostgreSQL and SpiceDB are critical; worker, Centrifugo-backed
  delivery, and optional object storage can report degraded/unavailable without
  making coding/MCP ingress blocking.
- `GET /metrics`: Prometheus text with bounded labels.

Worker metrics listener:

- `GET /health`: worker process liveness.
- `GET /ready`: ready, degraded when realtime is unavailable, or unavailable
  while stopping.
- `GET /metrics`: queue depth, job success/retry/failure, model outcome/latency,
  and realtime health.

Metrics never include prompts, messages, file names/content, Claims, tenant IDs,
Project IDs, principal IDs, API keys, tokens, or provider payloads. HTTP routes
are normalized templates and status is reduced to a status class.

## Object storage policy and lifecycle

`object_store_objects` is authoritative for declared checksum, size, content
type, tenant, encryption mode, state, expiry, quarantine, failure, and deletion
tombstone. Object keys are generated by the server:

```text
<prefix>/<organization-id>/objects/<object-id>
<prefix>/quarantine/<organization-id>/<object-id>
```

The adapter enforces the configured size limit, SHA-256 checksum, encryption,
tenant RLS, quarantine move, and cleanup. `authorized_raw` reservations require
encryption. A scan result is required before state becomes `available`.
Quarantine has a bucket lifecycle expiration plus database cleanup; expired
pending reservations and failed objects are tombstoned by opportunistic
cleanup.

No API or UI invokes this adapter in Phase 3. Enabling the adapter only
initializes and monitors its bucket; it does not authorize raw capture or
attachments.

## Backup and restore

Create and verify a PostgreSQL custom-format backup:

```bash
export DATABASE_URL='postgres://backup-user:...@db/intero'
export INTERO_BACKUP_FILE='/secure/backups/intero-2026-07-26.dump'
pnpm backup:postgres
```

Restore only into an empty database:

```bash
export INTERO_RESTORE_DATABASE_URL='postgres://restore-user:...@db/intero_restore'
export INTERO_BACKUP_FILE='/secure/backups/intero-2026-07-26.dump'
export INTERO_RESTORE_CONFIRM='RESTORE_INTERO_DATABASE:intero_restore'
pnpm restore:postgres
```

The restore command verifies the checksum when present, refuses a non-empty
target, uses `--exit-on-error`, and checks the restored table set. Run ordered
migrations after restore before admitting traffic.

Run backup and restore with PostgreSQL client tools from the same major version
as the server. The backup command refuses to overwrite an existing artifact and
publishes the dump and checksum only after `pg_restore --list` succeeds.

PostgreSQL backup covers object metadata, not MinIO bytes. Production must use
bucket versioning plus MinIO site/bucket replication or an infrastructure
backup product and test restoration of both metadata and bytes to a staged
environment. SpiceDB schema is versioned in the repository; normalized
membership can repopulate enforcement tuples. Centrifugo history is transient;
clients repair authoritative state from PostgreSQL-backed HTTP reads after
reconnect or a recovery gap.

## Failure behavior

- PostgreSQL unavailable: API readiness is unavailable; writes fail rather than
  losing authoritative state.
- worker unavailable/stale: API readiness is degraded; MCP checkpoints remain
  durable and pending.
- provider unavailable: private Work State remains durable; jobs retry and may
  dead-letter after the configured maximum.
- SpiceDB unavailable: authorization fails closed and readiness is unavailable.
- Centrifugo unavailable: outbox retries and clients remain degraded while the
  SDK reconnects; there is no polling delivery fallback.
- MinIO unavailable: API startup fails, or readiness becomes unavailable if the
  dependency fails after startup.

The local Compose validation is a dependency and recovery proof, not a
production HA, TLS, DNS, certificate, or infrastructure deployment claim.
