import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  clientDeclarationMismatch,
  guardedToolRegistrar,
} from "./client-declaration.js";

type ToolResult = {
  content: { type: string; text: string }[];
  isError?: boolean;
};

/**
 * Serves two tools over a real MCP handshake so the guard sees the same
 * `clientInfo` the SDK records while handling `initialize`.
 */
async function serveGuardedBridge(options: {
  declaredSource:
    "codex" | "claude-code" | "opencode" | "grok-build" | "cursor";
  clientName: string;
}) {
  const server = new McpServer({ name: "intero-cloud", version: "0.1.0" });
  const registerTool = guardedToolRegistrar(server, options.declaredSource);
  const currentContext = vi.fn(() => ({
    content: [{ type: "text" as const, text: '{"status":"connected"}' }],
  }));
  const listWork = vi.fn(() => ({
    content: [{ type: "text" as const, text: '{"items":[]}' }],
  }));
  registerTool(
    "stand_in.current_context",
    { description: "Show the connection.", inputSchema: {} },
    async () => currentContext(),
  );
  registerTool(
    "project.list_work",
    { description: "Read the Project board.", inputSchema: {} },
    async () => listWork(),
  );

  const client = new Client(
    { name: options.clientName, version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return {
    currentContext,
    listWork,
    async call(name: string) {
      return (await client.callTool({
        name,
        arguments: {},
      })) as unknown as ToolResult;
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

describe("bridge declaration cross-check", () => {
  it("fails closed with one actionable message when a recognized client contradicts the declared source", async () => {
    const bridge = await serveGuardedBridge({
      declaredSource: "codex",
      clientName: "cursor-vscode",
    });

    const first = await bridge.call("stand_in.current_context");
    const second = await bridge.call("project.list_work");

    expect(first.isError).toBe(true);
    expect(second.isError).toBe(true);
    // No partial service: neither tool body runs in a mismatched session.
    expect(bridge.currentContext).not.toHaveBeenCalled();
    expect(bridge.listWork).not.toHaveBeenCalled();
    // One message, not a per-tool variant.
    expect(second.content[0]?.text).toBe(first.content[0]?.text);
    const message = first.content[0]?.text ?? "";
    expect(message).toContain("--mcp-source codex");
    expect(message).toContain('"cursor-vscode"');
    expect(message).toContain("Agent Plugin artifact published for cursor");
    expect(message).toContain("--mcp-source cursor");
    await bridge.close();
  });

  it("serves normally when the recognized client matches the declared source", async () => {
    const bridge = await serveGuardedBridge({
      declaredSource: "codex",
      clientName: "codex-mcp-client",
    });

    const response = await bridge.call("stand_in.current_context");

    expect(response.isError).toBeFalsy();
    expect(response.content[0]?.text).toBe('{"status":"connected"}');
    expect(bridge.currentContext).toHaveBeenCalledTimes(1);
    await bridge.close();
  });

  it("does not block an unrecognized client", async () => {
    const bridge = await serveGuardedBridge({
      declaredSource: "codex",
      clientName: "some-internal-harness",
    });

    const response = await bridge.call("project.list_work");

    expect(response.isError).toBeFalsy();
    expect(response.content[0]?.text).toBe('{"items":[]}');
    expect(bridge.listWork).toHaveBeenCalledTimes(1);
    await bridge.close();
  });

  it("names the managed integration for a detected client that has no published plugin", () => {
    const message = clientDeclarationMismatch("cursor", {
      name: "claude-code",
    });

    expect(message).toContain("--mcp-source cursor");
    expect(message).toContain('"claude-code"');
    expect(message).toContain(
      "Reinstall the Intero managed integration for claude-code",
    );
    expect(message).not.toContain("Agent Plugin artifact");
  });

  it("treats a missing or unrecognized clientInfo as no information", () => {
    expect(clientDeclarationMismatch("codex", undefined)).toBeNull();
    expect(clientDeclarationMismatch("codex", {})).toBeNull();
    expect(clientDeclarationMismatch("codex", { name: "" })).toBeNull();
    expect(
      clientDeclarationMismatch("codex", { name: "claude-ai" }),
    ).toBeNull();
    expect(clientDeclarationMismatch("codex", { name: "Codex" })).toBeNull();
  });
});

describe("bridge declaration cross-check boundary", () => {
  const bridgeSource = readFileSync(
    new URL("./index.ts", import.meta.url),
    "utf8",
  );
  const hookSource = readFileSync(
    new URL("./hook.ts", import.meta.url),
    "utf8",
  );

  function bridgeFunctionBody(name: string): string {
    const start = bridgeSource.indexOf(`async function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const end = bridgeSource.indexOf("\nasync function ", start + 1);
    return bridgeSource.slice(start, end === -1 ? bridgeSource.length : end);
  }

  it("routes every served tool through the guard", () => {
    // A direct `server.registerTool` call would serve one tool outside the
    // cross-check, which is exactly the partial-service state ADR-0011 forbids.
    expect(bridgeSource).not.toContain("server.registerTool(");
    expect(bridgeSource.match(/guardedToolRegistrar\(/g)).toHaveLength(1);
    expect(bridgeFunctionBody("runCloudMcpServer")).toContain(
      "guardedToolRegistrar(",
    );
  });

  it("leaves the --hook-source and CLI paths untouched", () => {
    for (const path of [
      "runIntegrationManagement",
      "runCloudCommand",
      "runMcpServer",
    ]) {
      expect(bridgeFunctionBody(path)).not.toContain("guardedToolRegistrar");
      expect(bridgeFunctionBody(path)).not.toContain("registerTool(");
    }
    expect(hookSource).not.toContain("client-declaration");
    expect(hookSource).not.toContain("guardedToolRegistrar");
  });
});
