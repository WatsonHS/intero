#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${INTERO_PRODUCTION_ENV_FILE:-$repo_root/.env.production}"
state_dir="${INTERO_PRODUCTION_STATE_DIR:-$repo_root/.intero-production}"
image_tag="${1:-}"

if [[ -z "$image_tag" && -f "$state_dir/previous-tag" ]]; then
  image_tag="$(tr -d '[:space:]' <"$state_dir/previous-tag")"
fi
if [[ -z "$image_tag" ]]; then
  echo "Pass the image tag to restore; no previous deployment was recorded." >&2
  exit 1
fi
if [[ ! "$image_tag" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "Invalid image tag: $image_tag" >&2
  exit 1
fi
if [[ ! -f "$env_file" ]]; then
  echo "Missing production environment file: $env_file" >&2
  exit 1
fi

compose=(
  docker compose
  --env-file "$env_file"
  -f "$repo_root/compose.production.yaml"
)
export INTERO_IMAGE_TAG="$image_tag"

for image in intero-worker intero-api intero-gateway; do
  if ! docker image inspect "$image:$image_tag" >/dev/null 2>&1; then
    echo "Missing local rollback image: $image:$image_tag" >&2
    exit 1
  fi
done

# Database migrations are forward-only. Rollback changes only application
# images and deliberately leaves PostgreSQL, SpiceDB, and Centrifugo intact.
"${compose[@]}" up -d --no-build worker api gateway
"${compose[@]}" up -d --wait --wait-timeout 120 worker api
printf '%s\n' "$image_tag" >"$state_dir/current-tag"
echo "Intero application images rolled back to $image_tag."
