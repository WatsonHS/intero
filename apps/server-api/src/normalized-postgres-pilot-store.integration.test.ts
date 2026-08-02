import {
  interoRequestIdFromMessage,
  OrganizationId,
  type MessageId,
  type PilotAgentBinding,
  type PilotAgentTicket,
  type PilotCheckpointInput,
  type PilotOrganization,
  type PilotProject,
  PrincipalId,
  ProjectId,
  roomInteroPrincipalId,
  type ThreadId,
  uuidv7,
} from "@intero/domain";
import { createHash } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "./database/migrate.js";
import { NormalizedPostgresPilotStore } from "./normalized-postgres-pilot-store.js";
import { PostgresPlatformStore } from "./postgres-store.js";
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

  it("persists team deletion across store instances", async () => {
    const disposableTeamId = uuidv7();
    await store.createTeam({
      team: {
        id: disposableTeamId,
        organizationId,
        name: "Disposable Team",
        createdAt: "2026-07-26T00:30:00.000Z",
      },
      principalId: adminId,
    });
    await store.deleteTeam({
      teamId: disposableTeamId,
      principalId: adminId,
    });

    const restarted = new NormalizedPostgresPilotStore(
      new Pool({ connectionString: databaseAppUrl }),
      organizationId,
    );
    await expect(restarted.getTeam(disposableTeamId)).resolves.toBeUndefined();
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

  it("rotates one pending Agent binding until validation consumes its ticket", async () => {
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
    const first = await store.exchangeAgentTicket(
      ticket.ticketHash,
      binding(ticket.id, projectId, adminId, "b".repeat(64)),
      "2026-07-26T01:10:01.000Z",
    );
    const connected = await store.exchangeAgentTicket(
      ticket.ticketHash,
      binding(ticket.id, projectId, adminId, "c".repeat(64)),
      "2026-07-26T01:10:01.250Z",
    );
    expect(connected.id).toBe(first.id);
    expect(connected.credentialHash).toBe("c".repeat(64));
    await expect(
      store.listAgentBindings(projectId, adminId),
    ).resolves.toHaveLength(1);
    await store.initializeAgentBinding(
      connected.id,
      adminId,
      {
        name: "codex",
        version: "test",
        protocolVersion: "2025-06-18",
      },
      "2026-07-26T01:10:01.500Z",
    );
    const validated = await store.validateAgentBinding(
      connected.id,
      adminId,
      "verify-normalized-store",
      "2026-07-26T01:10:02.000Z",
    );
    expect(validated.validatedAt).toBe("2026-07-26T01:10:02.000Z");
    await expect(
      store.exchangeAgentTicket(
        ticket.ticketHash,
        binding(ticket.id, projectId, adminId, "d".repeat(64)),
        "2026-07-26T01:10:03.000Z",
      ),
    ).rejects.toMatchObject({ code: "AGENT_TICKET_INVALID" });
    const restarted = new NormalizedPostgresPilotStore(
      new Pool({ connectionString: databaseAppUrl }),
      organizationId,
    );
    await expect(
      restarted.listAgentBindings(projectId, adminId),
    ).resolves.toEqual([
      expect.objectContaining({
        id: connected.id,
        validatedAt: "2026-07-26T01:10:02.000Z",
      }),
    ]);
    await restarted.close();
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

  it("persists one shared-boundary conflict with multi-source provenance", async () => {
    const activeBinding = (
      await store.listAgentBindings(projectId, adminId)
    )[0]!;
    const memberTicketId = uuidv7();
    const memberTicketHash = "e".repeat(64);
    await store.createAgentTicket({
      id: memberTicketId,
      projectId,
      ownerId: memberId,
      client: "claude-code",
      preferredLanguage: "en-US",
      ticketHash: memberTicketHash,
      expiresAt: "2026-07-31T09:00:00.000Z",
      createdAt: "2026-07-31T08:00:00.000Z",
    });
    const memberBinding = await store.exchangeAgentTicket(
      memberTicketHash,
      {
        ...binding(memberTicketId, projectId, memberId, "f".repeat(64)),
        client: "claude-code",
        name: "Claude Code validation",
        createdAt: "2026-07-31T08:00:01.000Z",
      },
      "2026-07-31T08:00:01.000Z",
    );
    const assumption = "v1 response keeps account_id";
    const checkpointWithBoundary = (
      clientEventId: string,
      relation: "changing" | "depending_on",
      change: "compatible" | "breaking" | "unknown",
      preserves: string[],
    ): PilotCheckpointInput => ({
      ...checkpointInput(projectId),
      clientEventId,
      occurredAt: "2026-07-31T08:01:00.000Z",
      workstream: {
        key: "account-api",
        title: "Account API",
        phase: "implementing",
      },
      sharedBoundaries: [
        {
          key: "api/accounts.v1",
          kind: "api",
          relation,
          assumption,
          change,
          preserves,
        },
      ],
    });
    const producer = checkpointWithBoundary(
      "postgres-compatible-producer-0001",
      "changing",
      "compatible",
      [assumption],
    );
    const consumer = checkpointWithBoundary(
      "postgres-compatible-consumer-0001",
      "depending_on",
      "unknown",
      [],
    );
    const producerState = await store.ingestCheckpoint(
      activeBinding,
      producer,
      "2026-07-31T08:01:01.000Z",
    );
    const consumerState = await store.ingestCheckpoint(
      memberBinding,
      consumer,
      "2026-07-31T08:01:02.000Z",
    );
    const project = (await store.listProjects(adminId)).find(
      (candidate) => candidate.id === projectId,
    )!;
    await store.reconcileSharedBoundaries({
      project,
      binding: activeBinding,
      workStateId: producerState.workState.id,
      checkpoint: producer,
      now: "2026-07-31T08:01:01.000Z",
    });
    const control = await store.reconcileSharedBoundaries({
      project,
      binding: memberBinding,
      workStateId: consumerState.workState.id,
      checkpoint: consumer,
      now: "2026-07-31T08:01:02.000Z",
    });
    expect(control.coordinationThreads).toEqual([]);

    const breaking = checkpointWithBoundary(
      "postgres-breaking-producer-0001",
      "changing",
      "breaking",
      [],
    );
    const breakingState = await store.ingestCheckpoint(
      activeBinding,
      breaking,
      "2026-07-31T08:02:00.000Z",
    );
    const conflict = await store.reconcileSharedBoundaries({
      project,
      binding: activeBinding,
      workStateId: breakingState.workState.id,
      checkpoint: breaking,
      now: "2026-07-31T08:02:00.000Z",
    });
    expect(conflict.coordinationThreads).toHaveLength(1);
    expect(conflict.coordinationThreads[0]).toMatchObject({
      trigger: "work_state_conflict",
      boundaryKey: "api/accounts.v1",
      sourceWorkStateIds: [expect.any(String), expect.any(String)],
      sourceClaimIds: [expect.any(String), expect.any(String)],
    });
    const corrected = checkpointWithBoundary(
      "postgres-corrected-producer-0001",
      "changing",
      "compatible",
      [assumption],
    );
    const correctedState = await store.ingestCheckpoint(
      activeBinding,
      corrected,
      "2026-07-31T08:03:00.000Z",
    );
    expect(correctedState.workState.id).toBe(breakingState.workState.id);
    const cleared = await store.reconcileSharedBoundaries({
      project,
      binding: activeBinding,
      workStateId: correctedState.workState.id,
      checkpoint: corrected,
      now: "2026-07-31T08:03:00.000Z",
    });
    expect(cleared.coordinationThreads).toEqual([
      expect.objectContaining({
        id: conflict.coordinationThreads[0]!.id,
        status: "resolved",
        conclusion: expect.stringContaining(
          "Current authorized evidence no longer supports",
        ),
      }),
    ]);
    expect(cleared.coordinationThreads[0]).not.toHaveProperty("decisionId");

    const restarted = new NormalizedPostgresPilotStore(
      new Pool({ connectionString: databaseAppUrl }),
      organizationId,
    );
    await expect(
      restarted.listCoordination(projectId, adminId),
    ).resolves.toEqual([
      expect.objectContaining({
        id: conflict.coordinationThreads[0]!.id,
        status: "resolved",
      }),
    ]);
    await expect(
      restarted.listCoordinationRelevance(projectId, adminId),
    ).resolves.toEqual([
      expect.objectContaining({
        coordinationThreadId: conflict.coordinationThreads[0]!.id,
        dismissedAt: "2026-07-31T08:03:00.000Z",
      }),
    ]);
    await expect(
      restarted.listCoordinationRelevance(projectId, memberId),
    ).resolves.toEqual([
      expect.objectContaining({
        coordinationThreadId: conflict.coordinationThreads[0]!.id,
        dismissedAt: "2026-07-31T08:03:00.000Z",
      }),
    ]);
    await restarted.close();
    const sources = await admin.query<{ count: string }>(
      `SELECT count(*)
       FROM pilot_coordination_sources
       WHERE organization_id = $1`,
      [organizationId],
    );
    expect(sources.rows[0]?.count).toBe("3");
    const signals = await admin.query<{ status: string }>(
      `SELECT status
       FROM project_automation_signals
       WHERE organization_id = $1 AND kind = 'work_state_conflict'`,
      [organizationId],
    );
    expect(signals.rows).toEqual([{ status: "dismissed" }]);
    const projectMemberships = await admin.query<{ count: string }>(
      `SELECT count(*)
       FROM pilot_coordination_projects
       WHERE organization_id = $1`,
      [organizationId],
    );
    expect(projectMemberships.rows[0]?.count).toBe("1");
  });

  it("persists one durable Intero request with an ID-only outbox payload", async () => {
    const platform = new PostgresPlatformStore(
      new Pool({ connectionString: databaseAppUrl }),
      organizationId,
    );
    const roomId = uuidv7() as ThreadId;
    const interoId = roomInteroPrincipalId(roomId);
    await platform.upsertPrincipal({
      id: interoId,
      displayName: "Intero",
      kind: "service",
    });
    await platform.createThread({
      id: roomId,
      kind: "room",
      title: "Golden durable request",
      participantIds: [adminId, memberId, interoId],
      standInIds: [],
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      sequence: 0,
      teamId,
      createdAt: "2026-07-31T09:00:00.000Z",
    });
    const sourceMessage = await platform.appendMessage(roomId, {
      id: uuidv7() as MessageId,
      senderId: adminId,
      body: "@Intero check Billing Operations.",
      mentionedPrincipalIds: [interoId],
      createdAt: "2026-07-31T09:00:01.000Z",
    });
    const requestId = interoRequestIdFromMessage(sourceMessage.id);
    const created = await store.createInteroRequest({
      id: requestId,
      organizationId,
      teamId,
      sourceRoomThreadId: roomId,
      sourceMessageId: sourceMessage.id,
      requestedByPrincipalId: adminId,
      interoPrincipalId: interoId,
      status: "pending",
      scopeRevision: 1,
      createdAt: "2026-07-31T09:00:01.000Z",
      updatedAt: "2026-07-31T09:00:01.000Z",
    });
    expect(created.duplicate).toBe(false);

    const outbox = await admin.query<{
      payload: Record<string, unknown>;
      completed_at: Date | null;
    }>(
      `SELECT payload, completed_at
       FROM outbox
       WHERE organization_id = $1 AND topic = 'pilot.intero.enqueue'`,
      [organizationId],
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]).toMatchObject({
      payload: {
        schemaVersion: 1,
        organizationId,
        requestId,
        scopeRevision: 1,
      },
      completed_at: null,
    });
    expect(JSON.stringify(outbox.rows[0]!.payload)).not.toContain(
      "check Billing",
    );

    await store.updateInteroRequest({
      requestId,
      status: "answered",
      now: "2026-07-31T09:00:02.000Z",
    });
    const restarted = new NormalizedPostgresPilotStore(
      new Pool({ connectionString: databaseAppUrl }),
      organizationId,
    );
    await expect(restarted.getInteroRequest(requestId)).resolves.toMatchObject({
      status: "answered",
      sourceRoomThreadId: roomId,
      sourceMessageId: sourceMessage.id,
    });
    await restarted.close();
    await platform.close();
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
  "pilot_coordination_projects",
  "pilot_coordination_relevance",
  "pilot_coordination_sources",
  "pilot_coordination_threads",
  "pilot_intero_requests",
  "pilot_deployment_settings",
  "pilot_dm_messages",
  "pilot_dm_threads",
  "pilot_private_claims",
  "pilot_shared_boundary_claims",
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
  id: string,
  projectId: ProjectId,
  adminId: PrincipalId,
  credentialHash: string,
): PilotAgentBinding {
  return {
    id,
    projectId,
    ownerId: adminId,
    client: "codex",
    name: "Codex validation",
    workspaceId: uuidv7(),
    preferredLanguage: "en-US",
    credentialHash,
    verificationCodeHash: createHash("sha256")
      .update("verify-normalized-store")
      .digest("hex"),
    verificationExpiresAt: "2026-07-26T01:20:01.000Z",
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
  await admin.query(
    "DELETE FROM project_automation_audit WHERE organization_id = $1",
    [organizationId],
  );
  await admin.query(
    `UPDATE pilot_coordination_threads
     SET automation_signal_id = NULL
     WHERE organization_id = $1`,
    [organizationId],
  );
  await admin.query(
    "DELETE FROM project_automation_signals WHERE organization_id = $1",
    [organizationId],
  );
  const tables = [
    "outbox",
    "activity_events",
    "pilot_intero_requests",
    "pilot_checkpoint_idempotency",
    "pilot_coordination_participants",
    "pilot_coordination_projects",
    "pilot_coordination_relevance",
    "pilot_coordination_sources",
    "pilot_coordination_threads",
    "pilot_pulse_entries",
    "pilot_private_claims",
    "pilot_shared_boundary_claims",
    "pilot_stand_in_jobs",
    "pilot_work_states",
    "pilot_agent_bindings",
    "pilot_agent_tickets",
    "pilot_dm_messages",
    "pilot_dm_threads",
    "pilot_stand_in_exchanges",
    "pilot_project_teams",
    "pilot_project_settings",
    "messages",
    "thread_reads",
    "thread_participants",
    "threads",
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
