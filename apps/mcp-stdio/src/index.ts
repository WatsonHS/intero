import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  PilotAgentClient,
  PilotCheckpointEventType,
  PilotWorkNarrative,
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
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

import { ReloadingDaemonClient, SocketDaemonClient } from "./daemon-client.js";
import { CloudPilotClient } from "./cloud-client.js";
import { loadConnectionSettings } from "./connection.js";
import { runHook } from "./hook.js";
import { createToolHandlers } from "./tools.js";

const hookSource = argumentValue("--hook-source");
const connectionFile = argumentValue("--connection-file");
const managementMode =
  process.argv.includes("integration") ||
  process.argv.includes("--integration");
const cloudCommand = process.argv[2] === "cloud";
if (
  hookSource === "codex" ||
  hookSource === "claude-code" ||
  hookSource === "opencode"
) {
  await runHook(hookSource, connectionFile);
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
    mcpSource !== "opencode"
  ) {
    throw new Error("A supported --mcp-source is required.");
  }
  if (process.argv.includes("--cloud")) {
    await runCloudMcpServer(mcpSource);
    return;
  }
  const tools = createToolHandlers(
    new ReloadingDaemonClient(async () => {
      const { socketPath, authToken } = await loadConnectionSettings({
        role: "mcp",
        ...(connectionFile ? { descriptorPath: connectionFile } : {}),
      });
      return new SocketDaemonClient(socketPath, authToken);
    }),
    {
      source: mcpSource,
      cwd: process.cwd(),
      clientSessionId: randomUUID(),
    },
  );
  const server = new McpServer({ name: "intero", version: "0.1.0" });
  const resourceScope = z.array(z.string().max(300)).max(50);

  server.registerTool(
    "stand_in.current_context",
    {
      description:
        "Show the enrolled Intero Workspace and current Agent session binding.",
      inputSchema: {},
    },
    async () => result(await tools.currentContext()),
  );

  server.registerTool(
    "stand_in.lookup_team_context",
    {
      description:
        "Look up bounded public team context at a technical branch point.",
      inputSchema: {
        query: z.string().min(1).max(1_000),
        scope: resourceScope.optional(),
      },
    },
    async (input) => result(await tools.lookupTeamContext(input)),
  );

  server.registerTool(
    "stand_in.request_coordination",
    {
      description:
        "Start visible coordination for a dependency, conflict, or ownership question.",
      inputSchema: {
        reason: z.string().min(1).max(2_000),
        resourceScope,
      },
    },
    async (input) => result(await tools.requestCoordination(input)),
  );

  server.registerTool(
    "stand_in.request_spec_review",
    {
      description:
        "Ask the Stand-in to publish a versioned Spec Review for human review.",
      inputSchema: {
        title: z.string().min(1).max(240),
        markdown: z.string().min(1).max(500_000),
        affectedScopes: resourceScope,
      },
    },
    async (input) => result(await tools.requestSpecReview(input)),
  );

  server.registerTool(
    "stand_in.lookup_decision",
    {
      description:
        "Retrieve sourced, versioned Decisions relevant to the current work.",
      inputSchema: {
        query: z.string().min(1).max(1_000),
      },
    },
    async (input) => result(await tools.lookupDecision(input)),
  );

  server.registerTool(
    "stand_in.check_scope",
    {
      description:
        "Check whether proposed work is inside existing delegated scope.",
      inputSchema: { resourceScope },
    },
    async (input) => result(await tools.checkScope(input)),
  );

  server.registerTool(
    "stand_in.report_checkpoint",
    {
      description: "Report a semantic work checkpoint as a sourced Claim.",
      inputSchema: {
        kind: z.enum([
          "intent",
          "decision",
          "blocker",
          "dependency",
          "scope",
          "artifact",
          "validation",
          "pause",
          "completion",
        ]),
        summary: z.string().min(1).max(600),
        evidenceRefs: z.array(z.string().max(200)).max(10).optional(),
      },
    },
    async (input) => result(await tools.reportCheckpoint(input)),
  );

  await server.connect(new StdioServerTransport());
}

async function runCloudMcpServer(
  mcpSource: "codex" | "claude-code" | "opencode",
) {
  const configDirectory = argumentValue("--cloud-data-dir");
  const client = CloudPilotClient.load({
    client: mcpSource,
    ...(configDirectory ? { configDirectory } : {}),
  });
  const server = new McpServer({ name: "intero-cloud", version: "0.1.0" });
  server.registerTool(
    "stand_in.current_context",
    {
      description: "Show the Project-scoped direct cloud MCP Agent connection.",
      inputSchema: {},
    },
    async () => result(client.context()),
  );
  server.registerTool(
    "stand_in.report_checkpoint",
    {
      description:
        "Report a human-readable structured work update to private Work State and, when policy permits, Team Pulse.",
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
    async (input) => result(await client.reportCheckpoint(input)),
  );
  const mutationId = z.string().min(8).max(200);
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
      description:
        "Update roadmap-only Epic content inside the bound Project.",
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
        "Create a Project Feature as a direct execution unit or as a parent for Work Items.",
      inputSchema: {
        title: z.string().min(1).max(240),
        description: z.string().max(8_000).optional(),
        stage: z
          .enum(["planned", "in_development", "released"])
          .optional(),
        epicId: z.string().uuid().optional(),
        ownerId: z.string().uuid().optional(),
        piId: z.string().uuid().optional(),
        sprintId: z.string().uuid().optional(),
      },
    },
    async (body) =>
      result(
        await client.projectRequest({
          path: "/features",
          method: "POST",
          body,
        }),
      ),
  );
  server.registerTool(
    "project.update_feature",
    {
      description:
        "Update one Project Feature without changing team membership or Project visibility.",
      inputSchema: {
        featureId: z.string().uuid(),
        title: z.string().min(1).max(240).optional(),
        description: z.string().max(8_000).optional(),
        stage: z
          .enum(["planned", "in_development", "released"])
          .optional(),
        epicId: z.string().uuid().nullable().optional(),
        ownerId: z.string().uuid().nullable().optional(),
        piId: z.string().uuid().nullable().optional(),
        sprintId: z.string().uuid().nullable().optional(),
      },
    },
    async ({ featureId, ...body }) =>
      result(
        await client.projectRequest({
          path: `/features/${featureId}`,
          method: "PATCH",
          body,
        }),
      ),
  );
  server.registerTool(
    "project.create_work_item",
    {
      description:
        "Create one Project-scoped Work Item. Owners, when supplied, must be human principals.",
      inputSchema: {
        title: z.string().min(1).max(240),
        description: z.string().max(16_000).optional(),
        status: z
          .enum(["todo", "in_progress", "ready_for_test", "done"])
          .optional(),
        priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
        ownerId: z.string().uuid().optional(),
        featureId: z.string().uuid().optional(),
        specId: z.string().uuid().optional(),
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
        "Update Project work content or move ready_for_test to done with explicit evidence when available.",
      inputSchema: {
        workItemId: z.string().uuid(),
        title: z.string().min(1).max(240).optional(),
        description: z.string().max(16_000).optional(),
        status: z
          .enum(["todo", "in_progress", "ready_for_test", "done"])
          .optional(),
        priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
        ownerId: z.string().uuid().nullable().optional(),
        featureId: z.string().uuid().nullable().optional(),
        specId: z.string().uuid().nullable().optional(),
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
      },
    },
    async ({ specId, reviewerIds }) =>
      result(
        await client.projectRequest({
          path: `/specs/${specId}/request-review`,
          method: "POST",
          body: { reviewerIds: reviewerIds ?? [] },
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
      result(
        await client.projectRequest({ path: "/specs/review-context" }),
      ),
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
      ...(configDirectory ? { configDirectory } : {}),
    });
    const connectionCheck = await client.reportConnectionCheck();
    process.stdout.write(
      `${JSON.stringify(
        {
          connected: true,
          context: client.context(),
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
    ...(configDirectory ? { configDirectory } : {}),
  });
  if (action === "status") {
    process.stdout.write(`${JSON.stringify(client.diagnostics(), null, 2)}\n`);
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
    if (needsHelp && !helpRequest) {
      throw new Error(
        "cloud checkpoint with --needs-help requires --help-request.",
      );
    }
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
  const adminConnection =
    connectionFile ??
    join(
      process.env.INTERO_DATA_DIR ?? join(userHome, ".intero"),
      "connection.json",
    );
  const connectionDirectory = dirname(adminConnection);
  const connections = {
    hook: join(connectionDirectory, "connection-hook.json"),
    mcp: join(connectionDirectory, "connection-mcp.json"),
  };
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
      connections,
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
        : ["opencode", join(userHome, ".opencode/bin/opencode")];
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
    return "valid";
  } catch {
    return "runtime_unreachable";
  }
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
