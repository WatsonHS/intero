import {
  OrganizationId,
  type PilotAgentBinding,
  type PilotAgentTicket,
  type PilotCheckpointInput,
  type PilotOrganization,
  type PilotProject,
  PrincipalId,
  ProjectId,
  uuidv7,
} from "@intero/domain";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "./database/migrate.js";
import { NormalizedPostgresPilotStore } from "./normalized-postgres-pilot-store.js";
import { AesGcmProviderSecretCipher } from "./provider-secrets.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const databaseSuite = databaseUrl && databaseAppUrl ? describe : describe.skip;

databaseSuite("Normalized PostgreSQL PilotStore", () => {
  const organizationId = OrganizationId.parse(uuidv7());
  const secondOrganizationId = OrganizationId.parse(uuidv7());
  const adminId = PrincipalId.parse(uuidv7());
  const memberId = PrincipalId.parse(uuidv7());
  const teamId = uuidv7();
  const projectId = ProjectId.parse(uuidv7());
  const admin = new Client({ connectionString: databaseUrl });
  let store: NormalizedPostgresPilotStore;

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    await admin.connect();
    await admin.query("GRANT USAGE ON SCHEMA public TO intero_app");
    await admin.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO intero_app",
    );
    await admin.query(
      "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO intero_app",
    );
    store = new NormalizedPostgresPilotStore(
      new Pool({ connectionString: databaseAppUrl }),
      organizationId,
    );
    await seedOrganization(store, {
      organizationId,
      adminId,
      memberId,
      teamId,
      projectId,
    });
  });

  afterAll(async () => {
    await store.close();
    await deleteOrganizationFixture(admin, organizationId);
    await deleteOrganizationFixture(admin, secondOrganizationId);
    await admin.query("DELETE FROM principals WHERE id = ANY($1::uuid[])", [
      [adminId, memberId],
    ]);
    await admin.end();
  });

  it("persists setup and encrypted provider configuration across store instances", async () => {
    const cipher = new AesGcmProviderSecretCipher(
      "normalized-store-provider-secret",
    );
    const encryptedApiKey = cipher.encrypt("provider-secret-value");
    await store.configureProvider({
      administratorId: adminId,
      endpoint: "https://provider.example/v1",
      defaultModel: "stand-in-model",
      encryptedApiKey,
    });

    const restarted = new NormalizedPostgresPilotStore(
      new Pool({ connectionString: databaseAppUrl }),
      organizationId,
    );
    await expect(restarted.getOrganization()).resolves.toMatchObject({
      id: organizationId,
      provider: {
        configured: true,
        endpoint: "https://provider.example/v1",
        defaultModel: "stand-in-model",
      },
    });
    const persisted = await restarted.getProviderConfiguration();
    expect(persisted?.encryptedApiKey).not.toContain("provider-secret-value");
    expect(cipher.decrypt(persisted!.encryptedApiKey)).toBe(
      "provider-secret-value",
    );
    await restarted.close();
  });

  it("allocates unique DM sequence values under concurrent sends", async () => {
    const thread = await store.getOrCreateDirectMessage({
      id: uuidv7(),
      teamId,
      principalId: adminId,
      peerId: memberId,
      now: "2026-07-26T01:00:00.000Z",
    });
    const messages = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        store.sendDirectMessage({
          id: uuidv7(),
          threadId: thread.id,
          senderId: index % 2 === 0 ? adminId : memberId,
          sequence: 1,
          body: `Message ${index + 1}`,
          createdAt: `2026-07-26T01:00:${String(index).padStart(2, "0")}.000Z`,
        }),
      ),
    );
    expect(
      messages
        .map((message) => message.sequence)
        .toSorted((left, right) => left - right),
    ).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));

    const restarted = new NormalizedPostgresPilotStore(
      new Pool({ connectionString: databaseAppUrl }),
      organizationId,
    );
    const persisted = await restarted.listDirectMessageThreads(adminId);
    expect(persisted[0]?.messages).toHaveLength(12);
    await restarted.close();
  });

  it("redeems an Agent ticket exactly once under concurrency", async () => {
    const ticket: PilotAgentTicket = {
      id: uuidv7(),
      projectId,
      ownerId: adminId,
      client: "codex",
      preferredLanguage: "en-US",
      ticketHash: "a".repeat(64),
      expiresAt: "2026-07-27T00:00:00.000Z",
      createdAt: "2026-07-26T01:10:00.000Z",
    };
    await store.createAgentTicket(ticket);
    const attempts = await Promise.allSettled([
      store.exchangeAgentTicket(
        ticket.ticketHash,
        binding(projectId, adminId, "b".repeat(64)),
        "2026-07-26T01:10:01.000Z",
      ),
      store.exchangeAgentTicket(
        ticket.ticketHash,
        binding(projectId, adminId, "c".repeat(64)),
        "2026-07-26T01:10:01.000Z",
      ),
    ]);
    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(1);
  });

  it("keeps checkpoint idempotency and withdrawal separate from private state", async () => {
    const activeBinding = (
      await store.listAgentBindings(projectId, adminId)
    )[0]!;
    const checkpoint = checkpointInput(projectId);
    const [first, second] = await Promise.all([
      store.ingestCheckpoint(
        activeBinding,
        checkpoint,
        "2026-07-26T01:20:01.000Z",
      ),
      store.ingestCheckpoint(
        activeBinding,
        checkpoint,
        "2026-07-26T01:20:01.000Z",
      ),
    ]);
    expect([first.duplicate, second.duplicate].toSorted()).toEqual([
      false,
      true,
    ]);
    const workState = first.workState;
    await store.publishStandInSummary({
      binding: activeBinding,
      checkpoint,
      workStateId: workState.id,
      safeSummary: "The billing export is ready for finance review.",
      narrative: checkpoint.narrative,
      now: "2026-07-26T01:20:02.000Z",
    });
    expect(await store.listTeamPulse(projectId, memberId)).toHaveLength(1);
    const firstWithdrawal = await store.withdrawPulseEntry(
      projectId,
      workState.id,
      adminId,
      "normalized-withdrawal-20260726-0001",
      "2026-07-26T01:20:03.000Z",
    );
    expect(firstWithdrawal.duplicate).toBe(false);
    const replayedWithdrawal = await store.withdrawPulseEntry(
      projectId,
      workState.id,
      adminId,
      "normalized-withdrawal-20260726-0001",
      "2026-07-26T01:20:04.000Z",
    );
    expect(replayedWithdrawal.duplicate).toBe(true);
    expect(replayedWithdrawal.entry.withdrawnAt).toBe(
      "2026-07-26T01:20:03.000Z",
    );
    expect(await store.listTeamPulse(projectId, memberId)).toHaveLength(0);
    expect(await store.listPrivateWorkState(projectId, adminId)).toHaveLength(
      1,
    );

    const eventCount = await admin.query<{ count: string }>(
      `SELECT count(*)
       FROM activity_events
       WHERE organization_id = $1
         AND event_type = 'pilot.checkpoint.validation_completed'`,
      [organizationId],
    );
    expect(eventCount.rows[0]?.count).toBe("1");
    const outboxCount = await admin.query<{ count: string }>(
      `SELECT count(*)
       FROM outbox
       WHERE organization_id = $1
         AND topic = 'pilot.checkpoint.validation_completed'`,
      [organizationId],
    );
    expect(outboxCount.rows[0]?.count).toBe("1");
    const withdrawalEffects = await admin.query<{
      activity_count: string;
      outbox_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text
          FROM activity_events
          WHERE organization_id=$1 AND event_type='pilot.pulse.withdrawn')
           activity_count,
         (SELECT count(*)::text
          FROM outbox
          WHERE organization_id=$1 AND topic='pilot.pulse.withdrawn')
           outbox_count`,
      [organizationId],
    );
    expect(withdrawalEffects.rows[0]).toEqual({
      activity_count: "1",
      outbox_count: "1",
    });
  });

  it("enforces cross-Organization RLS on every normalized table", async () => {
    const otherStore = new NormalizedPostgresPilotStore(
      new Pool({ connectionString: databaseAppUrl }),
      secondOrganizationId,
    );
    await seedOrganization(otherStore, {
      organizationId: secondOrganizationId,
      adminId,
      memberId,
      teamId: uuidv7(),
      projectId: ProjectId.parse(uuidv7()),
    });
    const client = new Client({ connectionString: databaseAppUrl });
    await client.connect();
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('intero.organization_id', $1, true)",
      [organizationId],
    );
    for (const table of normalizedPilotTables) {
      const hidden = await client.query<{ count: string }>(
        `SELECT count(*) FROM ${table} WHERE organization_id = $1`,
        [secondOrganizationId],
      );
      expect(hidden.rows[0]?.count, table).toBe("0");
    }
    await client.query("ROLLBACK");
    await client.end();

    const policies = await admin.query<{
      table_name: string;
      forced: boolean;
    }>(
      `SELECT c.relname AS table_name, c.relforcerowsecurity AS forced
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])
         AND EXISTS (
           SELECT 1
           FROM pg_policy p
           WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation'
         )
       ORDER BY c.relname`,
      [normalizedPilotTables],
    );
    expect(policies.rows.map((policy) => policy.table_name)).toEqual(
      normalizedPilotTables.toSorted(),
    );
    expect(policies.rows.every((policy) => policy.forced)).toBe(true);
    await otherStore.close();
  });
});

const normalizedPilotTables = [
  "pilot_agent_bindings",
  "pilot_agent_tickets",
  "pilot_checkpoint_idempotency",
  "pilot_coordination_participants",
  "pilot_coordination_threads",
  "pilot_deployment_settings",
  "pilot_dm_messages",
  "pilot_dm_threads",
  "pilot_private_claims",
  "pilot_project_settings",
  "pilot_project_teams",
  "pilot_provider_configs",
  "pilot_pulse_entries",
  "pilot_stand_in_exchanges",
  "pilot_stand_in_jobs",
  "pilot_team_join_links",
  "pilot_team_invitations",
  "pilot_team_memberships",
  "pilot_teams",
  "pilot_work_states",
  "pilot_worker_heartbeats",
] as const;

async function seedOrganization(
  store: NormalizedPostgresPilotStore,
  fixture: {
    organizationId: OrganizationId;
    adminId: PrincipalId;
    memberId: PrincipalId;
    teamId: string;
    projectId: ProjectId;
  },
): Promise<void> {
  const organization: PilotOrganization = {
    id: fixture.organizationId,
    name: `Normalized ${fixture.organizationId.slice(0, 8)}`,
    deploymentBaseUrl: "http://127.0.0.1:4310",
    deploymentValidatedAt: "2026-07-26T00:00:00.000Z",
    provider: { configured: false },
  };
  await store.setupOrganization({
    organization,
    administratorId: fixture.adminId,
    initialTeam: {
      id: fixture.teamId,
      organizationId: fixture.organizationId,
      name: "Platform",
      createdAt: "2026-07-26T00:00:00.000Z",
    },
  });
  const joinLink: PilotJoinLinkWithHash = {
    id: uuidv7(),
    teamId: fixture.teamId,
    createdBy: fixture.adminId,
    useCount: 0,
    createdAt: "2026-07-26T00:00:01.000Z",
    codeHash: fixture.organizationId
      .replaceAll("-", "")
      .padEnd(64, "0")
      .slice(0, 64),
  };
  await store.createJoinLink(
    {
      id: joinLink.id,
      teamId: joinLink.teamId,
      createdBy: joinLink.createdBy,
      useCount: joinLink.useCount,
      createdAt: joinLink.createdAt,
    },
    joinLink.codeHash,
    fixture.adminId,
  );
  await store.redeemJoinLink(
    joinLink.codeHash,
    fixture.memberId,
    "2026-07-26T00:00:02.000Z",
  );
  const project: PilotProject = {
    id: fixture.projectId,
    organizationId: fixture.organizationId,
    name: "Billing Operations",
    ownerId: fixture.adminId,
    primaryTeamId: fixture.teamId,
    participatingTeamIds: [fixture.teamId],
    posture: "collaborative",
    createdAt: "2026-07-26T00:00:03.000Z",
    updatedAt: "2026-07-26T00:00:03.000Z",
  };
  await store.createProject(project);
}

type PilotJoinLinkWithHash = {
  id: string;
  teamId: string;
  createdBy: PrincipalId;
  useCount: number;
  createdAt: string;
  codeHash: string;
};

function binding(
  projectId: ProjectId,
  adminId: PrincipalId,
  credentialHash: string,
): PilotAgentBinding {
  return {
    id: uuidv7(),
    projectId,
    ownerId: adminId,
    client: "codex",
    name: "Codex validation",
    workspaceId: uuidv7(),
    preferredLanguage: "en-US",
    credentialHash,
    createdAt: "2026-07-26T01:10:01.000Z",
  };
}

function checkpointInput(projectId: ProjectId): PilotCheckpointInput {
  return {
    schemaVersion: 2,
    clientEventId: "normalized-checkpoint-20260726-0001",
    projectId,
    occurredAt: "2026-07-26T01:20:00.000Z",
    eventType: "validation_completed",
    workstream: {
      key: "billing-export",
      title: "Customer billing CSV export",
      phase: "reviewing",
    },
    narrative: {
      currentFocus: "Preparing the billing export for finance review.",
      completedOutcome: "Generated the complete recoverable billing CSV.",
      evidence: ["12,480 invoice rows", "18/18 validation checks passed"],
      nextStep: "Finance confirms the reconciliation columns.",
      collaboration: {
        needed: true,
        request: "Confirm tax region and invoice status columns.",
        requestedFrom: "Finance owner",
      },
    },
    evidenceRefs: [],
  };
}

async function deleteOrganizationFixture(
  admin: Client,
  organizationId: OrganizationId,
): Promise<void> {
  const tables = [
    "outbox",
    "activity_events",
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
    "projects",
    "memberships",
  ];
  for (const table of tables) {
    await admin.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
      organizationId,
    ]);
  }
  await admin.query("DELETE FROM organizations WHERE id = $1", [
    organizationId,
  ]);
}
