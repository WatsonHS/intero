#!/bin/sh
set -eu

: "${INTERO_POSTGRES_APP_PASSWORD:?Set INTERO_POSTGRES_APP_PASSWORD}"
: "${INTERO_POSTGRES_WORKER_PASSWORD:?Set INTERO_POSTGRES_WORKER_PASSWORD}"
: "${INTERO_POSTGRES_SPICEDB_PASSWORD:?Set INTERO_POSTGRES_SPICEDB_PASSWORD}"
: "${INTERO_POSTGRES_ADMIN_PASSWORD:?Set INTERO_POSTGRES_ADMIN_PASSWORD}"

bootstrap_password="${INTERO_POSTGRES_BOOTSTRAP_PASSWORD:-$INTERO_POSTGRES_ADMIN_PASSWORD}"
if ! PGPASSWORD="$bootstrap_password" psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --command "SELECT 1" >/dev/null 2>&1; then
  export PGPASSWORD="$INTERO_POSTGRES_ADMIN_PASSWORD"
else
  export PGPASSWORD="$bootstrap_password"
fi

psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set ON_ERROR_STOP=1 \
  --set admin_password="$INTERO_POSTGRES_ADMIN_PASSWORD" \
  --set app_password="$INTERO_POSTGRES_APP_PASSWORD" \
  --set worker_password="$INTERO_POSTGRES_WORKER_PASSWORD" \
  --set spicedb_password="$INTERO_POSTGRES_SPICEDB_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE intero_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_app')
\gexec

SELECT format('ALTER ROLE intero_app PASSWORD %L', :'app_password')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_app')
\gexec

SELECT format(
  'CREATE ROLE intero_worker LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'worker_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_worker')
\gexec

SELECT format('ALTER ROLE intero_worker PASSWORD %L', :'worker_password')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_worker')
\gexec

SELECT format(
  'CREATE ROLE intero_spicedb LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'spicedb_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_spicedb')
\gexec

SELECT format('ALTER ROLE intero_spicedb PASSWORD %L', :'spicedb_password')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_spicedb')
\gexec

GRANT CONNECT ON DATABASE intero TO intero_app;
GRANT CONNECT, CREATE ON DATABASE intero TO intero_worker;
GRANT USAGE ON SCHEMA public TO intero_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO intero_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO intero_app;

SELECT 'CREATE DATABASE intero_spicedb OWNER intero_spicedb'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'intero_spicedb')
\gexec

SELECT format('ALTER ROLE intero PASSWORD %L', :'admin_password')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero')
\gexec
SQL
