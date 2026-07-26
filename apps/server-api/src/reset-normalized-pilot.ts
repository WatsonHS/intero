import { OrganizationId } from "@intero/domain";
import { Client } from "pg";

const confirmationPrefix = "DELETE_NORMALIZED_PILOT_DATA";
const validationDatabasePattern = /^intero_(?:validation_|.*_test_)/i;
const validationTargetConfirmationPrefix = "INTERO_VALIDATION_DISPOSABLE";
const providerDestructionConfirmationPrefix =
  "DESTROY_INTERO_CONFIGURED_PROVIDER";

export function requireResetConfirmation(
  organizationId: string | undefined,
  confirmation: string | undefined,
): OrganizationId {
  const parsedOrganizationId = OrganizationId.parse(organizationId);
  const expected = `${confirmationPrefix}:${parsedOrganizationId}`;
  if (confirmation !== expected) {
    throw new Error(
      `Refusing reset. Set INTERO_RESET_CONFIRM exactly to ${expected}.`,
    );
  }
  return parsedOrganizationId;
}

export function expectedValidationResetTargetConfirmation(
  databaseUrl: string,
): string {
  const target = new URL(databaseUrl);
  const databaseName = decodeURIComponent(target.pathname.replace(/^\/+/, ""));
  return `${validationTargetConfirmationPrefix}:${target.hostname}:${target.port || "5432"}/${databaseName}`;
}

export function requireDisposableValidationResetTarget(
  databaseUrl: string,
  confirmation: string | undefined,
): void {
  const target = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(target.protocol)) {
    throw new Error("Validation reset requires a PostgreSQL DATABASE_URL.");
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)) {
    throw new Error(
      "Validation reset only accepts a loopback disposable PostgreSQL target.",
    );
  }
  const databaseName = decodeURIComponent(target.pathname.replace(/^\/+/, ""));
  if (!validationDatabasePattern.test(databaseName)) {
    throw new Error(
      "Validation reset database names must start with intero_validation_ or contain an explicit _test_ segment.",
    );
  }
  const expected = expectedValidationResetTargetConfirmation(databaseUrl);
  if (confirmation !== expected) {
    throw new Error(
      `Refusing validation reset. Set INTERO_RESET_DISPOSABLE_CONFIRM exactly to ${expected}.`,
    );
  }
}

export function expectedNormalizedProviderDestructionConfirmation(
  databaseUrl: string,
  organizationId: OrganizationId,
): string {
  return `${providerDestructionConfirmationPrefix}:${expectedValidationResetTargetConfirmation(databaseUrl).slice(`${validationTargetConfirmationPrefix}:`.length)}:${organizationId}`;
}

export function requireNormalizedProviderDestructionConfirmation(input: {
  databaseUrl: string;
  organizationId: OrganizationId;
  hasConfiguredProvider: boolean;
  confirmation?: string;
}): void {
  if (!input.hasConfiguredProvider) return;
  const expected = expectedNormalizedProviderDestructionConfirmation(
    input.databaseUrl,
    input.organizationId,
  );
  if (input.confirmation !== expected) {
    throw new Error(
      `Refusing to reset normalized Pilot data with an existing configured Provider. This would permanently delete its encrypted credential. For a disposable validation database only, set INTERO_RESET_DESTROY_PROVIDER_CONFIG exactly to ${expected}.`,
    );
  }
}

export async function resetNormalizedPilotData(input: {
  databaseUrl: string;
  organizationId: OrganizationId;
  disposableTargetConfirmation: string;
  providerDestructionConfirmation?: string;
}): Promise<Record<string, number>> {
  requireDisposableValidationResetTarget(
    input.databaseUrl,
    input.disposableTargetConfirmation,
  );
  const client = new Client({ connectionString: input.databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`intero:pilot:${input.organizationId}`],
    );
    const exists = await client.query(
      "SELECT id FROM organizations WHERE id = $1",
      [input.organizationId],
    );
    if (!exists.rows[0]) {
      throw new Error(
        `Organization ${input.organizationId} does not exist in the selected database.`,
      );
    }
    const configuredProvider = await client.query<{ configured: boolean }>(
      `SELECT EXISTS(
         SELECT 1
         FROM pilot_provider_configs
         WHERE organization_id = $1
       ) AS configured`,
      [input.organizationId],
    );
    requireNormalizedProviderDestructionConfirmation({
      databaseUrl: input.databaseUrl,
      organizationId: input.organizationId,
      hasConfiguredProvider: configuredProvider.rows[0]?.configured === true,
      ...(input.providerDestructionConfirmation
        ? { confirmation: input.providerDestructionConfirmation }
        : {}),
    });
    const deleted: Record<string, number> = {};
    const operations = await client.query<{ operation_id: string }>(
      `SELECT operation_id
       FROM activity_events
       WHERE organization_id = $1 AND event_type LIKE 'pilot.%'`,
      [input.organizationId],
    );
    if (operations.rows.length > 0) {
      const ids = operations.rows.map((row) => row.operation_id);
      deleted.outbox =
        (
          await client.query(
            "DELETE FROM outbox WHERE operation_id = ANY($1::uuid[])",
            [ids],
          )
        ).rowCount ?? 0;
      deleted.activity_events =
        (
          await client.query(
            `DELETE FROM activity_events
           WHERE organization_id = $1 AND operation_id = ANY($2::uuid[])`,
            [input.organizationId, ids],
          )
        ).rowCount ?? 0;
    }
    for (const table of resetOrder) {
      const result = await client.query(
        `DELETE FROM ${table} WHERE organization_id = $1`,
        [input.organizationId],
      );
      deleted[table] = result.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return deleted;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

const resetOrder = [
  "pilot_checkpoint_idempotency",
  "pilot_coordination_participants",
  "pilot_coordination_threads",
  "pilot_pulse_entries",
  "pilot_private_claims",
  "pilot_stand_in_jobs",
  "pilot_work_states",
  "pilot_agent_bindings",
  "pilot_agent_tickets",
  "pilot_dm_messages",
  "pilot_dm_threads",
  "pilot_stand_in_exchanges",
  "pilot_project_teams",
  "pilot_project_settings",
  "pilot_team_join_links",
  "pilot_team_invitations",
  "pilot_team_memberships",
  "pilot_teams",
  "pilot_provider_configs",
  "pilot_worker_heartbeats",
  "pilot_deployment_settings",
] as const;

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL for the explicitly selected database is required.",
    );
  }
  const organizationId = requireResetConfirmation(
    process.env.INTERO_RESET_ORGANIZATION_ID,
    process.env.INTERO_RESET_CONFIRM,
  );
  const target = new URL(databaseUrl);
  process.stdout.write(
    `${JSON.stringify({
      resetting: true,
      database: target.pathname.replace(/^\//, ""),
      host: target.host,
      organizationId,
    })}\n`,
  );
  const deleted = await resetNormalizedPilotData({
    databaseUrl,
    organizationId,
    disposableTargetConfirmation:
      process.env.INTERO_RESET_DISPOSABLE_CONFIRM ?? "",
    ...(process.env.INTERO_RESET_DESTROY_PROVIDER_CONFIG
      ? {
          providerDestructionConfirmation:
            process.env.INTERO_RESET_DESTROY_PROVIDER_CONFIG,
        }
      : {}),
  });
  process.stdout.write(`${JSON.stringify({ reset: true, deleted })}\n`);
}
