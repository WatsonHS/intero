set dotenv-load := true

default:
  @just --list

setup:
  corepack pnpm install

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
  INTERO_DATABASE_URL=postgres://intero_app:intero_app@127.0.0.1:5432/intero \
  INTERO_PILOT_PERSISTENCE=postgres \
  INTERO_PROVIDER_ENCRYPTION_KEY=intero-development-provider-encryption-key \
  INTERO_WORKER_DATABASE_URL=postgres://intero_worker:intero_worker@127.0.0.1:5432/intero \
  INTERO_ORGANIZATION_ID=019b5ac0-7600-7000-8000-000000000001 \
  INTERO_SPICEDB_ENDPOINT=127.0.0.1:50051 \
  INTERO_SPICEDB_TOKEN=intero-development \
  INTERO_PUBLIC_STAND_IN_ID=019b5ac0-7600-7000-8000-000000000060 \
  INTERO_CENTRIFUGO_API_URL=http://127.0.0.1:8000 \
  INTERO_OBJECT_STORAGE=minio \
  INTERO_OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:29000 \
  INTERO_OBJECT_STORAGE_ACCESS_KEY_ID=intero \
  INTERO_OBJECT_STORAGE_SECRET_ACCESS_KEY=intero-development \
  INTERO_OBJECT_STORAGE_BUCKET=intero-objects \
  INTERO_OBJECT_STORAGE_ENCRYPTION=AES256 \
  INTERO_PRINCIPAL_ID=019b5ac0-7600-7000-8000-000000000002 \
  INTERO_PRINCIPAL_NAME="Intero User" \
  INTERO_API_URL=http://127.0.0.1:4310 \
  corepack pnpm dev

generate:
  corepack pnpm generate

lint:
  corepack pnpm lint

test:
  corepack pnpm test:ts

backup-restore-smoke:
  ./scripts/backup-restore-smoke.sh

check: generate lint test
  corepack pnpm build

down:
  docker compose down
