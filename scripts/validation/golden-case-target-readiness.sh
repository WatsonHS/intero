#!/usr/bin/env bash
set -eEuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${INTERO_PRODUCTION_ENV_FILE:-$repo_root/.env.production}"
state_dir="${INTERO_PRODUCTION_STATE_DIR:-$repo_root/.intero-production}"
preflight_only=false

if [[ "${1:-}" == "--" ]]; then
  shift
fi
if [[ "${1:-}" == "--preflight-only" ]]; then
  preflight_only=true
elif [[ -n "${1:-}" ]]; then
  echo "Usage: $0 [--preflight-only]" >&2
  exit 64
fi

if [[ ! -f "$env_file" ]]; then
  echo "Missing production environment file: $env_file" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the target readiness check." >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for the target readiness check." >&2
  exit 1
fi

public_url="$({
  awk -F= '$1 == "INTERO_PUBLIC_URL" { sub(/^[^=]*=/, ""); print; exit }' \
    "$env_file"
} | tr -d "\"'")"
if [[ "$public_url" != https://* ]]; then
  echo "INTERO_PUBLIC_URL must be an HTTPS origin." >&2
  exit 1
fi

compose=(
  docker compose
  --env-file "$env_file"
  -f "$repo_root/compose.production.yaml"
)

if [[ "$preflight_only" == "true" ]]; then
  "${compose[@]}" config --quiet
  echo "Golden Case target-readiness preflight passed."
  exit 0
fi

if [[ -z "${INTERO_G7_EVIDENCE_DIR:-}" ]]; then
  echo "Set INTERO_G7_EVIDENCE_DIR to a privacy-safe evidence directory." >&2
  exit 1
fi
evidence_dir="$INTERO_G7_EVIDENCE_DIR"
target_id="${INTERO_G7_TARGET_ID:-}"
expected_release_sha="${INTERO_G7_EXPECTED_RELEASE_SHA:-}"
expected_schema_sha="${INTERO_G7_EXPECTED_SCHEMA_SHA:-}"
if [[ -z "$target_id" ]]; then
  echo "Set INTERO_G7_TARGET_ID to the shared non-secret target identifier." >&2
  exit 1
fi
if [[ ! "$target_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "INTERO_G7_TARGET_ID must be a non-secret target identifier." >&2
  exit 1
fi
if [[ ! "$expected_release_sha" =~ ^[0-9a-fA-F]{7,64}$ ]]; then
  echo "INTERO_G7_EXPECTED_RELEASE_SHA must be a Git SHA prefix." >&2
  exit 1
fi
expected_release_sha="$(printf '%s' "$expected_release_sha" | tr '[:upper:]' '[:lower:]')"
expected_schema_sha="${expected_schema_sha:-$expected_release_sha}"
if [[ ! "$expected_schema_sha" =~ ^[0-9a-fA-F]{7,64}$ ]]; then
  echo "INTERO_G7_EXPECTED_SCHEMA_SHA must be a Git SHA prefix." >&2
  exit 1
fi
expected_schema_sha="$(printf '%s' "$expected_schema_sha" | tr '[:upper:]' '[:lower:]')"
mkdir -p "$evidence_dir"
chmod 700 "$evidence_dir"
receipt_path="$evidence_dir/target-readiness.json"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
commit_sha="$(git -C "$repo_root" rev-parse HEAD)"
result="failed"

read_state_tag() {
  local name="$1"
  local path="$state_dir/$name"
  if [[ -f "$path" ]]; then
    tr -d '[:space:]' <"$path"
  fi
}

write_receipt() {
  local exit_code="$1"
  local completed_at
  local current_tag
  local schema_tag
  completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  current_tag="$(read_state_tag current-tag)"
  schema_tag="$(read_state_tag current-schema-tag)"
  INTERO_G7_RECEIPT_PATH="$receipt_path" \
  INTERO_G7_COMMIT_SHA="$commit_sha" \
  INTERO_G7_STARTED_AT="$started_at" \
  INTERO_G7_COMPLETED_AT="$completed_at" \
  INTERO_G7_PUBLIC_ORIGIN="$public_url" \
  INTERO_G7_TARGET_ID="$target_id" \
  INTERO_G7_EXPECTED_RELEASE_SHA="$expected_release_sha" \
  INTERO_G7_EXPECTED_SCHEMA_SHA="$expected_schema_sha" \
  INTERO_G7_RESULT="$result" \
  INTERO_G7_EXIT_CODE="$exit_code" \
  INTERO_G7_CURRENT_TAG="$current_tag" \
  INTERO_G7_SCHEMA_TAG="$schema_tag" \
    node -e '
      const fs = require("node:fs");
      const receipt = {
        schemaVersion: 1,
        check: "golden_case_target_readiness",
        commitSha: process.env.INTERO_G7_COMMIT_SHA,
        startedAt: process.env.INTERO_G7_STARTED_AT,
        completedAt: process.env.INTERO_G7_COMPLETED_AT,
        publicOrigin: new URL(process.env.INTERO_G7_PUBLIC_ORIGIN).origin,
        targetId: process.env.INTERO_G7_TARGET_ID,
        expectedReleaseSha: process.env.INTERO_G7_EXPECTED_RELEASE_SHA,
        expectedSchemaSha: process.env.INTERO_G7_EXPECTED_SCHEMA_SHA,
        result: process.env.INTERO_G7_RESULT,
        exitCode: Number(process.env.INTERO_G7_EXIT_CODE),
        deploymentTag: process.env.INTERO_G7_CURRENT_TAG || null,
        schemaTag: process.env.INTERO_G7_SCHEMA_TAG || null,
        assertions: [
          "required_services_running",
          "target_release_identity_matches",
          "worker_ready",
          "api_ready",
          "public_health",
          "golden_case_tables_present",
          "row_level_security_forced",
          "tenant_isolation_policies_present",
          "runtime_role_grants_present",
          "runtime_roles_not_superuser_or_bypassrls"
        ]
      };
      fs.writeFileSync(
        process.env.INTERO_G7_RECEIPT_PATH,
        `${JSON.stringify(receipt, null, 2)}\n`,
        { mode: 0o600 }
      );
      fs.chmodSync(process.env.INTERO_G7_RECEIPT_PATH, 0o600);
    '
}

on_exit() {
  local exit_code="$?"
  trap - EXIT
  write_receipt "$exit_code"
  exit "$exit_code"
}
trap on_exit EXIT

tag_matches_expected_sha() {
  local tag="$1"
  local expected_sha="$2"
  [[ -n "$tag" && "$expected_sha" == "$tag"* ]]
}

require_ready() {
  local service="$1"
  local ready_url="$2"
  "${compose[@]}" exec -T "$service" node -e '
    const url = process.argv[1];
    fetch(url, { signal: AbortSignal.timeout(10_000) })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || body?.status !== "ready") {
          throw new Error(`expected ready, got HTTP ${response.status} ${body?.status ?? "invalid"}`);
        }
      })
      .catch((error) => {
        console.error(`Readiness check failed: ${error.message}`);
        process.exit(1);
      });
  ' "$ready_url"
}

require_running_image_tag() {
  local service="$1"
  local container image tag
  container="$("${compose[@]}" ps -q "$service")"
  if [[ -z "$container" ]]; then
    echo "No running container found for $service." >&2
    return 1
  fi
  image="$(docker inspect --format '{{.Config.Image}}' "$container")"
  tag="${image##*:}"
  if ! tag_matches_expected_sha "$tag" "$expected_release_sha"; then
    echo "Running $service image tag does not match INTERO_G7_EXPECTED_RELEASE_SHA: $image" >&2
    return 1
  fi
}

"${compose[@]}" config --quiet

running_services="$("${compose[@]}" ps --status running --services)"
for service in postgres spicedb centrifugo minio worker api gateway; do
  if ! grep -Fxq "$service" <<<"$running_services"; then
    echo "Required production service is not running: $service" >&2
    exit 1
  fi
done

current_tag="$(read_state_tag current-tag)"
schema_tag="$(read_state_tag current-schema-tag)"
if ! tag_matches_expected_sha "$current_tag" "$expected_release_sha" ||
  ! tag_matches_expected_sha "$schema_tag" "$expected_schema_sha"; then
  echo "Recorded deployment/schema tags do not match their expected release/schema SHA." >&2
  exit 1
fi
for service in api worker gateway; do
  require_running_image_tag "$service"
done

require_ready worker "http://127.0.0.1:9464/ready"
require_ready api "http://127.0.0.1:4310/ready"
curl --fail --silent --show-error --max-time 10 "$public_url/health" >/dev/null

"${compose[@]}" exec -T postgres \
  psql -X -v ON_ERROR_STOP=1 -U intero -d intero >/dev/null <<'SQL'
DO $$
DECLARE
  target_table text;
  target_role text;
  row_security_enabled boolean;
  row_security_forced boolean;
  policy_qual text;
  policy_with_check text;
  expected_tenant_expression constant text :=
    'organization_id=intero_current_organization_id()';
  role_is_superuser boolean;
  role_bypasses_rls boolean;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'pilot_coordination_projects',
    'pilot_intero_requests'
  ] LOOP
    IF to_regclass('public.' || target_table) IS NULL THEN
      RAISE EXCEPTION 'required Golden Case table is missing: %', target_table;
    END IF;

    SELECT relrowsecurity, relforcerowsecurity
      INTO row_security_enabled, row_security_forced
    FROM pg_class
    WHERE oid = to_regclass('public.' || target_table);
    IF NOT row_security_enabled OR NOT row_security_forced THEN
      RAISE EXCEPTION 'RLS is not enabled and forced for %', target_table;
    END IF;

    SELECT
      regexp_replace(pg_get_expr(policy.polqual, policy.polrelid), '\s+', '', 'g'),
      regexp_replace(pg_get_expr(policy.polwithcheck, policy.polrelid), '\s+', '', 'g')
      INTO policy_qual, policy_with_check
    FROM pg_policy AS policy
    WHERE policy.polrelid = to_regclass('public.' || target_table)
      AND policy.polname = 'tenant_isolation';
    IF policy_qual IS NULL OR policy_with_check IS NULL THEN
      RAISE EXCEPTION 'tenant_isolation policy is missing for %', target_table;
    END IF;
    policy_qual := regexp_replace(policy_qual, '^\((.*)\)$', '\1');
    policy_with_check := regexp_replace(
      policy_with_check,
      '^\((.*)\)$',
      '\1'
    );
    IF policy_qual <> expected_tenant_expression OR
      policy_with_check <> expected_tenant_expression THEN
      RAISE EXCEPTION 'tenant_isolation policy does not use the expected tenant expression for %',
        target_table;
    END IF;

    FOREACH target_role IN ARRAY ARRAY['intero_app', 'intero_worker'] LOOP
      SELECT rolsuper, rolbypassrls
        INTO role_is_superuser, role_bypasses_rls
      FROM pg_roles
      WHERE rolname = target_role;
      IF role_is_superuser IS NULL THEN
        RAISE EXCEPTION 'required runtime role is missing: %', target_role;
      END IF;
      IF role_is_superuser OR role_bypasses_rls THEN
        RAISE EXCEPTION 'runtime role % must not be superuser or BYPASSRLS', target_role;
      END IF;
      IF NOT has_table_privilege(
        target_role,
        'public.' || target_table,
        'SELECT,INSERT,UPDATE,DELETE'
      ) THEN
        RAISE EXCEPTION 'runtime role % lacks Golden Case privileges on %',
          target_role, target_table;
      END IF;
    END LOOP;
  END LOOP;
END
$$;
SQL

result="passed"
echo "Golden Case target readiness passed; receipt: $receipt_path"
