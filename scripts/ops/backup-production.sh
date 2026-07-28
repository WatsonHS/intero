#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${INTERO_PRODUCTION_ENV_FILE:-$repo_root/.env.production}"
backup_root="${INTERO_BACKUP_DIR:-$HOME/Library/Application Support/Intero/backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ ! -f "$env_file" ]]; then
  echo "Missing production environment file: $env_file" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is unavailable; production backup was not created." >&2
  exit 1
fi

compose=(
  docker compose
  --env-file "$env_file"
  -f "$repo_root/compose.production.yaml"
)
mkdir -p "$backup_root"
pending_dir="$(mktemp -d "$backup_root/.pending-$timestamp.XXXXXX")"
final_dir="$backup_root/$timestamp"

"${compose[@]}" exec -T postgres \
  pg_dump --username intero --dbname intero --format=custom \
  >"$pending_dir/intero.dump"
"${compose[@]}" exec -T postgres \
  pg_dump --username intero --dbname intero_spicedb --format=custom \
  >"$pending_dir/intero-spicedb.dump"
"${compose[@]}" exec -T postgres \
  pg_dumpall --username intero --globals-only \
  >"$pending_dir/globals.sql"

"${compose[@]}" exec -T postgres pg_restore --list \
  <"$pending_dir/intero.dump" >/dev/null
"${compose[@]}" exec -T postgres pg_restore --list \
  <"$pending_dir/intero-spicedb.dump" >/dev/null

(
  cd "$pending_dir"
  shasum -a 256 intero.dump intero-spicedb.dump globals.sql >SHA256SUMS
)
mv "$pending_dir" "$final_dir"
echo "Created verified Intero production backup: $final_dir"
