#!/usr/bin/env bash
set -euo pipefail

filters=(
  "--filter=@intero/web"
  "--filter=@intero/server-api"
)

if [[ -n "${INTERO_DATABASE_URL:-}" || "${INTERO_PILOT_PERSISTENCE:-}" == "postgres" ]]; then
  : "${INTERO_DATABASE_URL:?Persistent Pilot requires INTERO_DATABASE_URL.}"
  : "${INTERO_WORKER_DATABASE_URL:?Persistent Pilot requires INTERO_WORKER_DATABASE_URL so Team Pulse jobs can run.}"
  : "${INTERO_PROVIDER_ENCRYPTION_KEY:?Persistent Pilot requires INTERO_PROVIDER_ENCRYPTION_KEY.}"
  filters+=("--filter=@intero/server-worker")
fi

exec pnpm turbo run dev:pilot "${filters[@]}"
