import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { SocketDaemonClient } from "./daemon-client.js";
import { loadConnectionSettings } from "./connection.js";
import { runHook } from "./hook.js";
import { createToolHandlers } from "./tools.js";

const hookSourceIndex = process.argv.indexOf("--hook-source");
const hookSource =
  hookSourceIndex >= 0 ? process.argv[hookSourceIndex + 1] : undefined;
if (
  hookSource === "codex" ||
  hookSource === "claude-code" ||
  hookSource === "opencode"
) {
  await runHook(hookSource);
} else {
  await runMcpServer();
}

async function runMcpServer() {
  const { socketPath, authToken } = await loadConnectionSettings();
  const tools = createToolHandlers(
    new SocketDaemonClient(socketPath, authToken),
  );
  const server = new McpServer({ name: "intero", version: "0.1.0" });
  const workspaceId = z
    .string()
    .uuid()
    .describe("Enrolled Intero Workspace ID");
  const workstreamId = z.string().uuid().describe("Current Workstream ID");
  const resourceScope = z.array(z.string().max(300)).max(50);

  server.registerTool(
    "representative.lookup_team_context",
    {
      description:
        "Look up bounded public team context at a technical branch point.",
      inputSchema: {
        workspaceId,
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
        workspaceId,
        workstreamId,
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
        workspaceId,
        workstreamId,
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
        workspaceId,
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
      inputSchema: { workspaceId, workstreamId, resourceScope },
    },
    async (input) => result(await tools.checkScope(input)),
  );

  server.registerTool(
    "representative.report_checkpoint",
    {
      description: "Report a semantic work checkpoint as a sourced Claim.",
      inputSchema: {
        workspaceId,
        workstreamId,
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
        summary: z.string().min(1).max(2_000),
        evidenceRefs: z.array(z.string().max(300)).max(20).optional(),
      },
    },
    async (input) => result(await tools.reportCheckpoint(input)),
  );

  await server.connect(new StdioServerTransport());
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
