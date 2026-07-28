#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${INTERO_PRODUCTION_ENV_FILE:-$repo_root/.env.production}"
state_dir="${INTERO_PRODUCTION_STATE_DIR:-$repo_root/.intero-production}"
image_tag="${1:-$(git -C "$repo_root" rev-parse --short=12 HEAD)}"

if [[ ! -f "$env_file" ]]; then
  echo "Missing production environment file: $env_file" >&2
  echo "Copy .env.production.example and fill every required value." >&2
  exit 1
fi
public_url="$(
  awk -F= '$1 == "INTERO_PUBLIC_URL" { sub(/^[^=]*=/, ""); print; exit }' \
    "$env_file" |
    tr -d "\"'"
)"
if [[ "$public_url" != https://* ]]; then
  echo "INTERO_PUBLIC_URL must use HTTPS in product mode: $public_url" >&2
  exit 1
fi
for tls_file in \
  "$state_dir/spicedb-ca.crt" \
  "$state_dir/spicedb-server.crt" \
  "$state_dir/spicedb-server.key"; do
  if [[ ! -r "$tls_file" ]]; then
    echo "Missing SpiceDB TLS material: $tls_file" >&2
    echo "Run: pnpm production:generate-spicedb-tls" >&2
    exit 1
  fi
done
if [[ ! "$image_tag" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "Invalid image tag: $image_tag" >&2
  exit 1
fi
if [[ -n "$(git -C "$repo_root" status --porcelain)" && "${INTERO_ALLOW_DIRTY_DEPLOY:-false}" != "true" ]]; then
  echo "Refusing to deploy a dirty worktree. Commit the intended release first." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is unavailable. Start OrbStack before deploying." >&2
  exit 1
fi

compose=(
  docker compose
  --env-file "$env_file"
  -f "$repo_root/compose.production.yaml"
)
export INTERO_IMAGE_TAG="$image_tag"
export INTERO_MIGRATOR_IMAGE_TAG="$image_tag"
export INTERO_SPICEDB_CA_FILE="${INTERO_SPICEDB_CA_FILE:-$state_dir/spicedb-ca.crt}"
export INTERO_SPICEDB_CERT_FILE="${INTERO_SPICEDB_CERT_FILE:-$state_dir/spicedb-server.crt}"
export INTERO_SPICEDB_KEY_FILE="${INTERO_SPICEDB_KEY_FILE:-$state_dir/spicedb-server.key}"

mkdir -p "$state_dir"
if [[ -f "$state_dir/current-tag" ]]; then
  cp "$state_dir/current-tag" "$state_dir/previous-tag"
fi

echo "Building immutable Intero images tagged $image_tag..."
"${compose[@]}" --profile migrate build migrator worker api gateway

echo "Starting PostgreSQL and provisioning durable roles..."
"${compose[@]}" up -d postgres
"${compose[@]}" --profile migrate run --rm postgres-provision

echo "Migrating and starting persistent SpiceDB and object storage..."
"${compose[@]}" --profile migrate run --rm spicedb-migrate
"${compose[@]}" up -d spicedb centrifugo minio
"${compose[@]}" up -d --wait --wait-timeout 90 spicedb minio

echo "Applying Intero, Graphile Worker, and SpiceDB schema migrations..."
"${compose[@]}" up -d migrator
migrator_container="$("${compose[@]}" ps -q migrator)"
if [[ -z "$migrator_container" ]]; then
  echo "Compose did not create the production migrator container." >&2
  exit 1
fi
migrator_exit="$(docker wait "$migrator_container")"
if [[ "$migrator_exit" != "0" ]]; then
  "${compose[@]}" logs --tail=200 migrator >&2
  echo "Production migrator failed with exit code $migrator_exit." >&2
  exit 1
fi
printf '%s\n' "$image_tag" >"$state_dir/current-schema-tag"

echo "Starting worker, API, and static gateway..."
"${compose[@]}" up -d worker
"${compose[@]}" up -d --wait --wait-timeout 120 worker
"${compose[@]}" up -d api gateway
"${compose[@]}" up -d --wait --wait-timeout 120 api

healthy=false
for _attempt in {1..30}; do
  if curl --fail --silent --show-error --max-time 3 "$public_url/health" >/dev/null; then
    healthy=true
    break
  fi
  sleep 2
done
if [[ "$healthy" != "true" ]]; then
  echo "Deployment started but $public_url/health did not become healthy." >&2
  echo "Inspect: scripts/ops/production-compose.sh ps" >&2
  echo "Logs:    scripts/ops/production-compose.sh logs --tail=200 api worker gateway" >&2
  exit 1
fi

printf '%s\n' "$image_tag" >"$state_dir/current-tag"
echo "Intero production deployment $image_tag is ready at $public_url"
