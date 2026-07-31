import {
  OrganizationId,
  type PilotAgentBinding,
  type PilotAgentTicket,
  type PilotCheckpointInput,
  type PilotOrganization,
  type PilotProject,
  type PilotStandInAnswer,
  PrincipalId,
  ProjectId,
  uuidv7,
} from "@intero/domain";
import { makeWorkerUtils, runOnce, type TaskList } from "graphile-worker";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "../../server-api/src/database/migrate.js";
import { NormalizedPostgresPilotStore } from "../../server-api/src/normalized-postgres-pilot-store.js";
import {
  MembershipAuthorizationAdapter,
  ModelGatewayUnavailableError,
  ProjectInternalCoordinationTransport,
  type ModelGateway,
  type StandInModelInput,
  type StandInQuestionInput,
} from "../../server-api/src/pilot-ports.js";
import {
  PilotCheckpointService,
  PilotStandInJobHandler,
  TransactionalOutboxJobRunner,
} from "../../server-api/src/pilot-service.js";
import { AesGcmProviderSecretCipher } from "../../server-api/src/provider-secrets.js";
import { migrateWorker } from "./migrate.js";
import {
  GraphileJobRunner,
  PILOT_STAND_IN_TASK,
  PilotJobOutboxDispatcher,
  type PilotJobReference,
  PostgresPilotJobRepository,
} from "./pilot-jobs.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const workerDatabaseUrl = process.env.DATABASE_WORKER_URL;
const databaseSuite =
  databaseUrl && databaseAppUrl && workerDatabaseUrl ? describe : describe.skip;

databaseSuite("durable Pilot Stand-in jobs", () => {
  const organizationId = OrganizationId.parse(uuidv7());
  const adminId = PrincipalId.parse(uuidv7());
  const memberId = PrincipalId.parse(uuidv7());
  const teamId = uuidv7();
  const projectId = ProjectId.parse(uuidv7());
  const admin = new Client({ connectionString: databaseUrl });
  const model = new RecoveringModelGateway();
  let store: NormalizedPostgresPilotStore;
  let binding: PilotAgentBinding;
  let repository: PostgresPilotJobRepository;
  let workerUtils: Awaited<ReturnType<typeof makeWorkerUtils>>;
  let runner: GraphileJobRunner;
  let dispatcher: PilotJobOutboxDispatcher;
  let handler: PilotStandInJobHandler;

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    await migrateWorker(workerDatabaseUrl!);
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
    binding = await seedPilot(store, {
      organizationId,
      adminId,
      memberId,
      teamId,
      projectId,
    });
    repository = new PostgresPilotJobRepository(
      new Pool({ connectionString: databaseAppUrl }),
      organizationId,
    );
    workerUtils = await makeWorkerUtils({
      connectionString: workerDatabaseUrl!,
    });
    runner = new GraphileJobRunner(workerUtils, organizationId);
    dispatcher = new PilotJobOutboxDispatcher(repository, runner);
    handler = new PilotStandInJobHandler(
      store,
      new MembershipAuthorizationAdapter(store),
      model,
      new ProjectInternalCoordinationTransport(store),
    );
  });

  afterAll(async () => {
    await workerUtils?.release();
    await repository?.close();
    await store?.close();
    await admin.query(
      `DELETE FROM graphile_worker._private_jobs
       WHERE key LIKE $1`,
      [`pilot-stand-in:${organizationId}:%`],
    );
    await deleteOrganizationFixture(admin, organizationId);
    await admin.query("DELETE FROM principals WHERE id = ANY($1::uuid[])", [
      [adminId, memberId],
    ]);
    await admin.end();
  });

  it("closes API/enqueue crash windows and applies a job exactly once", async () => {
    const checkpoint = checkpointInput(
      projectId,
      "durable-crash-boundary-0001",
      "blocker_raised",
    );
    const service = new PilotCheckpointService(
      store,
      new TransactionalOutboxJobRunner(),
    );
    const accepted = await service.submit(
      binding,
      checkpoint,
      "2026-07-26T02:00:01.000Z",
    );
    expect(accepted.standIn).toEqual({
      status: "pending",
      jobKey: checkpoint.clientEventId,
    });

    const durable = await admin.query<{
      stand_in_status: string;
      job_status: string;
      outbox_count: string;
    }>(
      `SELECT w.stand_in_status,
              j.status AS job_status,
              (SELECT count(*)::text FROM outbox o
               WHERE o.operation_id = j.id
                 AND o.topic = 'pilot.stand_in.enqueue') AS outbox_count
       FROM pilot_work_states w
       JOIN pilot_stand_in_jobs j
         ON j.id = w.stand_in_job_id
       WHERE w.organization_id = $1 AND j.job_key = $2`,
      [organizationId, checkpoint.clientEventId],
    );
    expect(durable.rows[0]).toEqual({
      stand_in_status: "pending",
      job_status: "pending",
      outbox_count: "1",
    });

    const restarted = new NormalizedPostgresPilotStore(
      new Pool({ connectionString: databaseAppUrl }),
      organizationId,
    );
    await expect(
      restarted.getIngestResult(accepted.workState.id),
    ).resolves.toMatchObject({
      standInJob: { status: "pending" },
    });
    await restarted.close();

    const reference = await loadReference(
      admin,
      organizationId,
      checkpoint.clientEventId,
    );
    await runner.enqueue(reference);
    await runner.enqueue(reference);
    expect(
      await graphileJobCount(admin, organizationId, checkpoint.clientEventId),
    ).toBe(1);

    await admin.query(
      `UPDATE outbox SET completed_at = now()
       WHERE operation_id = $1`,
      [reference.jobId],
    );
    await repository.reconcilePending("2026-07-26T02:01:30.000Z");
    await dispatcher.dispatch();
    expect(
      await graphileJobCount(admin, organizationId, checkpoint.clientEventId),
    ).toBe(1);

    await runPilotJobs(workerDatabaseUrl!, handler, "worker-crash-proof");
    const firstModelCalls = model.callsFor(checkpoint.clientEventId);
    expect(firstModelCalls).toBe(1);

    await handler.handleJobKey(checkpoint.clientEventId, {
      workerId: "at-least-once-replay",
      attempt: 2,
      maxAttempts: 8,
      now: "2026-07-26T02:02:00.000Z",
    });
    expect(model.callsFor(checkpoint.clientEventId)).toBe(firstModelCalls);

    const effects = await admin.query<{
      pulse_count: string;
      coordination_count: string;
      completion_event_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM pilot_pulse_entries
          WHERE organization_id = $1 AND work_state_id = $2) AS pulse_count,
         (SELECT count(*)::text FROM pilot_coordination_threads
          WHERE organization_id = $1 AND work_state_id = $2) AS coordination_count,
         (SELECT count(*)::text FROM activity_events
          WHERE organization_id = $1
            AND aggregate_id = $2
            AND event_type = 'pilot.stand_in.completed')
            AS completion_event_count`,
      [organizationId, accepted.workState.id],
    );
    expect(effects.rows[0]).toEqual({
      pulse_count: "1",
      coordination_count: "1",
      completion_event_count: "1",
    });
  });

  it("recovers from provider outage and records terminal metadata only at max attempts", async () => {
    const retrying = checkpointInput(
      projectId,
      "provider-recovery-checkpoint-0001",
      "validation_completed",
    );
    const service = new PilotCheckpointService(
      store,
      new TransactionalOutboxJobRunner(),
    );
    const accepted = await service.submit(
      binding,
      retrying,
      "2026-07-26T02:10:00.000Z",
    );
    model.failOnce(retrying.clientEventId);
    await expect(
      handler.handleJobKey(retrying.clientEventId, {
        workerId: "provider-recovery",
        attempt: 1,
        maxAttempts: 2,
        now: "2026-07-26T02:10:01.000Z",
      }),
    ).rejects.toBeInstanceOf(ModelGatewayUnavailableError);
    await expect(
      store.getIngestResult(accepted.workState.id),
    ).resolves.toMatchObject({
      standInJob: {
        status: "retrying",
        attempts: 1,
        lastErrorCode: "MODEL_GATEWAY_UNAVAILABLE",
      },
    });

    await handler.handleJobKey(retrying.clientEventId, {
      workerId: "provider-recovery",
      attempt: 2,
      maxAttempts: 2,
      now: "2026-07-26T02:10:04.000Z",
    });
    await expect(
      store.getIngestResult(accepted.workState.id),
    ).resolves.toMatchObject({
      standInJob: {
        status: "published",
        attempts: 2,
      },
    });

    const terminal = checkpointInput(
      projectId,
      "provider-dead-letter-checkpoint-0001",
      "work_progressed",
    );
    const terminalAccepted = await service.submit(
      binding,
      terminal,
      "2026-07-26T02:11:00.000Z",
    );
    model.alwaysFail(terminal.clientEventId);
    await expect(
      handler.handleJobKey(terminal.clientEventId, {
        workerId: "provider-dead-letter",
        attempt: 1,
        maxAttempts: 1,
        now: "2026-07-26T02:11:01.000Z",
      }),
    ).rejects.toBeInstanceOf(ModelGatewayUnavailableError);
    await expect(
      store.getIngestResult(terminalAccepted.workState.id),
    ).resolves.toMatchObject({
      standInJob: {
        status: "failed",
        deadLetteredAt: "2026-07-26T02:11:01.000Z",
        lastErrorCode: "MODEL_GATEWAY_UNAVAILABLE",
      },
    });
    // This test invokes the handler directly to control retry metadata. Mark
    // the corresponding enqueue intents complete so the next scenario does
    // not inherit work that deliberately bypassed the dispatcher.
    await admin.query(
      `UPDATE outbox
       SET completed_at = now()
       WHERE organization_id = $1
         AND topic = 'pilot.stand_in.enqueue'
         AND payload->>'jobKey' = ANY($2::text[])`,
      [organizationId, [retrying.clientEventId, terminal.clientEventId]],
    );
  });

  it("serializes jobs per Project and exposes worker heartbeat readiness", async () => {
    const service = new PilotCheckpointService(
      store,
      new TransactionalOutboxJobRunner(),
    );
    const first = checkpointInput(
      projectId,
      "project-ordering-checkpoint-0001",
      "work_progressed",
    );
    const second = checkpointInput(
      projectId,
      "project-ordering-checkpoint-0002",
      "work_completed",
    );
    model.trackConcurrency([first.clientEventId, second.clientEventId]);
    const orderingReceivedAt = new Date().toISOString();
    await service.submit(binding, first, orderingReceivedAt);
    await service.submit(
      binding,
      second,
      new Date(Date.parse(orderingReceivedAt) + 1).toISOString(),
    );
    await dispatcher.dispatch();
    await runPilotJobs(workerDatabaseUrl!, handler, "worker-ordering");
    await runPilotJobs(workerDatabaseUrl!, handler, "worker-ordering");
    expect(model.maxTrackedConcurrency).toBe(1);
    expect(model.trackedOrder).toEqual([
      first.clientEventId,
      second.clientEventId,
    ]);

    const now = new Date().toISOString();
    await repository.heartbeat({
      workerId: "heartbeat-test",
      status: "ready",
      startedAt: now,
      now,
      metadata: { runtime: "integration" },
    });
    await expect(store.checkWorkerReadiness()).resolves.toEqual({
      status: "ready",
    });
    await repository.heartbeat({
      workerId: "heartbeat-test",
      status: "stopped",
      startedAt: now,
      now: new Date(Date.now() + 1).toISOString(),
    });
    await expect(store.checkWorkerReadiness()).resolves.toMatchObject({
      status: "unavailable",
    });
  });

  it("starts safely before the API initializes a new production organization", async () => {
    const pendingOrganizationId = OrganizationId.parse(uuidv7());
    const earlyRepository = new PostgresPilotJobRepository(
      new Pool({ connectionString: databaseAppUrl }),
      pendingOrganizationId,
    );
    const now = new Date().toISOString();
    try {
      await expect(
        earlyRepository.heartbeat({
          workerId: "pre-organization-bootstrap",
          status: "starting",
          startedAt: now,
          now,
        }),
      ).resolves.toBeUndefined();
      const persisted = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM pilot_worker_heartbeats
         WHERE organization_id = $1`,
        [pendingOrganizationId],
      );
      expect(persisted.rows[0]?.count).toBe("0");
    } finally {
      await earlyRepository.close();
    }
  });
});

class RecoveringModelGateway implements ModelGateway {
  private readonly calls = new Map<string, number>();
  private readonly failOnceIds = new Set<string>();
  private readonly alwaysFailIds = new Set<string>();
  private trackedIds = new Set<string>();
  trackedOrder: string[] = [];
  maxTrackedConcurrency = 0;
  private trackedConcurrency = 0;

  failOnce(clientEventId: string): void {
    this.failOnceIds.add(clientEventId);
  }

  alwaysFail(clientEventId: string): void {
    this.alwaysFailIds.add(clientEventId);
  }

  callsFor(clientEventId: string): number {
    return this.calls.get(clientEventId) ?? 0;
  }

  trackConcurrency(clientEventIds: string[]): void {
    this.trackedIds = new Set(clientEventIds);
    this.trackedOrder = [];
    this.maxTrackedConcurrency = 0;
  }

  async generateStandInOutput(input: StandInModelInput) {
    const id = input.checkpoint.clientEventId;
    const count = (this.calls.get(id) ?? 0) + 1;
    this.calls.set(id, count);
    const tracked = this.trackedIds.has(id);
    if (tracked) {
      this.trackedConcurrency += 1;
      this.maxTrackedConcurrency = Math.max(
        this.maxTrackedConcurrency,
        this.trackedConcurrency,
      );
      this.trackedOrder.push(id);
      await new Promise((resolve) => setTimeout(resolve, 30));
      this.trackedConcurrency -= 1;
    }
    if (
      this.alwaysFailIds.has(id) ||
      (this.failOnceIds.has(id) && count === 1)
    ) {
      throw new ModelGatewayUnavailableError("provider unavailable");
    }
    return {
      safeSummary: input.checkpoint.narrative.completedOutcome,
      narrative: input.checkpoint.narrative,
      coordination: {
        shouldOpen: input.checkpoint.eventType === "blocker_raised",
        safeContext: input.checkpoint.narrative.currentFocus,
        candidateNextSteps: [input.checkpoint.narrative.nextStep],
      },
    };
  }

  async answerStandInQuestion(
    _input: StandInQuestionInput,
  ): Promise<PilotStandInAnswer> {
    throw new Error("not used");
  }
}

async function runPilotJobs(
  connectionString: string,
  handler: PilotStandInJobHandler,
  workerId: string,
): Promise<void> {
  const tasks: TaskList = {
    [PILOT_STAND_IN_TASK]: async (payload, helpers) => {
      const reference = payload as PilotJobReference;
      await handler.handleJobKey(reference.jobKey, {
        workerId,
        attempt: helpers.job.attempts,
        maxAttempts: helpers.job.max_attempts,
      });
    },
  };
  await runOnce(
    {
      connectionString,
      concurrency: 4,
      noHandleSignals: true,
    },
    tasks,
  );
}

async function seedPilot(
  store: NormalizedPostgresPilotStore,
  fixture: {
    organizationId: OrganizationId;
    adminId: PrincipalId;
    memberId: PrincipalId;
    teamId: string;
    projectId: ProjectId;
  },
): Promise<PilotAgentBinding> {
  const organization: PilotOrganization = {
    id: fixture.organizationId,
    name: "Durable jobs fixture",
    deploymentBaseUrl: "http://127.0.0.1:4310",
    deploymentValidatedAt: "2026-07-26T01:50:00.000Z",
    provider: { configured: false },
  };
  await store.setupOrganization({
    organization,
    administratorId: fixture.adminId,
    initialTeam: {
      id: fixture.teamId,
      organizationId: fixture.organizationId,
      name: "Platform",
      createdAt: "2026-07-26T01:50:00.000Z",
    },
  });
  const cipher = new AesGcmProviderSecretCipher("durable-job-secret");
  await store.configureProvider({
    administratorId: fixture.adminId,
    endpoint: "https://provider.example/v1",
    defaultModel: "stand-in-model",
    encryptedApiKey: cipher.encrypt("server-only-provider-key"),
  });
  const joinHash = fixture.organizationId.replaceAll("-", "").padEnd(64, "0");
  await store.createJoinLink(
    {
      id: uuidv7(),
      teamId: fixture.teamId,
      createdBy: fixture.adminId,
      useCount: 0,
      createdAt: "2026-07-26T01:50:01.000Z",
    },
    joinHash,
    fixture.adminId,
  );
  await store.redeemJoinLink(
    joinHash,
    fixture.memberId,
    "2026-07-26T01:50:02.000Z",
  );
  const project: PilotProject = {
    id: fixture.projectId,
    organizationId: fixture.organizationId,
    name: "Reliable collaboration",
    ownerId: fixture.adminId,
    primaryTeamId: fixture.teamId,
    participatingTeamIds: [fixture.teamId],
    posture: "collaborative",
    createdAt: "2026-07-26T01:50:03.000Z",
    updatedAt: "2026-07-26T01:50:03.000Z",
  };
  await store.createProject(project);
  const ticket: PilotAgentTicket = {
    id: uuidv7(),
    projectId: fixture.projectId,
    ownerId: fixture.adminId,
    client: "codex",
    preferredLanguage: "en-US",
    ticketHash: fixture.organizationId.replaceAll("-", "").padEnd(64, "d"),
    expiresAt: "2026-07-27T00:00:00.000Z",
    createdAt: "2026-07-26T01:50:04.000Z",
  };
  await store.createAgentTicket(ticket);
  const binding: PilotAgentBinding = {
    id: ticket.id,
    projectId: fixture.projectId,
    ownerId: fixture.adminId,
    client: "codex",
    name: "Durable Codex",
    workspaceId: uuidv7(),
    preferredLanguage: "en-US",
    credentialHash: fixture.organizationId.replaceAll("-", "").padEnd(64, "e"),
    createdAt: "2026-07-26T01:50:05.000Z",
  };
  return store.exchangeAgentTicket(
    ticket.ticketHash,
    binding,
    "2026-07-26T01:50:05.000Z",
  );
}

function checkpointInput(
  projectId: ProjectId,
  clientEventId: string,
  eventType: PilotCheckpointInput["eventType"],
): PilotCheckpointInput {
  return {
    schemaVersion: 2,
    clientEventId,
    projectId,
    occurredAt: "2026-07-26T02:00:00.000Z",
    eventType,
    workstream: {
      key: clientEventId,
      title: "Reliable collaboration core",
      phase: "validating",
    },
    narrative: {
      currentFocus: `Processing ${clientEventId}.`,
      completedOutcome: `Completed ${clientEventId}.`,
      evidence: ["Durable integration evidence"],
      nextStep: "Confirm the next ordered checkpoint.",
      collaboration: {
        needed: eventType === "blocker_raised",
        request:
          eventType === "blocker_raised"
            ? "Confirm the responsible owner."
            : "",
        requestedFrom: eventType === "blocker_raised" ? "Project owner" : "",
      },
    },
    evidenceRefs: [],
  };
}

async function loadReference(
  admin: Client,
  organizationId: OrganizationId,
  jobKey: string,
): Promise<PilotJobReference> {
  const result = await admin.query<{ payload: PilotJobReference }>(
    `SELECT o.payload
     FROM outbox o
     JOIN pilot_stand_in_jobs j ON j.id = o.operation_id
     WHERE o.organization_id = $1 AND j.job_key = $2`,
    [organizationId, jobKey],
  );
  return result.rows[0]!.payload;
}

async function graphileJobCount(
  admin: Client,
  organizationId: OrganizationId,
  jobKey: string,
): Promise<number> {
  const result = await admin.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM graphile_worker.jobs
     WHERE key = $1`,
    [`pilot-stand-in:${organizationId}:${jobKey}`],
  );
  return Number(result.rows[0]!.count);
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
