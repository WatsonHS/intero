#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${INTERO_AUTH_SECRET:-}" ]]; then
  echo "dev:demo requires INTERO_AUTH_SECRET for product-mode session authentication." >&2
  exit 1
fi

export INTERO_RUNTIME_MODE=product
export INTERO_ALLOW_DEVELOPMENT_IDENTITY=false
# Leave the default empty so the browser uses :4310 when opened directly on
# Vite and stays same-origin when opened through Caddy on :4311.
export VITE_INTERO_API_URL="${VITE_INTERO_API_URL:-}"

pnpm demo:seed
exec pnpm dev:pilot
