import { PrincipalId, ProjectId, type WorkActor, uuidv7 } from "@intero/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "./app.js";
import type { PilotStore } from "./pilot-store.js";
import type { PostgresProjectWorkStore } from "./project-work-store.js";

const principalId = PrincipalId.parse("019b5ac0-7600-7000-8000-0000000000a1");
const projectId = ProjectId.parse("019b5ac0-7600-7000-8000-000000000011");
const otherProjectId = ProjectId.parse("019b5ac0-7600-7000-8000-000000000012");
const teamId = "019b5ac0-7600-7000-8000-000000000021";

describe("Phase 5 Project Work routes", () => {
  let signedIn = true;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let createdActor: WorkActor | undefined;
  let createdIdempotencyKey: string | undefined;
  const projectStore = {
    listProject: vi.fn(async (requestedProjectId: ProjectId) => ({
      project: { id: requestedProjectId, name: "Delivery", timezone: "UTC" },
      epics: [],
      features: [],
      workItems: [],
      relations: [],
      codeReferences: [],
      comments: [],
      history: [],
      programIncrements: [],
      sprints: [],
    })),
    createWorkItem: vi.fn(
      async (
        input: { projectId: ProjectId; title: string },
        actor: WorkActor,
        idempotencyKey?: string,
      ) => {
        createdActor = actor;
        createdIdempotencyKey = idempotencyKey;
        return {
          id: uuidv7(),
          projectId: input.projectId,
          title: input.title,
          description: "",
          status: "todo",
          priority: "P2",
          carryover: false,
          coordinationThreadIds: [],
          createdBy: actor,
          updatedBy: actor,
          createdAt: "2026-07-26T00:00:00.000Z",
          updatedAt: "2026-07-26T00:00:00.000Z",
        };
      },
    ),
  };
  const pilotStore = {
    listProjects: vi.fn(async () => [
      {
        id: projectId,
        name: "Delivery",
        primaryTeamId: teamId,
      },
    ]),
    findBindingByCredentialHash: vi.fn(async () => ({
      id: uuidv7(),
      projectId,
      ownerId: principalId,
      client: "codex",
      name: "Codex",
      workspaceId: uuidv7(),
      credentialHash: "stored-only",
      preferredLanguage: "en-US",
      createdAt: "2026-07-26T00:00:00.000Z",
      validatedAt: "2026-07-26T00:00:00.000Z",
    })),
    getOrganizationRole: vi.fn(async () => "member"),
    getTeamRole: vi.fn(async () => "member"),
  };

  beforeEach(async () => {
    signedIn = true;
    createdActor = undefined;
    createdIdempotencyKey = undefined;
    vi.clearAllMocks();
    app = await buildApp({
      logger: false,
      metrics: false,
      projectWorkStore: projectStore as unknown as PostgresProjectWorkStore,
      pilotStore: pilotStore as unknown as PilotStore,
      requestAuth: {
        mode: "session",
        developmentIdentities: [],
        async resolve() {
          return signedIn
            ? {
                id: principalId,
                displayName: "Alex",
                kind: "human" as const,
                email: "alex@example.test",
              }
            : undefined;
        },
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("rejects an unauthenticated or cross-Project read", async () => {
    signedIn = false;
    const unauthenticated = await app.inject({
      method: "GET",
      url: `/v1/project-work/${projectId}`,
    });
    expect(unauthenticated.statusCode).toBe(403);
    expect(unauthenticated.json()).toMatchObject({
      code: "PROJECT_ACCESS_DENIED",
    });

    signedIn = true;
    const crossProject = await app.inject({
      method: "GET",
      url: `/v1/project-work/${otherProjectId}`,
    });
    expect(crossProject.statusCode).toBe(403);
    expect(projectStore.listProject).not.toHaveBeenCalled();
  });

  it("binds an Agent mutation to its Project, actor and idempotency key", async () => {
    signedIn = false;
    const response = await app.inject({
      method: "POST",
      url: `/v1/project-work/${projectId}/items`,
      headers: {
        authorization: "Bearer one-time-bound-agent-credential",
        "idempotency-key": "phase5-route-idempotency",
      },
      payload: {
        title: "Verify signed refund export",
        status: "todo",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(createdActor).toEqual({
      principalId,
      kind: "agent",
      source: "direct_cloud_mcp",
    });
    expect(createdIdempotencyKey).toBe("phase5-route-idempotency");
    expect(response.body).not.toContain("one-time-bound-agent-credential");
  });

  it("keeps Agent automation inside human ownership and priority boundaries", async () => {
    signedIn = false;
    for (const payload of [
      {
        title: "Agent must not assign a person",
        ownerId: principalId,
      },
      {
        title: "Agent must not reprioritize work",
        priority: "P0",
      },
      {
        title: "Agent must not create a completed result",
        status: "done",
      },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/project-work/${projectId}/items`,
        headers: {
          authorization: "Bearer one-time-bound-agent-credential",
          "idempotency-key": `phase7-boundary-${payload.title}`,
        },
        payload,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        code: "AUTOMATION_AUTHORITY_DENIED",
      });
    }
    expect(projectStore.createWorkItem).not.toHaveBeenCalled();
  });

  it("keeps PI/Sprint governance limited to an admin or Team Leader", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/project-work/${projectId}/program-increments`,
      payload: {
        startDate: "2026-07-27",
        sprintCount: 3,
        sprintDurationWeeks: 2,
        timezone: "Asia/Shanghai",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: "PROJECT_ACCESS_DENIED",
    });
  });
});
