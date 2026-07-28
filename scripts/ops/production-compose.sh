#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${INTERO_PRODUCTION_ENV_FILE:-$repo_root/.env.production}"

if [[ ! -f "$env_file" ]]; then
  echo "Missing production environment file: $env_file" >&2
  echo "Copy .env.production.example and fill every required value." >&2
  exit 1
fi

exec docker compose \
  --env-file "$env_file" \
  -f "$repo_root/compose.production.yaml" \
  "$@"
