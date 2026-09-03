import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AGENT_PLUGIN_NAME,
  adapterSupportsStandardPlugin,
  recognizeClientInfoName,
  type IntegrationKind,
} from "@intero/integrations";

/**
 * The published Agent Plugin artifact varies per client in the `--mcp-source`
 * argument alone, so a Codex-flavored artifact installed into Cursor would
 * masquerade as Codex and resolve another client's encrypted workspace state.
 * ADR-0011 ("Bridge resolution") contains that hazard with one guard: compare
 * the declared source against the `clientInfo` received in MCP `initialize`,
 * fail closed on a recognized contradiction, and never block on an
 * unrecognized name.
 *
 * This is a guard, not inference. It only ever answers "the declaration is
 * provably wrong"; it never selects an identity on the client's behalf.
 */
export function clientDeclarationMismatch(
  declaredSource: IntegrationKind,
  clientInfo: { name?: string } | undefined,
): string | null {
  const reportedName = clientInfo?.name;
  if (!reportedName) return null;
  const detected = recognizeClientInfoName(reportedName);
  if (!detected || detected === declaredSource) return null;
  const artifactFix = adapterSupportsStandardPlugin(detected)
    ? `Install the ${AGENT_PLUGIN_NAME} Agent Plugin artifact published for ${detected}`
    : `Reinstall the Intero managed integration for ${detected}`;
  return (
    `Intero bridge declaration mismatch: this bridge was started with --mcp-source ${declaredSource}, ` +
    `but the connected MCP client identifies itself as "${reportedName}" (${detected}). ` +
    `${artifactFix}, or change this client's MCP configuration to pass --mcp-source ${detected}. ` +
    `Intero serves no tool call until the declared source and the connected client agree.`
  );
}

function declarationMismatchResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: {
      error: "client_declaration_mismatch",
      message,
    },
    isError: true,
  };
}

/**
 * Wraps {@link McpServer.registerTool} so every tool served on the
 * `--mcp-source` MCP path answers the declaration cross-check first.
 *
 * The check reads `clientInfo` lazily through `getClientVersion()`, which the
 * SDK populates while handling the `initialize` request itself. Every
 * `tools/call` is ordered after `initialize` by the protocol, so the value is
 * always present by the time a tool runs, and the guard does not depend on the
 * optional `notifications/initialized` follow-up that some clients omit.
 *
 * A mismatched session gets no partial service: the tool body never runs, and
 * every tool returns the same actionable message.
 */
export function guardedToolRegistrar(
  server: McpServer,
  declaredSource: IntegrationKind,
): McpServer["registerTool"] {
  const registerTool: McpServer["registerTool"] = (name, config, callback) =>
    server.registerTool(name, config, ((...args: unknown[]) => {
      const mismatch = clientDeclarationMismatch(
        declaredSource,
        server.server.getClientVersion(),
      );
      if (mismatch) return declarationMismatchResult(mismatch);
      return (callback as (...callbackArgs: unknown[]) => unknown)(...args);
    }) as typeof callback);
  return registerTool;
}
