import {
  PrincipalId,
  ProjectAutomationSignalKind,
  ProjectId,
} from "@intero/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { PostgresAutomationStore } from "./automation-store.js";
import type { RequestAuth } from "./auth.js";
import type { PilotStore } from "./pilot-store.js";
import { PilotStoreError } from "./pilot-store.js";

export async function registerAutomationRoutes(
  app: FastifyInstance,
  options: {
    store: PostgresAutomationStore;
    pilotStore: PilotStore;
    requestAuth: RequestAuth;
  },
): Promise<void> {
  app.get<{ Params: { projectId: string } }>(
    "/v1/project-automation/:projectId",
    async (request) => {
      const access = await requireProjectParticipant(request, options);
      const [policy, signals] = await Promise.all([
        options.store.getPolicy(access.projectId),
        options.store.listSignals(access.projectId),
      ]);
      return {
        policy,
        signals,
        canManage: await canGovernProject(
          access.principalId,
          access.projectId,
          options.pilotStore,
        ),
      };
    },
  );

  app.put<{ Params: { projectId: string } }>(
    "/v1/project-automation/:projectId",
    async (request) => {
      const access = await requireProjectParticipant(request, options);
      if (
        !(await canGovernProject(
          access.principalId,
          access.projectId,
          options.pilotStore,
        ))
      ) {
        throw new PilotStoreError(
          "PROJECT_GOVERNANCE_REQUIRED",
          403,
          "Only an organization administrator or Team Leader can configure Project automation.",
        );
      }
      const input = z
        .object({
          enabled: z.boolean(),
          enabledSignals: z
            .array(ProjectAutomationSignalKind)
            .max(5)
            .default([]),
          staleSpecReviewHours: z.number().int().min(1).max(720).default(48),
          unresolvedCoordinationHours: z
            .number()
            .int()
            .min(1)
            .max(720)
            .default(24),
          quietUntil: z.iso.datetime().nullable().optional(),
        })
        .strict()
        .parse(request.body);
      return options.store.updatePolicy({
        projectId: access.projectId,
        enabled: input.enabled,
        enabledSignals: input.enabledSignals,
        staleSpecReviewHours: input.staleSpecReviewHours,
        unresolvedCoordinationHours: input.unresolvedCoordinationHours,
        ...(input.quietUntil ? { quietUntil: input.quietUntil } : {}),
        actorId: access.principalId,
      });
    },
  );

  app.post<{ Params: { projectId: string; signalId: string } }>(
    "/v1/project-automation/:projectId/signals/:signalId/revert",
    async (request) => {
      const access = await requireProjectParticipant(request, options);
      if (
        !(await canGovernProject(
          access.principalId,
          access.projectId,
          options.pilotStore,
        ))
      ) {
        throw new PilotStoreError(
          "PROJECT_GOVERNANCE_REQUIRED",
          403,
          "Only an organization administrator or Team Leader can revert automation.",
        );
      }
      return options.store.revert({
        projectId: access.projectId,
        signalId: request.params.signalId,
        actorId: access.principalId,
        now: new Date().toISOString(),
      });
    },
  );
}

async function requireProjectParticipant(
  request: FastifyRequest,
  options: {
    pilotStore: PilotStore;
    requestAuth: RequestAuth;
  },
): Promise<{ projectId: ProjectId; principalId: PrincipalId }> {
  const principal = await options.requestAuth.resolve(request);
  if (!principal) {
    throw new PilotStoreError(
      "AUTHENTICATION_REQUIRED",
      401,
      "Sign in to continue.",
    );
  }
  const projectId = ProjectId.parse(
    (request.params as { projectId: string }).projectId,
  );
  if (
    !(await options.pilotStore.listProjects(principal.id)).some(
      (project) => project.id === projectId,
    )
  ) {
    throw new PilotStoreError(
      "PROJECT_ACCESS_DENIED",
      403,
      "This identity cannot access the Project.",
    );
  }
  return { projectId, principalId: principal.id };
}

async function canGovernProject(
  principalId: PrincipalId,
  projectId: ProjectId,
  pilotStore: PilotStore,
): Promise<boolean> {
  if ((await pilotStore.getOrganizationRole(principalId)) === "admin") {
    return true;
  }
  const project = (await pilotStore.listProjects(principalId)).find(
    (item) => item.id === projectId,
  );
  return project
    ? (await pilotStore.getTeamRole(project.primaryTeamId, principalId)) ===
        "leader"
    : false;
}
