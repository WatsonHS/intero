#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${INTERO_BACKUP_FILE:?INTERO_BACKUP_FILE is required}"

case "${INTERO_BACKUP_FILE}" in
  /*.dump) ;;
  *)
    echo "INTERO_BACKUP_FILE must be an absolute .dump path." >&2
    exit 1
    ;;
esac

if [[ -e "${INTERO_BACKUP_FILE}" || -e "${INTERO_BACKUP_FILE}.sha256" ]]; then
  echo "Refusing to overwrite an existing backup or checksum." >&2
  exit 1
fi

umask 077
mkdir -p "$(dirname "${INTERO_BACKUP_FILE}")"
backup_directory="$(dirname "${INTERO_BACKUP_FILE}")"
backup_temp="$(mktemp "${backup_directory}/.intero-backup.XXXXXX")"
checksum_temp="$(mktemp "${backup_directory}/.intero-checksum.XXXXXX")"
cleanup() {
  rm -f "${backup_temp}" "${checksum_temp}"
}
trap cleanup EXIT

pg_dump \
  --dbname="${DATABASE_URL}" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="${backup_temp}"
pg_restore --list "${backup_temp}" >/dev/null
if command -v shasum >/dev/null 2>&1; then
  backup_checksum="$(shasum -a 256 "${backup_temp}" | awk '{ print $1 }')"
elif command -v sha256sum >/dev/null 2>&1; then
  backup_checksum="$(sha256sum "${backup_temp}" | awk '{ print $1 }')"
else
  echo "Neither shasum nor sha256sum is available." >&2
  exit 1
fi
printf '%s  %s\n' \
  "${backup_checksum}" \
  "$(basename "${INTERO_BACKUP_FILE}")" \
  >"${checksum_temp}"
mv "${backup_temp}" "${INTERO_BACKUP_FILE}"
mv "${checksum_temp}" "${INTERO_BACKUP_FILE}.sha256"
trap - EXIT

echo "PostgreSQL backup verified: ${INTERO_BACKUP_FILE}"
