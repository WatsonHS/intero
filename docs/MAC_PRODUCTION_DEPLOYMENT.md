# Persistent Intero deployment on the Mac Studio

This deployment replaces the host `vite` and `tsx watch` processes with
immutable production containers. It is intentionally a single-Mac deployment:
PostgreSQL is authoritative, SpiceDB persists in PostgreSQL, and Centrifugo
remains a reconstructable realtime transport.

## Runtime topology

Only the gateway and a loopback-only PostgreSQL maintenance port are published:

- `gateway`: static Web build plus same-origin API/Centrifugo routing;
- `api`: built `apps/server-api/dist/index.js`;
- `worker`: built `apps/server-worker/dist/index.js`;
- `postgres`: Intero, Graphile Worker, and SpiceDB durable storage;
- `spicedb`: PostgreSQL datastore, not the development memory datastore;
- `centrifugo`: short-lived delivery/history acceleration;
- `minio`: persistent image bytes, reachable only by the API on the Compose
  network;
- `migrator`: one-shot Drizzle, Graphile Worker, and SpiceDB schema migration.

Every long-running container uses `restart: unless-stopped`. A user LaunchAgent
reconciles the Compose stack after login and a second LaunchAgent creates a
verified PostgreSQL backup every day at 03:15.

## Mac prerequisites

1. Keep OrbStack installed and enable **Start at Login**.
2. Keep this repository at its current absolute path. Reinstall the LaunchAgent
   after moving it.
3. Keep the macOS user logged in after a reboot. OrbStack and a user LaunchAgent
   cannot start before that user's login.
4. Ensure ports `4311` and `15432` are not held by the development stack at
   cutover time.

## Prepare the environment

Create the untracked production environment:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Generate independent hex secrets:

```bash
openssl rand -hex 32
```

Generate the MinIO KMS key separately:

```bash
openssl rand -base64 32
```

Fill every placeholder. Important migration rules:

- keep `INTERO_POSTGRES_VOLUME=intero-codex_intero-postgres` to reuse the
  current Intero PostgreSQL data on this Mac;
- set `INTERO_POSTGRES_BOOTSTRAP_PASSWORD` to the current `intero` database
  role password; provisioning rotates it to `INTERO_POSTGRES_ADMIN_PASSWORD`;
- preserve the currently deployed `INTERO_PROVIDER_ENCRYPTION_KEY`, otherwise
  stored model-provider credentials cannot be decrypted;
- keep the current public origin
  `http://172.21.1.123:4311` until the domain cutover.

Validate interpolation without starting anything:

```bash
pnpm production:compose config --quiet
```

## First cutover

First create an external backup with the existing database connection. Then
stop the `pnpm dev:pilot` process and the old Intero Caddy/dependency containers.
Never attach two PostgreSQL containers to the same volume at once.

Deploy the committed revision:

```bash
pnpm production:deploy
```

The deployment:

1. builds API, worker, migrator, and static gateway images tagged with the Git
   commit;
2. starts PostgreSQL and provisions/rotates durable roles;
3. migrates the SpiceDB PostgreSQL datastore and starts
   SpiceDB/Centrifugo/MinIO;
4. applies Intero, Graphile Worker, and authorization schemas;
5. starts worker before API/gateway;
6. requires the canonical `/ready` endpoint to succeed.

After the first successful deployment, install automatic recovery and backups:

```bash
pnpm production:install-launch-agent
```

Inspect the running stack:

```bash
pnpm production:compose ps
pnpm production:compose logs --tail=200 api worker gateway
curl --fail http://172.21.1.123:4311/ready
```

## Routine deployment and rollback

Deploy only a clean, committed tree:

```bash
git pull --ff-only
pnpm production:deploy
```

The previous image tag remains local and is recorded in
`.intero-production/previous-tag`. Roll back application images without
reversing database migrations:

```bash
pnpm production:rollback
# or:
pnpm production:rollback -- <commit-tag>
```

Migrations are forward-only. A rollback changes worker, API, and gateway images;
it does not replace PostgreSQL, SpiceDB, or Centrifugo.

## Backup policy

Create a verified backup immediately:

```bash
pnpm production:backup
```

Backups are written under
`~/Library/Application Support/Intero/backups/<UTC timestamp>/` and contain:

- the Intero database custom-format dump;
- the SpiceDB database custom-format dump;
- PostgreSQL roles;
- SHA-256 checksums.

The script verifies both custom-format archives before publishing the backup
directory. It does not delete old backups; storage retention remains an
operator decision.

## Moving to a domain

When an internal DNS name and certificate path are ready:

1. change `INTERO_PUBLIC_URL`, Caddy ports, and optional passkey RP ID;
2. ensure ports 80/443 do not conflict with the existing Zenova Caddy on this
   Mac, or route the domain through that shared edge proxy;
3. deploy a new image;
4. bump `PILOT_AGENT_CONFIGURATION_VERSION`.

The version bump marks repository MCP configurations as outdated so each member
gets a visible repair action that replaces the LAN-IP URL with the domain.
