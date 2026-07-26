import { OrganizationId, PrincipalId, ProjectId, uuidv7 } from "@intero/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresAutomationStore } from "./automation-store.js";
import { migrateDatabase } from "./database/migrate.js";

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
      `INSERT INTO pilot_teams (id,organization_id,name,data)
       VALUES ($1::uuid,$2::uuid,'Platform',jsonb_build_object(
         'id',$1::uuid::text,'organizationId',$2::uuid::text,'name','Platform'
       ))`,
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
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'sharing',jsonb_build_object(
         'projectId',$1::uuid::text,'ownerId',$3::uuid::text,
         'primaryTeamId',$4::uuid::text,'posture','sharing',
         'rawContentAuthorized',false,
         'participatingTeamIds',jsonb_build_array($4::uuid::text)
       ))`,
      [projectA, organizationA, adminA, teamA],
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
  });

  afterAll(async () => {
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
      "activity_events",
      "project_automation_audit",
      "pilot_coordination_participants",
      "pilot_coordination_threads",
      "project_automation_signals",
      "project_automation_policies",
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
        latestSafeContext: expect.stringContaining("支付灰度回归"),
      }),
    ]);
    expect(await storeB.summarizeForPrincipal(memberA)).toEqual([]);

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
  });
});
