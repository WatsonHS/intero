#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${INTERO_PRODUCTION_ENV_FILE:-$repo_root/.env.production}"
state_dir="${INTERO_PRODUCTION_STATE_DIR:-$repo_root/.intero-production}"

if [[ ! -f "$env_file" || ! -f "$state_dir/current-tag" ]]; then
  echo "Intero production has not been deployed yet." >&2
  exit 1
fi

for _attempt in {1..60}; do
  if docker info >/dev/null 2>&1; then
    break
  fi
  sleep 5
done
if ! docker info >/dev/null 2>&1; then
  echo "OrbStack did not become available within five minutes." >&2
  exit 1
fi

export INTERO_IMAGE_TAG
INTERO_IMAGE_TAG="$(tr -d '[:space:]' <"$state_dir/current-tag")"
exec docker compose \
  --env-file "$env_file" \
  -f "$repo_root/compose.production.yaml" \
  up -d --no-build --remove-orphans
