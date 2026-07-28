import {
  PrincipalId,
  ProjectId,
  type ProjectAutomationPolicy,
  uuidv7,
} from "@intero/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PostgresAutomationStore } from "./automation-store.js";
import { buildTestApp } from "./test-app.js";
import type { PilotStore } from "./pilot-store.js";

const principalId = PrincipalId.parse(uuidv7());
const projectId = ProjectId.parse(uuidv7());
const otherProjectId = ProjectId.parse(uuidv7());
const teamId = uuidv7();

describe("Phase 7 automation routes", () => {
  let organizationRole: "admin" | "member" = "member";
  let teamRole: "leader" | "member" = "member";
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  const policy: ProjectAutomationPolicy = {
    projectId,
    enabled: false,
    enabledSignals: ["blocker"],
    staleSpecReviewHours: 48,
    unresolvedCoordinationHours: 24,
    updatedAt: "2026-07-26T00:00:00.000Z",
  };
  const automationStore = {
    getPolicy: vi.fn(async () => policy),
    listSignals: vi.fn(async () => []),
    updatePolicy: vi.fn(async () => ({ ...policy, enabled: true })),
    revert: vi.fn(async () => ({
      id: uuidv7(),
      projectId,
      kind: "blocker",
      status: "reverted",
      sourceRef: "work-state:test",
      safeContext: "Safe context",
      candidateNextSteps: [],
      participantIds: [principalId],
      detectedAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:01:00.000Z",
    })),
  };
  const pilotStore = {
    listProjects: vi.fn(async () => [
      { id: projectId, name: "Delivery", primaryTeamId: teamId },
    ]),
    getOrganizationRole: vi.fn(async () => organizationRole),
    getTeamRole: vi.fn(async () => teamRole),
  };

  beforeEach(async () => {
    organizationRole = "member";
    teamRole = "member";
    vi.clearAllMocks();
    app = await buildTestApp({
      logger: false,
      metrics: false,
      automationStore: automationStore as unknown as PostgresAutomationStore,
      pilotStore: pilotStore as unknown as PilotStore,
      requestAuth: {
        mode: "session",
        developmentIdentities: [],
        async resolve() {
          return {
            id: principalId,
            displayName: "Member",
            kind: "human",
            email: "member@example.test",
          };
        },
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("lets participants inspect effective policy without governance authority", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/project-automation/${projectId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      policy: { enabled: false },
      canManage: false,
    });
  });

  it("rejects cross-Project reads and member policy mutations", async () => {
    const crossProject = await app.inject({
      method: "GET",
      url: `/v1/project-automation/${otherProjectId}`,
    });
    expect(crossProject.statusCode).toBe(403);

    const memberWrite = await app.inject({
      method: "PUT",
      url: `/v1/project-automation/${projectId}`,
      payload: {
        enabled: true,
        enabledSignals: ["blocker"],
        staleSpecReviewHours: 48,
        unresolvedCoordinationHours: 24,
      },
    });
    expect(memberWrite.statusCode).toBe(403);
    expect(automationStore.updatePolicy).not.toHaveBeenCalled();
  });

  it("allows organization admins and Team Leaders to manage bounded policy", async () => {
    teamRole = "leader";
    const response = await app.inject({
      method: "PUT",
      url: `/v1/project-automation/${projectId}`,
      payload: {
        enabled: true,
        enabledSignals: ["blocker", "project_work_risk"],
        staleSpecReviewHours: 24,
        unresolvedCoordinationHours: 12,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(automationStore.updatePolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        actorId: principalId,
        enabled: true,
      }),
    );
  });
});
