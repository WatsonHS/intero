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

const MINIMUM_SUPPORTED_VERSIONS: Record<
  IntegrationKind,
  [number, number, number]
> = {
  codex: [0, 146, 0],
  "claude-code": [2, 1, 140],
  opencode: [1, 17, 4],
};

export function integrationVersionIsSupported(
  adapter: IntegrationKind,
  version: string,
): boolean {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const actual = match.slice(1, 4).map(Number);
  const minimum = MINIMUM_SUPPORTED_VERSIONS[adapter];
  for (const [index, part] of actual.entries()) {
    if (part !== minimum[index]) return part > minimum[index]!;
  }
  return true;
}

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
  sessionId?: string;
  eventId?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface IntegrationAdapter {
  kind: IntegrationKind;
  capabilities: AdapterCapabilities;
  normalize(
    input: AdapterInput,
  ): ReturnType<typeof CanonicalWorkEvent.safeParse>;
  installPlan(
    homeDirectory: string,
    executable: string,
    connectionFiles?: { hook: string; mcp: string },
    executablePrefixArgs?: string[],
  ): ManagedInstallPlan;
}

export interface ManagedFile {
  path: string;
  format: "toml" | "json" | "jsonc" | "markdown" | "typescript";
  marker: string;
  content: string;
}

export interface ManagedInstallPlan {
  adapter: IntegrationKind;
  allowedRoots: string[];
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
    SessionEnd: "SessionStopped",
  },
  "claude-code": {
    SessionStart: "SessionStarted",
    SessionEnd: "SessionStopped",
  },
  opencode: {
    "session.created": "SessionStarted",
    "session.idle": "SessionPaused",
    "session.deleted": "SessionStopped",
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
  const stableSourceId = [
    kind,
    input.sourceEvent,
    input.sessionId ?? "unknown-session",
    input.eventId ?? "lifecycle",
  ]
    .join(":")
    .slice(0, 200);
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
    idempotencyKey: stableSourceId,
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

function hookCommand(
  executable: string,
  executablePrefixArgs: string[],
  source: IntegrationKind,
  connectionFile: string,
): string {
  const arguments_ = [
    ...executablePrefixArgs,
    "--connection-file",
    connectionFile,
    "--hook-source",
    source,
  ];
  if (
    executablePrefixArgs[0] === "/d" &&
    executablePrefixArgs[1] === "/s" &&
    executablePrefixArgs[2] === "/c"
  ) {
    const commandArguments = executablePrefixArgs.slice(3);
    const inner = [
      ...commandArguments,
      "--connection-file",
      connectionFile,
      "--hook-source",
      source,
    ]
      .map(windowsCommandQuote)
      .join(" ");
    return `${windowsCommandQuote(executable)} /d /s /c "${inner}"`;
  }
  return [executable, ...arguments_].map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function windowsCommandQuote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function commandHook(command: string, commandWindows?: string) {
  return [
    {
      hooks: [
        {
          type: "command",
          command,
          ...(commandWindows ? { commandWindows } : {}),
          timeout: 10,
        },
      ],
    },
  ];
}

function claudeCommandHook(
  executable: string,
  executablePrefixArgs: string[],
  source: IntegrationKind,
  connectionFile: string,
) {
  return [
    {
      hooks: [
        {
          type: "command",
          command: executable,
          args: [
            ...executablePrefixArgs,
            "--connection-file",
            connectionFile,
            "--hook-source",
            source,
          ],
          timeout: 10,
        },
      ],
    },
  ];
}

function connectionFilesFor(
  home: string,
  connectionFiles?: { hook: string; mcp: string },
) {
  return (
    connectionFiles ?? {
      hook: `${home}/.intero/connection-hook.json`,
      mcp: `${home}/.intero/connection-mcp.json`,
    }
  );
}

export const codexAdapter: IntegrationAdapter = {
  kind: "codex",
  capabilities: {
    mcp: true,
    lifecycleHooks: true,
    fileEvents: false,
    validationEvents: false,
    todoEvents: false,
    managedPlugin: false,
  },
  normalize: (input) => normalize("codex", input),
  installPlan: (
    home,
    executable,
    providedConnections,
    executablePrefixArgs = [],
  ) => {
    const connections = connectionFilesFor(home, providedConnections);
    const codexHome = process.env.CODEX_HOME || `${home}/.codex`;
    const codexHookCommand = hookCommand(
      executable,
      executablePrefixArgs,
      "codex",
      connections.hook,
    );
    return {
      adapter: "codex",
      allowedRoots: [home, codexHome],
      files: [
        {
          path: `${codexHome}/AGENTS.md`,
          format: "markdown",
          marker: "intero-managed",
          content: INSTRUCTION_CONTENT,
        },
        {
          path: `${codexHome}/config.toml`,
          format: "toml",
          marker: "intero-managed",
          content: `[mcp_servers.intero]\ncommand = ${tomlString(executable)}\nargs = [${[...executablePrefixArgs, "--connection-file", connections.mcp, "--mcp-source", "codex"].map(tomlString).join(", ")}]\nrequired = false\n`,
        },
        {
          path: `${codexHome}/hooks.json`,
          format: "json",
          marker: "intero-managed",
          content: JSON.stringify({
            hooks: Object.fromEntries(
              ["SessionStart", "SessionEnd"].map((event) => [
                event,
                commandHook(
                  codexHookCommand,
                  executablePrefixArgs[0] === "/d"
                    ? codexHookCommand
                    : undefined,
                ),
              ]),
            ),
          }),
        },
      ],
      diagnostics: [
        "Codex config contains mcp_servers.intero",
        "Intero hook commands are executable",
      ],
      uninstallPaths: [],
    };
  },
};

export const claudeCodeAdapter: IntegrationAdapter = {
  kind: "claude-code",
  capabilities: {
    mcp: true,
    lifecycleHooks: true,
    fileEvents: false,
    validationEvents: false,
    todoEvents: false,
    managedPlugin: false,
  },
  normalize: (input) => normalize("claude-code", input),
  installPlan: (
    home,
    executable,
    providedConnections,
    executablePrefixArgs = [],
  ) => {
    const connections = connectionFilesFor(home, providedConnections);
    const claudeHome = process.env.CLAUDE_CONFIG_DIR || `${home}/.claude`;
    const claudeMcpConfig = process.env.CLAUDE_CONFIG_DIR
      ? `${claudeHome}/.claude.json`
      : `${home}/.claude.json`;
    return {
      adapter: "claude-code",
      allowedRoots: [home, claudeHome],
      files: [
        {
          path: `${claudeHome}/rules/intero.md`,
          format: "markdown",
          marker: "intero-managed",
          content: INSTRUCTION_CONTENT,
        },
        {
          path: claudeMcpConfig,
          format: "json",
          marker: "intero-managed",
          content: JSON.stringify(
            {
              mcpServers: {
                intero: {
                  type: "stdio",
                  command: executable,
                  args: [
                    ...executablePrefixArgs,
                    "--connection-file",
                    connections.mcp,
                    "--mcp-source",
                    "claude-code",
                  ],
                },
              },
            },
            null,
            2,
          ),
        },
        {
          path: `${claudeHome}/settings.json`,
          format: "json",
          marker: "intero-managed",
          content: JSON.stringify({
            hooks: Object.fromEntries(
              ["SessionStart", "SessionEnd"].map((event) => [
                event,
                claudeCommandHook(
                  executable,
                  executablePrefixArgs,
                  "claude-code",
                  connections.hook,
                ),
              ]),
            ),
          }),
        },
      ],
      diagnostics: [
        "Claude Code MCP server intero is registered",
        "Hook matchers are valid",
      ],
      uninstallPaths: [`${claudeHome}/rules/intero.md`],
    };
  },
};

export const openCodeAdapter: IntegrationAdapter = {
  kind: "opencode",
  capabilities: {
    mcp: true,
    lifecycleHooks: true,
    fileEvents: false,
    validationEvents: false,
    todoEvents: false,
    managedPlugin: true,
  },
  normalize: (input) => normalize("opencode", input),
  installPlan: (
    home,
    executable,
    providedConnections,
    executablePrefixArgs = [],
  ) => {
    const connections = connectionFilesFor(home, providedConnections);
    const openCodeHome =
      process.env.OPENCODE_CONFIG_DIR || `${home}/.config/opencode`;
    return {
      adapter: "opencode",
      allowedRoots: [home, openCodeHome],
      files: [
        {
          path: `${openCodeHome}/intero.md`,
          format: "markdown",
          marker: "intero-managed",
          content: INSTRUCTION_CONTENT,
        },
        {
          path: `${openCodeHome}/opencode.json`,
          format: "jsonc",
          marker: "intero-managed",
          content: JSON.stringify(
            {
              mcp: {
                intero: {
                  type: "local",
                  command: [
                    executable,
                    ...executablePrefixArgs,
                    "--connection-file",
                    connections.mcp,
                    "--mcp-source",
                    "opencode",
                  ],
                  enabled: true,
                },
              },
              instructions: ["intero.md"],
            },
            null,
            2,
          ),
        },
        {
          path: `${openCodeHome}/plugins/intero.ts`,
          format: "typescript",
          marker: "intero-managed",
          content: `import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Plugin } from "@opencode-ai/plugin";

const executable = ${JSON.stringify(executable)};
const executablePrefixArgs = ${JSON.stringify(executablePrefixArgs)};
const hookConnection = ${JSON.stringify(connections.hook)};
const forwarded = new Set([
  "session.created",
  "session.idle",
  "session.deleted"
]);

export const InteroPlugin: Plugin = async ({ directory, worktree }) => ({
  event: async ({ event }) => {
    if (!forwarded.has(event.type)) return;
    const properties = event.properties as Record<string, unknown>;
    const info =
      properties.info && typeof properties.info === "object"
        ? properties.info as Record<string, unknown>
        : {};
    const sessionId =
      typeof info.id === "string"
        ? info.id
        : typeof properties.sessionID === "string"
          ? properties.sessionID
        : typeof properties.sessionId === "string"
          ? properties.sessionId
          : undefined;
    if (!sessionId) return;
    try {
      const child = spawn(executable, [
        ...executablePrefixArgs,
        "--connection-file",
        hookConnection,
        "--hook-source",
        "opencode"
      ], {
        stdio: ["pipe", "ignore", "ignore"]
      });
      const timeout = setTimeout(() => child.kill(), 1500);
      child.once("error", () => clearTimeout(timeout));
      child.once("close", () => clearTimeout(timeout));
      child.stdin.on("error", () => undefined);
      child.stdin.end(
        JSON.stringify({
          hook_event_name: event.type,
          cwd: worktree || directory,
          session_id: sessionId,
          event_id: randomUUID()
        })
      );
      await Promise.race([
        once(child, "close").catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 1600))
      ]);
    } catch {
      // Intero is optional; OpenCode must remain usable when it is unavailable.
    }
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
        `${openCodeHome}/intero.md`,
        `${openCodeHome}/plugins/intero.ts`,
      ],
    };
  },
};

export const integrationAdapters = [
  codexAdapter,
  claudeCodeAdapter,
  openCodeAdapter,
] as const;

export {
  applyManagedInstall,
  diagnoseManagedInstall,
  managedIntegrationHasState,
  managedIntegrationTargets,
  uninstallManagedIntegration,
} from "./installer.js";
