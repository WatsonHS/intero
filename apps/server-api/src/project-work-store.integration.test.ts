import {
  OrganizationId,
  PrincipalId,
  ProjectId,
  type WorkActor,
  uuidv7,
} from "@intero/domain";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "./database/migrate.js";
import { PostgresProjectWorkStore } from "./project-work-store.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const databaseSuite = databaseUrl && databaseAppUrl ? describe : describe.skip;

databaseSuite("PostgreSQL Project Work + Spec Review", () => {
  const organizationId = OrganizationId.parse(uuidv7());
  const otherOrganizationId = OrganizationId.parse(uuidv7());
  const projectId = ProjectId.parse(uuidv7());
  const otherProjectId = ProjectId.parse(uuidv7());
  const adminId = PrincipalId.parse(uuidv7());
  const memberId = PrincipalId.parse(uuidv7());
  const standInId = PrincipalId.parse(uuidv7());
  const adminActor: WorkActor = {
    principalId: adminId,
    kind: "human",
    source: "web",
  };
  const memberActor: WorkActor = {
    principalId: memberId,
    kind: "human",
    source: "web",
  };
  const memberAgentActor: WorkActor = {
    principalId: memberId,
    kind: "agent",
    source: "direct_cloud_mcp",
  };
  const adminAgentActor: WorkActor = {
    principalId: adminId,
    kind: "agent",
    source: "direct_cloud_mcp",
  };
  const admin = new Client({ connectionString: databaseUrl });
  let pool: Pool;
  let store: PostgresProjectWorkStore;

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
    await admin.query(
      `INSERT INTO organizations (id,name) VALUES
         ($1,'Phase 5 fixture'),($2,'Other Phase 5 fixture')`,
      [organizationId, otherOrganizationId],
    );
    await admin.query(
      `INSERT INTO principals (id,display_name,kind) VALUES
         ($1,'Admin','human'),($2,'Member','human'),($3,'Stand-in','stand_in')`,
      [adminId, memberId, standInId],
    );
    await admin.query(
      `INSERT INTO projects
         (id,organization_id,name,project_management_enabled,timezone)
       VALUES ($1,$2,'Delivery',true,'UTC'),
              ($3,$2,'Other project',true,'UTC')`,
      [projectId, organizationId, otherProjectId],
    );
    pool = new Pool({ connectionString: databaseAppUrl });
    store = new PostgresProjectWorkStore(pool, organizationId);
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(
      "UPDATE specs SET confirmed_revision_id = NULL WHERE organization_id = $1",
      [organizationId],
    );
    for (const table of cleanupTables) {
      await admin.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
        organizationId,
      ]);
    }
    await admin.query("DELETE FROM projects WHERE organization_id = $1", [
      organizationId,
    ]);
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [
      [organizationId, otherOrganizationId],
    ]);
    await admin.query("DELETE FROM principals WHERE id = ANY($1::uuid[])", [
      [adminId, memberId, standInId],
    ]);
    await admin.end();
  });

  it("keeps Backlog separate from the fixed four-state Sprint flow", async () => {
    const planning = await store.createProgramIncrement(
      {
        projectId,
        startDate: "2026-07-20",
        sprintCount: 2,
        sprintDurationWeeks: 2,
        timezone: "Asia/Shanghai",
      },
      adminActor,
    );
    expect(planning.pi.number).toBe(1);
    expect(planning.sprints.map((sprint) => sprint.number)).toEqual([1, 2]);

    const backlog = await store.createWorkItem(
      {
        projectId,
        title: "Unscheduled validation",
        description: "",
        status: "todo",
        priority: "P2",
        carryover: false,
        coordinationThreadIds: [],
      },
      adminActor,
      "phase5-backlog-fixture",
    );
    const sprintItem = await store.createWorkItem(
      {
        projectId,
        title: "Sprint validation",
        description: "Validate the payment export.",
        status: "in_progress",
        ownerId: memberId,
        priority: "P1",
        piId: planning.pi.id,
        sprintId: planning.sprints[0]!.id,
        carryover: false,
        coordinationThreadIds: [],
      },
      adminActor,
      "phase5-sprint-fixture",
    );
    const duplicate = await store.createWorkItem(
      {
        projectId,
        title: "Ignored duplicate",
        description: "",
        status: "todo",
        priority: "P3",
        carryover: false,
        coordinationThreadIds: [],
      },
      adminActor,
      "phase5-sprint-fixture",
    );
    expect(duplicate.id).toBe(sprintItem.id);
    expect(backlog.sprintId).toBeUndefined();

    await expect(
      store.updateWorkItem(
        projectId,
        sprintItem.id,
        { status: "done" },
        memberAgentActor,
      ),
    ).rejects.toThrow("ready_for_test");
    await store.updateWorkItem(
      projectId,
      sprintItem.id,
      {
        status: "ready_for_test",
        completionEvidence: "18 acceptance examples passed",
      },
      memberAgentActor,
    );
    const done = await store.updateWorkItem(
      projectId,
      sprintItem.id,
      { status: "done" },
      adminActor,
    );
    expect(done.completedBy).toEqual(adminActor);
    expect(done.completedAt).toBeTruthy();

    await expect(
      store.createWorkItem(
        {
          projectId,
          title: "Invalid owner",
          description: "",
          status: "todo",
          ownerId: standInId,
          priority: "P2",
          carryover: false,
          coordinationThreadIds: [],
        },
        memberAgentActor,
      ),
    ).rejects.toThrow("only be assigned to a human");
  });

  it("marks unfinished early-closed Sprint work as visible carryover", async () => {
    const snapshot = await store.listProject(projectId);
    const sprint = snapshot.sprints[1]!;
    const item = await store.createWorkItem(
      {
        projectId,
        title: "Carry customer migration forward",
        description: "",
        status: "todo",
        ownerId: memberId,
        priority: "P0",
        piId: sprint.piId,
        sprintId: sprint.id,
        carryover: false,
        coordinationThreadIds: [],
      },
      adminActor,
    );
    await store.closeSprint(projectId, sprint.id, adminActor);
    const carried = (await store.listProject(projectId)).workItems.find(
      (candidate) => candidate.id === item.id,
    );
    expect(carried).toMatchObject({
      status: "in_progress",
      carryover: true,
      sourceSprintId: sprint.id,
    });
    expect(carried?.sprintId).toBeUndefined();
  });

  it("keeps Epic, Feature and Work Item links Project-scoped and human-owned", async () => {
    const epic = await store.createEpic(
      {
        projectId,
        title: "Commerce reliability",
        description: "Roadmap-only outcome.",
      },
      adminActor,
    );
    const otherEpic = await store.createEpic(
      {
        projectId: otherProjectId,
        title: "Other Project roadmap",
        description: "",
      },
      adminActor,
    );
    await expect(
      store.createFeature(
        {
          projectId,
          epicId: otherEpic.id,
          title: "Invalid cross-Project Feature",
          description: "",
          stage: "planned",
        },
        memberAgentActor,
      ),
    ).rejects.toThrow("same Project");
    await expect(
      store.createFeature(
        {
          projectId,
          epicId: epic.id,
          ownerId: standInId,
          title: "Invalid Stand-in owner",
          description: "",
          stage: "planned",
        },
        memberAgentActor,
      ),
    ).rejects.toThrow("human");

    const feature = await store.createFeature(
      {
        projectId,
        epicId: epic.id,
        ownerId: memberId,
        title: "Invoice export reliability",
        description: "",
        stage: "in_development",
      },
      memberAgentActor,
      "phase7-agent-feature-create",
    );
    const duplicateFeature = await store.createFeature(
      {
        projectId,
        title: "A replay must not create this Feature",
        description: "",
        stage: "planned",
      },
      memberAgentActor,
      "phase7-agent-feature-create",
    );
    expect(duplicateFeature.id).toBe(feature.id);
    const detached = await store.updateFeature(
      projectId,
      feature.id,
      { epicId: null, ownerId: null },
      memberAgentActor,
      "phase7-agent-feature-update",
    );
    const duplicateUpdate = await store.updateFeature(
      projectId,
      feature.id,
      { title: "A replay must not apply this title" },
      memberAgentActor,
      "phase7-agent-feature-update",
    );
    expect(duplicateUpdate.title).toBe(detached.title);
    expect(detached.epicId).toBeUndefined();
    expect(detached.ownerId).toBeUndefined();

    const otherFeature = await store.createFeature(
      {
        projectId: otherProjectId,
        title: "Other Project Feature",
        description: "",
        stage: "planned",
      },
      adminActor,
    );
    await expect(
      store.createWorkItem(
        {
          projectId,
          featureId: otherFeature.id,
          title: "Invalid cross-Project work link",
          description: "",
          status: "todo",
          priority: "P2",
          carryover: false,
          coordinationThreadIds: [],
        },
        memberAgentActor,
      ),
    ).rejects.toThrow("same Project");
  });

  it("keeps Spec confirmation version-specific with comments and policy", async () => {
    const v1 = await store.createSpecVersion({
      projectId,
      title: "Invoice export contract",
      markdown: "# Invoice export\n\nReturn a signed CSV.",
      changeSummary: "Initial review version",
      affectedScopes: ["billing/export"],
      actor: adminActor,
      idempotencyKey: "phase5-spec-v1",
    });
    await store.requestSpecReview(
      projectId,
      v1.spec.id,
      [memberId],
      adminActor,
    );
    const targetedReview = await admin.query(
      `SELECT principal_id,resolved_at FROM action_inbox
       WHERE organization_id=$1 AND principal_id=$2 AND kind='review_request'`,
      [organizationId, memberId],
    );
    expect(targetedReview.rows).toEqual([
      expect.objectContaining({ principal_id: memberId, resolved_at: null }),
    ]);
    await expect(
      store.confirmSpec(projectId, v1.spec.id, adminActor),
    ).rejects.toThrow("author cannot confirm");
    const confirmedV1 = await store.confirmSpec(
      projectId,
      v1.spec.id,
      memberActor,
    );
    expect(confirmedV1.spec.confirmedRevisionId).toBe(
      confirmedV1.spec.currentRevisionId,
    );
    expect(
      (
        await admin.query(
          `SELECT resolved_at FROM action_inbox
           WHERE organization_id=$1 AND principal_id=$2 AND kind='review_request'`,
          [organizationId, memberId],
        )
      ).rows[0]?.resolved_at,
    ).toBeTruthy();

    const v2 = await store.createSpecVersion({
      projectId,
      specId: v1.spec.id,
      title: v1.spec.title,
      markdown:
        "# Invoice export\n\nReturn a signed CSV with one row per invoice.",
      changeSummary: "Clarify row cardinality",
      affectedScopes: ["billing/export"],
      actor: memberAgentActor,
      idempotencyKey: "phase5-spec-v2",
    });
    const stillConfirmed = await store.getConfirmed(projectId, v1.spec.id);
    expect(stillConfirmed?.revision.revision).toBe(1);
    await store.requestSpecReview(projectId, v1.spec.id, [], memberActor);
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM action_inbox
           WHERE organization_id=$1 AND resolved_at IS NULL
             AND dedupe_key LIKE $2`,
          [organizationId, `spec-review:${v2.spec.currentRevisionId}:%`],
        )
      ).rows[0]?.count,
    ).toBe(0);

    const commented = await store.addSpecComment({
      projectId,
      specId: v1.spec.id,
      revisionId: v2.spec.currentRevisionId,
      lineStart: 3,
      lineEnd: 3,
      selection: "one row per invoice",
      body: "Please confirm refunds are included.",
      actor: memberActor,
    });
    expect(commented.commentThreads[0]).toMatchObject({
      revisionId: v2.spec.currentRevisionId,
      status: "open",
    });

    await store.updateSpecReviewPolicy(
      projectId,
      {
        requiredConfirmations: 1,
        otherMemberAgentsCount: false,
        authorSelfConfirmation: false,
      },
      adminActor,
    );
    await expect(
      store.confirmSpec(projectId, v1.spec.id, adminAgentActor),
    ).rejects.toThrow("does not count Agent");
    const confirmedV2 = await store.confirmSpec(
      projectId,
      v1.spec.id,
      adminActor,
    );
    expect(confirmedV2.spec.confirmedRevisionId).toBe(
      v2.spec.currentRevisionId,
    );
    await expect(
      store.revokeSpecVersion({
        projectId,
        specId: v1.spec.id,
        revisionId: v2.spec.currentRevisionId,
        actor: adminActor,
      }),
    ).rejects.toThrow("confirmed");
  });

  it("records reversible Work Item history and rejects cross-Project relations", async () => {
    const item = await store.createWorkItem(
      {
        projectId,
        title: "Original title",
        description: "",
        status: "todo",
        priority: "P2",
        carryover: false,
        coordinationThreadIds: [],
      },
      memberAgentActor,
      "phase5-revert-create",
    );
    await store.updateWorkItem(
      projectId,
      item.id,
      { title: "Agent-updated title" },
      memberAgentActor,
      "phase5-revert-update",
    );
    const history = (await store.listProject(projectId)).history.filter(
      (entry) => entry.workItemId === item.id,
    );
    const reverted = await store.revertWorkItem(
      projectId,
      item.id,
      history[0]!.id,
      memberAgentActor,
      "phase5-revert-action",
    );
    expect(reverted.title).toBe("Original title");

    const other = await store.createWorkItem(
      {
        projectId: otherProjectId,
        title: "Other Project item",
        description: "",
        status: "todo",
        priority: "P2",
        carryover: false,
        coordinationThreadIds: [],
      },
      adminActor,
    );
    await expect(
      store.addRelation(projectId, {
        sourceId: item.id,
        targetId: other.id,
        kind: "related",
        createdBy: adminActor,
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toThrow("share one Project");

    await store.revokeWorkItem(projectId, item.id, memberAgentActor);
    expect(
      (await store.listProject(projectId)).workItems.some(
        (candidate) => candidate.id === item.id,
      ),
    ).toBe(false);
  });

  it("forces Organization RLS on every new Phase 5 table", async () => {
    const client = new Client({ connectionString: databaseAppUrl });
    await client.connect();
    await client.query("BEGIN");
    await client.query("SELECT set_config('intero.organization_id',$1,true)", [
      otherOrganizationId,
    ]);
    for (const table of phase5Tables) {
      const hidden = await client.query<{ count: string }>(
        `SELECT count(*) FROM ${table} WHERE organization_id = $1`,
        [organizationId],
      );
      expect(hidden.rows[0]?.count, table).toBe("0");
    }
    await client.query("ROLLBACK");
    await client.end();

    const policies = await admin.query<{ table_name: string; forced: boolean }>(
      `SELECT c.relname AS table_name,c.relforcerowsecurity AS forced
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname=ANY($1::text[])`,
      [phase5Tables],
    );
    expect(policies.rows).toHaveLength(phase5Tables.length);
    expect(policies.rows.every((row) => row.forced)).toBe(true);
  });
});

const phase5Tables = [
  "project_epics",
  "project_program_increments",
  "project_sprints",
  "project_features",
  "project_work_items",
  "project_work_relations",
  "project_work_code_refs",
  "project_work_comments",
  "project_work_history",
  "project_spec_review_policies",
  "project_spec_reviewer_nominations",
  "project_spec_comment_threads",
  "project_spec_comments",
  "project_spec_confirmations",
] as const;

const cleanupTables = [
  "action_inbox",
  "project_spec_confirmations",
  "project_spec_comments",
  "project_spec_comment_threads",
  "project_spec_reviewer_nominations",
  "project_spec_review_policies",
  "project_work_code_refs",
  "project_work_comments",
  "project_work_relations",
  "project_work_history",
  "project_work_items",
  "spec_revisions",
  "specs",
  "project_features",
  "project_sprints",
  "project_program_increments",
  "project_epics",
  "outbox",
  "activity_events",
  "idempotency_keys",
] as const;
