# R0 release gate — 2026-08-01

## Result

**PASS for the repository-local production-like release gate.**

The repeatable gate builds immutable production images, provisions fresh
production-shaped dependencies and secrets, runs the release capacity cohort,
and exercises replica and dependency recovery. It passed locally as
`intero-r0-20260731t190121z-40570`.

This is not evidence from the final hosted environment. DNS, the external load
balancer, managed PostgreSQL failover, multi-node Centrifugo with its production
engine, and the configured external model provider still require a deployment
canary before R0 can be declared exited for that environment.

## Production-like topology

- fresh PostgreSQL database and application, worker, and SpiceDB roles;
- SpiceDB over generated TLS certificates;
- Centrifugo and MinIO with per-run credentials;
- two production API containers and two production Worker containers;
- the production Caddy gateway with HTTPS and private `/ready` routing;
- automatic removal of the exact temporary Compose project, volumes, state,
  and secrets after the run.

The gate is available as:

```sh
pnpm test:r0:production-like
```

## Capacity evidence

| Gate                            |                  Result |
| ------------------------------- | ----------------------: |
| Concurrent realtime clients     |                  10,000 |
| Connection cohort duration      |               49,183 ms |
| Remote delivery                 | 9,999 / 10,000 (99.99%) |
| Remote visibility p95           |                  255 ms |
| Remote visibility p99           |                  267 ms |
| Content-free publication cohort |                   1,000 |
| Publication duration            |                   32 ms |
| Publication throughput          |                30,883/s |

The delivery gate requires at least 99%, p95 below one second, and p99 below
three seconds. An independent capacity rerun delivered 10,000 / 10,000 with
p95 322 ms, p99 332 ms, and 31,825 publications/s.

## Failure and recovery evidence

The same run passed all of the following:

1. public HTTPS health and Web shell with private dependency readiness;
2. one API replica stopped while public health remained continuously ready;
3. the stopped API replica restarted and returned to readiness;
4. one Worker replica stopped while the other remained ready;
5. the stopped Worker restarted and returned to readiness;
6. Centrifugo stopped while durable API health remained available, followed by
   restart and a fresh realtime capacity cohort;
7. PostgreSQL restarted, followed by recovery of both API replicas, both Worker
   replicas, and public health.

The run also found and fixed a production cold-start fault: a Worker heartbeat
could violate the Organization foreign key when Workers started before the API
initialized a new Organization. Startup now safely waits for that durable
Organization row instead of crashing.

## Product and browser evidence

- real-dependency TypeScript suite: 93 files, 425 tests, all passed;
- production build: 14 packages passed;
- lint, generated-contract diff, format, production Compose rendering, Web
  bundle budget, and production dependency audit passed;
- Phase 6 authenticated collaboration passed;
- Phase 7 bounded automation and human revert passed;
- authenticated MCP Agent connection passed;
- route loading, degraded deep links, partial migration, and exact Action Inbox
  focus passed.

Phase 7 exposed a cross-session consistency fault after the backend had already
committed a human revert. The revert transaction now emits a privacy-safe,
Project-scoped workspace event, so every authorized browser invalidates its
automation cache and converges to the durable `reverted` state.

## Existing local database reset

The previously drifted local `intero` database was reset only after a verified
custom-format backup was written to:

```text
/tmp/intero-pre-r0-reset-20260801.dump
```

Its SHA-256 is:

```text
f847b9d706f0ce92f5ac410939cfad1ed8ffd0b104d8bbddcf62daff866268f4
```

`pg_restore` verified the archive before reset. Fresh API and Worker migrations
then passed. The backup is machine-local and temporary; copy it to durable
storage before cleaning `/tmp` if it must be retained.

## Remaining external release evidence

The repository-side implementation and repeatable local gate are complete.
The final target-environment release record still needs:

- the deployed domain and external load balancer;
- managed database failover and restore evidence;
- the final multi-node realtime topology;
- a configured-provider canary using privacy-safe identifiers only;
- post-deploy readiness, metrics, and rollback confirmation.
