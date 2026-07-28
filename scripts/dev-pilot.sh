#!/usr/bin/env bash
set -euo pipefail

filters=(
  "--filter=@intero/web"
  "--filter=@intero/server-api"
)

if [[ "${INTERO_OBJECT_STORAGE:-minio}" == "minio" ]]; then
  export INTERO_OBJECT_STORAGE="minio"

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

  export INTERO_OBJECT_STORAGE_REGION="${INTERO_OBJECT_STORAGE_REGION:-us-east-1}"
  export INTERO_OBJECT_STORAGE_BUCKET="${INTERO_OBJECT_STORAGE_BUCKET:-intero-objects}"
  export INTERO_OBJECT_STORAGE_ENCRYPTION="${INTERO_OBJECT_STORAGE_ENCRYPTION:-AES256}"
fi

if [[ "${INTERO_RUNTIME_MODE:-development}" == "development" ]]; then
  export INTERO_CENTRIFUGO_API_URL="${INTERO_CENTRIFUGO_API_URL:-http://localhost:8000}"
  export INTERO_CENTRIFUGO_PUBLIC_URL="${INTERO_CENTRIFUGO_PUBLIC_URL:-${INTERO_PUBLIC_URL:-http://localhost:4311}}"
  export INTERO_CENTRIFUGO_TOKEN_SECRET="${INTERO_CENTRIFUGO_TOKEN_SECRET:-intero-development-realtime-token-secret-v1}"
  export INTERO_CENTRIFUGO_API_KEY="${INTERO_CENTRIFUGO_API_KEY:-intero-development-realtime-api-key-v1}"
  docker compose up -d centrifugo
  docker compose -f compose.proxy.yaml up -d
fi

if [[ -n "${INTERO_DATABASE_URL:-}" || "${INTERO_PILOT_PERSISTENCE:-}" == "postgres" ]]; then
  : "${DATABASE_URL:?Persistent Pilot requires DATABASE_URL so migrations run before startup.}"
  : "${INTERO_DATABASE_URL:?Persistent Pilot requires INTERO_DATABASE_URL.}"
  : "${INTERO_WORKER_DATABASE_URL:?Persistent Pilot requires INTERO_WORKER_DATABASE_URL so Team Pulse jobs can run.}"
  : "${INTERO_PROVIDER_ENCRYPTION_KEY:?Persistent Pilot requires INTERO_PROVIDER_ENCRYPTION_KEY.}"
  pnpm --filter @intero/server-api migrate
  unset DATABASE_URL
  filters+=("--filter=@intero/server-worker")
fi

exec pnpm turbo run dev:pilot "${filters[@]}"
