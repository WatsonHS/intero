import type { IntegrationKind } from "./index.js";

/**
 * The credential-free launcher published by `apps/mcp-stdio` as its `bin`
 * entry. The managed install path always resolves an absolute executable, but
 * the Agent Plugins artifact cannot: the standard forbids placeholder
 * expansion inside `command`, so the published plugin references the launcher
 * that the user installed on PATH (ADR-0011, "Bridge resolution").
 */
export const DEFAULT_BRIDGE_EXECUTABLE = "intero-mcp";

/**
 * Runtime arguments for the direct-cloud stdio bridge. Every managed adapter
 * MCP entry and the Agent Plugins `mcp.json` entry are built from this one
 * function, so the launcher contract has a single origin.
 */
export function mcpBridgeArguments(
  client: IntegrationKind,
  executablePrefixArgs: readonly string[] = [],
): string[] {
  return [...executablePrefixArgs, "--mcp-source", client, "--cloud"];
}

/**
 * MCP `initialize` `clientInfo.name` strings that identify a supported client
 * beyond doubt, lowercased. Each entry matches the exact name or a name that
 * continues past a separator, so `codex-mcp-client` resolves to Codex while
 * `codexample` resolves to nothing.
 *
 * This table is a guard input only (ADR-0011, "Bridge resolution"): the bridge
 * never infers an identity from it. Entries are deliberately conservative,
 * because a wrong match blocks a legitimate user while a missing match only
 * skips the cross-check. Notably `claude-ai` — Claude Desktop and claude.ai —
 * is a different client from `claude-code` and is therefore absent.
 *
 * Observed names, from the published MCP client index
 * (`apify/mcp-client-capabilities`, keyed by `clientInfo.name`):
 * `Codex` and `codex-mcp-client`, `claude-code`, `opencode`, `cursor-vscode`.
 * Grok Build publishes no observed name; its bare product prefix is included
 * because no other client is named `grok`.
 */
const MCP_CLIENT_INFO_PREFIXES: ReadonlyArray<
  readonly [string, IntegrationKind]
> = [
  ["codex", "codex"],
  ["claude-code", "claude-code"],
  ["opencode", "opencode"],
  ["grok", "grok-build"],
  ["cursor", "cursor"],
];

/** Characters that may follow a recognized prefix inside a client name. */
const CLIENT_INFO_PREFIX_SEPARATORS = new Set(["-", "_", ".", " ", "/"]);

/**
 * Resolves an MCP `initialize` `clientInfo.name` to the adapter it identifies,
 * or null when the name is not recognized with high confidence.
 *
 * Null is the safe answer: the caller must treat it as "no information", never
 * as a contradiction.
 */
export function recognizeClientInfoName(name: string): IntegrationKind | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  for (const [prefix, adapter] of MCP_CLIENT_INFO_PREFIXES) {
    if (normalized === prefix) return adapter;
    if (
      normalized.startsWith(prefix) &&
      CLIENT_INFO_PREFIX_SEPARATORS.has(normalized.charAt(prefix.length))
    ) {
      return adapter;
    }
  }
  return null;
}
