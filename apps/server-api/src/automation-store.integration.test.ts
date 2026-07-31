import {
  OrganizationId,
  type PilotAgentBinding,
  type PilotCheckpointInput,
  type PilotProject,
  PrincipalId,
  ProjectId,
  uuidv7,
} from "@intero/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresAutomationStore } from "./automation-store.js";
import { migrateDatabase } from "./database/migrate.js";
import { NormalizedPostgresPilotStore } from "./normalized-postgres-pilot-store.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const databaseSuite = databaseUrl && databaseAppUrl ? describe : describe.skip;

databaseSuite("bounded Project automation store", () => {
  const admin = new Pool({ connectionString: databaseUrl });
  const appPoolA = new Pool({ connectionString: databaseAppUrl });
  const appPoolB = new Pool({ connectionString: databaseAppUrl });
  const organizationA = OrganizationId.parse(uuidv7());
  const organizationB = OrganizationId.parse(uuidv7());
  const adminA = PrincipalId.parse(uuidv7());
  const memberA = PrincipalId.parse(uuidv7());
  const adminB = PrincipalId.parse(uuidv7());
  const projectA = ProjectId.parse(uuidv7());
  const projectB = ProjectId.parse(uuidv7());
  const teamA = uuidv7();
  const workItemA = uuidv7();
  const specA = uuidv7();
  const specRevisionA = uuidv7();
  const decisionA = uuidv7();
  const bindingA = uuidv7();
  const workStateA = uuidv7();
  const standInJobA = uuidv7();
  const checkpointA: PilotCheckpointInput = {
    schemaVersion: 2,
    clientEventId: "automation-provider-recovery-0001",
    projectId: projectA,
    occurredAt: "2026-07-26T04:20:00.000Z",
    eventType: "blocker_raised",
    workstream: {
      key: "provider-recovery",
      title: "Provider recovery correlation",
      phase: "blocked",
    },
    narrative: {
      currentFocus: "Waiting for Morgan to confirm the retry contract.",
      completedOutcome: "The failing provider request is isolated.",
      evidence: ["The structured failure was reproduced."],
      nextStep: "Morgan confirms the bounded retry behavior.",
      collaboration: {
        needed: true,
        request: "Confirm the retry contract.",
        requestedFrom: "Member A",
        targetPrincipalId: memberA,
      },
    },
    evidenceRefs: [],
  };
  const bindingData: PilotAgentBinding = {
    id: bindingA,
    projectId: projectA,
    ownerId: adminA,
    client: "codex",
    name: "Correlation test Agent",
    workspaceId: uuidv7(),
    preferredLanguage: "en-US",
    credentialHash: "c".repeat(64),
    createdAt: "2026-07-26T04:19:00.000Z",
  };
  const storeA = new PostgresAutomationStore(appPoolA, organizationA);
  const storeB = new PostgresAutomationStore(appPoolB, organizationB);

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    await admin.query("GRANT USAGE ON SCHEMA public TO intero_app");
    await admin.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO intero_app",
    );
    await admin.query(
      "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO intero_app",
    );
    await admin.query(
      `INSERT INTO organizations (id,name) VALUES
         ($1,'Phase 7 A'),($2,'Phase 7 B')`,
      [organizationA, organizationB],
    );
    await admin.query(
      `INSERT INTO principals (id,display_name,kind) VALUES
         ($1,'Admin A','human'),($2,'Member A','human'),($3,'Admin B','human')`,
      [adminA, memberA, adminB],
    );
    await admin.query(
      `INSERT INTO memberships (organization_id,principal_id,role) VALUES
         ($1,$2,'admin'),($1,$3,'member'),($4,$5,'admin')`,
      [organizationA, adminA, memberA, organizationB, adminB],
    );
    await admin.query(
      `INSERT INTO projects
         (id,organization_id,name,project_management_enabled,timezone)
       VALUES ($1,$2,'Delivery A',true,'Asia/Shanghai'),
              ($3,$4,'Delivery B',true,'Asia/Shanghai')`,
      [projectA, organizationA, projectB, organizationB],
    );
    await admin.query(
      `INSERT INTO pilot_teams (id,organization_id,name,data,created_at)
       VALUES ($1::uuid,$2::uuid,'Platform',jsonb_build_object(
         'id',$1::uuid::text,'organizationId',$2::uuid::text,'name','Platform',
         'createdAt','2026-07-26T03:50:00.000Z'
       ),'2026-07-26T03:50:00.000Z')`,
      [teamA, organizationA],
    );
    await admin.query(
      `INSERT INTO pilot_team_memberships
         (organization_id,team_id,principal_id,role)
       VALUES ($1,$2,$3,'leader'),($1,$2,$4,'member')`,
      [organizationA, teamA, adminA, memberA],
    );
    await admin.query(
      `INSERT INTO pilot_project_settings
         (project_id,organization_id,owner_id,primary_team_id,posture,data)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'collaborative',$5::jsonb)`,
      [
        projectA,
        organizationA,
        adminA,
        teamA,
        JSON.stringify({
          id: projectA,
          organizationId: organizationA,
          name: "Delivery A",
          ownerId: adminA,
          primaryTeamId: teamA,
          participatingTeamIds: [teamA],
          posture: "collaborative",
          createdAt: "2026-07-26T03:50:00.000Z",
          updatedAt: "2026-07-26T03:50:00.000Z",
        } satisfies PilotProject),
      ],
    );
    await admin.query(
      `INSERT INTO pilot_project_teams (organization_id,project_id,team_id)
       VALUES ($1,$2,$3)`,
      [organizationA, projectA, teamA],
    );
    await admin.query(
      `INSERT INTO project_work_items
         (id,organization_id,project_id,title,description,status,owner_id,
          priority,carryover,created_by)
       VALUES ($1,$2,$3,'支付灰度回归','等待确认验收条件','in_progress',$4,
               'P1',true,$5::jsonb)`,
      [
        workItemA,
        organizationA,
        projectA,
        memberA,
        JSON.stringify({
          principalId: adminA,
          kind: "human",
          source: "web",
        }),
      ],
    );
    await admin.query(
      `INSERT INTO specs
         (id,organization_id,project_id,title,status)
       VALUES ($1,$2,$3,'支付灰度验收','approved')`,
      [specA, organizationA, projectA],
    );
    await admin.query(
      `INSERT INTO spec_revisions
         (id,organization_id,spec_id,revision,markdown,blocks,change_summary,
          affected_scopes,created_by,confirmed_at)
       VALUES ($1,$2,$3,1,'# 支付灰度验收','[]'::jsonb,'确认验收口径',
               '[]'::jsonb,$4,now())`,
      [specRevisionA, organizationA, specA, adminA],
    );
    await admin.query(
      `UPDATE specs
       SET current_revision_id=$2,confirmed_revision_id=$2
       WHERE id=$1`,
      [specA, specRevisionA],
    );
    await admin.query(
      `INSERT INTO decisions
         (id,organization_id,title,outcome,source_spec_revision_id,
          affected_scopes,decided_by)
       VALUES ($1,$2,'支付灰度范围','先覆盖退款主路径',$3,
               '[]'::jsonb,$4::jsonb)`,
      [decisionA, organizationA, specRevisionA, JSON.stringify([adminA])],
    );
    await admin.query(
      `INSERT INTO pilot_agent_bindings
        (id,organization_id,project_id,owner_id,credential_hash,data,created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        bindingA,
        organizationA,
        projectA,
        adminA,
        bindingData.credentialHash,
        JSON.stringify(bindingData),
        bindingData.createdAt,
      ],
    );
    const workStateData = {
      id: workStateA,
      projectId: projectA,
      ownerId: adminA,
      bindingId: bindingA,
      workstreamKey: checkpointA.workstream.key,
      title: checkpointA.workstream.title,
      phase: checkpointA.workstream.phase,
      narrative: checkpointA.narrative,
      claims: [],
      standIn: {
        jobId: standInJobA,
        jobKey: checkpointA.clientEventId,
        status: "pending",
        attempts: 0,
        queuedAt: "2026-07-26T04:20:00.000Z",
        updatedAt: "2026-07-26T04:20:00.000Z",
      },
      freshnessAt: checkpointA.occurredAt,
      expiresAt: "2027-01-22T04:20:00.000Z",
      createdAt: "2026-07-26T04:20:00.000Z",
      updatedAt: "2026-07-26T04:20:00.000Z",
    };
    await admin.query(
      `INSERT INTO pilot_work_states
        (id,organization_id,project_id,owner_id,binding_id,workstream_key,
         stand_in_job_id,stand_in_status,freshness_at,expires_at,data,
         created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10::jsonb,$11,$11)`,
      [
        workStateA,
        organizationA,
        projectA,
        adminA,
        bindingA,
        checkpointA.workstream.key,
        standInJobA,
        checkpointA.occurredAt,
        workStateData.expiresAt,
        JSON.stringify({ ...workStateData, claims: [] }),
        workStateData.createdAt,
      ],
    );
    const jobData = {
      id: standInJobA,
      jobKey: checkpointA.clientEventId,
      projectId: projectA,
      workStateId: workStateA,
      binding: bindingData,
      checkpoint: checkpointA,
      receivedAt: "2026-07-26T04:20:00.000Z",
      status: "pending",
      attempts: 0,
      maxAttempts: 8,
      queuedAt: "2026-07-26T04:20:00.000Z",
      updatedAt: "2026-07-26T04:20:00.000Z",
    };
    await admin.query(
      `INSERT INTO pilot_stand_in_jobs
        (id,organization_id,project_id,work_state_id,binding_id,job_key,status,
         attempts,max_attempts,queued_at,data,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',0,8,$7,$8::jsonb,$7,$7)`,
      [
        standInJobA,
        organizationA,
        projectA,
        workStateA,
        bindingA,
        checkpointA.clientEventId,
        jobData.queuedAt,
        JSON.stringify(jobData),
      ],
    );
  });

  afterAll(async () => {
    await admin.query(
      `UPDATE specs SET confirmed_revision_id=NULL
       WHERE organization_id=ANY($1::uuid[])`,
      [[organizationA, organizationB]],
    );
    await admin.query(
      `UPDATE project_automation_signals
       SET coordination_thread_id=NULL
       WHERE organization_id=ANY($1::uuid[])`,
      [[organizationA, organizationB]],
    );
    await admin.query(
      `UPDATE pilot_coordination_threads
       SET automation_signal_id=NULL
       WHERE organization_id=ANY($1::uuid[])`,
      [[organizationA, organizationB]],
    );
    for (const table of [
      "action_inbox",
      "outbox",
      "project_automation_summary_jobs",
      "activity_events",
      "project_automation_audit",
      "pilot_coordination_participants",
      "pilot_coordination_threads",
      "project_automation_signals",
      "project_automation_policies",
      "pilot_pulse_entries",
      "pilot_stand_in_jobs",
      "pilot_work_states",
      "pilot_agent_bindings",
      "decisions",
      "spec_revisions",
      "specs",
      "project_work_items",
      "pilot_project_teams",
      "pilot_project_settings",
      "pilot_team_memberships",
      "pilot_teams",
      "memberships",
      "projects",
    ]) {
      await admin.query(
        `DELETE FROM ${table} WHERE organization_id=ANY($1::uuid[])`,
        [[organizationA, organizationB]],
      );
    }
    await admin.query(`DELETE FROM principals WHERE id=ANY($1::uuid[])`, [
      [adminA, memberA, adminB],
    ]);
    await admin.query(`DELETE FROM organizations WHERE id=ANY($1::uuid[])`, [
      [organizationA, organizationB],
    ]);
    await storeA.close();
    await storeB.close();
    await admin.end();
  });

  it("detects once, enqueues durably, and opens one bounded coordination", async () => {
    expect(await storeA.getPolicy(projectA)).toMatchObject({ enabled: false });
    await storeA.updatePolicy({
      projectId: projectA,
      enabled: true,
      enabledSignals: ["project_work_risk"],
      staleSpecReviewHours: 48,
      unresolvedCoordinationHours: 24,
      actorId: adminA,
    });

    expect(
      await storeA.detectMeaningfulSignals("2026-07-26T04:00:00.000Z"),
    ).toBe(1);
    expect(
      await storeA.detectMeaningfulSignals("2026-07-26T04:00:01.000Z"),
    ).toBe(0);

    const [queued] = await storeA.claimOutbox();
    expect(queued?.payload).toMatchObject({
      organizationId: organizationA,
      projectId: projectA,
    });
    const opened = await storeA.openCoordination(
      queued!.payload.signalId,
      "2026-07-26T04:00:02.000Z",
    );
    const replay = await storeA.openCoordination(
      queued!.payload.signalId,
      "2026-07-26T04:00:03.000Z",
    );
    expect(replay.coordinationThreadId).toBe(opened.coordinationThreadId);
    await storeA.markOutboxCompleted(queued!.operationId);

    const effects = await admin.query<{
      thread_count: string;
      inbox_count: string;
      completed_at: Date | null;
    }>(
      `SELECT
         (SELECT count(*)::text FROM pilot_coordination_threads
          WHERE organization_id=$1 AND automation_signal_id=$2) thread_count,
         (SELECT count(*)::text FROM action_inbox
          WHERE organization_id=$1 AND dedupe_key=$3) inbox_count,
         (SELECT completed_at FROM outbox WHERE operation_id=$2) completed_at`,
      [
        organizationA,
        queued!.payload.signalId,
        `automation-signal:${queued!.payload.signalId}`,
      ],
    );
    expect(effects.rows[0]).toMatchObject({
      thread_count: "1",
      inbox_count: "2",
    });
    expect(effects.rows[0]!.completed_at).toBeTruthy();
  });

  it("keeps signals tenant-scoped and supports human confirm/revert audit", async () => {
    const [entry] = await storeA.listSignals(projectA);
    expect(entry?.signal.status).toBe("opened");
    expect(entry?.audit.map((audit) => audit.action)).toEqual([
      "detected",
      "coordination_opened",
    ]);
    expect(await storeB.listSignals(projectA)).toEqual([]);
    expect(await storeA.summarizeForPrincipal(memberA)).toEqual([
      expect.objectContaining({
        projectId: projectA,
        projectName: "Delivery A",
        openSignalCount: 1,
        progressFacts: {
          total: 1,
          todo: 0,
          inProgress: 1,
          readyForTest: 0,
          done: 0,
        },
        risks: [
          expect.objectContaining({
            sourceRef: `work-item:${workItemA}`,
            summary: expect.stringContaining("支付灰度回归"),
          }),
        ],
        decisions: [
          expect.objectContaining({
            id: decisionA,
            title: "支付灰度范围",
            outcome: "先覆盖退款主路径",
            sourceSpecRevisionId: specRevisionA,
          }),
        ],
        interpretation: expect.stringContaining("待协调风险"),
        freshnessAt: expect.any(String),
      }),
    ]);
    expect(await storeB.summarizeForPrincipal(memberA)).toEqual([]);
    const summaryJob = await storeA.requestPortfolioSummary(memberA);
    expect(summaryJob).toMatchObject({
      organizationId: organizationA,
      principalId: memberA,
    });
    expect(await storeA.requestPortfolioSummary(memberA)).toBeUndefined();
    const [summaryOutbox] = await storeA.claimPortfolioSummaryOutbox();
    expect(summaryOutbox?.payload).toEqual(summaryJob);
    await storeA.markPortfolioSummaryOutboxCompleted(
      summaryOutbox!.operationId,
    );
    const generatedSummary = await storeA.generatePortfolioSummary(summaryJob!);
    expect(generatedSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: projectA,
          progressFacts: expect.objectContaining({ inProgress: 1 }),
        }),
      ]),
    );
    expect(await storeA.latestPortfolioSummary(memberA)).toEqual(
      generatedSummary,
    );
    expect(await storeB.latestPortfolioSummary(memberA)).toBeUndefined();
    const summaryState = await admin.query<{
      status: string;
      attempts: number;
      completed_at: Date | null;
    }>(
      `SELECT status,attempts,completed_at
       FROM project_automation_summary_jobs
       WHERE id=$1`,
      [summaryJob!.operationId],
    );
    expect(summaryState.rows[0]).toMatchObject({
      status: "completed",
      attempts: 1,
    });
    expect(summaryState.rows[0]!.completed_at).toBeTruthy();

    await storeA.markConfirmed({
      signalId: entry!.signal.id,
      actorId: memberA,
      now: "2026-07-26T04:10:00.000Z",
    });
    const reverted = await storeA.revert({
      projectId: projectA,
      signalId: entry!.signal.id,
      actorId: adminA,
      now: "2026-07-26T04:11:00.000Z",
    });
    expect(reverted.status).toBe("reverted");
    const [final] = await storeA.listSignals(projectA);
    expect(final?.audit.map((audit) => audit.action)).toEqual([
      "detected",
      "coordination_opened",
      "confirmed",
      "reverted",
    ]);
    const revertEvent = await admin.query<{
      topic: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT topic,payload FROM outbox
       WHERE organization_id=$1
         AND payload->>'eventType'='project.automation.reverted'
         AND payload->>'aggregateId'=$2
       LIMIT 1`,
      [organizationA, entry!.signal.id],
    );
    expect(revertEvent.rows[0]).toMatchObject({
      topic: `project.${projectA}.phase7`,
      payload: {
        eventType: "project.automation.reverted",
        aggregateType: "project_automation_signal",
        aggregateId: entry!.signal.id,
        projectId: projectA,
      },
    });
  });

  it("correlates provider recovery and later automation to one targeted thread", async () => {
    await storeA.updatePolicy({
      projectId: projectA,
      enabled: true,
      enabledSignals: ["blocker"],
      staleSpecReviewHours: 48,
      unresolvedCoordinationHours: 24,
      actorId: adminA,
    });

    const normalized = new NormalizedPostgresPilotStore(
      new Pool({ connectionString: databaseAppUrl }),
      organizationA,
    );
    let providerThreadId: string | undefined;
    try {
      await normalized.claimStandInJob({
        jobKey: checkpointA.clientEventId,
        workerId: "provider-recovery-test",
        attempt: 1,
        maxAttempts: 8,
        now: "2026-07-26T04:20:01.000Z",
      });
      const completed = await normalized.completeStandInJob({
        jobKey: checkpointA.clientEventId,
        workerId: "provider-recovery-test",
        actorId: adminA,
        projectId: projectA,
        workStateId: workStateA,
        output: {
          safeSummary: "Provider recovery published the bounded update.",
          narrative: checkpointA.narrative,
          coordination: {
            shouldOpen: true,
            safeContext: "Morgan must confirm the retry contract.",
            candidateNextSteps: ["Confirm the bounded retry behavior."],
          },
        },
        coordination: {
          safeContext: "Morgan must confirm the retry contract.",
          candidateNextSteps: ["Confirm the bounded retry behavior."],
        },
        now: "2026-07-26T04:20:02.000Z",
      });
      providerThreadId = completed.coordinationThread?.id;
      expect(providerThreadId).toBeTruthy();
    } finally {
      await normalized.close();
    }

    expect(
      await storeA.detectMeaningfulSignals("2026-07-26T04:20:03.000Z"),
    ).toBe(1);
    const [queued] = await storeA.claimOutbox();
    expect(queued).toBeDefined();
    const opened = await storeA.openCoordination(
      queued!.payload.signalId,
      "2026-07-26T04:20:04.000Z",
    );
    expect(opened).toMatchObject({
      sourceRef: `work-state:${workStateA}`,
      participantIds: expect.arrayContaining([adminA, memberA]),
      coordinationThreadId: providerThreadId,
    });

    const effects = await admin.query<{
      thread_count: string;
      pulse_count: string;
      inbox_count: string;
      participant_ids: string[];
    }>(
      `SELECT
         (SELECT count(*)::text FROM pilot_coordination_threads
          WHERE organization_id=$1 AND work_state_id=$2) thread_count,
         (SELECT count(*)::text FROM pilot_pulse_entries
          WHERE organization_id=$1 AND work_state_id=$2) pulse_count,
         (SELECT count(*)::text FROM action_inbox
          WHERE organization_id=$1 AND dedupe_key=$3) inbox_count,
         (SELECT array_agg(principal_id::text ORDER BY principal_id)
          FROM pilot_coordination_participants
          WHERE thread_id=$4) participant_ids`,
      [
        organizationA,
        workStateA,
        `work-state-coordination:${workStateA}`,
        providerThreadId,
      ],
    );
    expect(effects.rows[0]).toMatchObject({
      thread_count: "1",
      pulse_count: "1",
      inbox_count: "1",
      participant_ids: [adminA, memberA].toSorted(),
    });
  });
});
