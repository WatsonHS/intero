import { DEFAULT_BRIDGE_EXECUTABLE, mcpBridgeArguments } from "./bridge.js";
import { INSTRUCTION_CONTENT } from "./instructions.js";
import type { StandardPluginClient } from "./index.js";

/**
 * The Agent Plugins specification version this artifact targets. Pinning the
 * identifier is the only protection ADR-0011 claims against specification
 * churn, so it is single-sourced and used for every `$schema` reference.
 */
export const AGENT_PLUGIN_SPEC_VERSION = "1.0.0";

/** Published plugin identity. Must stay a valid 1.0.0 `name` (1-64 chars). */
export const AGENT_PLUGIN_NAME = "intero";

/** Version of the published artifact itself, independent of the spec version. */
export const AGENT_PLUGIN_VERSION = "1.0.0";

export const AGENT_PLUGIN_SCHEMA_URL = `https://agent-plugins.org/schemas/${AGENT_PLUGIN_SPEC_VERSION}/plugin.schema.json`;

export const AGENT_PLUGIN_MCP_SCHEMA_URL = `https://agent-plugins.org/schemas/${AGENT_PLUGIN_SPEC_VERSION}/mcp.schema.json`;

/** Relative paths emitted by {@link buildAgentPluginArtifact}, in order. */
export const AGENT_PLUGIN_MANIFEST_PATH = "plugin.json";
export const AGENT_PLUGIN_MCP_PATH = "mcp.json";
export const AGENT_PLUGIN_SKILL_PATH = `skills/${AGENT_PLUGIN_NAME}/SKILL.md`;

export interface AgentPluginArtifactOptions {
  /**
   * The standard-capable client whose bridge session this plugin registers.
   * The stdio bridge resolves encrypted connection state per repository *and*
   * client (ADR-0010), so `--mcp-source` cannot be omitted or shared.
   */
  client: StandardPluginClient;
  /**
   * Launcher command. Defaults to the PATH-installed launcher because the
   * specification forbids `${PLUGIN_ROOT}` expansion inside `command`.
   */
  executable?: string;
  /** Wrapper prefix arguments, mirroring `IntegrationAdapter.installPlan`. */
  executablePrefixArgs?: readonly string[];
}

/**
 * Builds the published `intero` Agent Plugin as an ordered map of relative
 * path to file content.
 *
 * The result is a pure function of its options: no timestamps, no randomness,
 * and stable key ordering, so two builds are byte-identical (ADR-0011
 * acceptance evidence 8). The artifact is public and credential-free: it
 * carries no ticket, token, Project, member, binding, or workspace identifier,
 * and declares no `extensions` payload.
 */
export function buildAgentPluginArtifact(
  options: AgentPluginArtifactOptions,
): Map<string, string> {
  const executable = options.executable ?? DEFAULT_BRIDGE_EXECUTABLE;
  return new Map([
    [AGENT_PLUGIN_MANIFEST_PATH, pluginManifest()],
    [
      AGENT_PLUGIN_MCP_PATH,
      mcpManifest(
        executable,
        mcpBridgeArguments(options.client, options.executablePrefixArgs),
      ),
    ],
    [AGENT_PLUGIN_SKILL_PATH, skillDocument()],
  ]);
}

function pluginManifest(): string {
  return jsonDocument({
    $schema: AGENT_PLUGIN_SCHEMA_URL,
    name: AGENT_PLUGIN_NAME,
    version: AGENT_PLUGIN_VERSION,
    description:
      "Register the credential-free Intero launcher and the Intero coordination skill. Installing this plugin registers a bridge; it does not create, authorize, or restore an Intero attachment.",
    license: "Apache-2.0",
    keywords: ["intero", "coordination", "work-state", "mcp"],
  });
}

function mcpManifest(executable: string, args: readonly string[]): string {
  return jsonDocument({
    $schema: AGENT_PLUGIN_MCP_SCHEMA_URL,
    mcpServers: {
      [AGENT_PLUGIN_NAME]: {
        type: "stdio",
        // `command` never carries ${PLUGIN_ROOT}/${PLUGIN_DATA}: the
        // specification does not expand placeholders there. The launcher is
        // resolved from PATH by the client.
        command: executable,
        args: [...args],
      },
    },
  });
}

function skillDocument(): string {
  const frontmatter = [
    "---",
    `name: ${AGENT_PLUGIN_NAME}`,
    "description: Coordinate work through Intero. Use when a repository is attached to an Intero Project and work reaches a semantic branch point such as an intent, decision, blocker, dependency, scope change, artifact, validation outcome, pause, or completion.",
    "---",
    "",
  ].join("\n");
  return `${frontmatter}\n${INSTRUCTION_CONTENT}`;
}

function jsonDocument(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
