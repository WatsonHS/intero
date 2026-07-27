# Development demo data

The Demo workspace is a development/test-only way to exercise the canonical
Intero browser renderer with persisted Phase 1–5 data. It does not add a
production seed route, a frontend fixture mode, or an alternate UI.

## Safety boundary

The commands refuse to run unless all of these conditions are true:

- `NODE_ENV` is `development` or `test`;
- `INTERO_DEMO_DATA=true` is explicitly present;
- `DATABASE_URL` uses loopback PostgreSQL (`localhost`, `127.0.0.1`, or `::1`);
- the database name contains `demo`, `test`, or `validation`;
- `INTERO_DEMO_CONFIRM` exactly identifies the host, port, and database;
- the database is empty or contains only the known Intero Demo organization
  and Demo identities (plus the canonical renderer's fixed local bootstrap
  principals, which the running API may recreate).

Do not point these commands at a shared or user-facing product/Demo database.
The reset command truncates all application tables in the confirmed disposable
database while preserving the applied migration ledger.

`demo:seed` is non-destructive on an already seeded database: it returns
`already_seeded` before writing Provider configuration, so an administrator's
configured Provider remains unchanged.

`demo:reset` and `demo:reset-and-seed` check only whether
`pilot_provider_configs` contains a row; they do not read or print its encrypted
credential. When a configured Provider exists, both commands refuse before
truncating any table. The only override is the database-specific destructive
phrase from the refusal, supplied as
`INTERO_DEMO_DESTROY_PROVIDER_CONFIG=DESTROY_INTERO_CONFIGURED_PROVIDER:<host>:<port>/<database>`.
Never set this override for the running user-facing environment.

## Create the workspace

Create a dedicated local database and apply the seed:

```sh
createdb intero_demo

export NODE_ENV=development
export DATABASE_URL='postgres://intero:intero@127.0.0.1:5432/intero_demo'
export INTERO_DATABASE_URL='postgres://intero_app:intero_app@127.0.0.1:5432/intero_demo'
export INTERO_WORKER_DATABASE_URL='postgres://intero_worker:intero_worker@127.0.0.1:5432/intero_demo'
export INTERO_DEMO_DATA=true
export INTERO_DEMO_CONFIRM='INTERO_DEMO_DISPOSABLE:127.0.0.1:5432/intero_demo'
export INTERO_PROVIDER_ENCRYPTION_KEY='replace-with-a-development-only-secret'

pnpm demo:seed
```

When using the repository's Compose roles, grant the application role access to
the newly created disposable database before starting the API:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c 'GRANT USAGE ON SCHEMA public TO intero_app' \
  -c 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO intero_app' \
  -c 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO intero_app'
```

`pnpm demo:seed` applies migrations, creates the Demo workspace once, and
returns `already_seeded` on later runs. It does not overwrite board moves,
comments, or reviews made while testing.

To intentionally restore the baseline:

```sh
pnpm demo:reset-and-seed
```

If the disposable database contains a configured Provider, the command above
will refuse. Only after confirming that the database was created solely for
this validation run may you use the exact destructive phrase:

```sh
export INTERO_DEMO_DESTROY_PROVIDER_CONFIG='DESTROY_INTERO_CONFIGURED_PROVIDER:127.0.0.1:5432/intero_demo'
pnpm demo:reset-and-seed
unset INTERO_DEMO_DESTROY_PROVIDER_CONFIG
```

To leave the confirmed database empty:

```sh
pnpm demo:reset
```

Automated validation must create a uniquely named disposable database, migrate
and seed it, run the checks, and drop that database afterward. It must not reset
the currently running product/Demo database.

## Start and sign in

Enable Better Auth and start the existing canonical browser renderer:

```sh
export INTERO_AUTH_SECRET='replace-with-at-least-32-development-characters'
export INTERO_RUNTIME_MODE='product'
export INTERO_PUBLIC_URL='http://localhost:4311'

pnpm dev:proxy
pnpm dev:demo
```

`dev:demo` always starts the normal product auth boundary. It refuses to start
without `INTERO_AUTH_SECRET`, disables development identity simulation, and
uses Better Auth sessions. Seeded demo records do not create a third or more
permissive auth mode.

Local aliases on ports `4310`, `4311`, and `5173` are trusted automatically.
Use `localhost` consistently for the API public URL and Passkey relying-party
ID when creating Passkeys. `INTERO_PASSKEY_RP_ID` defaults to the hostname from
`INTERO_PUBLIC_URL`; set it explicitly only when the deployment requires a
parent-domain RP ID. Browsers treat `localhost` and
`127.0.0.1` as different WebAuthn relying parties; mixing them can create an
account without completing Passkey enrollment. Database URLs may continue to
use `127.0.0.1`.

The browser identities are real Better Auth users with a shared disposable
Demo password, linked to persisted Intero principals:

| Name        | Email                     | Role                 |
| ----------- | ------------------------- | -------------------- |
| Alex Rivera | `alex@demo.intero.test`   | Organization admin   |
| Priya Shah  | `priya@demo.intero.test`  | Product Team Leader  |
| Morgan Lee  | `morgan@demo.intero.test` | Member               |
| Jordan Kim  | `jordan@demo.intero.test` | Platform Team Leader |

Use password `Intero-demo-2026!` in the normal password fallback. A Passkey can
be enrolled in the browser after activation; the seed does not install a fake
WebAuthn credential.

The pending invitation is for `casey@demo.intero.test`. The seed command prints
its deterministic one-time activation token; the corresponding browser path is
`/accept-invitation?token=<token>`.

## Seeded coverage

- Chinese-first product, project, work, Spec, coordination, and conversation
  content, while preserving common English engineering terms where they are
  natural;
- two Teams and a cross-team Project with a primary Team;
- one admin, two Team Leaders, normal members, accepted invitations, and one
  pending exact-email invitation;
- a configured local Demo provider placeholder and three connected Agent
  records (no external provider secret);
- two persistent 1:1 DMs, a persistent Chinese-first `产品体验 · 团队频道`
  containing all Team members, a temporary multi-person project discussion
  with a Stand-in participant, and a grounded Alex-to-Stand-in status
  conversation;
- two pending Action Inbox examples and recent Stand-in activity derived from
  the persisted Stand-in thread;
- private structured Work State, published Team Pulse entries, and one bounded
  Coordination request;
- two PIs, five Sprints, an ended-Sprint carryover, an Epic, three Features, and
  Work Items across every canonical status and priority;
- relations, nested comments, completion evidence, and explicit PR, commit, and
  branch references;
- two Specs, immutable versions, a previously confirmed version beside a newer
  review version, nominations, confirmations, and resolved/open selection
  comments.

The Demo Stand-in output is generated inside the one-shot Demo seeder and is
labelled `intero-demo-deterministic`. The running API still uses its configured
production ModelGateway path; the Demo command does not register or replace a
runtime gateway.
