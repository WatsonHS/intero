#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${INTERO_AUTH_SECRET:-}" ]]; then
  echo "dev:demo requires INTERO_AUTH_SECRET for product-mode session authentication." >&2
  exit 1
fi

export INTERO_RUNTIME_MODE=product
export INTERO_ALLOW_DEVELOPMENT_IDENTITY=false
export VITE_INTERO_API_URL="${VITE_INTERO_API_URL:-${INTERO_PUBLIC_URL:-http://localhost:4310}}"

pnpm demo:seed
exec pnpm dev:pilot
