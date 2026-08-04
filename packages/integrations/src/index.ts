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
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { z } from "zod";

export type IntegrationKind = Exclude<EventSource, "desktop" | "system">;

export function cloudWorkspaceDirectory(
  homeDirectory: string,
  repositoryPath: string,
): string {
  const workspaceKey = createHash("sha256")
    .update(resolve(repositoryPath))
    .digest("hex");
  return join(
    resolve(homeDirectory),
    ".intero",
    "cloud",
    "workspaces",
    workspaceKey,
  );
}

export function cloudWorkspaceClientFiles(
  homeDirectory: string,
  repositoryPath: string,
  client: IntegrationKind,
) {
  const directory = cloudWorkspaceDirectory(homeDirectory, repositoryPath);
  return {
    directory,
    workspaceId: join(directory, "workspace-id"),
    connection: join(directory, `${client}.connection.enc`),
    outbox: join(directory, `${client}.outbox.enc`),
    metadata: join(directory, `${client}.metadata.json`),
  };
}

const MINIMUM_SUPPORTED_VERSIONS: Record<
  IntegrationKind,
  [number, number, number]
> = {
  codex: [0, 146, 0],
  "claude-code": [2, 1, 140],
  opencode: [1, 17, 4],
  // Grok Build is in active beta. Accept any semantic version until xAI
  // publishes a compatibility floor for its local MCP configuration.
  "grok-build": [0, 0, 0],
  // Cursor Agent has no published compatibility floor for MCP registration.
  cursor: [0, 0, 0],
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
  // Grok Build has MCP support, but no lifecycle event payload contract that
  // we can safely normalize and operate. Do not invent one.
  "grok-build": {},
  // Cursor supports MCP registration but has no stable lifecycle Hook contract.
  cursor: {},
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
    privacy: "P1_STAND_IN_PRIVATE",
    payload: safeMetadata.parse(
      input.metadata ?? {},
    ) satisfies SafeEventPayload,
    idempotencyKey: stableSourceId,
  });
}

const INSTRUCTION_CONTENT = `# Intero coordination

After understanding the first user request in each new conversation and before
substantive work, report an intent checkpoint with a safe summary of the current
work. Include a stable workstream key, a concise title, and currentFocus.

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
): string {
  const arguments_ = [...executablePrefixArgs, "--hook-source", source];
  if (
    executablePrefixArgs[0] === "/d" &&
    executablePrefixArgs[1] === "/s" &&
    executablePrefixArgs[2] === "/c"
  ) {
    const commandArguments = executablePrefixArgs.slice(3);
    const inner = [...commandArguments, "--hook-source", source]
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
) {
  return [
    {
      hooks: [
        {
          type: "command",
          command: executable,
          args: [...executablePrefixArgs, "--hook-source", source],
          timeout: 10,
        },
      ],
    },
  ];
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
  installPlan: (home, executable, executablePrefixArgs = []) => {
    const codexHome = process.env.CODEX_HOME || `${home}/.codex`;
    const codexHookCommand = hookCommand(
      executable,
      executablePrefixArgs,
      "codex",
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
          content: `[mcp_servers.intero]\ncommand = ${tomlString(executable)}\nargs = [${[...executablePrefixArgs, "--mcp-source", "codex", "--cloud"].map(tomlString).join(", ")}]\nrequired = false\n`,
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
  installPlan: (home, executable, executablePrefixArgs = []) => {
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
                    "--mcp-source",
                    "claude-code",
                    "--cloud",
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
  installPlan: (home, executable, executablePrefixArgs = []) => {
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
                    "--mcp-source",
                    "opencode",
                    "--cloud",
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

export const grokBuildAdapter: IntegrationAdapter = {
  kind: "grok-build",
  capabilities: {
    mcp: true,
    lifecycleHooks: false,
    fileEvents: false,
    validationEvents: false,
    todoEvents: false,
    managedPlugin: false,
  },
  normalize: (input) => normalize("grok-build", input),
  installPlan: (home, executable, executablePrefixArgs = []) => {
    const grokHome = process.env.GROK_HOME || `${home}/.grok`;
    return {
      adapter: "grok-build",
      allowedRoots: [home, grokHome],
      files: [
        {
          path: `${grokHome}/config.toml`,
          format: "toml",
          marker: "intero-managed",
          content: `[mcp_servers.intero]\ncommand = ${tomlString(executable)}\nargs = [${[...executablePrefixArgs, "--mcp-source", "grok-build", "--cloud"].map(tomlString).join(", ")}]\nenabled = true\n`,
        },
      ],
      diagnostics: [
        "Grok Build config contains mcp_servers.intero",
        "Run grok mcp doctor intero --json to verify the configured server",
      ],
      uninstallPaths: [],
    };
  },
};

export const cursorAdapter: IntegrationAdapter = {
  kind: "cursor",
  capabilities: {
    mcp: true,
    lifecycleHooks: false,
    fileEvents: false,
    validationEvents: false,
    todoEvents: false,
    managedPlugin: false,
  },
  normalize: (input) => normalize("cursor", input),
  installPlan: (home, executable, executablePrefixArgs = []) => {
    const cursorHome = `${home}/.cursor`;
    return {
      adapter: "cursor",
      allowedRoots: [home, cursorHome],
      files: [
        {
          path: `${cursorHome}/mcp.json`,
          format: "json",
          marker: "intero-managed",
          content: JSON.stringify(
            {
              mcpServers: {
                intero: {
                  command: executable,
                  args: [
                    ...executablePrefixArgs,
                    "--mcp-source",
                    "cursor",
                    "--cloud",
                  ],
                  env: {},
                },
              },
            },
            null,
            2,
          ),
        },
      ],
      diagnostics: [
        "Cursor global MCP config contains mcpServers.intero",
        "Run cursor-agent mcp list to verify the configured server",
      ],
      uninstallPaths: [],
    };
  },
};

export const integrationAdapters = [
  codexAdapter,
  claudeCodeAdapter,
  openCodeAdapter,
  grokBuildAdapter,
  cursorAdapter,
] as const;

export {
  applyManagedInstall,
  diagnoseManagedInstall,
  managedIntegrationHasState,
  managedIntegrationTargets,
  uninstallManagedIntegration,
} from "./installer.js";
