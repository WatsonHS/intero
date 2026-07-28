#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${INTERO_PRODUCTION_ENV_FILE:-$repo_root/.env.production}"
state_dir="${INTERO_PRODUCTION_STATE_DIR:-$repo_root/.intero-production}"

if [[ ! -f "$env_file" ]]; then
  echo "Missing production environment file: $env_file" >&2
  echo "Copy .env.production.example and fill every required value." >&2
  exit 1
fi

if [[ -z "${INTERO_IMAGE_TAG:-}" && -f "$state_dir/current-tag" ]]; then
  export INTERO_IMAGE_TAG
  INTERO_IMAGE_TAG="$(tr -d '[:space:]' <"$state_dir/current-tag")"
fi
if [[ -z "${INTERO_MIGRATOR_IMAGE_TAG:-}" ]]; then
  export INTERO_MIGRATOR_IMAGE_TAG
  if [[ -f "$state_dir/current-schema-tag" ]]; then
    INTERO_MIGRATOR_IMAGE_TAG="$(
      tr -d '[:space:]' <"$state_dir/current-schema-tag"
    )"
  else
    INTERO_MIGRATOR_IMAGE_TAG="${INTERO_IMAGE_TAG:-local}"
  fi
fi

exec docker compose \
  --env-file "$env_file" \
  -f "$repo_root/compose.production.yaml" \
  "$@"
