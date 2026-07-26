import {
  CodeReferenceKind,
  EpicId,
  FeatureId,
  FeatureStage,
  type PilotAgentBinding,
  PrincipalId,
  ProgramIncrementId,
  ProjectId,
  SpecId,
  SprintId,
  ThreadId,
  WorkCommentId,
  WorkItemId,
  WorkItemStatus,
  WorkPriority,
  WorkRelationKind,
  type WorkActor,
  uuidv7,
} from "@intero/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";

import type { RequestAuth } from "./auth.js";
import type { PilotStore } from "./pilot-store.js";
import { PilotStoreError } from "./pilot-store.js";
import { PostgresProjectWorkStore } from "./project-work-store.js";

export async function registerProjectWorkRoutes(
  app: FastifyInstance,
  options: {
    store: PostgresProjectWorkStore;
    pilotStore: PilotStore;
    requestAuth: RequestAuth;
  },
): Promise<void> {
  app.get<{ Params: { projectId: string } }>(
    "/v1/project-work/:projectId",
    async (request) => {
      const access = await requireProjectAccess(request, options, "either");
      return {
        ...(await options.store.listProject(access.projectId)),
        actor: access.actor,
      };
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/v1/project-work/:projectId/epics",
    async (request, reply) => {
      const access = await requireProjectAccess(request, options, "either");
      const input = z.object({
        title: z.string().min(1).max(240),
        description: z.string().max(8_000).default(""),
      }).strict().parse(request.body);
      return reply.status(201).send(
        await options.store.createEpic(
          { projectId: access.projectId, ...input },
          access.actor,
        ),
      );
    },
  );

  app.patch<{ Params: { projectId: string; epicId: string } }>(
    "/v1/project-work/:projectId/epics/:epicId",
    async (request) => {
      const access = await requireProjectAccess(request, options, "either");
      const input = z
        .object({
          title: z.string().min(1).max(240).optional(),
          description: z.string().max(8_000).optional(),
        })
        .strict()
        .parse(request.body);
      return options.store.updateEpic(
        access.projectId,
        EpicId.parse(request.params.epicId),
        {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
        },
        access.actor,
      );
    },
  );

  app.patch<{ Params: { projectId: string; featureId: string } }>(
    "/v1/project-work/:projectId/features/:featureId",
    async (request) => {
      const access = await requireProjectAccess(request, options, "either");
      const input = z
        .object({
          title: z.string().min(1).max(240).optional(),
          description: z.string().max(8_000).optional(),
          stage: FeatureStage.optional(),
          epicId: z.uuid().nullable().optional(),
          ownerId: z.uuid().nullable().optional(),
          piId: z.uuid().nullable().optional(),
          sprintId: z.uuid().nullable().optional(),
        })
        .strict()
        .parse(request.body);
      return options.store.updateFeature(
        access.projectId,
        FeatureId.parse(request.params.featureId),
        {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          ...(input.stage === undefined ? {} : { stage: input.stage }),
          ...(input.epicId === undefined
            ? {}
            : {
                epicId:
                  input.epicId === null ? null : EpicId.parse(input.epicId),
              }),
          ...(input.ownerId === undefined
            ? {}
            : {
                ownerId:
                  input.ownerId === null
                    ? null
                    : PrincipalId.parse(input.ownerId),
              }),
          ...(input.piId === undefined
            ? {}
            : {
                piId:
                  input.piId === null
                    ? null
                    : ProgramIncrementId.parse(input.piId),
              }),
          ...(input.sprintId === undefined
            ? {}
            : {
                sprintId:
                  input.sprintId === null
                    ? null
                    : SprintId.parse(input.sprintId),
              }),
        } as Parameters<PostgresProjectWorkStore["updateFeature"]>[2],
        access.actor,
      );
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/v1/project-work/:projectId/features",
    async (request, reply) => {
      const access = await requireProjectAccess(request, options, "either");
      const input = z.object({
        title: z.string().min(1).max(240),
        description: z.string().max(8_000).default(""),
        stage: FeatureStage.default("planned"),
        epicId: z.uuid().optional(),
        ownerId: z.uuid().optional(),
        piId: z.uuid().optional(),
        sprintId: z.uuid().optional(),
      }).strict().parse(request.body);
      return reply.status(201).send(
        await options.store.createFeature(
          {
            projectId: access.projectId,
            title: input.title,
            description: input.description,
            stage: input.stage,
            ...(input.epicId ? { epicId: EpicId.parse(input.epicId) } : {}),
            ...(input.ownerId
              ? { ownerId: PrincipalId.parse(input.ownerId) }
              : {}),
            ...(input.piId
              ? { piId: ProgramIncrementId.parse(input.piId) }
              : {}),
            ...(input.sprintId
              ? { sprintId: SprintId.parse(input.sprintId) }
              : {}),
          },
          access.actor,
        ),
      );
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/v1/project-work/:projectId/items",
    async (request, reply) => {
      const access = await requireProjectAccess(request, options, "either");
      const input = workItemMutation.parse(request.body);
      return reply.status(201).send(
        await options.store.createWorkItem(
          {
            projectId: access.projectId,
            title: input.title,
            description: input.description ?? "",
            status: input.status ?? "todo",
            priority: input.priority ?? "P2",
            carryover: false,
            coordinationThreadIds: (input.coordinationThreadIds ?? []).map(
              (id) => ThreadId.parse(id),
            ),
            ...(input.featureId
              ? { featureId: FeatureId.parse(input.featureId) }
              : {}),
            ...(input.ownerId
              ? { ownerId: PrincipalId.parse(input.ownerId) }
              : {}),
            ...(input.specId ? { specId: SpecId.parse(input.specId) } : {}),
            ...(input.points === undefined || input.points === null
              ? {}
              : { points: input.points }),
            ...(input.piId
              ? { piId: ProgramIncrementId.parse(input.piId) }
              : {}),
            ...(input.sprintId
              ? { sprintId: SprintId.parse(input.sprintId) }
              : {}),
            ...(input.completionEvidence
              ? { completionEvidence: input.completionEvidence }
              : {}),
          },
          access.actor,
          idempotencyKey(request),
        ),
      );
    },
  );

  app.patch<{ Params: { projectId: string; workItemId: string } }>(
    "/v1/project-work/:projectId/items/:workItemId",
    async (request) => {
      const access = await requireProjectAccess(request, options, "either");
      const input = workItemMutation.partial().parse(request.body);
      return options.store.updateWorkItem(
        access.projectId,
        WorkItemId.parse(request.params.workItemId),
        workItemPatch(input),
        access.actor,
        idempotencyKey(request),
      );
    },
  );

  app.post<{ Params: { projectId: string; workItemId: string } }>(
    "/v1/project-work/:projectId/items/:workItemId/revert",
    async (request) => {
      const access = await requireProjectAccess(request, options, "either");
      const input = z
        .object({ historyId: z.uuid() })
        .strict()
        .parse(request.body);
      return options.store.revertWorkItem(
        access.projectId,
        WorkItemId.parse(request.params.workItemId),
        input.historyId,
        access.actor,
        idempotencyKey(request),
      );
    },
  );

  app.delete<{ Params: { projectId: string; workItemId: string } }>(
    "/v1/project-work/:projectId/items/:workItemId",
    async (request, reply) => {
      const access = await requireProjectAccess(request, options, "either");
      await options.store.revokeWorkItem(
        access.projectId,
        WorkItemId.parse(request.params.workItemId),
        access.actor,
      );
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { projectId: string; workItemId: string } }>(
    "/v1/project-work/:projectId/items/:workItemId/comments",
    async (request, reply) => {
      const access = await requireProjectAccess(request, options, "either");
      const input = z.object({
        body: z.string().min(1).max(16_000),
        parentId: z.uuid().optional(),
      }).strict().parse(request.body);
      return reply.status(201).send(
        await options.store.addWorkComment(access.projectId, {
          id: WorkCommentId.parse(uuidv7()),
          workItemId: WorkItemId.parse(request.params.workItemId),
          body: input.body,
          ...(input.parentId
            ? { parentId: WorkCommentId.parse(input.parentId) }
            : {}),
          author: access.actor,
          createdAt: new Date().toISOString(),
        }),
      );
    },
  );

  app.post<{ Params: { projectId: string; workItemId: string } }>(
    "/v1/project-work/:projectId/items/:workItemId/code-references",
    async (request, reply) => {
      const access = await requireProjectAccess(request, options, "either");
      const input = z.object({
        kind: CodeReferenceKind,
        label: z.string().min(1).max(240),
        value: z.string().min(1).max(500),
        url: z.url().optional(),
        repository: z.string().max(240).optional(),
      }).strict().parse(request.body);
      return reply.status(201).send(
        await options.store.addCodeReference(access.projectId, {
          id: uuidv7(),
          workItemId: WorkItemId.parse(request.params.workItemId),
          ...input,
          reportedBy: access.actor,
          createdAt: new Date().toISOString(),
        }),
      );
    },
  );

  app.delete<{ Params: { projectId: string; referenceId: string } }>(
    "/v1/project-work/:projectId/code-references/:referenceId",
    async (request, reply) => {
      await requireProjectAccess(request, options, "human");
      await options.store.removeCodeReference(
        ProjectId.parse(request.params.projectId),
        request.params.referenceId,
      );
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { projectId: string; workItemId: string } }>(
    "/v1/project-work/:projectId/items/:workItemId/relations",
    async (request, reply) => {
      const access = await requireProjectAccess(request, options, "either");
      const input = z.object({
        targetId: z.uuid(),
        kind: WorkRelationKind,
      }).strict().parse(request.body);
      return reply.status(201).send(
        await options.store.addRelation(access.projectId, {
          sourceId: WorkItemId.parse(request.params.workItemId),
          targetId: WorkItemId.parse(input.targetId),
          kind: input.kind,
          createdBy: access.actor,
          createdAt: new Date().toISOString(),
        }),
      );
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/v1/project-work/:projectId/program-increments",
    async (request, reply) => {
      const access = await requireProjectGovernor(request, options);
      const input = z.object({
        startDate: z.iso.date(),
        sprintCount: z.number().int().min(1).max(12),
        sprintDurationWeeks: z.number().int().min(1).max(8),
        timezone: z.string().min(1).max(80),
      }).strict().parse(request.body);
      return reply.status(201).send(
        await options.store.createProgramIncrement(
          { projectId: access.projectId, ...input },
          access.actor,
        ),
      );
    },
  );

  app.post<{ Params: { projectId: string; sprintId: string } }>(
    "/v1/project-work/:projectId/sprints/:sprintId/close",
    async (request, reply) => {
      const access = await requireProjectGovernor(request, options);
      await options.store.closeSprint(
        access.projectId,
        SprintId.parse(request.params.sprintId),
        access.actor,
      );
      return reply.status(202).send({ closed: true });
    },
  );

  app.post<{ Params: { projectId: string; piId: string } }>(
    "/v1/project-work/:projectId/program-increments/:piId/close",
    async (request, reply) => {
      const access = await requireProjectGovernor(request, options);
      await options.store.closeProgramIncrement(
        access.projectId,
        request.params.piId,
        access.actor,
      );
      return reply.status(202).send({ closed: true });
    },
  );

  app.patch<{ Params: { projectId: string } }>(
    "/v1/project-work/:projectId/spec-review-policy",
    async (request) => {
      const access = await requireProjectGovernor(request, options);
      const input = z
        .object({
          requiredConfirmations: z.number().int().min(1).max(3),
          otherMemberAgentsCount: z.boolean(),
          authorSelfConfirmation: z.boolean(),
        })
        .strict()
        .parse(request.body);
      return options.store.updateSpecReviewPolicy(
        access.projectId,
        input,
        access.actor,
      );
    },
  );

  app.get("/v1/spec-reviews", async (request) => {
    const projectId = ProjectId.parse(
      z.object({ projectId: z.uuid() }).parse(request.query).projectId,
    );
    await requireProjectAccess(request, options, "human", projectId);
    return { items: await options.store.listSpecs(projectId) };
  });

  app.post<{ Params: { projectId: string } }>(
    "/v1/project-work/:projectId/specs",
    async (request, reply) => {
      const access = await requireProjectAccess(request, options, "either");
      const input = specVersionMutation.parse(request.body);
      return reply.status(201).send(
        await options.store.createSpecVersion({
          projectId: access.projectId,
          ...input,
          actor: access.actor,
          ...(idempotencyKey(request)
            ? { idempotencyKey: idempotencyKey(request)! }
            : {}),
        }),
      );
    },
  );

  app.post<{ Params: { projectId: string; specId: string } }>(
    "/v1/project-work/:projectId/specs/:specId/versions",
    async (request, reply) => {
      const access = await requireProjectAccess(request, options, "either");
      const input = specVersionMutation.parse(request.body);
      return reply.status(201).send(
        await options.store.createSpecVersion({
          projectId: access.projectId,
          specId: SpecId.parse(request.params.specId),
          ...input,
          actor: access.actor,
          ...(idempotencyKey(request)
            ? { idempotencyKey: idempotencyKey(request)! }
            : {}),
        }),
      );
    },
  );

  app.post<{
    Params: { projectId: string; specId: string; revisionId: string };
  }>(
    "/v1/project-work/:projectId/specs/:specId/versions/:revisionId/revert",
    async (request) => {
      const access = await requireProjectAccess(request, options, "either");
      return options.store.revertSpecVersion({
        projectId: access.projectId,
        specId: request.params.specId,
        revisionId: request.params.revisionId,
        actor: access.actor,
        ...(idempotencyKey(request)
          ? { idempotencyKey: idempotencyKey(request)! }
          : {}),
      });
    },
  );

  app.delete<{
    Params: { projectId: string; specId: string; revisionId: string };
  }>(
    "/v1/project-work/:projectId/specs/:specId/versions/:revisionId",
    async (request) => {
      const access = await requireProjectAccess(request, options, "either");
      return options.store.revokeSpecVersion({
        projectId: access.projectId,
        specId: request.params.specId,
        revisionId: request.params.revisionId,
        actor: access.actor,
      });
    },
  );

  app.post<{ Params: { projectId: string; specId: string } }>(
    "/v1/project-work/:projectId/specs/:specId/request-review",
    async (request) => {
      const access = await requireProjectAccess(request, options, "either");
      const input = z.object({
        reviewerIds: z.array(z.uuid()).max(20).default([]),
      }).strict().parse(request.body);
      return options.store.requestSpecReview(
        access.projectId,
        request.params.specId,
        input.reviewerIds,
        access.actor,
      );
    },
  );

  app.post<{ Params: { projectId: string; specId: string } }>(
    "/v1/project-work/:projectId/specs/:specId/comments",
    async (request, reply) => {
      const access = await requireProjectAccess(request, options, "either");
      const input = z.object({
        revisionId: z.uuid(),
        threadId: z.uuid().optional(),
        parentId: z.uuid().optional(),
        lineStart: z.number().int().positive(),
        lineEnd: z.number().int().positive(),
        selection: z.string().max(2_000).optional(),
        body: z.string().min(1).max(16_000),
      }).strict().parse(request.body);
      return reply.status(201).send(
        await options.store.addSpecComment({
          projectId: access.projectId,
          specId: request.params.specId,
          revisionId: input.revisionId,
          lineStart: input.lineStart,
          lineEnd: input.lineEnd,
          body: input.body,
          ...(input.threadId ? { threadId: input.threadId } : {}),
          ...(input.parentId ? { parentId: input.parentId } : {}),
          ...(input.selection ? { selection: input.selection } : {}),
          actor: access.actor,
        }),
      );
    },
  );

  app.patch<{ Params: { projectId: string; threadId: string } }>(
    "/v1/project-work/:projectId/spec-comment-threads/:threadId",
    async (request) => {
      const access = await requireProjectAccess(request, options, "either");
      const input = z.object({
        status: z.enum(["open", "resolved"]),
      }).strict().parse(request.body);
      return options.store.setSpecCommentStatus({
        projectId: access.projectId,
        threadId: request.params.threadId,
        status: input.status,
      });
    },
  );

  app.post<{ Params: { projectId: string; specId: string } }>(
    "/v1/project-work/:projectId/specs/:specId/confirm",
    async (request) => {
      const access = await requireProjectAccess(request, options, "either");
      return options.store.confirmSpec(
        access.projectId,
        request.params.specId,
        access.actor,
      );
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/project-work/:projectId/specs/confirmed",
    async (request) => {
      const access = await requireProjectAccess(request, options, "either");
      return { items: await options.store.listConfirmed(access.projectId) };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/project-work/:projectId/specs/review-context",
    async (request) => {
      const access = await requireProjectAccess(request, options, "either");
      const items = await options.store.listSpecs(access.projectId);
      return {
        items: items.flatMap((item) =>
          item.commentThreads
            .filter(
              (thread) =>
                thread.status === "open" &&
                thread.revisionId === item.spec.currentRevisionId,
            )
            .map((thread) => ({
              specId: item.spec.id,
              title: item.spec.title,
              revisionId: thread.revisionId,
              thread,
            })),
        ),
      };
    },
  );

  app.get<{ Params: { projectId: string; specId: string } }>(
    "/v1/project-work/:projectId/specs/:specId/confirmed",
    async (request, reply) => {
      const access = await requireProjectAccess(request, options, "either");
      const item = await options.store.getConfirmed(
        access.projectId,
        request.params.specId,
      );
      return item ? item : reply.status(404).send({
        code: "CONFIRMED_SPEC_NOT_FOUND",
        message: "No confirmed version is available.",
      });
    },
  );
}

const workItemMutation = z.object({
  title: z.string().min(1).max(240),
  description: z.string().max(16_000).optional(),
  status: WorkItemStatus.optional(),
  ownerId: z.uuid().nullable().optional(),
  featureId: z.uuid().nullable().optional(),
  specId: z.uuid().nullable().optional(),
  priority: WorkPriority.optional(),
  points: z.number().finite().nonnegative().nullable().optional(),
  piId: z.uuid().nullable().optional(),
  sprintId: z.uuid().nullable().optional(),
  completionEvidence: z.string().max(4_000).nullable().optional(),
  coordinationThreadIds: z.array(z.uuid()).max(50).optional(),
}).strict();

const specVersionMutation = z.object({
  title: z.string().min(1).max(240),
  markdown: z.string().min(1).max(500_000),
  changeSummary: z.string().max(2_000).default(""),
  affectedScopes: z.array(z.string().max(300)).max(100).default([]),
}).strict();

type Access = {
  projectId: ProjectId;
  actor: WorkActor;
  binding?: PilotAgentBinding;
};

async function requireProjectAccess(
  request: FastifyRequest,
  options: {
    pilotStore: PilotStore;
    requestAuth: RequestAuth;
  },
  mode: "human" | "either",
  knownProjectId?: ProjectId,
): Promise<Access> {
  const projectId =
    knownProjectId ??
    ProjectId.parse((request.params as { projectId?: string }).projectId);
  const principal = await options.requestAuth.resolve(request, false);
  if (principal) {
    const visible = (await options.pilotStore.listProjects(principal.id)).some(
      (project) => project.id === projectId,
    );
    if (!visible) throw forbidden();
    return {
      projectId,
      actor: { principalId: principal.id, kind: "human", source: "web" },
    };
  }
  if (mode === "human") throw unauthenticated();
  const binding = await agentBinding(request, options.pilotStore);
  if (!binding || binding.projectId !== projectId) throw forbidden();
  return {
    projectId,
    binding,
    actor: {
      principalId: binding.ownerId,
      kind: "agent",
      source: "direct_cloud_mcp",
    },
  };
}

async function requireProjectGovernor(
  request: FastifyRequest,
  options: {
    pilotStore: PilotStore;
    requestAuth: RequestAuth;
  },
): Promise<Access> {
  const access = await requireProjectAccess(request, options, "human");
  const projects = await options.pilotStore.listProjects(access.actor.principalId);
  const project = projects.find((item) => item.id === access.projectId)!;
  const organizationRole = await options.pilotStore.getOrganizationRole(
    access.actor.principalId,
  );
  const teamRole = await options.pilotStore.getTeamRole(
    project.primaryTeamId,
    access.actor.principalId,
  );
  if (organizationRole !== "admin" && teamRole !== "leader") throw forbidden();
  return access;
}

async function agentBinding(request: FastifyRequest, store: PilotStore) {
  const value = request.headers.authorization;
  const credential = value?.startsWith("Bearer ") ? value.slice(7) : undefined;
  return credential
    ? store.findBindingByCredentialHash(
        createHash("sha256").update(credential).digest("hex"),
      )
    : undefined;
}

function idempotencyKey(request: FastifyRequest): string | undefined {
  const value = request.headers["idempotency-key"];
  return typeof value === "string" ? value : undefined;
}

function workItemPatch(
  input: z.infer<ReturnType<typeof workItemMutation.partial>>,
): Parameters<PostgresProjectWorkStore["updateWorkItem"]>[2] {
  return {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.description === undefined
      ? {}
      : { description: input.description }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.ownerId === undefined
      ? {}
      : {
          ownerId:
            input.ownerId === null
              ? null
              : PrincipalId.parse(input.ownerId),
        }),
    ...(input.featureId === undefined
      ? {}
      : {
          featureId:
            input.featureId === null
              ? null
              : FeatureId.parse(input.featureId),
        }),
    ...(input.specId === undefined
      ? {}
      : {
          specId:
            input.specId === null ? null : SpecId.parse(input.specId),
        }),
    ...(input.priority === undefined ? {} : { priority: input.priority }),
    ...(input.points === undefined ? {} : { points: input.points }),
    ...(input.piId === undefined
      ? {}
      : {
          piId:
            input.piId === null
              ? null
              : ProgramIncrementId.parse(input.piId),
        }),
    ...(input.sprintId === undefined
      ? {}
      : {
          sprintId:
            input.sprintId === null
              ? null
              : SprintId.parse(input.sprintId),
        }),
    ...(input.completionEvidence === undefined
      ? {}
      : { completionEvidence: input.completionEvidence }),
    ...(input.coordinationThreadIds === undefined
      ? {}
      : {
          coordinationThreadIds: input.coordinationThreadIds.map((id) =>
            ThreadId.parse(id),
          ),
        }),
  };
}

function unauthenticated() {
  return new PilotStoreError(
    "AUTHENTICATION_REQUIRED",
    401,
    "Sign in or connect a bound Agent to continue.",
  );
}

function forbidden() {
  return new PilotStoreError(
    "PROJECT_ACCESS_DENIED",
    403,
    "This identity cannot access the Project.",
  );
}
