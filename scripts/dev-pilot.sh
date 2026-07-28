#!/usr/bin/env bash
set -euo pipefail

filters=(
  "--filter=@intero/web"
  "--filter=@intero/server-api"
)

if [[ "${INTERO_RUNTIME_MODE:-development}" == "development" ]]; then
  export INTERO_CENTRIFUGO_API_URL="${INTERO_CENTRIFUGO_API_URL:-http://localhost:8000}"
  export INTERO_CENTRIFUGO_PUBLIC_URL="${INTERO_CENTRIFUGO_PUBLIC_URL:-${INTERO_PUBLIC_URL:-http://localhost:4311}}"
  export INTERO_CENTRIFUGO_TOKEN_SECRET="${INTERO_CENTRIFUGO_TOKEN_SECRET:-intero-development-realtime-token-secret-v1}"
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
