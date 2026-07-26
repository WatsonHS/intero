set dotenv-load := true

default:
  @just --list

setup:
  corepack pnpm install
  cargo fetch

dev-deps:
  docker compose up -d postgres spicedb centrifugo minio

dev:
  corepack pnpm dev

up:
  #!/usr/bin/env bash
  set -euo pipefail
  docker compose up -d --wait
  DATABASE_URL=postgres://intero:intero@127.0.0.1:5432/intero \
  INTERO_WORKER_DATABASE_URL=postgres://intero_worker:intero_worker@127.0.0.1:5432/intero \
  INTERO_SPICEDB_ENDPOINT=127.0.0.1:50051 \
  INTERO_SPICEDB_TOKEN=intero-development \
  INTERO_SPICEDB_INSECURE=true \
  corepack pnpm --filter @intero/server-worker migrate:all
  intero_data_dir="${TMPDIR:-/tmp}/intero-dev-${UID:-user}"
  mkdir -p "${intero_data_dir}"
  INTERO_DATA_DIR="${intero_data_dir}" cargo run -p interod &
  interod_pid=$!
  trap 'kill "${interod_pid}" 2>/dev/null || true' EXIT
  for _ in $(seq 1 100); do
    [[ -f "${intero_data_dir}/connection.json" ]] && break
    sleep 0.1
  done
  [[ -f "${intero_data_dir}/connection.json" ]]
  INTERO_DATABASE_URL=postgres://intero_app:intero_app@127.0.0.1:5432/intero \
  INTERO_PILOT_PERSISTENCE=postgres \
  INTERO_PROVIDER_ENCRYPTION_KEY=intero-development-provider-encryption-key \
  INTERO_WORKER_DATABASE_URL=postgres://intero_worker:intero_worker@127.0.0.1:5432/intero \
  INTERO_ORGANIZATION_ID=019b5ac0-7600-7000-8000-000000000001 \
  INTERO_SPICEDB_ENDPOINT=127.0.0.1:50051 \
  INTERO_SPICEDB_TOKEN=intero-development \
  INTERO_PUBLIC_STAND_IN_ID=019b5ac0-7600-7000-8000-000000000060 \
  INTERO_CENTRIFUGO_API_URL=http://127.0.0.1:8000 \
  INTERO_S3_SERVER_ENCRYPTION=false \
  INTERO_PRINCIPAL_ID=019b5ac0-7600-7000-8000-000000000002 \
  INTERO_PRINCIPAL_NAME="Intero User" \
  INTERO_LOCAL_REP_MODE=sidecar \
  INTERO_API_URL=http://127.0.0.1:4310 \
  INTERO_DATA_DIR="${intero_data_dir}" \
  corepack pnpm dev

generate:
  corepack pnpm generate

lint:
  corepack pnpm lint
  cargo fmt --all --check
  cargo clippy --workspace --all-targets -- -D warnings

test:
  corepack pnpm test:ts
  cargo test --workspace

backup-restore-smoke:
  ./scripts/backup-restore-smoke.sh

check: generate lint test
  corepack pnpm build

down:
  docker compose down
