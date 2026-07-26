import { OrganizationId, PrincipalId, ProjectId, uuidv7 } from "@intero/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "./database/migrate.js";
import { PostgresInformationStore } from "./information-store.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const databaseSuite = databaseUrl && databaseAppUrl ? describe : describe.skip;

databaseSuite("Phase 6 information store", () => {
  const admin = new Pool({ connectionString: databaseUrl });
  const appPool = new Pool({ connectionString: databaseAppUrl });
  const organizationA = OrganizationId.parse(uuidv7());
  const organizationB = OrganizationId.parse(uuidv7());
  const principalA = PrincipalId.parse(uuidv7());
  const principalB = PrincipalId.parse(uuidv7());
  const projectA = ProjectId.parse(uuidv7());
  const projectB = ProjectId.parse(uuidv7());
  const workItemA = uuidv7();
  const workItemB = uuidv7();
  const storeA = new PostgresInformationStore(appPool, organizationA);
  const storeB = new PostgresInformationStore(appPool, organizationB);

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    for (const [organizationId, principalId, projectId, workItemId, suffix] of [
      [organizationA, principalA, projectA, workItemA, "A"],
      [organizationB, principalB, projectB, workItemB, "B"],
    ] as const) {
      await admin.query(`INSERT INTO organizations (id,name) VALUES ($1,$2)`, [
        organizationId,
        `Phase 6 ${suffix}`,
      ]);
      await admin.query(
        `INSERT INTO principals (id,display_name,kind) VALUES ($1,$2,'human')`,
        [principalId, `Member ${suffix}`],
      );
      await admin.query(
        `INSERT INTO memberships (organization_id,principal_id,role)
         VALUES ($1,$2,'admin')`,
        [organizationId, principalId],
      );
      await admin.query(
        `INSERT INTO projects
          (id,organization_id,name,project_management_enabled,timezone)
         VALUES ($1,$2,$3,true,'Asia/Shanghai')`,
        [projectId, organizationId, `Project ${suffix}`],
      );
      await admin.query(
        `INSERT INTO project_work_items
          (id,organization_id,project_id,title,description,status,priority,created_by)
         VALUES ($1,$2,$3,$4,$5,'todo','P2',$6::jsonb)`,
        [
          workItemId,
          organizationId,
          projectId,
          suffix === "A" ? "中文发布核对" : "Secret tenant work",
          suffix === "A"
            ? "核对灰度发布清单与回滚证据"
            : "Must never leak to tenant A",
          JSON.stringify({ principalId, kind: "human" }),
        ],
      );
    }
  });

  afterAll(async () => {
    const organizations = [organizationA, organizationB];
    const principals = [principalA, principalB];
    for (const table of [
      "notification_preferences",
      "action_inbox",
      "project_work_items",
      "projects",
      "memberships",
    ]) {
      await admin.query(
        `DELETE FROM ${table} WHERE organization_id=ANY($1::uuid[])`,
        [organizations],
      );
    }
    await admin.query(`DELETE FROM principals WHERE id=ANY($1::uuid[])`, [
      principals,
    ]);
    await admin.query(`DELETE FROM organizations WHERE id=ANY($1::uuid[])`, [
      organizations,
    ]);
    await appPool.end();
    await admin.end();
  });

  it("keeps targeted attention tenant-scoped with read and mute state", async () => {
    await storeA.createAttention({
      principalId: principalA,
      projectId: projectA,
      kind: "review_request",
      title: "请评审发布 Spec",
      detail: "你被指定为本版本评审人。",
      sourceRef: `spec:${uuidv7()}`,
      dedupeKey: "phase6-review-a",
    });
    await storeB.createAttention({
      principalId: principalB,
      projectId: projectB,
      kind: "review_request",
      title: "Tenant B review",
      detail: "Private to B",
      sourceRef: `spec:${uuidv7()}`,
      dedupeKey: "phase6-review-b",
    });
    const [item] = await storeA.listAttention(principalA);
    expect(item).toMatchObject({
      title: "请评审发布 Spec",
      projectId: projectA,
    });
    expect(await storeA.listAttention(principalB)).toEqual([]);
    const read = await storeA.updateAttention(principalA, item!.id, "read");
    expect(read.readAt).toBeTruthy();
    const preferences = await storeA.setPreferences(principalA, {
      mutedKinds: ["review_request"],
    });
    expect(preferences.mutedKinds).toEqual(["review_request"]);
  });

  it("searches authorized project content without cross-tenant leakage", async () => {
    const visible = await storeA.search(principalA, {
      query: "发布",
      limit: 20,
    });
    expect(visible).toEqual([
      expect.objectContaining({
        id: workItemA,
        projectId: projectA,
        type: "work_item",
      }),
    ]);
    const leaked = await storeA.search(principalA, {
      query: "Secret tenant",
      limit: 20,
    });
    expect(leaked).toEqual([]);
  });
});
