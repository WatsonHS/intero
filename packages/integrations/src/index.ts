import {
  CanonicalWorkEvent,
  type CanonicalEventType,
  type EventSource,
  type SafeEventPayload,
  type WorkspaceId,
  type WorkstreamId,
  containsForbiddenEventField,
  uuidv7,
} from "@intero/domain";
import { z } from "zod";

export type IntegrationKind = Exclude<EventSource, "desktop" | "system">;

export interface AdapterCapabilities {
  mcp: true;
  lifecycleHooks: boolean;
  fileEvents: boolean;
  validationEvents: boolean;
  todoEvents: boolean;
  managedPlugin: boolean;
}

export interface AdapterInput {
  sourceEvent: string;
  workspaceId: WorkspaceId;
  workstreamId?: WorkstreamId;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface IntegrationAdapter {
  kind: IntegrationKind;
  capabilities: AdapterCapabilities;
  normalize(
    input: AdapterInput,
  ): ReturnType<typeof CanonicalWorkEvent.safeParse>;
  installPlan(homeDirectory: string, executable: string): ManagedInstallPlan;
}

export interface ManagedFile {
  path: string;
  format: "toml" | "json" | "jsonc" | "markdown" | "typescript";
  marker: string;
  content: string;
}

export interface ManagedInstallPlan {
  adapter: IntegrationKind;
  files: ManagedFile[];
  diagnostics: string[];
  uninstallPaths: string[];
}

const safeMetadata = z
  .object({
    phase: z.string().max(80).optional(),
    summary: z.string().max(600).optional(),
    resourceKind: z
      .enum(["file", "symbol", "api", "schema", "config", "artifact"])
      .optional(),
    resourceRef: z.string().max(300).optional(),
    gitBranch: z.string().max(240).optional(),
    gitHead: z.string().max(64).optional(),
    validationName: z.string().max(160).optional(),
    validationStatus: z
      .enum(["pending", "passed", "failed", "skipped"])
      .optional(),
    checkpointKind: z
      .enum([
        "intent",
        "decision",
        "blocker",
        "dependency",
        "scope",
        "artifact",
        "validation",
        "pause",
        "completion",
      ])
      .optional(),
  })
  .strip();

const EVENT_MAP: Record<IntegrationKind, Record<string, CanonicalEventType>> = {
  codex: {
    SessionStart: "SessionStarted",
    UserPromptSubmit: "PlanChanged",
    PreToolUse: "ResourceTouched",
    PostToolUse: "ResourceTouched",
    Stop: "SessionStopped",
    SubagentStart: "SessionStarted",
    SubagentStop: "SessionStopped",
  },
  "claude-code": {
    SessionStart: "SessionStarted",
    UserPromptSubmit: "PlanChanged",
    PreToolUse: "ResourceTouched",
    PostToolUse: "ResourceTouched",
    PostToolUseFailure: "ValidationChanged",
    Stop: "SessionStopped",
    SessionEnd: "SessionStopped",
  },
  opencode: {
    "session.created": "SessionStarted",
    "session.idle": "SessionPaused",
    "session.deleted": "SessionStopped",
    "file.edited": "ResourceTouched",
    "file.watcher.updated": "ResourceTouched",
    "todo.updated": "PlanChanged",
    "lsp.client.diagnostics": "ValidationChanged",
    "tool.execute.after": "ResourceTouched",
  },
};

function normalize(kind: IntegrationKind, input: AdapterInput) {
  if (containsForbiddenEventField(input.metadata)) {
    return CanonicalWorkEvent.safeParse({ rejected: "forbidden metadata" });
  }
  const type = EVENT_MAP[kind][input.sourceEvent];
  if (!type) {
    return CanonicalWorkEvent.safeParse({ rejected: "unsupported event" });
  }
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const eventId = uuidv7();
  return CanonicalWorkEvent.safeParse({
    id: eventId,
    operationId: uuidv7(),
    schemaVersion: 1,
    source: kind,
    type,
    occurredAt,
    receivedAt: new Date().toISOString(),
    workspaceId: input.workspaceId,
    workstreamId: input.workstreamId,
    privacy: "P1_REPRESENTATIVE_PRIVATE",
    payload: safeMetadata.parse(
      input.metadata ?? {},
    ) satisfies SafeEventPayload,
    idempotencyKey: `${kind}:${input.sourceEvent}:${eventId}`,
  });
}

const INSTRUCTION_CONTENT = `# Intero coordination

Use the Intero MCP tools only at semantic branch points. Report an intent,
decision, blocker, dependency, meaningful scope change, artifact, validation
outcome, pause, or completion. Never send prompts, chain-of-thought, raw tool
input/output, terminal logs, secrets, or file contents as checkpoints.
`;

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function hookCommand(executable: string, source: IntegrationKind): string {
  return `${shellQuote(executable)} --hook-source ${source}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandHook(command: string) {
  return [{ hooks: [{ type: "command", command, timeout: 10 }] }];
}

export const codexAdapter: IntegrationAdapter = {
  kind: "codex",
  capabilities: {
    mcp: true,
    lifecycleHooks: true,
    fileEvents: true,
    validationEvents: true,
    todoEvents: false,
    managedPlugin: false,
  },
  normalize: (input) => normalize("codex", input),
  installPlan: (home, executable) => ({
    adapter: "codex",
    files: [
      {
        path: `${home}/.codex/intero.md`,
        format: "markdown",
        marker: "intero-managed",
        content: INSTRUCTION_CONTENT,
      },
      {
        path: `${home}/.codex/config.toml`,
        format: "toml",
        marker: "intero-managed",
        content: `[mcp_servers.intero]\ncommand = ${tomlString(executable)}\nrequired = false\n`,
      },
      {
        path: `${home}/.codex/hooks.json`,
        format: "json",
        marker: "intero-managed",
        content: JSON.stringify({
          hooks: Object.fromEntries(
            ["SessionStart", "PreToolUse", "PostToolUse", "Stop"].map(
              (event) => [event, commandHook(hookCommand(executable, "codex"))],
            ),
          ),
        }),
      },
    ],
    diagnostics: [
      "Codex config contains mcp_servers.intero",
      "Intero hook commands are executable",
    ],
    uninstallPaths: [`${home}/.codex/intero.md`],
  }),
};

export const claudeCodeAdapter: IntegrationAdapter = {
  kind: "claude-code",
  capabilities: {
    mcp: true,
    lifecycleHooks: true,
    fileEvents: true,
    validationEvents: true,
    todoEvents: false,
    managedPlugin: false,
  },
  normalize: (input) => normalize("claude-code", input),
  installPlan: (home, executable) => ({
    adapter: "claude-code",
    files: [
      {
        path: `${home}/.claude/intero.md`,
        format: "markdown",
        marker: "intero-managed",
        content: INSTRUCTION_CONTENT,
      },
      {
        path: `${home}/.claude.json`,
        format: "json",
        marker: "intero-managed",
        content: JSON.stringify(
          { mcpServers: { intero: { command: executable } } },
          null,
          2,
        ),
      },
      {
        path: `${home}/.claude/settings.json`,
        format: "json",
        marker: "intero-managed",
        content: JSON.stringify({
          hooks: Object.fromEntries(
            [
              "SessionStart",
              "UserPromptSubmit",
              "PreToolUse",
              "PostToolUse",
              "PostToolUseFailure",
              "Stop",
              "SessionEnd",
            ].map((event) => [
              event,
              commandHook(hookCommand(executable, "claude-code")),
            ]),
          ),
        }),
      },
    ],
    diagnostics: [
      "Claude Code MCP server intero is registered",
      "Hook matchers are valid",
    ],
    uninstallPaths: [`${home}/.claude/intero.md`],
  }),
};

export const openCodeAdapter: IntegrationAdapter = {
  kind: "opencode",
  capabilities: {
    mcp: true,
    lifecycleHooks: true,
    fileEvents: true,
    validationEvents: true,
    todoEvents: true,
    managedPlugin: true,
  },
  normalize: (input) => normalize("opencode", input),
  installPlan: (home, executable) => ({
    adapter: "opencode",
    files: [
      {
        path: `${home}/.config/opencode/intero.md`,
        format: "markdown",
        marker: "intero-managed",
        content: INSTRUCTION_CONTENT,
      },
      {
        path: `${home}/.config/opencode/opencode.json`,
        format: "jsonc",
        marker: "intero-managed",
        content: JSON.stringify(
          {
            mcp: {
              intero: { type: "local", command: [executable], enabled: true },
            },
            instructions: ["intero.md"],
          },
          null,
          2,
        ),
      },
      {
        path: `${home}/.config/opencode/plugins/intero.ts`,
        format: "typescript",
        marker: "intero-managed",
        content: `import { spawn } from "node:child_process";
import { once } from "node:events";
import type { Plugin } from "@opencode-ai/plugin";

const executable = ${JSON.stringify(executable)};
const forwarded = new Set([
  "session.created",
  "session.idle",
  "session.deleted",
  "file.edited",
  "file.watcher.updated",
  "todo.updated",
  "lsp.client.diagnostics",
  "tool.execute.after"
]);

export const InteroPlugin: Plugin = async ({ directory, worktree }) => ({
  event: async ({ event }) => {
    if (!forwarded.has(event.type)) return;
    const properties = event.properties as Record<string, unknown>;
    const sessionId =
      typeof properties.sessionID === "string"
        ? properties.sessionID
        : typeof properties.sessionId === "string"
          ? properties.sessionId
          : "opencode-global";
    const child = spawn(executable, ["--hook-source", "opencode"], {
      stdio: ["pipe", "ignore", "ignore"]
    });
    child.stdin.end(
      JSON.stringify({
        hook_event_name: event.type,
        cwd: worktree || directory,
        session_id: sessionId
      })
    );
    await once(child, "close");
  }
});
`,
      },
    ],
    diagnostics: [
      "OpenCode global plugin is loadable",
      "OpenCode local MCP command is enabled",
    ],
    uninstallPaths: [
      `${home}/.config/opencode/intero.md`,
      `${home}/.config/opencode/plugins/intero.ts`,
    ],
  }),
};

export const integrationAdapters = [
  codexAdapter,
  claudeCodeAdapter,
  openCodeAdapter,
] as const;

export {
  applyManagedInstall,
  diagnoseManagedInstall,
  uninstallManagedIntegration,
} from "./installer.js";
