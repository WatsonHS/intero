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
public_url="$(
  awk -F= '$1 == "INTERO_PUBLIC_URL" { sub(/^[^=]*=/, ""); print; exit }' \
    "$env_file" |
    tr -d "\"'"
)"
if [[ "$public_url" != https://* ]]; then
  echo "INTERO_PUBLIC_URL must use HTTPS in product mode." >&2
  exit 1
fi

compose=(
  docker compose
  --env-file "$env_file"
  -f "$repo_root/compose.production.yaml"
)

require_ready() {
  local service="$1"
  local ready_url="$2"
  "${compose[@]}" exec -T "$service" node -e '
    const url = process.argv[1];
    fetch(url, { signal: AbortSignal.timeout(10_000) })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || body?.status !== "ready") {
          throw new Error(`expected ready, got HTTP ${response.status} ${body?.status ?? "invalid"}`);
        }
      })
      .catch((error) => {
        console.error(`Readiness check failed: ${error.message}`);
        process.exit(1);
      });
  ' "$ready_url"
}

export INTERO_IMAGE_TAG="$image_tag"
export INTERO_MIGRATOR_IMAGE_TAG
if [[ -f "$state_dir/current-schema-tag" ]]; then
  INTERO_MIGRATOR_IMAGE_TAG="$(
    tr -d '[:space:]' <"$state_dir/current-schema-tag"
  )"
elif [[ -f "$state_dir/current-tag" ]]; then
  INTERO_MIGRATOR_IMAGE_TAG="$(
    tr -d '[:space:]' <"$state_dir/current-tag"
  )"
else
  INTERO_MIGRATOR_IMAGE_TAG="$image_tag"
fi

for image in intero-worker intero-api intero-gateway; do
  if ! docker image inspect "$image:$image_tag" >/dev/null 2>&1; then
    echo "Missing local rollback image: $image:$image_tag" >&2
    exit 1
  fi
done
if ! docker image inspect \
  "intero-migrator:$INTERO_MIGRATOR_IMAGE_TAG" >/dev/null 2>&1; then
  echo "Missing schema migrator image: intero-migrator:$INTERO_MIGRATOR_IMAGE_TAG" >&2
  exit 1
fi

# Database migrations are forward-only. Rollback changes only application
# images. The newest successfully applied migrator remains pinned separately,
# so Compose can enforce the schema gate without replaying an older SpiceDB
# schema during application rollback.
"${compose[@]}" up -d --no-build worker api gateway
"${compose[@]}" up -d --wait --wait-timeout 120 worker api
require_ready worker "http://127.0.0.1:9464/ready"
require_ready api "http://127.0.0.1:4310/ready"

healthy=false
for _attempt in {1..30}; do
  if curl --fail --silent --show-error --max-time 3 "$public_url/health" >/dev/null; then
    healthy=true
    break
  fi
  sleep 2
done
if [[ "$healthy" != "true" ]]; then
  echo "Rollback started but the public health endpoint did not recover." >&2
  echo "Inspect: scripts/ops/production-compose.sh ps" >&2
  echo "Logs:    scripts/ops/production-compose.sh logs --tail=200 api worker gateway" >&2
  exit 1
fi

printf '%s\n' "$image_tag" >"$state_dir/current-tag"
echo "Intero application images rolled back to $image_tag and passed public health."
