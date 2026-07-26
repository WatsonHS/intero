#!/usr/bin/env bash
set -euo pipefail

backup_file="$(mktemp "${TMPDIR:-/tmp}/intero-backup.XXXXXX.dump")"
restore_database="intero_restore_smoke_${RANDOM}_${RANDOM}"

cleanup() {
  docker compose exec -T postgres dropdb --if-exists --username=intero "${restore_database}" >/dev/null
  rm -f "${backup_file}"
}
trap cleanup EXIT

docker compose exec -T postgres \
  pg_dump --format=custom --no-owner --username=intero intero >"${backup_file}"
docker compose exec -T postgres \
  createdb --username=intero "${restore_database}"
docker compose exec -T postgres \
  pg_restore --exit-on-error --no-owner --username=intero \
  --dbname="${restore_database}" <"${backup_file}"

table_count="$(
  docker compose exec -T postgres \
    psql --tuples-only --no-align --username=intero --dbname="${restore_database}" \
    --command="SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"
)"

if [[ "${table_count}" -lt 48 ]]; then
  echo "Restored database has too few public tables: ${table_count}" >&2
  exit 1
fi

object_table="$(
  docker compose exec -T postgres \
    psql --tuples-only --no-align --username=intero --dbname="${restore_database}" \
    --command="SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'object_store_objects';"
)"
if [[ "${object_table}" != "1" ]]; then
  echo "Restored database is missing object_store_objects." >&2
  exit 1
fi

echo "Backup restore smoke passed with ${table_count} public tables."
