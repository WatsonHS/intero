import {
  containsForbiddenEventField,
  PilotCheckpointEventType,
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
    const checkpoint = lifecycleCheckpoint(binding, input, now);
    const result = await options.checkpointService.submit(
      binding,
      checkpoint,
      now,
    );
    return reply.status(202).send({
      accepted: result.accepted,
      duplicate: result.duplicate,
      published: result.published,
      workStateId: result.workState.id,
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
    "intero.validate_connection",
    {
      description:
        "Complete Intero setup verification for this Agent and Project after the native MCP connection initializes.",
      inputSchema: {
        verificationCode: z.string().min(20).max(120).optional(),
      },
    },
    async ({ verificationCode }) => {
      const binding =
        initialBinding.validatedAt !== undefined
          ? initialBinding
          : await options.store.validateAgentBinding(
              initialBinding.id,
              initialBinding.ownerId,
              verificationCode,
              new Date().toISOString(),
            );
      return toolResult({
        status: "connected",
        bindingId: binding.id,
        projectId: binding.projectId,
        ownerId: binding.ownerId,
        client: binding.client,
        name: binding.name,
        workspaceId: binding.workspaceId,
        mcpInitializedAt: binding.mcpInitializedAt,
        validatedAt: binding.validatedAt,
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
      return toolResult({
        status: binding.validatedAt
          ? "connected"
          : binding.mcpInitializedAt
            ? "mcp_initialized"
            : "awaiting_initialization",
        bindingId: binding.id,
        projectId: binding.projectId,
        ownerId: binding.ownerId,
        client: binding.client,
        name: binding.name,
        workspaceId: binding.workspaceId,
        preferredLanguage: binding.preferredLanguage,
        mcpInitializedAt: binding.mcpInitializedAt,
        validatedAt: binding.validatedAt,
        lastSeenAt: binding.lastSeenAt,
      });
    },
  );

  server.registerTool(
    "stand_in.report_checkpoint",
    {
      description:
        initialBinding.preferredLanguage === "zh-CN"
          ? "向当前项目的私有 Work State 上报结构化语义检查点；禁止包含原始 prompt、文件、diff、终端或工具日志。"
          : "Report a structured semantic checkpoint to this Project's private Work State; never include raw prompts, files, diffs, terminal output, or tool logs.",
      inputSchema: {
        eventType: PilotCheckpointEventType,
        narrative: PilotWorkNarrative,
        evidenceRefs: z.array(z.string().max(200)).max(10).optional(),
        clientEventId: z.string().min(8).max(200).optional(),
        workstreamKey: z.string().min(1).max(160).optional(),
        workstreamTitle: z.string().min(1).max(160).optional(),
        phase: WorkstreamPhase.optional(),
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
        workStateId: result.workState.id,
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

function lifecycleCheckpoint(
  binding: PilotAgentBinding,
  input: z.infer<typeof lifecycleInput>,
  now: string,
): PilotCheckpointInput {
  const chinese = binding.preferredLanguage === "zh-CN";
  const ended = input.lifecycle === "session_ended";
  return {
    schemaVersion: 2,
    clientEventId: input.clientEventId,
    projectId: binding.projectId,
    occurredAt: input.occurredAt ?? now,
    eventType: ended ? "work_progressed" : "work_started",
    workstream: {
      key: input.workstreamKey,
      title: input.workstreamTitle,
      phase: "implementing",
    },
    narrative: {
      currentFocus: ended
        ? chinese
          ? "Coding Agent 会话已结束，等待下一次语义工作更新。"
          : "The Coding Agent session ended and is waiting for the next semantic work update."
        : chinese
          ? "Coding Agent 已开始当前项目的工作会话。"
          : "The Coding Agent started a work session for this Project.",
      completedOutcome: ended
        ? chinese
          ? "会话生命周期已安全记录；实际成果以语义检查点为准。"
          : "The session lifecycle was recorded safely; semantic checkpoints remain the source of actual outcomes."
        : chinese
          ? "当前项目工作上下文已建立。"
          : "The Project work context is established.",
      evidence: [],
      nextStep: chinese
        ? "在进展、产出、验证、阻塞或依赖发生时上报语义检查点。"
        : "Report a semantic checkpoint for progress, outcomes, validation, blockers, or dependencies.",
      collaboration: { needed: false, request: "", requestedFrom: "" },
    },
    evidenceRefs: input.evidenceRefs ?? [],
  };
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
