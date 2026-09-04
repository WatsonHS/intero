#!/usr/bin/env bash
set -euo pipefail

filters=(
  "--filter=@intero/web"
  "--filter=@intero/server-api"
)

if [[ -z "${INTERO_OBJECT_STORAGE_ENDPOINT:-}" ]]; then
  export INTERO_MINIO_API_PORT="${INTERO_MINIO_API_PORT:-29000}"
  export INTERO_MINIO_CONSOLE_PORT="${INTERO_MINIO_CONSOLE_PORT:-29001}"
  export INTERO_OBJECT_STORAGE_ENDPOINT="http://127.0.0.1:${INTERO_MINIO_API_PORT}"
  export INTERO_OBJECT_STORAGE_ACCESS_KEY_ID="${INTERO_OBJECT_STORAGE_ACCESS_KEY_ID:-intero}"
  export INTERO_OBJECT_STORAGE_SECRET_ACCESS_KEY="${INTERO_OBJECT_STORAGE_SECRET_ACCESS_KEY:-intero-development}"

  docker compose \
    --project-name "${INTERO_DEV_COMPOSE_PROJECT:-intero-codex}" \
    up -d --wait minio
fi
export INTERO_OBJECT_STORAGE_BUCKET="${INTERO_OBJECT_STORAGE_BUCKET:-intero-objects}"

docker compose up -d centrifugo
docker compose -f compose.proxy.yaml up -d

: "${DATABASE_URL:?Intero requires DATABASE_URL so migrations run before startup.}"
: "${INTERO_DATABASE_URL:?Intero requires INTERO_DATABASE_URL for persistent MinIO metadata.}"
: "${INTERO_WORKER_DATABASE_URL:?Intero requires INTERO_WORKER_DATABASE_URL so Team Pulse jobs can run.}"
: "${INTERO_PROVIDER_ENCRYPTION_KEY:?Intero requires INTERO_PROVIDER_ENCRYPTION_KEY.}"
pnpm --filter @intero/server-api migrate
# Keep the administrator migration URL available to the API's dev-only
# supervisor. It reruns the idempotent migrator before every hot restart;
# runtime database access still uses INTERO_DATABASE_URL.
filters+=("--filter=@intero/server-worker")

exec pnpm turbo run dev:pilot "${filters[@]}"
