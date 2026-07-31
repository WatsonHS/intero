#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
normalized_run_id="$(printf '%s' "$run_id" | tr '[:upper:]' '[:lower:]')"
project_name="intero-r0-$normalized_run_id"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/intero-r0-production.XXXXXX")"
env_file="$work_dir/production.env"
state_dir="$work_dir/state"
gateway_port="${INTERO_R0_GATEWAY_PORT:-443}"
postgres_port="${INTERO_R0_POSTGRES_PORT:-25432}"
centrifugo_port="${INTERO_R0_CENTRIFUGO_PORT:-18000}"
if [[ "$gateway_port" == "443" ]]; then
  public_url="https://localhost"
else
  public_url="https://localhost:$gateway_port"
fi

admin_password="$(openssl rand -hex 32)"
app_password="$(openssl rand -hex 32)"
worker_password="$(openssl rand -hex 32)"
spicedb_password="$(openssl rand -hex 32)"
provider_key="$(openssl rand -hex 32)"
auth_secret="$(openssl rand -hex 32)"
spicedb_token="$(openssl rand -hex 32)"
centrifugo_api_key="$(openssl rand -hex 32)"
centrifugo_token_secret="$(openssl rand -hex 32)"
minio_secret="$(openssl rand -hex 32)"
minio_kms_key="$(openssl rand -base64 32)"

compose=(
  docker compose
  --project-name "$project_name"
  --env-file "$env_file"
  -f "$repo_root/compose.production.yaml"
  -f "$repo_root/compose.r0-validation.yaml"
)

cleanup() {
  task_status=$?
  if [[ "$task_status" != "0" ]]; then
    echo "R0 gate failed; collecting privacy-safe container status and tail logs." >&2
    "${compose[@]}" ps >&2 || true
    "${compose[@]}" logs --tail=120 \
      postgres spicedb centrifugo minio migrator worker api gateway >&2 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work_dir"
  trap - EXIT
  exit "$task_status"
}
trap cleanup EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "R0 gate requires $1." >&2
    exit 1
  }
}

require_command curl
require_command docker
require_command openssl
require_command pnpm

if ! docker info >/dev/null 2>&1; then
  echo "R0 gate requires a running Docker daemon." >&2
  exit 1
fi
if command -v lsof >/dev/null 2>&1 &&
  lsof -nP -iTCP:"$gateway_port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "R0 gate gateway port $gateway_port is already in use." >&2
  exit 1
fi

mkdir -p "$state_dir"
chmod 700 "$work_dir" "$state_dir"
printf '%s\n' \
  "INTERO_PUBLIC_URL=$public_url" \
  "INTERO_CADDY_PORT=$gateway_port" \
  "INTERO_CADDY_LISTEN_PORT=$gateway_port" \
  "INTERO_POSTGRES_VOLUME=${project_name}-postgres" \
  "INTERO_POSTGRES_HOST_PORT=$postgres_port" \
  "INTERO_CADDY_DATA_VOLUME=${project_name}-caddy-data" \
  "INTERO_CADDY_CONFIG_VOLUME=${project_name}-caddy-config" \
  "INTERO_MINIO_VOLUME=${project_name}-minio" \
  "INTERO_POSTGRES_BOOTSTRAP_PASSWORD=$admin_password" \
  "INTERO_POSTGRES_ADMIN_PASSWORD=$admin_password" \
  "INTERO_POSTGRES_APP_PASSWORD=$app_password" \
  "INTERO_POSTGRES_WORKER_PASSWORD=$worker_password" \
  "INTERO_POSTGRES_SPICEDB_PASSWORD=$spicedb_password" \
  "INTERO_PROVIDER_ENCRYPTION_KEY=$provider_key" \
  "INTERO_AUTH_SECRET=$auth_secret" \
  "INTERO_SPICEDB_TOKEN=$spicedb_token" \
  "INTERO_SPICEDB_CA_FILE=$state_dir/spicedb-ca.crt" \
  "INTERO_SPICEDB_CERT_FILE=$state_dir/spicedb-server.crt" \
  "INTERO_SPICEDB_KEY_FILE=$state_dir/spicedb-server.key" \
  "INTERO_CENTRIFUGO_API_KEY=$centrifugo_api_key" \
  "INTERO_CENTRIFUGO_TOKEN_SECRET=$centrifugo_token_secret" \
  "INTERO_REALTIME_ROLLOUT_PERCENT=100" \
  "INTERO_MINIO_ACCESS_KEY=intero-r0-validation" \
  "INTERO_MINIO_SECRET_KEY=$minio_secret" \
  "INTERO_MINIO_KMS_KEY=$minio_kms_key" \
  "INTERO_OBJECT_STORAGE_BUCKET=intero-r0-validation" \
  "INTERO_WORKER_CONCURRENCY=8" \
  "INTERO_LOG_LEVEL=info" \
  "INTERO_R0_CENTRIFUGO_PORT=$centrifugo_port" \
  >"$env_file"
chmod 600 "$env_file"

INTERO_SPICEDB_TLS_DIR="$state_dir" \
  "$repo_root/scripts/ops/generate-spicedb-tls.sh" >/dev/null

export INTERO_IMAGE_TAG="r0-$run_id"
export INTERO_MIGRATOR_IMAGE_TAG="$INTERO_IMAGE_TAG"
export INTERO_SPICEDB_CA_FILE="$state_dir/spicedb-ca.crt"
export INTERO_SPICEDB_CERT_FILE="$state_dir/spicedb-server.crt"
export INTERO_SPICEDB_KEY_FILE="$state_dir/spicedb-server.key"
export INTERO_R0_CENTRIFUGO_PORT="$centrifugo_port"

echo "R0 gate: build immutable production images"
"${compose[@]}" --profile migrate build migrator worker api gateway

echo "R0 gate: provision PostgreSQL, SpiceDB TLS, and durable dependencies"
"${compose[@]}" up -d postgres
"${compose[@]}" --profile migrate run --rm postgres-provision
"${compose[@]}" --profile migrate run --rm spicedb-migrate
"${compose[@]}" up -d spicedb centrifugo minio
"${compose[@]}" up -d --wait --wait-timeout 120 spicedb centrifugo minio

echo "R0 gate: apply application and authorization migrations"
"${compose[@]}" up -d migrator
migrator_container="$("${compose[@]}" ps -q migrator)"
if [[ -z "$migrator_container" ]]; then
  echo "R0 gate did not create a migrator container." >&2
  exit 1
fi
migrator_exit="$(docker wait "$migrator_container")"
if [[ "$migrator_exit" != "0" ]]; then
  "${compose[@]}" logs --tail=200 migrator >&2
  echo "R0 gate migrator failed with exit code $migrator_exit." >&2
  exit 1
fi

echo "R0 gate: start two workers and two APIs behind the production gateway"
"${compose[@]}" up -d --scale worker=2 worker
"${compose[@]}" up -d --wait --wait-timeout 180 --scale worker=2 worker
"${compose[@]}" up -d --scale worker=2 --scale api=2 api gateway
"${compose[@]}" up -d --wait --wait-timeout 180 --scale worker=2 --scale api=2 api

curl --fail --silent --show-error --insecure --max-time 5 \
  "$public_url/health" >/dev/null
curl --fail --silent --show-error --insecure --max-time 5 \
  "$public_url/" >/dev/null
ready_content_type="$(
  curl --silent --insecure --output /dev/null --write-out '%{content_type}' \
    --max-time 5 "$public_url/ready"
)"
if [[ "$ready_content_type" != text/html* ]]; then
  echo "R0 gate expected public /ready to resolve only to the Web shell; got $ready_content_type." >&2
  exit 1
fi
echo "R0 gate: public HTTPS health, Web, and private-readiness boundary passed"

echo "R0 gate: run 10k connection, fanout, outage, and 1k publication checks"
DATABASE_URL="postgres://intero:$admin_password@127.0.0.1:$postgres_port/intero" \
DATABASE_APP_URL="postgres://intero_app:$app_password@127.0.0.1:$postgres_port/intero" \
INTERO_CENTRIFUGO_API_URL="http://127.0.0.1:$centrifugo_port" \
INTERO_CENTRIFUGO_API_KEY="$centrifugo_api_key" \
INTERO_CENTRIFUGO_TOKEN_SECRET="$centrifugo_token_secret" \
  pnpm --dir "$repo_root" test:realtime:release

api_containers=()
while IFS= read -r container_id; do
  [[ -n "$container_id" ]] && api_containers+=("$container_id")
done < <("${compose[@]}" ps -q api)
worker_containers=()
while IFS= read -r container_id; do
  [[ -n "$container_id" ]] && worker_containers+=("$container_id")
done < <("${compose[@]}" ps -q worker)
if [[ "${#api_containers[@]}" -ne 2 || "${#worker_containers[@]}" -ne 2 ]]; then
  echo "R0 gate expected two API and two worker containers." >&2
  exit 1
fi

echo "R0 gate: stop one API replica and require uninterrupted public health"
docker stop "${api_containers[0]}" >/dev/null
for attempt in {1..20}; do
  curl --fail --silent --show-error --insecure --max-time 3 \
    "$public_url/health" >/dev/null || {
    echo "R0 gate public health failed over with one API replica stopped (attempt $attempt)." >&2
    exit 1
  }
done
docker start "${api_containers[0]}" >/dev/null
api_recovered=0
for attempt in {1..60}; do
  all_ready=true
  for container_id in "${api_containers[@]}"; do
    if ! docker exec "$container_id" node -e \
      "fetch('http://127.0.0.1:4310/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      all_ready=false
    fi
  done
  if [[ "$all_ready" == "true" ]]; then
    api_recovered=1
    break
  fi
  sleep 1
done
if [[ "$api_recovered" != "1" ]]; then
  echo "R0 gate stopped API replica did not recover." >&2
  exit 1
fi

echo "R0 gate: stop one worker replica and require the remaining worker ready"
docker stop "${worker_containers[0]}" >/dev/null
remaining_worker="${worker_containers[1]}"
worker_ready="$(
  docker exec "$remaining_worker" node -e \
    "fetch('http://127.0.0.1:9464/ready').then(async r=>{console.log(r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
)"
if [[ "$worker_ready" != "200" ]]; then
  echo "R0 gate remaining worker was not ready: $worker_ready." >&2
  exit 1
fi
docker start "${worker_containers[0]}" >/dev/null
workers_recovered=0
for attempt in {1..60}; do
  all_ready=true
  for container_id in "${worker_containers[@]}"; do
    if ! docker exec "$container_id" node -e \
      "fetch('http://127.0.0.1:9464/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      all_ready=false
    fi
  done
  if [[ "$all_ready" == "true" ]]; then
    workers_recovered=1
    break
  fi
  sleep 1
done
if [[ "$workers_recovered" != "1" ]]; then
  echo "R0 gate stopped worker replica did not recover." >&2
  exit 1
fi

echo "R0 gate: restart Centrifugo and prove durable recovery"
"${compose[@]}" stop centrifugo
curl --fail --silent --show-error --insecure --max-time 5 \
  "$public_url/health" >/dev/null
"${compose[@]}" start centrifugo
"${compose[@]}" up -d --wait --wait-timeout 120 centrifugo
DATABASE_URL="postgres://intero:$admin_password@127.0.0.1:$postgres_port/intero" \
DATABASE_APP_URL="postgres://intero_app:$app_password@127.0.0.1:$postgres_port/intero" \
INTERO_CENTRIFUGO_API_URL="http://127.0.0.1:$centrifugo_port" \
INTERO_CENTRIFUGO_API_KEY="$centrifugo_api_key" \
INTERO_CENTRIFUGO_TOKEN_SECRET="$centrifugo_token_secret" \
  pnpm --dir "$repo_root" test:realtime:capacity

echo "R0 gate: restart PostgreSQL and require API recovery"
"${compose[@]}" restart postgres
"${compose[@]}" up -d --wait --wait-timeout 120 postgres
recovered=0
for attempt in {1..60}; do
  all_ready=true
  for container_id in "${api_containers[@]}"; do
    if ! docker exec "$container_id" node -e \
      "fetch('http://127.0.0.1:4310/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      all_ready=false
    fi
  done
  for container_id in "${worker_containers[@]}"; do
    if ! docker exec "$container_id" node -e \
      "fetch('http://127.0.0.1:9464/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      all_ready=false
    fi
  done
  if [[ "$all_ready" == "true" ]] &&
    curl --fail --silent --show-error --insecure --max-time 3 \
      "$public_url/health" >/dev/null; then
    recovered=1
    break
  fi
  sleep 1
done
if [[ "$recovered" != "1" ]]; then
  echo "R0 gate APIs or workers did not recover after PostgreSQL restart." >&2
  exit 1
fi

echo "R0 production-like gate passed: $project_name"
