import {
  AddStandInRequest,
  AddReviewResponseRequest,
  ApplyPublicProjectionRequest,
  CreateAttachmentUploadRequest,
  CoordinateRequest,
  CreateKanbanCardRequest,
  CreateCapabilityGrantRequest,
  CreateClaimRequest,
  CreateDecisionRequest,
  CreateSpecRequest,
  CreateSpecRevisionRequest,
  ConcludeThreadRequest,
  CreateThreadRequest,
  CreateWorkstreamRequest,
  CursorQuery,
  IngestEventRequest,
  MarkThreadReadRequest,
  SendThreadMessageRequest,
  UpdateKanbanCardRequest,
} from "@intero/api-contracts";
import type { AttachmentService } from "@intero/attachments";
import {
  createLogger,
  loggerOptions,
  PrivacySafeMetrics,
} from "@intero/config";
import {
  personalStandInId,
  ThreadKind,
  type KanbanCard,
  type KanbanCardId,
  type OperationId,
  type PrincipalId,
  type Project,
  type ProjectId,
  type SpecId,
  type ThreadId,
} from "@intero/domain";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z, ZodError, type ZodType } from "zod";

import {
  createRequestAuth,
  DatabasePrincipalDirectory,
  InMemoryPrincipalDirectory,
  type InteroAuth,
  mountAuth,
  type PrincipalDirectory,
  type RequestAuth,
} from "./auth.js";
import { registerAutomationRoutes } from "./automation-routes.js";
import { PostgresAutomationStore } from "./automation-store.js";
import { PostgresInformationStore } from "./information-store.js";
import {
  InMemoryPilotStore,
  type PilotStore,
  PilotStoreError,
} from "./pilot-store.js";
import { registerPilotMcpRoutes } from "./pilot-mcp.js";
import {
  type CoordinationTransport,
  DisabledObjectStoreAdapter,
  InstrumentedModelGateway,
  InlineJobRunner,
  MembershipAuthorizationAdapter,
  type ModelGateway,
  type PilotStandInJob,
  PollingRealtimeAdapter,
  ProjectInternalCoordinationTransport,
} from "./pilot-ports.js";
import { registerPilotRoutes } from "./pilot-routes.js";
import { registerProjectWorkRoutes } from "./project-work-routes.js";
import type { PostgresProjectWorkStore } from "./project-work-store.js";
import {
  PilotCheckpointService,
  PilotStandInJobHandler,
} from "./pilot-service.js";
import type { PlatformStore } from "./platform-store.js";
import type { PrincipalSummary } from "./platform-store.js";
import {
  FailClosedAuthorization,
  type AuthorizationPort,
  evaluateReadiness,
  type JobRunnerPort,
  type ObjectStorePort,
  type ReadinessDependency,
  type RealtimePort,
} from "./ports.js";
import { AesGcmProviderSecretCipher } from "./provider-secrets.js";
import { InMemoryPlatformStore } from "./store.js";
import type { KanbanCardUpdate } from "./store.js";
import { VercelAiModelGateway } from "./vercel-model-gateway.js";

/** Membership and invitation changes — the events the audit log renders. */
const GOVERNANCE_EVENT_TYPES = new Set([
  "pilot.team_member.role_changed",
  "pilot.team_member.added",
  "pilot.team_member.removed",
  "pilot.organization_member.role_changed",
  "pilot.team_invitation.created",
  "pilot.team_invitation.revoked",
  "pilot.team.created",
  "pilot.team.renamed",
  "pilot.project.created",
  "pilot.project.updated",
  "pilot.organization.renamed",
]);

export interface BuildAppOptions {
  store?: PlatformStore;
  logger?: boolean;
  auth?: InteroAuth;
  authCorsOrigins?: string[];
  authDatabase?: Pool;
  authActivationSecret?: string;
  authPublicUrl?: string;
  informationStore?: PostgresInformationStore;
  automationStore?: PostgresAutomationStore;
  allowDevelopmentIdentity?: boolean;
  principalDirectory?: PrincipalDirectory;
  requestAuth?: RequestAuth;
  authorization?: AuthorizationPort;
  attachments?: AttachmentService;
  organization?: { id: string; name: string };
  currentPrincipal?: PrincipalSummary;
  standInPrincipal?: PrincipalSummary;
  project?: Project;
  pilotStore?: PilotStore;
  projectWorkStore?: PostgresProjectWorkStore;
  pilotIdentities?: PrincipalSummary[];
  deploymentProbe?: (baseUrl: string) => Promise<boolean>;
  providerEncryptionSecret?: string;
  pilotAuthorization?: AuthorizationPort;
  pilotRealtime?: RealtimePort;
  pilotObjectStore?: ObjectStorePort;
  pilotCoordination?: CoordinationTransport;
  pilotModelGateway?: ModelGateway;
  pilotJobs?: JobRunnerPort<PilotStandInJob>;
  readinessDependencies?: ReadinessDependency[];
  metrics?: PrivacySafeMetrics | false;
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
  const metrics =
    options.metrics === false
      ? undefined
      : (options.metrics ?? new PrivacySafeMetrics());
  const requestStartedAt = new WeakMap<object, number>();
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
  const standInPrincipal = options.standInPrincipal ?? {
    id: "019b5ac0-7600-7000-8000-000000000003" as PrincipalId,
    displayName: "Intero Stand-in",
    kind: "stand_in" as const,
  };
  const pilotIdentities = options.pilotIdentities ?? [
    currentPrincipal,
    {
      id: "019b5ac0-7600-7000-8000-000000000004" as PrincipalId,
      displayName: "Morgan Chen",
      kind: "human" as const,
    },
  ];
  const principalDirectory =
    options.principalDirectory ??
    (options.authDatabase
      ? new DatabasePrincipalDirectory(options.authDatabase)
      : new InMemoryPrincipalDirectory(pilotIdentities));
  const requestAuth =
    options.requestAuth ??
    createRequestAuth({
      ...(options.auth ? { auth: options.auth } : {}),
      ...(options.authDatabase ? { database: options.authDatabase } : {}),
      allowDevelopmentIdentity:
        options.allowDevelopmentIdentity ?? process.env.NODE_ENV === "test",
      developmentIdentities: pilotIdentities,
      directory: principalDirectory,
    });
  const informationStore =
    options.informationStore ??
    (options.authDatabase
      ? new PostgresInformationStore(
          options.authDatabase,
          organization.id as ConstructorParameters<
            typeof PostgresInformationStore
          >[1],
        )
      : undefined);
  const automationStore =
    options.automationStore ??
    (options.authDatabase
      ? new PostgresAutomationStore(
          options.authDatabase,
          organization.id as ConstructorParameters<
            typeof PostgresAutomationStore
          >[1],
        )
      : undefined);
  const project = options.project ?? {
    id: "019b5ac0-7600-7000-8000-000000000011" as ProjectId,
    name: "Intero",
    projectManagementEnabled: true,
  };
  await store.upsertPrincipal(currentPrincipal);
  await store.upsertPrincipal(standInPrincipal);
  for (const identity of pilotIdentities) {
    await store.upsertPrincipal(identity);
  }
  await store.ensureProject(project);
  const authorization = options.authorization ?? new FailClosedAuthorization();
  const pilotStore = options.pilotStore ?? new InMemoryPilotStore();
  const providerSecretCipher = new AesGcmProviderSecretCipher(
    options.providerEncryptionSecret ??
      process.env.INTERO_PROVIDER_ENCRYPTION_KEY ??
      "intero-development-provider-key",
  );
  const pilotAuthorization =
    options.pilotAuthorization ??
    new MembershipAuthorizationAdapter(pilotStore);
  const pilotRealtime = options.pilotRealtime ?? new PollingRealtimeAdapter();
  const pilotObjectStore =
    options.pilotObjectStore ?? new DisabledObjectStoreAdapter();
  const pilotCoordination =
    options.pilotCoordination ??
    new ProjectInternalCoordinationTransport(pilotStore);
  const rawPilotModelGateway =
    options.pilotModelGateway ??
    new VercelAiModelGateway(
      () => pilotStore.getProviderConfiguration(),
      providerSecretCipher,
    );
  const pilotModelGateway =
    metrics && !(rawPilotModelGateway instanceof InstrumentedModelGateway)
      ? new InstrumentedModelGateway(rawPilotModelGateway, metrics)
      : rawPilotModelGateway;
  const standInJobHandler = new PilotStandInJobHandler(
    pilotStore,
    pilotAuthorization,
    pilotModelGateway,
    pilotCoordination,
    pilotRealtime,
  );
  const pilotJobs =
    options.pilotJobs ??
    new InlineJobRunner((job) => standInJobHandler.handle(job));
  const pilotCheckpointService = new PilotCheckpointService(
    pilotStore,
    pilotJobs,
  );
  app.decorate("interoStore", store);
  await app.register(cors, {
    origin: [
      ...(options.authCorsOrigins ?? []),
      /^http:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+$/,
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  if (metrics) {
    app.addHook("onRequest", async (request) => {
      requestStartedAt.set(request, performance.now());
    });
    app.addHook("onResponse", async (request, reply) => {
      metrics.observeRequest({
        method: request.method,
        route: request.routeOptions.url ?? "unknown",
        statusCode: reply.statusCode,
        durationMs:
          performance.now() -
          (requestStartedAt.get(request) ?? performance.now()),
      });
    });
    app.get("/metrics", async (_request, reply) =>
      reply
        .header("content-type", "text/plain; version=0.0.4; charset=utf-8")
        .send(metrics.renderPrometheus()),
    );
  }
  if (options.auth) mountAuth(app, options.auth, options.authCorsOrigins);

  app.setErrorHandler((error, request, reply) => {
    const normalized =
      error instanceof Error ? error : new Error("Unexpected server error");
    const statusCode =
      normalized instanceof PilotStoreError
        ? normalized.statusCode
        : normalized instanceof ZodError
          ? 400
          : normalized.message.includes("not found")
            ? 404
            : 400;
    reply.status(statusCode).send({
      code:
        normalized instanceof PilotStoreError
          ? normalized.code
          : normalized instanceof ZodError
            ? "INVALID_REQUEST"
            : "DOMAIN_ERROR",
      message: normalized.message,
      requestId: request.id,
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "intero-api",
    version: "0.1.0",
  }));

  app.get("/ready", async (_request, reply) => {
    const readiness = await evaluateReadiness(
      options.readinessDependencies ?? [
        {
          name: "pilot_store",
          critical: true,
          check: async () => ({ status: "ready" }),
        },
      ],
    );
    return reply
      .status(readiness.status === "unavailable" ? 503 : 200)
      .send(readiness);
  });

  app.get("/v1/bootstrap", async (request) => {
    const resolvedPrincipal = await requestAuth.resolve(request, false);
    return {
      organization,
      ...(resolvedPrincipal
        ? {
            currentPrincipal: resolvedPrincipal,
            standInPrincipal: {
              id: personalStandInId(resolvedPrincipal.id),
              displayName: `${resolvedPrincipal.displayName} 的替身`,
              kind: "stand_in" as const,
            },
          }
        : {}),
    };
  });

  await registerPilotRoutes(app, {
    store: pilotStore,
    organizationId: organization.id as Parameters<
      typeof registerPilotRoutes
    >[1]["organizationId"],
    requestAuth,
    principalDirectory,
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.authDatabase ? { authDatabase: options.authDatabase } : {}),
    ...(options.authActivationSecret
      ? { authActivationSecret: options.authActivationSecret }
      : {}),
    ...(options.authPublicUrl ? { authPublicUrl: options.authPublicUrl } : {}),
    ...(informationStore ? { informationStore } : {}),
    ...(automationStore ? { automationStore } : {}),
    standIn: standInPrincipal,
    providerSecretCipher,
    checkpointService: pilotCheckpointService,
    coordination: pilotCoordination,
    modelGateway: pilotModelGateway,
    adapters: {
      realtime:
        pilotRealtime instanceof PollingRealtimeAdapter
          ? pilotRealtime.mode
          : "polling",
      objectStorage:
        pilotObjectStore instanceof DisabledObjectStoreAdapter
          ? pilotObjectStore.mode
          : "disabled",
      jobs: pilotJobs instanceof InlineJobRunner ? pilotJobs.mode : "inline",
      coordination:
        pilotCoordination instanceof ProjectInternalCoordinationTransport
          ? pilotCoordination.protocol
          : "project-internal-v1",
      projectWork: options.projectWorkStore ? "postgres" : "unavailable",
    },
    ...(options.deploymentProbe
      ? { deploymentProbe: options.deploymentProbe }
      : {}),
  });
  await registerPilotMcpRoutes(app, {
    store: pilotStore,
    checkpointService: pilotCheckpointService,
  });
  if (options.projectWorkStore) {
    await registerProjectWorkRoutes(app, {
      store: options.projectWorkStore,
      pilotStore,
      requestAuth,
    });
  }
  if (automationStore) {
    await registerAutomationRoutes(app, {
      store: automationStore,
      pilotStore,
      requestAuth,
    });
  }

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

  app.get("/v1/kanban", async (request) => {
    const query = parse(
      z.object({
        projectId: z.string().uuid().optional(),
      }),
      request.query,
    );
    const projects = await store.listProjects();
    const selectedProject = query.projectId
      ? projects.find((item) => item.id === query.projectId)
      : projects.find((item) => item.projectManagementEnabled);
    if (query.projectId && !selectedProject) {
      throw new Error("Project was not found.");
    }
    const selectedProjectId = selectedProject?.id as ProjectId | undefined;
    const [cards, workstreams] = await Promise.all([
      store.listKanbanCards(selectedProjectId),
      store.listProjections(),
    ]);
    const principalIds = [
      ...cards.flatMap((card) => (card.ownerId ? [card.ownerId] : [])),
      ...workstreams.map((workstream) => workstream.ownerId),
    ];
    return {
      projects,
      ...(selectedProjectId ? { selectedProjectId } : {}),
      cards,
      workstreams,
      principals: await store.listPrincipals([...new Set(principalIds)]),
    };
  });

  app.post("/v1/kanban/cards", async (request, reply) => {
    const input = parse(CreateKanbanCardRequest, request.body);
    const now = new Date().toISOString();
    return reply.status(201).send(
      await store.createKanbanCard({
        ...input,
        createdAt: now,
        updatedAt: now,
      } as KanbanCard),
    );
  });

  app.patch<{ Params: { cardId: string } }>(
    "/v1/kanban/cards/:cardId",
    async (request, reply) => {
      const input = parse(UpdateKanbanCardRequest, request.body);
      return reply.send(
        await store.updateKanbanCard(
          request.params.cardId as KanbanCardId,
          input as KanbanCardUpdate,
        ),
      );
    },
  );

  app.post("/v1/capability-grants", async (request, reply) => {
    const grant = parse(CreateCapabilityGrantRequest, request.body);
    return reply.status(201).send(await store.putGrant(grant));
  });

  app.post("/v1/coordination", async (request) => {
    const { envelope } = parse(CoordinateRequest, request.body);
    return { result: await store.coordinate(envelope) };
  });

  app.get("/v1/action-inbox", async (request) => {
    const principal = await requestAuth.resolve(request);
    const includeDismissed =
      (request.query as { includeDismissed?: string }).includeDismissed ===
      "true";
    const items = informationStore
      ? await informationStore.listAttention(principal!.id, includeDismissed)
      : await store.listInbox(principal!.id);
    const preferences = informationStore
      ? await informationStore.getPreferences(principal!.id)
      : {
          principalId: principal!.id,
          mutedKinds: [],
          updatedAt: new Date(0).toISOString(),
        };
    const muteActive =
      preferences.muteUntil && preferences.muteUntil > new Date().toISOString();
    const unreadCount = items.filter(
      (item) =>
        !item.readAt &&
        !item.dismissedAt &&
        !muteActive &&
        !preferences.mutedKinds.includes(item.kind),
    ).length;
    const automationSummary = automationStore
      ? await automationStore.summarizeForPrincipal(principal!.id)
      : [];
    return { items, preferences, unreadCount, automationSummary };
  });

  app.patch<{ Params: { itemId: string } }>(
    "/v1/action-inbox/:itemId",
    async (request) => {
      if (!informationStore)
        throw new PilotStoreError(
          "ATTENTION_STORE_UNAVAILABLE",
          503,
          "Action Inbox persistence is unavailable.",
        );
      const principal = await requestAuth.resolve(request);
      const input = parse(
        z
          .object({
            action: z.enum(["read", "unread", "dismiss", "restore", "resolve"]),
          })
          .strict(),
        request.body,
      );
      return {
        item: await informationStore.updateAttention(
          principal!.id,
          request.params.itemId,
          input.action,
        ),
      };
    },
  );

  app.get("/v1/notification-preferences", async (request) => {
    if (!informationStore)
      throw new PilotStoreError(
        "ATTENTION_STORE_UNAVAILABLE",
        503,
        "Notification preferences are unavailable.",
      );
    const principal = await requestAuth.resolve(request);
    return {
      preferences: await informationStore.getPreferences(principal!.id),
    };
  });

  app.put("/v1/notification-preferences", async (request) => {
    if (!informationStore)
      throw new PilotStoreError(
        "ATTENTION_STORE_UNAVAILABLE",
        503,
        "Notification preferences are unavailable.",
      );
    const principal = await requestAuth.resolve(request);
    const input = parse(
      z
        .object({
          mutedKinds: z.array(
            z.enum([
              "human_decision",
              "scope_expansion",
              "consequential_commitment",
              "high_impact_contradiction",
              "review_request",
              "imminent_blocker",
            ]),
          ),
          muteUntil: z.iso.datetime().optional(),
        })
        .strict(),
      request.body,
    );
    return {
      preferences: await informationStore.setPreferences(principal!.id, {
        mutedKinds: input.mutedKinds,
        ...(input.muteUntil ? { muteUntil: input.muteUntil } : {}),
      }),
    };
  });

  app.get("/v1/search", async (request) => {
    if (!informationStore)
      throw new PilotStoreError(
        "SEARCH_UNAVAILABLE",
        503,
        "Authorized search requires PostgreSQL persistence.",
      );
    const principal = await requestAuth.resolve(request);
    const input = parse(
      z.object({
        q: z.string().trim().min(2).max(200),
        projectId: z.string().uuid().optional(),
        types: z.string().max(300).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }),
      request.query,
    );
    const allowedTypes = [
      "work_item",
      "spec",
      "spec_version",
      "comment",
      "code_reference",
      "coordination",
      "stand_in_activity",
    ] as const;
    const requestedTypes = input.types
      ?.split(",")
      .filter((type): type is (typeof allowedTypes)[number] =>
        allowedTypes.includes(type as (typeof allowedTypes)[number]),
      );
    return {
      items: await informationStore.search(principal!.id, {
        query: input.q,
        ...(input.projectId ? { projectId: input.projectId as ProjectId } : {}),
        ...(requestedTypes?.length ? { types: requestedTypes } : {}),
        limit: input.limit,
      }),
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
    const viewer = await requestAuth.resolve(request, false);
    const reads = viewer
      ? new Map(
          (await store.listThreadReads(viewer.id)).map((entry) => [
            entry.threadId as string,
            entry.lastReadSequence,
          ]),
        )
      : undefined;
    return {
      items: await Promise.all(
        items.map((item) =>
          presentThread(store, item, reads, viewer?.id as PrincipalId),
        ),
      ),
    };
  });

  app.post<{ Params: { threadId: string } }>(
    "/v1/threads/:threadId/read",
    async (request, reply) => {
      const input = parse(MarkThreadReadRequest, request.body);
      await store.markThreadRead(
        request.params.threadId as ThreadId,
        input.principalId as PrincipalId,
        input.sequence,
      );
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { threadId: string } }>(
    "/v1/threads/:threadId/conclusion",
    async (request, reply) => {
      const input = parse(ConcludeThreadRequest, request.body);
      try {
        const result = await store.concludeThreadIntoParent({
          threadId: request.params.threadId as ThreadId,
          actorId: input.actorId as PrincipalId,
          conclusion: input.conclusion,
          messageId: input.messageId as Parameters<
            PlatformStore["appendMessage"]
          >[1]["id"],
          at: input.createdAt,
        });
        return reply.status(201).send(result);
      } catch (error) {
        return reply.status(409).send({
          error: {
            code: "thread_not_concludable",
            message:
              error instanceof Error
                ? error.message
                : "The Thread could not be concluded.",
          },
        });
      }
    },
  );

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
    "/v1/threads/:threadId/stand-ins",
    async (request, reply) => {
      const input = parse(AddStandInRequest, request.body);
      return reply
        .status(201)
        .send(
          await store.addStandInToThread(
            request.params.threadId as ThreadId,
            input.standInId as PrincipalId,
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

  /**
   * Governance audit: who changed whose role, and who invited or removed whom.
   *
   * These are read off the same activity events the mutations already emit, so
   * there is no second trail to keep in sync. Only membership and invitation
   * events are exposed — never checkpoints, prompts or file contents.
   */
  app.get("/v1/governance-audit", async () => {
    const events = await store.listActivity();
    const entries = events
      .filter((event) => GOVERNANCE_EVENT_TYPES.has(event.eventType))
      .slice(0, 100)
      .map((event) => {
        const detail = Object.fromEntries(
          Object.entries(event.metadata)
            .filter(
              ([key]) => key.startsWith("audit.") && key !== "audit.subjectId",
            )
            .map(([key, value]) => [key.slice("audit.".length), value]),
        );
        const subjectId = event.metadata["audit.subjectId"];
        return {
          id: event.operationId,
          eventType: event.eventType,
          actorId: event.actorId,
          ...(typeof subjectId === "string" ? { subjectId } : {}),
          aggregateId: event.aggregateId,
          detail,
          occurredAt: event.occurredAt,
        };
      });
    const principalIds = [
      ...new Set(
        entries.flatMap((entry) =>
          [entry.actorId, entry.subjectId].filter(
            (id): id is string => id !== undefined,
          ),
        ),
      ),
    ];
    return {
      entries,
      principals: await store.listPrincipals(principalIds as PrincipalId[]),
    };
  });

  return app;
}

async function presentThread(
  store: PlatformStore,
  item: Awaited<ReturnType<PlatformStore["getThread"]>> & {},
  reads?: Map<string, number>,
  viewerId?: PrincipalId,
) {
  const operationIds = item.messages
    .map((message) => message.operationId)
    .filter((id): id is OperationId => id !== undefined);
  // Unread is what arrived after your marker that you did not send yourself.
  const lastRead = reads?.get(item.thread.id) ?? 0;
  const unreadCount = viewerId
    ? item.messages.filter(
        (message) =>
          message.sequence > lastRead && message.senderId !== viewerId,
      ).length
    : 0;
  return {
    ...item,
    unreadCount,
    lastReadSequence: lastRead,
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
