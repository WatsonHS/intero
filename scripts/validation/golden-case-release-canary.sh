#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
commit_sha="$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || printf 'unknown')"
evidence_dir="${INTERO_G7_EVIDENCE_DIR:-}"
api_origin=""
renderer_origin=""
target_id="${INTERO_G7_TARGET_ID:-}"
expected_release_sha="${INTERO_G7_EXPECTED_RELEASE_SHA:-}"
manifest_reference=""
manifest_sha256=""
private_output_dir=""
result="FAIL"

cleanup_private_output() {
  if [[ -n "$private_output_dir" && -d "$private_output_dir" ]]; then
    rm -rf -- "$private_output_dir"
  fi
}

write_summary() {
  local exit_status=$?
  local completed_at summary_file summary_tmp

  trap - EXIT
  completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if [[ -z "$evidence_dir" ]] || ! mkdir -p -- "$evidence_dir" 2>/dev/null; then
    printf '%s\n' "Cannot write the privacy-safe G7 summary: INTERO_G7_EVIDENCE_DIR is required and must be writable." >&2
    if [[ "$exit_status" -eq 0 ]]; then
      exit_status=1
    fi
    cleanup_private_output
    exit "$exit_status"
  fi
  if ! chmod 700 "$evidence_dir"; then
    printf '%s\n' "Cannot restrict the privacy-safe G7 evidence directory." >&2
    if [[ "$exit_status" -eq 0 ]]; then
      exit_status=1
    fi
    cleanup_private_output
    exit "$exit_status"
  fi

  summary_file="$evidence_dir/golden-case-release-canary.json"
  summary_tmp="$(mktemp "$evidence_dir/.golden-case-release-canary.XXXXXX" 2>/dev/null || true)"
  if [[ -z "$summary_tmp" ]]; then
    printf '%s\n' "Cannot create the privacy-safe G7 summary file." >&2
    if [[ "$exit_status" -eq 0 ]]; then
      exit_status=1
    fi
    cleanup_private_output
    exit "$exit_status"
  fi

  if ! SCHEMA_VERSION="1" \
    COMMIT_SHA="$commit_sha" \
    STARTED_AT="$started_at" \
    COMPLETED_AT="$completed_at" \
    API_ORIGIN="$api_origin" \
    RENDERER_ORIGIN="$renderer_origin" \
    TARGET_ID="$target_id" \
    EXPECTED_RELEASE_SHA="$expected_release_sha" \
    MANIFEST_REFERENCE="$manifest_reference" \
    MANIFEST_SHA256="$manifest_sha256" \
    RESULT="$result" \
    ARTIFACT_DIRECTORY="$evidence_dir" \
    node -e '
      const summary = {
        schemaVersion: Number(process.env.SCHEMA_VERSION),
        commitSha: process.env.COMMIT_SHA,
        startedAt: process.env.STARTED_AT,
        completedAt: process.env.COMPLETED_AT,
        apiOrigin: process.env.API_ORIGIN || null,
        rendererOrigin: process.env.RENDERER_ORIGIN || null,
        targetId: process.env.TARGET_ID || null,
        expectedReleaseSha: process.env.EXPECTED_RELEASE_SHA || null,
        runtimeManifest: process.env.MANIFEST_REFERENCE
          ? {
              reference: process.env.MANIFEST_REFERENCE,
              sha256: process.env.MANIFEST_SHA256,
            }
          : null,
        result: process.env.RESULT,
        artifactDirectory: process.env.ARTIFACT_DIRECTORY,
      };
      process.stdout.write(`${JSON.stringify(summary)}\n`);
    ' >"$summary_tmp"; then
    rm -f -- "$summary_tmp"
    printf '%s\n' "Cannot write the privacy-safe G7 summary." >&2
    if [[ "$exit_status" -eq 0 ]]; then
      exit_status=1
    fi
    cleanup_private_output
    exit "$exit_status"
  fi

  mv -f -- "$summary_tmp" "$summary_file"
  if ! chmod 600 "$summary_file"; then
    printf '%s\n' "Cannot restrict the privacy-safe G7 summary file." >&2
    if [[ "$exit_status" -eq 0 ]]; then
      exit_status=1
    fi
    cleanup_private_output
    exit "$exit_status"
  fi
  cleanup_private_output
  exit "$exit_status"
}
trap write_summary EXIT

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    fail "Required environment variable is not set: $name"
  fi
}

parse_origin() {
  local name="$1"
  URL_TO_PARSE="${!name}" node -e '
    try {
      const url = new URL(process.env.URL_TO_PARSE);
      if (url.protocol !== "http:" && url.protocol !== "https:") process.exit(1);
      process.stdout.write(url.origin);
    } catch {
      process.exit(1);
    }
  '
}

reject_local_origin() {
  local name="$1"
  ORIGIN_TO_CHECK="${!name}" node -e '
    try {
      const host = new URL(process.env.ORIGIN_TO_CHECK).hostname.toLowerCase();
      const local = host === "localhost" || host.endsWith(".localhost") ||
        host === "0.0.0.0" || host === "::1" || host === "[::1]" ||
        /^127\./.test(host);
      process.exit(local ? 1 : 0);
    } catch {
      process.exit(1);
    }
  '
}

preflight_only=false
if [[ "${1:-}" == "--" ]]; then
  shift
fi
case "$#" in
  0) ;;
  1)
    case "$1" in
      --preflight-only) preflight_only=true ;;
      *) fail "Unsupported argument. Use --preflight-only or no argument." ;;
    esac
    ;;
  *) fail "Unsupported arguments. Use --preflight-only or no argument." ;;
esac

require_env INTERO_G7_EVIDENCE_DIR
require_env INTERO_E2E_API_URL
require_env INTERO_E2E_RENDERER_URL
require_env INTERO_E2E_PASSWORD
require_env INTERO_G7_TARGET_ID
require_env INTERO_G7_EXPECTED_RELEASE_SHA

if [[ ! "$target_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  fail "INTERO_G7_TARGET_ID must be a non-secret target identifier."
fi
if [[ ! "$expected_release_sha" =~ ^[0-9a-fA-F]{7,64}$ ]]; then
  fail "INTERO_G7_EXPECTED_RELEASE_SHA must be a Git SHA prefix."
fi
expected_release_sha="$(printf '%s' "$expected_release_sha" | tr '[:upper:]' '[:lower:]')"
if [[ "$commit_sha" != "$expected_release_sha"* ]]; then
  fail "Current checkout does not begin with INTERO_G7_EXPECTED_RELEASE_SHA."
fi
mkdir -p "$evidence_dir"
chmod 700 "$evidence_dir"

if ! api_origin="$(parse_origin INTERO_E2E_API_URL)"; then
  fail "INTERO_E2E_API_URL must be a valid HTTP(S) URL."
fi
if ! renderer_origin="$(parse_origin INTERO_E2E_RENDERER_URL)"; then
  fail "INTERO_E2E_RENDERER_URL must be a valid HTTP(S) URL."
fi
if ! reject_local_origin INTERO_E2E_API_URL; then
  fail "INTERO_E2E_API_URL must not target localhost or a loopback address."
fi
if ! reject_local_origin INTERO_E2E_RENDERER_URL; then
  fail "INTERO_E2E_RENDERER_URL must not target localhost or a loopback address."
fi

if [[ "$preflight_only" == "true" ]]; then
  result="PREFLIGHT_PASSED"
  exit 0
fi

cd "$repo_root"
private_output_dir="$(mktemp -d "${TMPDIR:-/tmp}/intero-g7-playwright.XXXXXX")"
chmod 700 "$private_output_dir"
INTERO_REAL_PROVIDER_CANARY=1 \
INTERO_G7_PRIVACY_SAFE=1 \
INTERO_PLAYWRIGHT_OUTPUT_DIR="$private_output_dir" \
  pnpm test:e2e:collaboration --grep "Golden Case canary"
manifest_reference="golden-case-provider-canary.json"
manifest_path="$evidence_dir/$manifest_reference"
if [[ ! -f "$manifest_path" ]]; then
  fail "Golden Case canary did not produce its privacy-safe runtime manifest."
fi
manifest_sha256="$(
  INTERO_G7_MANIFEST_PATH="$manifest_path" node -e '
    const { createHash } = require("node:crypto");
    const { readFileSync } = require("node:fs");
    process.stdout.write(
      createHash("sha256").update(readFileSync(process.env.INTERO_G7_MANIFEST_PATH)).digest("hex"),
    );
  '
)"
result="PASS"
