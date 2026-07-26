#!/usr/bin/env bash
set -euo pipefail

: "${INTERO_RESTORE_DATABASE_URL:?INTERO_RESTORE_DATABASE_URL is required}"
: "${INTERO_BACKUP_FILE:?INTERO_BACKUP_FILE is required}"
: "${INTERO_RESTORE_CONFIRM:?INTERO_RESTORE_CONFIRM is required}"

database_name="$(
  psql "${INTERO_RESTORE_DATABASE_URL}" --tuples-only --no-align \
    --command="SELECT current_database();"
)"
expected_confirmation="RESTORE_INTERO_DATABASE:${database_name}"
if [[ "${INTERO_RESTORE_CONFIRM}" != "${expected_confirmation}" ]]; then
  echo "Refusing restore. Set INTERO_RESTORE_CONFIRM=${expected_confirmation}" >&2
  exit 1
fi
if [[ ! -f "${INTERO_BACKUP_FILE}" ]]; then
  echo "Backup file does not exist: ${INTERO_BACKUP_FILE}" >&2
  exit 1
fi
if [[ -f "${INTERO_BACKUP_FILE}.sha256" ]]; then
  if command -v shasum >/dev/null 2>&1; then
    (
      cd "$(dirname "${INTERO_BACKUP_FILE}")"
      shasum -a 256 --check "$(basename "${INTERO_BACKUP_FILE}").sha256"
    )
  elif command -v sha256sum >/dev/null 2>&1; then
    (
      cd "$(dirname "${INTERO_BACKUP_FILE}")"
      sha256sum -c "$(basename "${INTERO_BACKUP_FILE}").sha256"
    )
  else
    echo "Neither shasum nor sha256sum is available." >&2
    exit 1
  fi
fi

table_count="$(
  psql "${INTERO_RESTORE_DATABASE_URL}" --tuples-only --no-align \
    --command="SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema');"
)"
if [[ "${table_count}" != "0" ]]; then
  echo "Refusing restore into non-empty database ${database_name}." >&2
  exit 1
fi

pg_restore \
  --exit-on-error \
  --no-owner \
  --no-acl \
  --dbname="${INTERO_RESTORE_DATABASE_URL}" \
  "${INTERO_BACKUP_FILE}"

restored="$(
  psql "${INTERO_RESTORE_DATABASE_URL}" --tuples-only --no-align \
    --command="SELECT count(*) FROM pg_tables WHERE schemaname = 'public';"
)"
if [[ "${restored}" -lt 48 ]]; then
  echo "Restore verification failed: only ${restored} public tables." >&2
  exit 1
fi

echo "PostgreSQL restore verified in ${database_name}: ${restored} public tables."
