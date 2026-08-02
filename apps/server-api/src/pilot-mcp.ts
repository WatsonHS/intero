import {
  containsForbiddenEventField,
  PILOT_AGENT_CONFIGURATION_VERSION,
  PilotCheckpointEventType,
  PilotSharedBoundaryInput,
  PilotWorkNarrative,
  WorkstreamPhase,
  type PilotAgentBinding,
  type PilotCheckpointInput,
} from "@intero/domain";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import type { PilotCheckpointService } from "./pilot-service.js";
import type { PilotStore } from "./pilot-store.js";
import { PilotStoreError } from "./pilot-store.js";

export interface PilotMcpRoutesOptions {
  store: PilotStore;
  checkpointService: PilotCheckpointService;
}

const lifecycleInput = z
  .object({
    clientEventId: z.string().min(8).max(200),
    lifecycle: z.enum(["session_started", "session_ended"]),
    occurredAt: z.iso.datetime().optional(),
    workstreamKey: z.string().min(1).max(160),
    workstreamTitle: z.string().min(1).max(160),
    evidenceRefs: z.array(z.string().min(1).max(200)).max(10).optional(),
  })
  .strict();

const initializeRequest = z
  .object({
    method: z.literal("initialize"),
    params: z
      .object({
        protocolVersion: z.string().min(1).max(80),
        clientInfo: z
          .object({
            name: z.string().min(1).max(120),
            version: z.string().min(1).max(80),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export async function registerPilotMcpRoutes(
  app: FastifyInstance,
  options: PilotMcpRoutesOptions,
): Promise<void> {
  app.post<{
    Params: { projectId: string; bindingId: string };
  }>(
    "/v1/pilot/projects/:projectId/agent-connections/:bindingId/mcp",
    async (request, reply) =>
      handleMcpRequest(request, reply, undefined, options),
  );

  app.post("/v1/pilot/mcp", async (request, reply) => {
    const binding = await findActiveAgentBinding(request, options.store);
    return handleMcpRequest(request, reply, binding, options);
  });

  app.get("/v1/pilot/mcp", async (_request, reply) =>
    reply.status(405).send({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    }),
  );

  app.delete("/v1/pilot/mcp", async (_request, reply) =>
    reply.status(405).send({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    }),
  );

  app.post("/v1/pilot/agent/hooks", async (request, reply) => {
    const binding = await requireValidatedAgentBinding(request, options.store);
    const input = lifecycleInput.parse(request.body);
    const now = new Date().toISOString();
    const updated = await options.store.recordAgentLifecycle(
      binding.id,
      binding.ownerId,
      {
        lifecycle: input.lifecycle,
        occurredAt: input.occurredAt ?? now,
        receivedAt: now,
      },
    );
    return reply.status(202).send({
      accepted: true,
      duplicate: false,
      published: false,
      activity: {
        status: updated.activityStatus,
        updatedAt: updated.activityUpdatedAt,
      },
    });
  });
}

async function handleMcpRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  binding: PilotAgentBinding | undefined,
  options: PilotMcpRoutesOptions,
): Promise<void> {
  const initialization = initializeRequest.safeParse(request.body);
  ensureDestroySoon(request.raw.socket);
  const server = binding
    ? createPilotMcpServer(binding, options)
    : createUnavailablePilotMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  } as unknown as StreamableHTTPServerTransportOptions);
  await server.connect(transport as unknown as Transport);
  reply.hijack();
  try {
    await transport.handleRequest(request.raw, reply.raw, request.body);
    if (binding && initialization.success) {
      await options.store.initializeAgentBinding(
        binding.id,
        binding.ownerId,
        {
          name: initialization.data.params.clientInfo.name,
          version: initialization.data.params.clientInfo.version,
          protocolVersion: initialization.data.params.protocolVersion,
        },
        new Date().toISOString(),
      );
    }
  } catch {
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(500, { "content-type": "application/json" });
      reply.raw.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "MCP request failed." },
          id: null,
        }),
      );
    }
  } finally {
    await transport.close();
    await server.close();
  }
}

function ensureDestroySoon(
  socket: FastifyRequest["raw"]["socket"] & {
    destroy?: () => void;
    destroySoon?: () => void;
  },
): void {
  if (typeof socket.destroySoon === "function") return;
  socket.destroySoon = () => {
    if (typeof socket.destroy === "function") socket.destroy();
  };
}

function createPilotMcpServer(
  initialBinding: PilotAgentBinding,
  options: PilotMcpRoutesOptions,
): McpServer {
  const server = new McpServer({
    name: "intero-project-cloud",
    version: "0.2.0",
  });

  server.registerTool(
    "intero.connection_status",
    {
      description:
        "Return the current Intero connection state for this Agent and Project.",
      inputSchema: {},
    },
    async () => {
      const binding = await options.store.findAgentBindingById(
        initialBinding.id,
      );
      if (!binding) {
        return toolResult({
          status: "disconnected",
          connected: false,
          action:
            "Reconnect this repository from the Intero Project connection center.",
        });
      }
      const state = agentConnectionState(binding);
      return toolResult({
        ...state,
        mcpConnected: Boolean(binding.validatedAt),
        lifecycleReady: Boolean(binding.activityUpdatedAt),
        configurationVersion: binding.configurationVersion,
        requiredConfigurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
        configurationUpdatedAt: binding.configurationUpdatedAt,
        bindingId: binding.id,
        projectId: binding.projectId,
        client: binding.client,
        name: binding.name,
        workspaceId: binding.workspaceId,
        mcpInitializedAt: binding.mcpInitializedAt,
        validatedAt: binding.validatedAt,
        activityStatus: binding.activityStatus,
        activityUpdatedAt: binding.activityUpdatedAt,
        action: agentConnectionAction(state.status),
      });
    },
  );

  server.registerTool(
    "intero.validate_connection",
    {
      description:
        "Complete Intero setup verification for this Agent and Project after the native MCP connection initializes.",
      inputSchema: {
        verificationCode: z.string().min(20).max(120).optional(),
        configurationVersion: z
          .number()
          .int()
          .positive()
          .max(10_000)
          .optional(),
      },
    },
    async ({ verificationCode, configurationVersion }) => {
      const binding = await options.store.validateAgentBinding(
        initialBinding.id,
        initialBinding.ownerId,
        verificationCode,
        new Date().toISOString(),
        configurationVersion,
      );
      const state = agentConnectionState(binding);
      return toolResult({
        ...state,
        mcpConnected: true,
        lifecycleReady: Boolean(binding.activityUpdatedAt),
        configurationVersion: binding.configurationVersion,
        requiredConfigurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
        configurationUpdatedAt: binding.configurationUpdatedAt,
        bindingId: binding.id,
        projectId: binding.projectId,
        ownerId: binding.ownerId,
        client: binding.client,
        name: binding.name,
        workspaceId: binding.workspaceId,
        mcpInitializedAt: binding.mcpInitializedAt,
        validatedAt: binding.validatedAt,
        activityStatus: binding.activityStatus,
        activityUpdatedAt: binding.activityUpdatedAt,
        action: agentConnectionAction(state.status),
      });
    },
  );

  server.registerTool(
    "stand_in.current_context",
    {
      description:
        "Show the authenticated, Project-scoped Intero connection without exposing credentials.",
      inputSchema: {},
    },
    async () => {
      const binding =
        (await options.store.findAgentBindingById(initialBinding.id)) ??
        initialBinding;
      const state = agentConnectionState(binding);
      const confirmedCoordination = (
        await options.store.listCoordination(binding.projectId, binding.ownerId)
      )
        .filter((thread) => thread.status === "resolved" && thread.decisionId)
        .map((thread) => ({
          coordinationThreadId: thread.id,
          decisionId: thread.decisionId,
          scopeKind: thread.scopeKind ?? "single_project",
          projectIds: thread.projectIds ?? [thread.projectId],
          boundaryKey: thread.boundaryKey,
          conclusion: thread.conclusion,
          confirmedAt: thread.confirmedAt,
          humanDecision: thread.brief?.humanDecision,
        }));
      return toolResult({
        ...state,
        mcpConnected: Boolean(binding.validatedAt),
        lifecycleReady: Boolean(binding.activityUpdatedAt),
        configurationVersion: binding.configurationVersion,
        requiredConfigurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
        configurationUpdatedAt: binding.configurationUpdatedAt,
        bindingId: binding.id,
        projectId: binding.projectId,
        ownerId: binding.ownerId,
        client: binding.client,
        name: binding.name,
        workspaceId: binding.workspaceId,
        preferredLanguage: binding.preferredLanguage,
        mcpInitializedAt: binding.mcpInitializedAt,
        validatedAt: binding.validatedAt,
        activityStatus: binding.activityStatus,
        activityUpdatedAt: binding.activityUpdatedAt,
        lastSeenAt: binding.lastSeenAt,
        confirmedCoordination,
      });
    },
  );

  server.registerTool(
    "stand_in.report_checkpoint",
    {
      description:
        initialBinding.preferredLanguage === "zh-CN"
          ? "向当前项目的私有 Work State 上报结构化语义检查点。sharedBoundaries 是显式的项目可见边界声明，只能使用短语义标识；禁止包含原始 prompt、文件、diff、终端、工具日志或秘密。"
          : "Report a structured semantic checkpoint to this Project's private Work State. sharedBoundaries are explicit Project-visible boundary claims and must use short semantic identifiers; never include raw prompts, files, diffs, terminal output, tool logs, or secrets.",
      inputSchema: {
        eventType: PilotCheckpointEventType,
        narrative: PilotWorkNarrative,
        evidenceRefs: z.array(z.string().max(200)).max(10).optional(),
        clientEventId: z.string().min(8).max(200).optional(),
        workstreamKey: z.string().min(1).max(160).optional(),
        workstreamTitle: z.string().min(1).max(160).optional(),
        phase: WorkstreamPhase.optional(),
        sharedBoundaries: z.array(PilotSharedBoundaryInput).max(12).optional(),
      },
    },
    async (input) => {
      const binding = await requireValidatedBinding(
        initialBinding,
        options.store,
      );
      if (containsForbiddenEventField(input)) {
        throw new PilotStoreError(
          "RAW_CONTENT_FORBIDDEN",
          400,
          "Structured checkpoints cannot contain raw content or secrets.",
        );
      }
      if (
        (input.eventType === "dependency_declared" ||
          input.narrative.collaboration.needed) &&
        !input.narrative.collaboration.targetPrincipalId
      ) {
        throw new PilotStoreError(
          "COLLABORATION_TARGET_REQUIRED",
          400,
          "Routed collaboration requires a structured targetPrincipalId.",
        );
      }
      const now = new Date().toISOString();
      const checkpoint: PilotCheckpointInput = {
        schemaVersion: 2,
        clientEventId: input.clientEventId ?? randomUUID(),
        projectId: binding.projectId,
        occurredAt: now,
        eventType: input.eventType,
        workstream: {
          key: input.workstreamKey ?? "coding-agent",
          title:
            input.workstreamTitle ??
            (binding.preferredLanguage === "zh-CN"
              ? "Coding Agent 工作"
              : "Coding Agent work"),
          phase: input.phase ?? phaseForEvent(input.eventType),
        },
        narrative: input.narrative,
        evidenceRefs: input.evidenceRefs ?? [],
        sharedBoundaries: input.sharedBoundaries ?? [],
      };
      const result = await options.checkpointService.submit(
        binding,
        checkpoint,
        now,
      );
      return toolResult({
        accepted: result.accepted,
        duplicate: result.duplicate,
        published: result.published,
        standIn: result.standIn,
        status: result.standInJob.status,
        terminal: isTerminalCheckpointStatus(result.standInJob.status),
        workStateId: result.workState.id,
        statusTool: "stand_in.checkpoint_status",
      });
    },
  );

  server.registerTool(
    "stand_in.checkpoint_status",
    {
      description:
        initialBinding.preferredLanguage === "zh-CN"
          ? "查询当前连接所提交检查点的异步处理终态、重试与失败原因。"
          : "Read the asynchronous terminal state, retry state, or failure reason for a checkpoint submitted by this connection.",
      inputSchema: {
        workStateId: z.uuid(),
      },
    },
    async ({ workStateId }) => {
      const binding = await requireValidatedBinding(
        initialBinding,
        options.store,
      );
      const result = await options.store.getIngestResult(workStateId);
      if (
        result.workState.bindingId !== binding.id ||
        result.workState.projectId !== binding.projectId
      ) {
        throw new PilotStoreError(
          "CHECKPOINT_NOT_FOUND",
          404,
          "Checkpoint was not found for this Agent connection.",
        );
      }
      const job = result.standInJob;
      return toolResult({
        workStateId,
        status: job.status,
        terminal: isTerminalCheckpointStatus(job.status),
        published: result.published,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        queuedAt: job.queuedAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        nextAttemptAt: job.nextAttemptAt,
        lastErrorCode: job.lastErrorCode,
        deadLetteredAt: job.deadLetteredAt,
        pulseEntryId: result.pulseEntry?.id,
        coordinationThreadId: result.coordinationThread?.id,
        action: checkpointStatusAction(
          job.status,
          job.nextAttemptAt,
          job.lastErrorCode,
        ),
      });
    },
  );

  return server;
}

function createUnavailablePilotMcpServer(): McpServer {
  const server = new McpServer({
    name: "intero-project-cloud",
    version: "0.2.0",
  });

  server.registerTool(
    "intero.connection_status",
    {
      description:
        "Report that this local Intero connection is unavailable and needs to be reconnected.",
      inputSchema: {},
    },
    async () =>
      toolResult({
        status: "disconnected",
        connected: false,
        action:
          "Reconnect this repository from the Intero Project connection center.",
      }),
  );

  return server;
}

async function requireValidatedBinding(
  binding: PilotAgentBinding,
  store: PilotStore,
): Promise<PilotAgentBinding> {
  const current = await store.findAgentBindingById(binding.id);
  if (!current?.validatedAt) {
    throw new PilotStoreError(
      "AGENT_VALIDATION_REQUIRED",
      409,
      "Call intero.validate_connection before using Project tools.",
    );
  }
  return current;
}

function isTerminalCheckpointStatus(status: string): boolean {
  return status === "published" || status === "private" || status === "failed";
}

type AgentConnectionStatus =
  | "awaiting_initialization"
  | "mcp_initialized"
  | "lifecycle_pending"
  | "configuration_outdated"
  | "connected";

function agentConnectionState(binding: PilotAgentBinding): {
  status: AgentConnectionStatus;
  connected: boolean;
  ready: boolean;
  configurationCurrent: boolean;
} {
  const connected = Boolean(binding.validatedAt && binding.activityUpdatedAt);
  const configurationCurrent =
    binding.configurationVersion === PILOT_AGENT_CONFIGURATION_VERSION;
  const status: AgentConnectionStatus = !binding.validatedAt
    ? binding.mcpInitializedAt
      ? "mcp_initialized"
      : "awaiting_initialization"
    : !binding.activityUpdatedAt
      ? "lifecycle_pending"
      : !configurationCurrent
        ? "configuration_outdated"
        : "connected";
  return {
    status,
    connected,
    ready: connected && configurationCurrent,
    configurationCurrent,
  };
}

function agentConnectionAction(status: AgentConnectionStatus): string {
  if (status === "connected") return "Use Project-scoped Intero tools.";
  if (status === "configuration_outdated") {
    return `Run the Project connection repair task from Intero settings, then call intero.validate_connection with configurationVersion ${PILOT_AGENT_CONFIGURATION_VERSION}.`;
  }
  if (status === "lifecycle_pending") {
    return "Complete the Codex Hook review, then start a fresh GUI task in this repository and call intero.connection_status again.";
  }
  return "Call intero.validate_connection with the temporary verification code and the setup configurationVersion.";
}

function checkpointStatusAction(
  status: string,
  nextAttemptAt?: string,
  lastErrorCode?: string,
): string {
  if (status === "published") {
    return "Checkpoint processing completed and its safe projection is visible in Team Pulse.";
  }
  if (status === "private") {
    return "Checkpoint processing completed and remains private under the current Project posture or policy.";
  }
  if (status === "failed") {
    return `Checkpoint processing failed (${lastErrorCode ?? "STAND_IN_JOB_FAILED"}). Address the cause, then submit a new checkpoint with a new clientEventId.`;
  }
  if (status === "retrying") {
    return nextAttemptAt
      ? `A retry is scheduled for ${nextAttemptAt}; call stand_in.checkpoint_status again afterward.`
      : "A retry is scheduled; call stand_in.checkpoint_status again after a short delay.";
  }
  return "Processing is still in progress; call stand_in.checkpoint_status again after a short delay.";
}

async function requireValidatedAgentBinding(
  request: FastifyRequest,
  store: PilotStore,
): Promise<PilotAgentBinding> {
  const binding = await requireAgentBinding(request, store);
  return requireValidatedBinding(binding, store);
}

async function requireAgentBinding(
  request: FastifyRequest,
  store: PilotStore,
): Promise<PilotAgentBinding> {
  const binding = await findActiveAgentBinding(request, store);
  if (!binding) {
    throw new PilotStoreError(
      "AGENT_AUTHENTICATION_REQUIRED",
      401,
      "A valid Agent credential is required.",
    );
  }
  return binding;
}

async function findActiveAgentBinding(
  request: FastifyRequest,
  store: PilotStore,
): Promise<PilotAgentBinding | undefined> {
  const authorization = request.headers.authorization;
  const credential = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : undefined;
  return credential
    ? await store.findBindingByCredentialHash(sha256(credential))
    : undefined;
}

function phaseForEvent(
  eventType: z.infer<typeof PilotCheckpointEventType>,
): z.infer<typeof WorkstreamPhase> {
  if (eventType === "validation_completed") return "validating";
  if (eventType === "work_completed") return "completed";
  if (eventType === "blocker_raised") return "blocked";
  return "implementing";
}

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
