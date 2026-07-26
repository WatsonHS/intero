import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEMO_IDS,
  expectedDemoConfirmation,
  expectedProviderDestructionConfirmation,
  requireDemoTarget,
  resetDemoData,
  seedDemoData,
} from "./demo-data.js";
import { NormalizedPostgresPilotStore } from "./normalized-postgres-pilot-store.js";
import { PostgresPlatformStore } from "./postgres-store.js";
import { PostgresProjectWorkStore } from "./project-work-store.js";

const databaseUrl = process.env.INTERO_DEMO_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("persisted Demo workspace", () => {
  const target = databaseUrl
    ? requireDemoTarget({
        databaseUrl,
        confirmation: expectedDemoConfirmation(databaseUrl),
        nodeEnv: "test",
        demoEnabled: "true",
      })
    : undefined;
  let pool: Pool;
  const providerDestructionConfirmation = target
    ? expectedProviderDestructionConfirmation(target)
    : "";

  beforeAll(async () => {
    await resetDemoData(target!, {
      providerDestructionConfirmation,
    });
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool?.end();
    await resetDemoData(target!, {
      providerDestructionConfirmation,
    });
  });

  it("seeds once and preserves the same persisted workspace on rerun", async () => {
    await pool.query(
      "INSERT INTO organizations (id,name) VALUES ($1,'Unknown shared tenant')",
      ["019f9a00-0000-7000-8000-00000000dead"],
    );
    await expect(resetDemoData(target!)).rejects.toThrow(
      "non-Demo Intero data",
    );
    await pool.query("DELETE FROM organizations WHERE id=$1", [
      "019f9a00-0000-7000-8000-00000000dead",
    ]);

    const first = await seedDemoData({
      target: target!,
      providerEncryptionKey: "demo-integration-encryption-key",
      now: new Date("2026-07-26T08:00:00.000Z"),
    });
    const second = await seedDemoData({
      target: target!,
      providerEncryptionKey: "demo-integration-encryption-key",
      now: new Date("2026-07-26T09:00:00.000Z"),
    });
    expect(first.status).toBe("seeded");
    expect(second).toEqual({ ...first, status: "already_seeded" });

    const pilot = new NormalizedPostgresPilotStore(pool, DEMO_IDS.organization);
    const teams = await pilot.listTeams(DEMO_IDS.principals.alex);
    const projects = await pilot.listProjects(DEMO_IDS.principals.morgan);
    const pulse = await pilot.listTeamPulse(
      DEMO_IDS.project,
      DEMO_IDS.principals.jordan,
    );
    const coordination = await pilot.listCoordination(
      DEMO_IDS.project,
      DEMO_IDS.principals.morgan,
    );
    const invitations = await pilot.listInvitations(
      DEMO_IDS.teams.product,
      DEMO_IDS.principals.alex,
    );
    expect(teams.map((team) => team.name)).toEqual(
      expect.arrayContaining(["开发者平台", "产品体验"]),
    );
    expect(teams).toHaveLength(2);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.participatingTeamIds).toHaveLength(2);
    expect(pulse).toHaveLength(3);
    expect(coordination).toHaveLength(2);
    expect(
      coordination.some(
        (thread) =>
          thread.automationSignalId &&
          thread.automationKind === "project_work_risk",
      ),
    ).toBe(true);
    expect(
      invitations.filter(
        (invitation) => !invitation.acceptedAt && !invitation.revokedAt,
      ),
    ).toHaveLength(1);
    const alexDirectMessages = await pilot.listDirectMessageThreads(
      DEMO_IDS.principals.alex,
    );
    expect(alexDirectMessages).toHaveLength(2);
    expect(alexDirectMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              body: expect.stringContaining("发布检查清单"),
            }),
            expect.objectContaining({
              body: expect.stringContaining("Work Item"),
            }),
          ],
        }),
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              body: expect.stringContaining("先别自动继续"),
            }),
          ]),
        }),
      ]),
    );
    expect(
      await pilot.listDirectMessageThreads(DEMO_IDS.principals.priya),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              body: expect.stringContaining("跨团队权限关系"),
            }),
          ]),
        }),
      ]),
    );

    const collaboration = new PostgresPlatformStore(
      pool,
      DEMO_IDS.organization,
    );
    const groupThreads = await collaboration.listThreads("human_group");
    const teamRooms = await collaboration.listThreads("room");
    const standInThreads = await collaboration.listThreads("stand_in");
    const inbox = await collaboration.listInbox(DEMO_IDS.principals.alex);
    expect(groupThreads).toEqual([
      expect.objectContaining({
        thread: expect.objectContaining({
          title: "统一发布 · 今日联调",
          participantIds: expect.arrayContaining([
            DEMO_IDS.principals.alex,
            DEMO_IDS.principals.priya,
            DEMO_IDS.principals.morgan,
            DEMO_IDS.principals.jordan,
          ]),
        }),
        messages: expect.arrayContaining([
          expect.objectContaining({
            body: expect.stringContaining("Project-Team 关联"),
          }),
          expect.objectContaining({
            senderId: DEMO_IDS.principals.standIn,
          }),
        ]),
      }),
    ]);
    expect(teamRooms).toEqual([
      expect.objectContaining({
        thread: expect.objectContaining({
          title: "产品体验 · 团队频道",
          kind: "room",
          participantIds: expect.arrayContaining([
            DEMO_IDS.principals.alex,
            DEMO_IDS.principals.priya,
            DEMO_IDS.principals.morgan,
            DEMO_IDS.principals.jordan,
          ]),
        }),
        messages: expect.arrayContaining([
          expect.objectContaining({
            body: expect.stringContaining("长期沟通频道"),
          }),
        ]),
      }),
    ]);
    expect(standInThreads).toEqual([]);
    expect(inbox.length).toBeGreaterThanOrEqual(2);
    expect(inbox.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["consequential_commitment", "scope_expansion"]),
    );
    expect(inbox.map((item) => item.title)).toEqual(
      expect.arrayContaining([
        "请确认是否推进 10% 灰度发布",
        "替身请求扩大数据范围",
      ]),
    );

    const work = await new PostgresProjectWorkStore(
      pool,
      DEMO_IDS.organization,
    ).listProject(DEMO_IDS.project);
    const specs = await new PostgresProjectWorkStore(
      pool,
      DEMO_IDS.organization,
    ).listSpecs(DEMO_IDS.project);
    expect(work.programIncrements).toHaveLength(2);
    expect(work.sprints).toHaveLength(5);
    expect(work.epics).toHaveLength(1);
    expect(work.features).toHaveLength(3);
    expect(work.workItems.map((item) => item.status)).toEqual(
      expect.arrayContaining(["todo", "in_progress", "ready_for_test", "done"]),
    );
    expect(work.workItems.some((item) => item.carryover)).toBe(true);
    expect(work.workItems.map((item) => item.title)).toEqual(
      expect.arrayContaining([
        "执行 10% 租户安全灰度",
        "验证看板空状态与重连状态",
      ]),
    );
    expect(work.relations).toHaveLength(2);
    expect(work.codeReferences).toHaveLength(3);
    expect(work.comments).toHaveLength(2);
    expect(specs).toHaveLength(2);
    expect(
      specs.some(
        (spec) =>
          spec.revisions.length === 2 &&
          spec.spec.confirmedRevisionId !== spec.spec.currentRevisionId,
      ),
    ).toBe(true);
    expect(
      specs
        .flatMap((spec) => spec.commentThreads)
        .some((thread) => thread.status === "resolved"),
    ).toBe(true);
    expect(
      specs
        .flatMap((spec) => spec.commentThreads)
        .some((thread) => thread.status === "open"),
    ).toBe(true);
  });

  it("preserves an admin Provider on seed and requires explicit destruction on reset", async () => {
    const pilot = new NormalizedPostgresPilotStore(pool, DEMO_IDS.organization);
    await pilot.configureProvider({
      administratorId: DEMO_IDS.principals.alex,
      endpoint: "https://provider.integration.invalid/v1",
      defaultModel: "integration-admin-model",
      encryptedApiKey: "integration-test-ciphertext",
    });

    const reseed = await seedDemoData({
      target: target!,
      providerEncryptionKey: "demo-integration-encryption-key",
      now: new Date("2026-07-26T10:00:00.000Z"),
    });
    expect(reseed.status).toBe("already_seeded");
    await expect(pilot.getProviderConfiguration()).resolves.toMatchObject({
      endpoint: "https://provider.integration.invalid/v1",
      defaultModel: "integration-admin-model",
    });

    await expect(resetDemoData(target!)).rejects.toThrow(
      "existing configured Provider",
    );
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM pilot_provider_configs",
        )
      ).rows[0]?.count,
    ).toBe(1);
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM projects")).rows[0]
        ?.count,
    ).toBeGreaterThan(0);

    await expect(
      resetDemoData(target!, {
        providerDestructionConfirmation,
      }),
    ).resolves.toMatchObject({ status: "reset" });
  });
});
