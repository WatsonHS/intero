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

import { mcpBridgeArguments } from "./bridge.js";
import { INSTRUCTION_CONTENT } from "./instructions.js";

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

/**
 * Minimum client version that ships working Agent Plugins 1.0.0 support, or
 * null for a client that is not a launch client of the standard (ADR-0011).
 *
 * Codex and Cursor are launch clients. Claude Code uses its own near-identical
 * native plugin format that is not part of the standard, and OpenCode and Grok
 * Build have announced no support; all three stay on the managed install path
 * only. Both supporting clients currently reuse their managed compatibility
 * floor until a narrower version that ships plugin loading is published.
 */
const STANDARD_PLUGIN_MINIMUM_VERSIONS: Record<
  IntegrationKind,
  [number, number, number] | null
> = {
  codex: MINIMUM_SUPPORTED_VERSIONS.codex,
  "claude-code": null,
  opencode: null,
  "grok-build": null,
  cursor: MINIMUM_SUPPORTED_VERSIONS.cursor,
};

/** Clients that can receive the launcher layer as a published Agent Plugin. */
export type StandardPluginClient = "codex" | "cursor";

export const standardPluginClients = [
  "codex",
  "cursor",
] as const satisfies readonly StandardPluginClient[];

export function integrationVersionIsSupported(
  adapter: IntegrationKind,
  version: string,
): boolean {
  return versionMeetsMinimum(version, MINIMUM_SUPPORTED_VERSIONS[adapter]);
}

/**
 * Whether this client can register the Intero bridge by installing the
 * published Agent Plugin instead of a managed MCP configuration entry.
 */
export function adapterSupportsStandardPlugin(
  adapter: IntegrationKind,
): adapter is StandardPluginClient {
  return STANDARD_PLUGIN_MINIMUM_VERSIONS[adapter] !== null;
}

/**
 * Whether this installed client version can load the published Agent Plugin.
 * A client without standard support is never plugin-capable at any version.
 */
export function standardPluginIsSupported(
  adapter: IntegrationKind,
  version: string,
): boolean {
  const minimum = STANDARD_PLUGIN_MINIMUM_VERSIONS[adapter];
  if (!minimum) return false;
  return versionMeetsMinimum(version, minimum);
}

function versionMeetsMinimum(
  version: string,
  minimum: [number, number, number],
): boolean {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const actual = match.slice(1, 4).map(Number);
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
    options?: ManagedInstallPlanOptions,
  ): ManagedInstallPlan;
}

/**
 * What a managed file contributes to the integration. Only `mcp` is expressible
 * by the Agent Plugins standard; `instructions`, `hooks`, and `plugin` stay on
 * the managed install path for every client (ADR-0011, "Boundary between the
 * two paths").
 */
export type ManagedFileRole = "mcp" | "instructions" | "hooks" | "plugin";

export interface ManagedFile {
  path: string;
  format: "toml" | "json" | "jsonc" | "markdown" | "typescript";
  marker: string;
  content: string;
  role?: ManagedFileRole;
}

export interface ManagedInstallPlanOptions {
  /**
   * Where the credential-free launcher registration comes from.
   *
   * `managed` (default) writes the MCP entry through the installer.
   * `standard_plugin` selects ADR-0011 hybrid mode: the published `intero`
   * Agent Plugin owns the MCP registration and the managed plan narrows to
   * only what the standard cannot express. Narrowing changes what a new
   * install writes; it never changes what uninstall is willing to remove,
   * because uninstall replays the recorded manifest rather than a plan.
   */
  bridgeRegistration?: "managed" | "standard_plugin";
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

/**
 * The single managed diagnostic that describes each client's MCP registration.
 * Hybrid mode drops exactly this line and states who owns the bridge instead,
 * so preview, repair, and detach report the real managed target set.
 */
const MANAGED_MCP_DIAGNOSTIC: Record<IntegrationKind, string> = {
  codex: "Codex config contains mcp_servers.intero",
  "claude-code": "Claude Code MCP server intero is registered",
  opencode: "OpenCode local MCP command is enabled",
  "grok-build": "Grok Build config contains mcp_servers.intero",
  cursor: "Cursor global MCP config contains mcpServers.intero",
};

const STANDARD_PLUGIN_BRIDGE_DIAGNOSTIC =
  "The intero Agent Plugin owns the MCP bridge registration; no managed MCP entry is written";

/**
 * Applies ADR-0011 hybrid mode to a fully built plan. The managed MCP entry is
 * removed and the remaining targets — lifecycle hooks, always-on instructions,
 * and the OpenCode managed plugin — stay on the managed install path.
 */
function narrowInstallPlan(
  plan: ManagedInstallPlan,
  options: ManagedInstallPlanOptions | undefined,
): ManagedInstallPlan {
  if (options?.bridgeRegistration !== "standard_plugin") return plan;
  if (!adapterSupportsStandardPlugin(plan.adapter)) {
    throw new Error(
      `${plan.adapter} has no Agent Plugins standard support; its managed MCP registration cannot be narrowed.`,
    );
  }
  return {
    ...plan,
    files: plan.files.filter((file) => file.role !== "mcp"),
    diagnostics: [
      ...plan.diagnostics.filter(
        (diagnostic) => diagnostic !== MANAGED_MCP_DIAGNOSTIC[plan.adapter],
      ),
      STANDARD_PLUGIN_BRIDGE_DIAGNOSTIC,
    ],
  };
}

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
  installPlan: (home, executable, executablePrefixArgs = [], options) => {
    const codexHome = process.env.CODEX_HOME || `${home}/.codex`;
    const codexHookCommand = hookCommand(
      executable,
      executablePrefixArgs,
      "codex",
    );
    return narrowInstallPlan(
      {
        adapter: "codex",
        allowedRoots: [home, codexHome],
        files: [
          {
            path: `${codexHome}/AGENTS.md`,
            format: "markdown",
            marker: "intero-managed",
            content: INSTRUCTION_CONTENT,
            role: "instructions",
          },
          {
            path: `${codexHome}/config.toml`,
            format: "toml",
            marker: "intero-managed",
            content: `[mcp_servers.intero]\ncommand = ${tomlString(executable)}\nargs = [${mcpBridgeArguments("codex", executablePrefixArgs).map(tomlString).join(", ")}]\nrequired = false\n`,
            role: "mcp",
          },
          {
            path: `${codexHome}/hooks.json`,
            format: "json",
            marker: "intero-managed",
            role: "hooks",
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
          MANAGED_MCP_DIAGNOSTIC.codex,
          "Intero hook commands are executable",
        ],
        uninstallPaths: [],
      },
      options,
    );
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
  installPlan: (home, executable, executablePrefixArgs = [], options) => {
    const claudeHome = process.env.CLAUDE_CONFIG_DIR || `${home}/.claude`;
    const claudeMcpConfig = process.env.CLAUDE_CONFIG_DIR
      ? `${claudeHome}/.claude.json`
      : `${home}/.claude.json`;
    return narrowInstallPlan(
      {
        adapter: "claude-code",
        allowedRoots: [home, claudeHome],
        files: [
          {
            path: `${claudeHome}/rules/intero.md`,
            format: "markdown",
            marker: "intero-managed",
            content: INSTRUCTION_CONTENT,
            role: "instructions",
          },
          {
            path: claudeMcpConfig,
            format: "json",
            marker: "intero-managed",
            role: "mcp",
            content: JSON.stringify(
              {
                mcpServers: {
                  intero: {
                    type: "stdio",
                    command: executable,
                    args: mcpBridgeArguments(
                      "claude-code",
                      executablePrefixArgs,
                    ),
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
            role: "hooks",
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
          MANAGED_MCP_DIAGNOSTIC["claude-code"],
          "Hook matchers are valid",
        ],
        uninstallPaths: [`${claudeHome}/rules/intero.md`],
      },
      options,
    );
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
  installPlan: (home, executable, executablePrefixArgs = [], options) => {
    const openCodeHome =
      process.env.OPENCODE_CONFIG_DIR || `${home}/.config/opencode`;
    return narrowInstallPlan(
      {
        adapter: "opencode",
        allowedRoots: [home, openCodeHome],
        files: [
          {
            path: `${openCodeHome}/intero.md`,
            format: "markdown",
            marker: "intero-managed",
            content: INSTRUCTION_CONTENT,
            role: "instructions",
          },
          {
            path: `${openCodeHome}/opencode.json`,
            format: "jsonc",
            marker: "intero-managed",
            // OpenCode registers the MCP server and the instructions file in one
            // document. It has no Agent Plugins support, so this target is never
            // narrowed and the combined role stays unambiguous in practice.
            role: "mcp",
            content: JSON.stringify(
              {
                mcp: {
                  intero: {
                    type: "local",
                    command: [
                      executable,
                      ...mcpBridgeArguments("opencode", executablePrefixArgs),
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
            role: "plugin",
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
          MANAGED_MCP_DIAGNOSTIC.opencode,
        ],
        uninstallPaths: [
          `${openCodeHome}/intero.md`,
          `${openCodeHome}/plugins/intero.ts`,
        ],
      },
      options,
    );
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
  installPlan: (home, executable, executablePrefixArgs = [], options) => {
    const grokHome = process.env.GROK_HOME || `${home}/.grok`;
    return narrowInstallPlan(
      {
        adapter: "grok-build",
        allowedRoots: [home, grokHome],
        files: [
          {
            path: `${grokHome}/config.toml`,
            format: "toml",
            marker: "intero-managed",
            content: `[mcp_servers.intero]\ncommand = ${tomlString(executable)}\nargs = [${mcpBridgeArguments("grok-build", executablePrefixArgs).map(tomlString).join(", ")}]\nenabled = true\n`,
            role: "mcp",
          },
        ],
        diagnostics: [
          MANAGED_MCP_DIAGNOSTIC["grok-build"],
          "Run grok mcp doctor intero --json to verify the configured server",
        ],
        uninstallPaths: [],
      },
      options,
    );
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
  installPlan: (home, executable, executablePrefixArgs = [], options) => {
    const cursorHome = `${home}/.cursor`;
    return narrowInstallPlan(
      {
        adapter: "cursor",
        allowedRoots: [home, cursorHome],
        files: [
          {
            path: `${cursorHome}/mcp.json`,
            format: "json",
            marker: "intero-managed",
            role: "mcp",
            content: JSON.stringify(
              {
                mcpServers: {
                  intero: {
                    command: executable,
                    args: mcpBridgeArguments("cursor", executablePrefixArgs),
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
          MANAGED_MCP_DIAGNOSTIC.cursor,
          "Run cursor-agent mcp list to verify the configured server",
        ],
        uninstallPaths: [],
      },
      options,
    );
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

export { INSTRUCTION_CONTENT } from "./instructions.js";
export {
  DEFAULT_BRIDGE_EXECUTABLE,
  mcpBridgeArguments,
  recognizeClientInfoName,
} from "./bridge.js";
export {
  AGENT_PLUGIN_MANIFEST_PATH,
  AGENT_PLUGIN_MCP_PATH,
  AGENT_PLUGIN_MCP_SCHEMA_URL,
  AGENT_PLUGIN_NAME,
  AGENT_PLUGIN_SCHEMA_URL,
  AGENT_PLUGIN_SKILL_PATH,
  AGENT_PLUGIN_SPEC_VERSION,
  AGENT_PLUGIN_VERSION,
  buildAgentPluginArtifact,
  type AgentPluginArtifactOptions,
} from "./agent-plugin.js";
