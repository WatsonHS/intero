import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  PilotAgentClient,
  PilotCheckpointEventType,
  PilotSharedBoundaryInput,
  PilotWorkNarrative,
  PrincipalId,
  WorkstreamPhase,
} from "@intero/domain";
import {
  applyManagedInstall,
  diagnoseManagedInstall,
  integrationVersionIsSupported,
  integrationAdapters,
  managedIntegrationHasState,
  uninstallManagedIntegration,
} from "@intero/integrations";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

import { CloudPilotClient } from "./cloud-client.js";
import { runHook } from "./hook.js";

const hookSource = argumentValue("--hook-source");
const managementMode =
  process.argv.includes("integration") ||
  process.argv.includes("--integration");
const cloudCommand = process.argv[2] === "cloud";
if (
  hookSource === "codex" ||
  hookSource === "claude-code" ||
  hookSource === "opencode"
) {
  await runHook(hookSource);
} else if (managementMode) {
  await runIntegrationManagement();
} else if (cloudCommand) {
  await runCloudCommand();
} else {
  await runMcpServer();
}

async function runMcpServer() {
  const mcpSource = argumentValue("--mcp-source");
  if (
    mcpSource !== "codex" &&
    mcpSource !== "claude-code" &&
    mcpSource !== "opencode" &&
    mcpSource !== "grok-build" &&
    mcpSource !== "cursor"
  ) {
    throw new Error("A supported --mcp-source is required.");
  }
  // Direct cloud MCP is the only runtime. `--cloud` is an explicit managed
  // configuration marker; connection state is loaded from the cloud client.
  await runCloudMcpServer(mcpSource);
}

async function runCloudMcpServer(
  mcpSource: "codex" | "claude-code" | "opencode" | "grok-build" | "cursor",
) {
  const configDirectory = argumentValue("--cloud-data-dir");
  const client = CloudPilotClient.load({
    client: mcpSource,
    cwd: process.cwd(),
    ...(configDirectory ? { configDirectory } : {}),
  });
  const preferredLanguage = client.context().preferredLanguage;
  const server = new McpServer({ name: "intero-cloud", version: "0.1.0" });
  server.registerTool(
    "stand_in.current_context",
    {
      description:
        "Show the authenticated Project-scoped connection and human-confirmed coordination available to this Coding Agent.",
      inputSchema: {},
    },
    async () => result(await client.currentContext()),
  );
  server.registerTool(
    "stand_in.report_checkpoint",
    {
      description:
        preferredLanguage === "zh-CN"
          ? "向私有 Work State（策略允许时也向 Team Pulse）上报人类可读的结构化工作动态。sharedBoundaries 是显式的项目可见边界声明，只能使用短语义标识，不得包含 prompt、文件、diff、日志或秘密。所有 narrative 字段、协作请求和人类可读 evidence 必须使用所有者首选语言 zh-CN。dependency_declared 或需要定向协作时，必须提供当前项目成员的 collaboration.targetPrincipalId；requestedFrom 仅用于展示。"
          : "Report a human-readable structured work update to private Work State and, when policy permits, Team Pulse. sharedBoundaries are explicit Project-visible boundary claims and must use short semantic identifiers without prompts, files, diffs, logs, or secrets. Write all narrative fields, collaboration requests, and human-readable evidence in the owner's preferred language, en-US. For dependency_declared or routed collaboration, provide the current Project member's collaboration.targetPrincipalId; requestedFrom is display text only.",
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
    async (input) => result(await client.reportCheckpoint(input)),
  );
  const mutationId = z.string().min(8).max(200);
  const specSourceReferences = z
    .array(z.string().regex(/^block:block_[a-zA-Z0-9_-]{8,80}$/))
    .min(1)
    .max(50);
  server.registerTool(
    "project.create_epic",
    {
      description:
        "Create a Project roadmap Epic. Epics never appear as execution-board cards.",
      inputSchema: {
        title: z.string().min(1).max(240),
        description: z.string().max(8_000).optional(),
      },
    },
    async (body) =>
      result(
        await client.projectRequest({
          path: "/epics",
          method: "POST",
          body,
        }),
      ),
  );
  server.registerTool(
    "project.update_epic",
    {
      description: "Update roadmap-only Epic content inside the bound Project.",
      inputSchema: {
        epicId: z.string().uuid(),
        title: z.string().min(1).max(240).optional(),
        description: z.string().max(8_000).optional(),
      },
    },
    async ({ epicId, ...body }) =>
      result(
        await client.projectRequest({
          path: `/epics/${epicId}`,
          method: "PATCH",
          body,
        }),
      ),
  );
  server.registerTool(
    "project.list_work",
    {
      description:
        "Read the Project board, Backlog, roadmap, planning windows, relations, code references, comments, and provenance history.",
      inputSchema: {},
    },
    async () => result(await client.projectRequest({ path: "" })),
  );
  server.registerTool(
    "project.create_feature",
    {
      description:
        "Create a Project Feature. For confirmed-Spec derivation, provide specId, sourceSpecRevisionId, exact sourceReferences, and clientMutationId; owner remains a human choice.",
      inputSchema: {
        title: z.string().min(1).max(240),
        description: z.string().max(8_000).optional(),
        stage: z.enum(["planned", "in_development", "released"]).optional(),
        epicId: z.string().uuid().optional(),
        specId: z.string().uuid().optional(),
        sourceSpecRevisionId: z.string().uuid().optional(),
        sourceReferences: specSourceReferences.optional(),
        piId: z.string().uuid().optional(),
        sprintId: z.string().uuid().optional(),
        clientMutationId: mutationId,
      },
    },
    async ({ clientMutationId, ...body }) =>
      result(
        await client.projectRequest({
          path: "/features",
          method: "POST",
          body,
          clientMutationId,
        }),
      ),
  );
  server.registerTool(
    "project.update_feature",
    {
      description:
        "Update one Project Feature without changing team membership or Project visibility. Confirmed-Spec provenance must name the confirmed revision and exact source blocks.",
      inputSchema: {
        featureId: z.string().uuid(),
        title: z.string().min(1).max(240).optional(),
        description: z.string().max(8_000).optional(),
        stage: z.enum(["planned", "in_development", "released"]).optional(),
        epicId: z.string().uuid().nullable().optional(),
        specId: z.string().uuid().nullable().optional(),
        sourceSpecRevisionId: z.string().uuid().nullable().optional(),
        sourceReferences: specSourceReferences.optional(),
        piId: z.string().uuid().nullable().optional(),
        sprintId: z.string().uuid().nullable().optional(),
        clientMutationId: mutationId,
      },
    },
    async ({ featureId, clientMutationId, ...body }) =>
      result(
        await client.projectRequest({
          path: `/features/${featureId}`,
          method: "PATCH",
          body,
          clientMutationId,
        }),
      ),
  );
  server.registerTool(
    "project.revert_feature",
    {
      description:
        "Revert a Feature by creating a new provenance history entry from an earlier snapshot.",
      inputSchema: {
        featureId: z.string().uuid(),
        historyId: z.string().uuid(),
        clientMutationId: mutationId,
      },
    },
    async ({ featureId, historyId, clientMutationId }) =>
      result(
        await client.projectRequest({
          path: `/features/${featureId}/revert`,
          method: "POST",
          body: { historyId },
          clientMutationId,
        }),
      ),
  );
  server.registerTool(
    "project.revoke_feature",
    {
      description:
        "Revoke an Agent-created Feature while retaining its provenance history.",
      inputSchema: { featureId: z.string().uuid() },
    },
    async ({ featureId }) =>
      result(
        await client.projectRequest({
          path: `/features/${featureId}`,
          method: "DELETE",
        }),
      ),
  );
  server.registerTool(
    "project.create_work_item",
    {
      description:
        "Create one Project-scoped Work Item. For confirmed-Spec derivation, provide specId, sourceSpecRevisionId, exact sourceReferences, and clientMutationId; owner and priority remain human choices.",
      inputSchema: {
        title: z.string().min(1).max(240),
        description: z.string().max(16_000).optional(),
        status: z
          .enum(["todo", "in_progress", "ready_for_test", "done"])
          .optional(),
        featureId: z.string().uuid().optional(),
        specId: z.string().uuid().optional(),
        sourceSpecRevisionId: z.string().uuid().optional(),
        sourceReferences: specSourceReferences.optional(),
        points: z.number().nonnegative().optional(),
        piId: z.string().uuid().optional(),
        sprintId: z.string().uuid().optional(),
        completionEvidence: z.string().max(4_000).optional(),
        clientMutationId: mutationId,
      },
    },
    async ({ clientMutationId, ...body }) =>
      result(
        await client.projectRequest({
          path: "/items",
          method: "POST",
          body,
          clientMutationId,
        }),
      ),
  );
  server.registerTool(
    "project.update_work_item",
    {
      description:
        "Update Project work content or confirmed-Spec provenance, or move ready_for_test to done with explicit evidence when available.",
      inputSchema: {
        workItemId: z.string().uuid(),
        title: z.string().min(1).max(240).optional(),
        description: z.string().max(16_000).optional(),
        status: z
          .enum(["todo", "in_progress", "ready_for_test", "done"])
          .optional(),
        featureId: z.string().uuid().nullable().optional(),
        specId: z.string().uuid().nullable().optional(),
        sourceSpecRevisionId: z.string().uuid().nullable().optional(),
        sourceReferences: specSourceReferences.optional(),
        points: z.number().nonnegative().nullable().optional(),
        piId: z.string().uuid().nullable().optional(),
        sprintId: z.string().uuid().nullable().optional(),
        completionEvidence: z.string().max(4_000).optional(),
        clientMutationId: mutationId,
      },
    },
    async ({ workItemId, clientMutationId, ...body }) =>
      result(
        await client.projectRequest({
          path: `/items/${workItemId}`,
          method: "PATCH",
          body,
          clientMutationId,
        }),
      ),
  );
  server.registerTool(
    "project.add_work_relation",
    {
      description:
        "Attach an explicit Project-scoped work relation. Confirmed-Spec-derived relations must include the confirmed revision and exact source blocks.",
      inputSchema: {
        sourceWorkItemId: z.string().uuid(),
        targetWorkItemId: z.string().uuid(),
        kind: z.enum([
          "blocks",
          "blocked_by",
          "related",
          "duplicate",
          "duplicated_by",
        ]),
        specId: z.string().uuid().optional(),
        sourceSpecRevisionId: z.string().uuid().optional(),
        sourceReferences: specSourceReferences.optional(),
        clientMutationId: mutationId,
      },
    },
    async ({ sourceWorkItemId, targetWorkItemId, kind, clientMutationId }) =>
      result(
        await client.projectRequest({
          path: `/items/${sourceWorkItemId}/relations`,
          method: "POST",
          body: { targetId: targetWorkItemId, kind },
          clientMutationId,
        }),
      ),
  );
  server.registerTool(
    "project.add_work_comment",
    {
      description:
        "Add a Work Item comment or reply. Confirmed-Spec-derived comments must include the confirmed revision, exact source blocks, and clientMutationId.",
      inputSchema: {
        workItemId: z.string().uuid(),
        body: z.string().min(1).max(16_000),
        parentId: z.string().uuid().optional(),
        specId: z.string().uuid().optional(),
        sourceSpecRevisionId: z.string().uuid().optional(),
        sourceReferences: specSourceReferences.optional(),
        clientMutationId: mutationId,
      },
    },
    async ({ workItemId, clientMutationId, ...body }) =>
      result(
        await client.projectRequest({
          path: `/items/${workItemId}/comments`,
          method: "POST",
          body,
          clientMutationId,
        }),
      ),
  );
  server.registerTool(
    "project.revoke_work_comment",
    {
      description:
        "Revoke an Agent-created Work Item comment while preserving its audit event.",
      inputSchema: {
        workItemId: z.string().uuid(),
        commentId: z.string().uuid(),
      },
    },
    async ({ workItemId, commentId }) =>
      result(
        await client.projectRequest({
          path: `/items/${workItemId}/comments/${commentId}`,
          method: "DELETE",
        }),
      ),
  );
  server.registerTool(
    "project.revoke_work_relation",
    {
      description:
        "Revoke an Agent-created Project relation while preserving its audit event.",
      inputSchema: {
        sourceWorkItemId: z.string().uuid(),
        targetWorkItemId: z.string().uuid(),
        kind: z.enum([
          "blocks",
          "blocked_by",
          "related",
          "duplicate",
          "duplicated_by",
        ]),
      },
    },
    async ({ sourceWorkItemId, targetWorkItemId, kind }) =>
      result(
        await client.projectRequest({
          path: `/items/${sourceWorkItemId}/relations/${targetWorkItemId}/${kind}`,
          method: "DELETE",
        }),
      ),
  );
  server.registerTool(
    "project.attach_code_reference",
    {
      description:
        "Explicitly attach a PR, Commit, or branch reference. Intero never infers code references.",
      inputSchema: {
        workItemId: z.string().uuid(),
        kind: z.enum(["pull_request", "commit", "branch"]),
        label: z.string().min(1).max(240),
        value: z.string().min(1).max(500),
        url: z.url().optional(),
        repository: z.string().max(240).optional(),
      },
    },
    async ({ workItemId, ...body }) =>
      result(
        await client.projectRequest({
          path: `/items/${workItemId}/code-references`,
          method: "POST",
          body,
        }),
      ),
  );
  server.registerTool(
    "project.revert_work_item",
    {
      description:
        "Revert a Work Item by creating a new provenance history entry from an earlier snapshot.",
      inputSchema: {
        workItemId: z.string().uuid(),
        historyId: z.string().uuid(),
        clientMutationId: mutationId,
      },
    },
    async ({ workItemId, clientMutationId, historyId }) =>
      result(
        await client.projectRequest({
          path: `/items/${workItemId}/revert`,
          method: "POST",
          body: { historyId },
          clientMutationId,
        }),
      ),
  );
  server.registerTool(
    "project.revoke_work_item",
    {
      description:
        "Revoke an Agent-created Work Item while retaining its audit history.",
      inputSchema: { workItemId: z.string().uuid() },
    },
    async ({ workItemId }) =>
      result(
        await client.projectRequest({
          path: `/items/${workItemId}`,
          method: "DELETE",
        }),
      ),
  );
  server.registerTool(
    "spec.create",
    {
      description: "Create an immutable Project Spec version.",
      inputSchema: {
        title: z.string().min(1).max(240),
        markdown: z.string().min(1).max(500_000),
        changeSummary: z.string().max(2_000).optional(),
        affectedScopes: z.array(z.string().max(300)).max(100).optional(),
        clientMutationId: mutationId,
      },
    },
    async ({ clientMutationId, ...body }) =>
      result(
        await client.projectRequest({
          path: "/specs",
          method: "POST",
          body,
          clientMutationId,
        }),
      ),
  );
  server.registerTool(
    "spec.update",
    {
      description:
        "Create the next immutable version without changing the previously confirmed version.",
      inputSchema: {
        specId: z.string().uuid(),
        title: z.string().min(1).max(240),
        markdown: z.string().min(1).max(500_000),
        changeSummary: z.string().max(2_000).optional(),
        affectedScopes: z.array(z.string().max(300)).max(100).optional(),
        clientMutationId: mutationId,
      },
    },
    async ({ specId, clientMutationId, ...body }) =>
      result(
        await client.projectRequest({
          path: `/specs/${specId}/versions`,
          method: "POST",
          body,
          clientMutationId,
        }),
      ),
  );
  server.registerTool(
    "spec.request_review",
    {
      description:
        "Explicitly request review of the current immutable Spec version.",
      inputSchema: {
        specId: z.string().uuid(),
        reviewerIds: z.array(z.string().uuid()).max(20).optional(),
        clientMutationId: mutationId,
      },
    },
    async ({ specId, reviewerIds, clientMutationId }) =>
      result(
        await client.projectRequest({
          path: `/specs/${specId}/request-review`,
          method: "POST",
          body: { reviewerIds: reviewerIds ?? [] },
          clientMutationId,
        }),
      ),
  );
  server.registerTool(
    "spec.list_confirmed",
    {
      description:
        "List the latest confirmed Spec versions available to this Project Agent.",
      inputSchema: {},
    },
    async () =>
      result(await client.projectRequest({ path: "/specs/confirmed" })),
  );
  server.registerTool(
    "spec.get_confirmed",
    {
      description:
        "Get the most recently confirmed version, even when a newer draft exists.",
      inputSchema: { specId: z.string().uuid() },
    },
    async ({ specId }) =>
      result(
        await client.projectRequest({
          path: `/specs/${specId}/confirmed`,
        }),
      ),
  );
  server.registerTool(
    "spec.comment",
    {
      description:
        "Comment on a line or selection in one immutable Spec version, or reply to an existing thread.",
      inputSchema: {
        specId: z.string().uuid(),
        revisionId: z.string().uuid(),
        threadId: z.string().uuid().optional(),
        parentId: z.string().uuid().optional(),
        lineStart: z.number().int().positive(),
        lineEnd: z.number().int().positive(),
        selection: z.string().max(2_000).optional(),
        body: z.string().min(1).max(16_000),
      },
    },
    async ({ specId, ...body }) =>
      result(
        await client.projectRequest({
          path: `/specs/${specId}/comments`,
          method: "POST",
          body,
        }),
      ),
  );
  server.registerTool(
    "spec.list_review_comments",
    {
      description:
        "List open comments on current Spec versions that the Agent should address at this MCP connection.",
      inputSchema: {},
    },
    async () =>
      result(await client.projectRequest({ path: "/specs/review-context" })),
  );
  server.registerTool(
    "spec.confirm",
    {
      description:
        "Confirm the current Spec version when Project review policy permits this Agent confirmation.",
      inputSchema: { specId: z.string().uuid() },
    },
    async ({ specId }) =>
      result(
        await client.projectRequest({
          path: `/specs/${specId}/confirm`,
          method: "POST",
          body: {},
        }),
      ),
  );
  server.registerTool(
    "spec.revert",
    {
      description:
        "Create a new immutable Spec version from an earlier non-revoked version.",
      inputSchema: {
        specId: z.string().uuid(),
        revisionId: z.string().uuid(),
        clientMutationId: mutationId,
      },
    },
    async ({ specId, revisionId, clientMutationId }) =>
      result(
        await client.projectRequest({
          path: `/specs/${specId}/versions/${revisionId}/revert`,
          method: "POST",
          body: {},
          clientMutationId,
        }),
      ),
  );
  server.registerTool(
    "spec.revoke_version",
    {
      description:
        "Revoke a non-confirmed Spec version while retaining immutable version history.",
      inputSchema: {
        specId: z.string().uuid(),
        revisionId: z.string().uuid(),
      },
    },
    async ({ specId, revisionId }) =>
      result(
        await client.projectRequest({
          path: `/specs/${specId}/versions/${revisionId}`,
          method: "DELETE",
        }),
      ),
  );
  await client.flush();
  await server.connect(new StdioServerTransport());
}

async function runCloudCommand() {
  const action = process.argv[3];
  const source = PilotAgentClient.parse(
    argumentValue("--mcp-source") ?? argumentValue("--client"),
  );
  const configDirectory = argumentValue("--cloud-data-dir");
  const expectedWorkspaceId = argumentValue("--workspace-id");
  if (action === "connect") {
    const baseUrl = argumentValue("--cloud-url");
    const ticket = argumentValue("--connect-ticket");
    if (!baseUrl || !ticket) {
      throw new Error(
        "cloud connect requires --cloud-url and --connect-ticket.",
      );
    }
    const client = await CloudPilotClient.connect({
      baseUrl,
      ticket,
      client: source,
      cwd: process.cwd(),
      ...(expectedWorkspaceId ? { expectedWorkspaceId } : {}),
      ...(configDirectory ? { configDirectory } : {}),
    });
    const validation = await client.validateConnection();
    const connectionCheck = await client.reportConnectionCheck();
    process.stdout.write(
      `${JSON.stringify(
        {
          connected:
            Boolean(validation) &&
            typeof validation === "object" &&
            (validation as { status?: unknown }).status === "connected",
          context: client.context(),
          validation,
          connectionCheck,
          mcp: {
            command: process.argv[1],
            args: ["--mcp-source", source, "--cloud"],
          },
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  const client = CloudPilotClient.load({
    client: source,
    cwd: process.cwd(),
    ...(configDirectory ? { configDirectory } : {}),
  });
  if (action === "status") {
    process.stdout.write(`${JSON.stringify(client.diagnostics(), null, 2)}\n`);
    return;
  }
  if (action === "context") {
    process.stdout.write(
      `${JSON.stringify(await client.currentContext(), null, 2)}\n`,
    );
    return;
  }
  if (action === "checkpoint") {
    const eventType = PilotCheckpointEventType.parse(
      argumentValue("--event-type"),
    );
    const currentFocus = argumentValue("--current-focus");
    if (!currentFocus) {
      throw new Error("cloud checkpoint requires --current-focus.");
    }
    const needsHelp = process.argv.includes("--needs-help");
    const helpRequest = argumentValue("--help-request") ?? "";
    const requestedFrom = argumentValue("--requested-from") ?? "";
    const targetPrincipalId = argumentValue("--target-principal-id");
    if (needsHelp && !helpRequest) {
      throw new Error(
        "cloud checkpoint with --needs-help requires --help-request.",
      );
    }
    if (
      (needsHelp || eventType === "dependency_declared") &&
      !targetPrincipalId
    ) {
      throw new Error(
        "routed collaboration requires --target-principal-id for a verified member of the bound Project.",
      );
    }
    const sharedBoundaries = argumentValues("--shared-boundary").map(
      (value, index) => {
        try {
          return PilotSharedBoundaryInput.parse(JSON.parse(value));
        } catch (error) {
          throw new Error(
            `cloud checkpoint --shared-boundary ${index + 1} must be valid JSON matching the shared-boundary contract.`,
            { cause: error },
          );
        }
      },
    );
    const response = await client.reportCheckpoint({
      eventType,
      narrative: {
        currentFocus,
        completedOutcome: argumentValue("--completed-outcome") ?? "",
        evidence: argumentValues("--evidence"),
        nextStep: argumentValue("--next-step") ?? "",
        collaboration: {
          needed: needsHelp,
          request: helpRequest,
          requestedFrom,
          ...(targetPrincipalId
            ? {
                targetPrincipalId: PrincipalId.parse(targetPrincipalId),
              }
            : {}),
        },
      },
      ...(argumentValue("--client-event-id")
        ? { clientEventId: argumentValue("--client-event-id") }
        : {}),
      ...(argumentValue("--workstream-key")
        ? { workstreamKey: argumentValue("--workstream-key") }
        : {}),
      ...(argumentValue("--workstream-title")
        ? { workstreamTitle: argumentValue("--workstream-title") }
        : {}),
      ...(argumentValue("--phase")
        ? { phase: WorkstreamPhase.parse(argumentValue("--phase")) }
        : {}),
      ...(sharedBoundaries.length > 0 ? { sharedBoundaries } : {}),
    });
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    return;
  }
  throw new Error("Cloud action must be connect, status, or checkpoint.");
}

async function runIntegrationManagement() {
  const action =
    argumentValue("--action") ??
    process.argv.find((value) =>
      ["install", "repair", "status", "uninstall"].includes(value),
    );
  if (
    action !== "install" &&
    action !== "repair" &&
    action !== "status" &&
    action !== "uninstall"
  ) {
    throw new Error(
      "Integration action must be install, repair, status, or uninstall.",
    );
  }
  const selected = argumentValue("--adapter") ?? "all";
  const adapters =
    selected === "all"
      ? [...integrationAdapters]
      : integrationAdapters.filter((adapter) => adapter.kind === selected);
  if (adapters.length === 0) {
    throw new Error("Unknown integration adapter.");
  }

  const userHome = resolve(argumentValue("--home") ?? homedir());
  const launcher =
    argumentValue("--executable") ??
    process.env.INTERO_MCP_LAUNCHER ??
    process.argv[1]!;
  const executable = resolve(launcher);
  const executableSpec =
    process.platform === "win32" && executable.endsWith(".cmd")
      ? {
          command: process.env.ComSpec ?? process.env.COMSPEC ?? "cmd.exe",
          prefixArgs: ["/d", "/s", "/c", executable],
        }
      : { command: executable, prefixArgs: [] };
  const output = [];
  const detectedAgents = new Map(
    adapters.map((adapter) => [
      adapter.kind,
      detectAgent(adapter.kind, userHome),
    ]),
  );
  if (action === "install" || action === "repair") {
    const unsupported = adapters.filter((adapter) => {
      const detected = detectedAgents.get(adapter.kind);
      return (
        !detected ||
        !integrationVersionIsSupported(adapter.kind, detected.version)
      );
    });
    if (unsupported.length > 0) {
      throw new Error(
        `Unsupported or missing Coding Agent: ${unsupported
          .map((adapter) => adapter.kind)
          .join(", ")}.`,
      );
    }
  }

  for (const adapter of adapters) {
    const plan = adapter.installPlan(
      userHome,
      executableSpec.command,
      executableSpec.prefixArgs,
    );
    if (action === "uninstall") {
      await uninstallManagedIntegration(adapter.kind, userHome);
    } else if (action === "install" || action === "repair") {
      await applyManagedInstall(plan, userHome);
    }
    const diagnostics = await diagnoseManagedInstall(plan, userHome);
    const complete = diagnostics.every((diagnostic) => diagnostic.ok);
    const configured =
      diagnostics.some((diagnostic) => diagnostic.ok) ||
      (await managedIntegrationHasState(adapter.kind, userHome));
    const detected = detectedAgents.get(adapter.kind);
    const supported = Boolean(
      detected && integrationVersionIsSupported(adapter.kind, detected.version),
    );
    const configurationState =
      complete && detected
        ? agentConfigurationState(adapter.kind, detected.executable)
        : undefined;
    output.push({
      adapter: adapter.kind,
      detected: detected !== undefined,
      supported,
      configured,
      ...(detected ? { version: detected.version } : {}),
      state:
        action === "uninstall"
          ? "not_installed"
          : !detected && !configured
            ? "not_installed"
            : !supported
              ? "unsupported_version"
              : complete && configurationState === "invalid"
                ? "needs_repair"
                : complete
                  ? adapter.kind === "codex"
                    ? "pending_trust"
                    : adapter.kind === "grok-build"
                      ? configurationState === "valid"
                        ? "config_valid"
                        : "config_written"
                      : configurationState === "valid"
                        ? "config_valid"
                        : "config_written"
                  : configured
                    ? "needs_repair"
                    : "not_installed",
      diagnostics,
      warnings: [
        ...(configurationState === "runtime_unreachable"
          ? ["agent_runtime_unreachable"]
          : []),
        ...(adapter.kind === "codex" &&
        existsSync(join(dirname(plan.files[0]!.path), "AGENTS.override.md"))
          ? ["codex_override_shadows_instructions"]
          : []),
      ],
    });
  }
  process.stdout.write(
    `${JSON.stringify({ integrations: output }, null, 2)}\n`,
  );
}

function detectAgent(
  adapter: (typeof integrationAdapters)[number]["kind"],
  userHome: string,
): { executable: string; version: string } | undefined {
  const candidates =
    adapter === "codex"
      ? ["codex", "/Applications/Codex.app/Contents/Resources/codex"]
      : adapter === "claude-code"
        ? ["claude", join(userHome, ".local/bin/claude")]
        : adapter === "opencode"
          ? ["opencode", join(userHome, ".opencode/bin/opencode")]
          : adapter === "grok-build"
            ? ["grok"]
            : ["cursor-agent"];
  for (const executable of candidates) {
    try {
      const version = execFileSync(executable, ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1_500,
      })
        .trim()
        .slice(0, 120);
      if (version) return { executable, version };
    } catch {
      // Try the next known executable location.
    }
  }
  return undefined;
}

function agentConfigurationState(
  adapter: (typeof integrationAdapters)[number]["kind"],
  executable: string,
): "valid" | "runtime_unreachable" | "invalid" {
  const argumentsByAdapter = {
    codex: ["mcp", "get", "intero", "--json"],
    "claude-code": ["mcp", "get", "intero"],
    opencode: ["mcp", "list"],
    "grok-build": ["mcp", "doctor", "intero", "--json"],
    cursor: ["mcp", "list"],
  };
  try {
    const output = execFileSync(executable, argumentsByAdapter[adapter], {
      encoding: "utf8",
      env: { ...process.env, INTERO_INTEGRATION_PROBE: "1" },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3_000,
    });
    const normalized = output.toLowerCase();
    if (!normalized.includes("intero")) return "invalid";
    if (
      /\b(enoent|not found|no such file|invalid|malformed)\b/.test(normalized)
    )
      return "invalid";
    if (
      /\b(fail(?:ed|ure)?|error|disconnected|not connected|unreachable)\b/.test(
        normalized,
      )
    ) {
      return "runtime_unreachable";
    }
    if (adapter === "claude-code") {
      return normalized.includes("connected") ? "valid" : "runtime_unreachable";
    }
    if (adapter === "opencode") {
      return normalized.includes("connected") || output.includes("✓")
        ? "valid"
        : "runtime_unreachable";
    }
    if (adapter === "grok-build") {
      return grokBuildDoctorIsHealthy(output) ? "valid" : "runtime_unreachable";
    }
    return "valid";
  } catch {
    return "runtime_unreachable";
  }
}

function grokBuildDoctorIsHealthy(output: string): boolean {
  let report: unknown;
  try {
    report = JSON.parse(output);
  } catch {
    return false;
  }
  return jsonReportContainsHealthyStatus(report);
}

function jsonReportContainsHealthyStatus(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(jsonReportContainsHealthyStatus);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.healthy === true) return true;
  if (
    typeof record.status === "string" &&
    (record.status.toLowerCase() === "ok" ||
      record.status.toLowerCase() === "healthy")
  ) {
    return true;
  }
  return Object.values(record).some(jsonReportContainsHealthyStatus);
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function argumentValues(name: string): string[] {
  return process.argv.flatMap((value, index) =>
    value === name && process.argv[index + 1] ? [process.argv[index + 1]!] : [],
  );
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent:
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : { value },
  };
}
