import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

import { SocketDaemonClient } from "./daemon-client.js";
import { loadConnectionSettings } from "./connection.js";
import { runHook } from "./hook.js";
import { createToolHandlers } from "./tools.js";

const hookSource = argumentValue("--hook-source");
const connectionFile = argumentValue("--connection-file");
const managementMode =
  process.argv.includes("integration") ||
  process.argv.includes("--integration");
if (
  hookSource === "codex" ||
  hookSource === "claude-code" ||
  hookSource === "opencode"
) {
  await runHook(hookSource, connectionFile);
} else if (managementMode) {
  await runIntegrationManagement();
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
  const { socketPath, authToken } = await loadConnectionSettings({
    role: "mcp",
    ...(connectionFile ? { descriptorPath: connectionFile } : {}),
  });
  const tools = createToolHandlers(
    new SocketDaemonClient(socketPath, authToken),
    {
      source: mcpSource,
      cwd: process.cwd(),
      clientSessionId: randomUUID(),
    },
  );
  const server = new McpServer({ name: "intero", version: "0.1.0" });
  const resourceScope = z.array(z.string().max(300)).max(50);

  server.registerTool(
    "representative.current_context",
    {
      description:
        "Show the enrolled Intero Workspace and current Agent session binding.",
      inputSchema: {},
    },
    async () => result(await tools.currentContext()),
  );

  server.registerTool(
    "representative.lookup_team_context",
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
    "representative.request_coordination",
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
    "representative.request_spec_review",
    {
      description:
        "Ask the Representative to publish a versioned Spec Review for human review.",
      inputSchema: {
        title: z.string().min(1).max(240),
        markdown: z.string().min(1).max(500_000),
        affectedScopes: resourceScope,
      },
    },
    async (input) => result(await tools.requestSpecReview(input)),
  );

  server.registerTool(
    "representative.lookup_decision",
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
    "representative.check_scope",
    {
      description:
        "Check whether proposed work is inside existing delegated scope.",
      inputSchema: { resourceScope },
    },
    async (input) => result(await tools.checkScope(input)),
  );

  server.registerTool(
    "representative.report_checkpoint",
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

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent:
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : { value },
  };
}
