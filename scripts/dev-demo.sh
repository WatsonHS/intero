#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${INTERO_AUTH_SECRET:-}" ]]; then
  echo "dev:demo requires INTERO_AUTH_SECRET for persistent session authentication." >&2
  exit 1
fi

# A loopback demo uses the development service profile so HTTP localhost,
# insecure local SpiceDB, and the bundled collaboration services remain valid.
# Authentication still uses real Better Auth sessions because the development
# identity simulator is explicitly disabled below. Secure HTTPS environments
# may opt into product mode before invoking this script.
export INTERO_RUNTIME_MODE="${INTERO_RUNTIME_MODE:-development}"
export INTERO_ALLOW_DEVELOPMENT_IDENTITY=false
export INTERO_ORGANIZATION_ID="${INTERO_ORGANIZATION_ID:-019f9a00-0000-7000-8000-000000000001}"
export INTERO_ORGANIZATION_NAME="${INTERO_ORGANIZATION_NAME:-Intero Demo}"
export INTERO_PRINCIPAL_ID="${INTERO_PRINCIPAL_ID:-019f9a00-0000-7000-8000-000000000101}"
export INTERO_PRINCIPAL_NAME="${INTERO_PRINCIPAL_NAME:-Alex Rivera}"
export INTERO_STAND_IN_ID="${INTERO_STAND_IN_ID:-019f9a00-0000-7000-8000-000000000201}"
export INTERO_STAND_IN_NAME="${INTERO_STAND_IN_NAME:-Intero Stand-in}"
# Leave the default empty so the browser uses :4310 when opened directly on
# Vite and stays same-origin when opened through Caddy on :4311.
export VITE_INTERO_API_URL="${VITE_INTERO_API_URL:-}"

pnpm demo:seed
exec pnpm dev:pilot
