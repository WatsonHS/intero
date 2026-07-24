import {
  AddRepresentativeRequest,
  AddReviewResponseRequest,
  ApplyPublicProjectionRequest,
  CreateAttachmentUploadRequest,
  CoordinateRequest,
  CreateCapabilityGrantRequest,
  CreateClaimRequest,
  CreateDecisionRequest,
  CreateSpecRequest,
  CreateSpecRevisionRequest,
  CreateThreadRequest,
  CreateWorkstreamRequest,
  CursorQuery,
  IngestEventRequest,
  SendThreadMessageRequest,
} from "@intero/api-contracts";
import type { AttachmentService } from "@intero/attachments";
import { createLogger, loggerOptions } from "@intero/config";
import {
  ThreadKind,
  type OperationId,
  type PrincipalId,
  type SpecId,
  type ThreadId,
} from "@intero/domain";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { z, ZodError, type ZodType } from "zod";

import { type InteroAuth, mountAuth } from "./auth.js";
import type { PlatformStore } from "./platform-store.js";
import type { PrincipalSummary } from "./platform-store.js";
import { FailClosedAuthorization, type AuthorizationPort } from "./ports.js";
import { InMemoryPlatformStore } from "./store.js";

export interface BuildAppOptions {
  store?: PlatformStore;
  logger?: boolean;
  auth?: InteroAuth;
  authorization?: AuthorizationPort;
  attachments?: AttachmentService;
  organization?: { id: string; name: string };
  currentPrincipal?: PrincipalSummary;
  representativePrincipal?: PrincipalSummary;
  inboxPrincipalIds?: PrincipalId[];
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : loggerOptions(process.env.INTERO_LOG_LEVEL),
  });
  const store = options.store ?? new InMemoryPlatformStore();
  const organization = options.organization ?? {
    id: "019b5ac0-7600-7000-8000-000000000001",
    name: "Intero Development",
  };
  const currentPrincipal = options.currentPrincipal ?? {
    id: "019b5ac0-7600-7000-8000-000000000002" as PrincipalId,
    displayName: "Intero User",
    kind: "human" as const,
  };
  const representativePrincipal = options.representativePrincipal ?? {
    id: "019b5ac0-7600-7000-8000-000000000003" as PrincipalId,
    displayName: "Intero Representative",
    kind: "representative" as const,
  };
  const inboxPrincipalIds = options.inboxPrincipalIds ?? [
    currentPrincipal.id,
    representativePrincipal.id,
  ];
  await store.upsertPrincipal(currentPrincipal);
  await store.upsertPrincipal(representativePrincipal);
  const authorization = options.authorization ?? new FailClosedAuthorization();
  let localRuntimeHeartbeatAt: number | undefined;
  app.decorate("interoStore", store);
  await app.register(cors, {
    origin: [/^http:\/\/localhost:\d+$/],
    credentials: true,
  });
  if (options.auth) mountAuth(app, options.auth);

  app.setErrorHandler((error, request, reply) => {
    const normalized =
      error instanceof Error ? error : new Error("Unexpected server error");
    const statusCode =
      normalized instanceof ZodError
        ? 400
        : normalized.message.includes("not found")
          ? 404
          : 400;
    reply.status(statusCode).send({
      code: normalized instanceof ZodError ? "INVALID_REQUEST" : "DOMAIN_ERROR",
      message: normalized.message,
      requestId: request.id,
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "intero-api",
    version: "0.1.0",
  }));

  app.get("/v1/bootstrap", async () => ({
    organization,
    currentPrincipal,
    representativePrincipal,
  }));

  app.post("/v1/authorization/check", async (request) => {
    const input = parse(
      z.object({
        principalId: z.string().min(1).max(200),
        permission: z.string().min(1).max(120),
        resourceType: z.string().min(1).max(120),
        resourceId: z.string().min(1).max(300),
        consistencyToken: z.string().max(1_000).optional(),
      }),
      request.body,
    );
    return authorization.check({
      principalId: input.principalId,
      permission: input.permission,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      ...(input.consistencyToken
        ? { consistencyToken: input.consistencyToken }
        : {}),
    });
  });

  app.post("/v1/attachments/uploads", async (request, reply) => {
    if (!options.attachments) {
      return reply.status(503).send({
        code: "ATTACHMENTS_UNAVAILABLE",
        message: "Attachment storage is not configured.",
        requestId: request.id,
      });
    }
    const input = parse(CreateAttachmentUploadRequest, request.body);
    return reply
      .status(201)
      .send(await options.attachments.createUpload(input));
  });

  app.post<{ Params: { attachmentId: string } }>(
    "/v1/attachments/:attachmentId/complete",
    async (request, reply) => {
      if (!options.attachments) {
        return reply.status(503).send({
          code: "ATTACHMENTS_UNAVAILABLE",
          message: "Attachment storage is not configured.",
          requestId: request.id,
        });
      }
      await options.attachments.completeUpload(request.params.attachmentId);
      return reply
        .status(202)
        .send(await options.attachments.scan(request.params.attachmentId));
    },
  );

  app.get<{ Params: { attachmentId: string } }>(
    "/v1/attachments/:attachmentId",
    async (request, reply) => {
      if (!options.attachments) {
        return reply.status(503).send({
          code: "ATTACHMENTS_UNAVAILABLE",
          message: "Attachment storage is not configured.",
          requestId: request.id,
        });
      }
      return options.attachments.createDownload(request.params.attachmentId);
    },
  );

  app.post("/v1/workstreams", async (request, reply) => {
    const input = parse(CreateWorkstreamRequest, request.body);
    const mutation = await store.createWorkstream(input);
    return reply.status(201).send(mutation.value);
  });

  app.post("/v1/claims", async (request, reply) => {
    const claim = parse(CreateClaimRequest, request.body);
    return reply.status(201).send((await store.addClaim(claim)).value);
  });

  app.post("/v1/events", async (request, reply) => {
    const { event } = parse(IngestEventRequest, request.body);
    return reply.status(202).send(await store.ingestEvent(event));
  });

  app.post("/v1/projections", async (request, reply) => {
    const { projection } = parse(ApplyPublicProjectionRequest, request.body);
    return reply.status(202).send(await store.applyProjection(projection));
  });

  app.get("/v1/team-pulse", async () => {
    const projections = await store.listProjections();
    return {
      generatedAt: new Date().toISOString(),
      projections,
      principals: await store.listPrincipals(
        projections.map((projection) => projection.ownerId),
      ),
      staleAfterSeconds: 300,
    };
  });

  app.post("/v1/capability-grants", async (request, reply) => {
    const grant = parse(CreateCapabilityGrantRequest, request.body);
    return reply.status(201).send(await store.putGrant(grant));
  });

  app.post("/v1/coordination", async (request) => {
    const { envelope } = parse(CoordinateRequest, request.body);
    return { result: await store.coordinate(envelope) };
  });

  app.get("/v1/action-inbox", async () => {
    const items = (
      await Promise.all(
        inboxPrincipalIds.map((principalId) => store.listInbox(principalId)),
      )
    )
      .flat()
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
    return {
      items: [...new Map(items.map((item) => [item.id, item])).values()],
    };
  });

  app.post("/v1/threads", async (request, reply) => {
    const input = parse(CreateThreadRequest, request.body);
    return reply
      .status(201)
      .send(await store.createThread({ ...input, sequence: 0 }));
  });

  app.get("/v1/threads", async (request) => {
    const query = parse(
      z.object({
        kind: ThreadKind.optional(),
      }),
      request.query,
    );
    const items = await store.listThreads(query.kind);
    return {
      items: await Promise.all(items.map((item) => presentThread(store, item))),
    };
  });

  app.get<{ Params: { threadId: string } }>(
    "/v1/threads/:threadId",
    async (request, reply) => {
      const threadId = request.params.threadId as ThreadId;
      const result = await store.getThread(threadId);
      if (!result) return notFound(reply, "Thread");
      return presentThread(store, result);
    },
  );

  app.post<{ Params: { threadId: string } }>(
    "/v1/threads/:threadId/messages",
    async (request, reply) => {
      const input = parse(SendThreadMessageRequest, request.body);
      return reply.status(201).send(
        await store.appendMessage(request.params.threadId as ThreadId, {
          id: input.id as Parameters<PlatformStore["appendMessage"]>[1]["id"],
          senderId: input.senderId as PrincipalId,
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.encryptedBody !== undefined
            ? { encryptedBody: input.encryptedBody }
            : {}),
          createdAt: input.createdAt,
        }),
      );
    },
  );

  app.post<{ Params: { threadId: string } }>(
    "/v1/threads/:threadId/representatives",
    async (request, reply) => {
      const input = parse(AddRepresentativeRequest, request.body);
      return reply
        .status(201)
        .send(
          await store.addRepresentativeToThread(
            request.params.threadId as ThreadId,
            input.representativeId as PrincipalId,
            input.actorId as PrincipalId,
          ),
        );
    },
  );

  app.post("/v1/specs", async (request, reply) => {
    const input = parse(CreateSpecRequest, request.body);
    const { markdown, changeSummary, affectedScopes, createdBy, ...spec } =
      input;
    return reply.status(201).send(
      await store.createSpec({
        spec,
        markdown,
        changeSummary,
        affectedScopes,
        createdBy: createdBy as PrincipalId,
      }),
    );
  });

  app.post<{ Params: { specId: string } }>(
    "/v1/specs/:specId/revisions",
    async (request, reply) => {
      const input = parse(CreateSpecRevisionRequest, request.body);
      return reply
        .status(201)
        .send(
          await store.addSpecRevision(request.params.specId as SpecId, input),
        );
    },
  );

  app.post<{ Params: { specId: string } }>(
    "/v1/specs/:specId/reviews",
    async (request, reply) => {
      const review = parse(AddReviewResponseRequest, request.body);
      return reply
        .status(201)
        .send(await store.addReview(request.params.specId as SpecId, review));
    },
  );

  app.get<{ Params: { specId: string } }>(
    "/v1/specs/:specId",
    async (request, reply) => {
      const specId = request.params.specId as SpecId;
      const result = await store.getSpec(specId);
      if (!result) return notFound(reply, "Spec");
      return presentSpec(store, result);
    },
  );

  app.get("/v1/specs", async () => ({
    items: await Promise.all(
      (await store.listSpecs()).map((item) => presentSpec(store, item)),
    ),
  }));

  app.post("/v1/decisions", async (request, reply) => {
    const input = parse(CreateDecisionRequest, request.body);
    return reply.status(201).send(await store.createDecision(input));
  });

  app.get("/v1/decisions", async () => ({
    items: await store.listDecisions(),
  }));

  app.get("/v1/activity", async (request) => {
    const query = parse(CursorQuery, request.query);
    return await store.cursor(query.after, query.limit);
  });

  app.post("/v1/runtime/heartbeat", async (_request, reply) => {
    localRuntimeHeartbeatAt = Date.now();
    return reply.status(202).send({ accepted: true });
  });

  app.get("/v1/offline-status", async () => {
    const latest = await store.latestProjectionFreshness();
    const localRuntimeOnline =
      localRuntimeHeartbeatAt !== undefined &&
      Date.now() - localRuntimeHeartbeatAt < 15_000;
    return {
      localRuntime: localRuntimeOnline ? "online" : "offline",
      fallback: localRuntimeOnline ? "local" : "public",
      freshnessAt: latest ?? null,
      stale: latest ? Date.now() - Date.parse(latest) > 300_000 : true,
      disclosure: localRuntimeOnline
        ? "Local Representative is connected."
        : latest
          ? "Answering from the latest synchronized public Work State."
          : "No synchronized Work State is available.",
    };
  });

  return app;
}

async function presentThread(
  store: PlatformStore,
  item: Awaited<ReturnType<PlatformStore["getThread"]>> & {},
) {
  const operationIds = item.messages
    .map((message) => message.operationId)
    .filter((id): id is OperationId => id !== undefined);
  return {
    ...item,
    principals: await store.listPrincipals(item.thread.participantIds),
    actions: (await store.listActionEnvelopes(operationIds)).map(
      (envelope) => ({
        envelope,
        status: "resolved" as const,
      }),
    ),
  };
}

async function presentSpec(
  store: PlatformStore,
  item: NonNullable<Awaited<ReturnType<PlatformStore["getSpec"]>>>,
) {
  return {
    ...item,
    principals: await store.listPrincipals([
      ...item.revisions.map((revision) => revision.createdBy),
      ...item.reviews.map((review) => review.reviewerId),
    ]),
  };
}

function parse<T>(schema: ZodType<T>, input: unknown): T {
  return schema.parse(input);
}

function notFound(reply: FastifyReply, resource: string) {
  return reply.status(404).send({
    code: "NOT_FOUND",
    message: `${resource} was not found.`,
    requestId: reply.request.id,
  });
}

declare module "fastify" {
  interface FastifyInstance {
    interoStore: PlatformStore;
  }
}
