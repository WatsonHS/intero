import { OrganizationId } from "@intero/domain";
import { Client } from "pg";

const confirmationPrefix = "DELETE_NORMALIZED_PILOT_DATA";

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

export async function resetNormalizedPilotData(input: {
  databaseUrl: string;
  organizationId: OrganizationId;
}): Promise<Record<string, number>> {
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
  });
  process.stdout.write(`${JSON.stringify({ reset: true, deleted })}\n`);
}
