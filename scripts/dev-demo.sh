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

provider_pid=""
pilot_pid=""
cleanup() {
  if [[ -n "$pilot_pid" ]]; then
    kill "$pilot_pid" 2>/dev/null || true
    wait "$pilot_pid" 2>/dev/null || true
  fi
  if [[ -n "$provider_pid" ]]; then
    kill "$provider_pid" 2>/dev/null || true
    wait "$provider_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

pnpm --filter @intero/server-api dev:pilot-provider &
provider_pid=$!
provider_ready=false
for _attempt in $(seq 1 30); do
  if curl --silent --output /dev/null http://127.0.0.1:4312/; then
    provider_ready=true
    break
  fi
  if ! kill -0 "$provider_pid" 2>/dev/null; then
    wait "$provider_pid"
    exit 1
  fi
  sleep 0.2
done
if [[ "$provider_ready" != "true" ]]; then
  echo "dev:demo deterministic provider did not become ready." >&2
  exit 1
fi

pnpm dev:pilot &
pilot_pid=$!
wait "$pilot_pid"
