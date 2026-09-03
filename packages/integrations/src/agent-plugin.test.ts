import { describe, expect, it } from "vitest";

import {
  AGENT_PLUGIN_MANIFEST_PATH,
  AGENT_PLUGIN_MCP_PATH,
  AGENT_PLUGIN_SKILL_PATH,
  AGENT_PLUGIN_SPEC_VERSION,
  buildAgentPluginArtifact,
  codexAdapter,
  cursorAdapter,
  standardPluginClients,
} from "./index.js";

/** Every top-level key Agent Plugins 1.0.0 allows in plugin.json. */
const ALLOWED_MANIFEST_KEYS = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
]);

function artifact(client: (typeof standardPluginClients)[number]) {
  return buildAgentPluginArtifact({ client });
}

function manifest(client: (typeof standardPluginClients)[number]) {
  return JSON.parse(
    artifact(client).get(AGENT_PLUGIN_MANIFEST_PATH)!,
  ) as Record<string, unknown>;
}

function mcp(client: (typeof standardPluginClients)[number]) {
  return JSON.parse(artifact(client).get(AGENT_PLUGIN_MCP_PATH)!) as {
    $schema: string;
    mcpServers: Record<
      string,
      { type: string; command: string; args: string[]; env?: unknown }
    >;
  };
}

describe("Agent Plugins artifact", () => {
  it.each(standardPluginClients)(
    "generates byte-identical %s output on every build",
    (client) => {
      const first = buildAgentPluginArtifact({ client });
      const second = buildAgentPluginArtifact({ client });
      expect([...second.keys()]).toEqual([...first.keys()]);
      for (const [path, content] of first) {
        expect(second.get(path)).toBe(content);
      }
      expect([...first.keys()]).toEqual([
        AGENT_PLUGIN_MANIFEST_PATH,
        AGENT_PLUGIN_MCP_PATH,
        AGENT_PLUGIN_SKILL_PATH,
      ]);
    },
  );

  it("publishes one plugin identity for every standard-capable client", () => {
    const identities = standardPluginClients.map((client) =>
      artifact(client).get(AGENT_PLUGIN_MANIFEST_PATH),
    );
    expect(new Set(identities).size).toBe(1);
  });

  it("declares only the fields the 1.0.0 manifest permits", () => {
    const document = manifest("codex");
    expect(document.$schema).toBe(
      `https://agent-plugins.org/schemas/${AGENT_PLUGIN_SPEC_VERSION}/plugin.schema.json`,
    );
    expect(document.name).toBe("intero");
    expect(document.name as string).toMatch(
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/,
    );
    expect((document.name as string).length).toBeGreaterThanOrEqual(1);
    expect((document.name as string).length).toBeLessThanOrEqual(64);
    expect(document.version as string).toMatch(/^\d+\.\d+\.\d+$/);
    for (const key of Object.keys(document)) {
      expect(ALLOWED_MANIFEST_KEYS).toContain(key);
    }
    expect(document).not.toHaveProperty("extensions");
  });

  it("registers one stdio bridge without placeholder expansion in command", () => {
    for (const client of standardPluginClients) {
      const document = mcp(client);
      expect(document.$schema).toBe(
        `https://agent-plugins.org/schemas/${AGENT_PLUGIN_SPEC_VERSION}/mcp.schema.json`,
      );
      expect(Object.keys(document.mcpServers)).toEqual(["intero"]);
      const server = document.mcpServers.intero!;
      expect(server.type).toBe("stdio");
      expect(server.command).toBe("intero-mcp");
      expect(server.command).not.toContain("${PLUGIN_ROOT}");
      expect(server.command).not.toContain("${PLUGIN_DATA}");
      expect(server.env).toBeUndefined();
    }
  });

  it("pins mcp.json to the same specification version as plugin.json", () => {
    for (const client of standardPluginClients) {
      const schemaVersion = (value: string) =>
        value.match(/\/schemas\/([^/]+)\//)?.[1];
      expect(schemaVersion(mcp(client).$schema)).toBe(
        schemaVersion(manifest(client).$schema as string),
      );
    }
  });

  it("launches the same bridge arguments the managed adapters generate", () => {
    const codexManagedArguments = JSON.parse(
      `[${
        codexAdapter
          .installPlan("/Users/example", "/opt/intero-mcp")
          .files.find((file) => file.role === "mcp")!
          .content.match(/args = \[(.*)\]/)![1]!
      }]`,
    ) as string[];
    expect(mcp("codex").mcpServers.intero!.args).toEqual(codexManagedArguments);

    const cursorManagedEntry = JSON.parse(
      cursorAdapter
        .installPlan("/Users/example", "/opt/intero-mcp")
        .files.find((file) => file.role === "mcp")!.content,
    ) as { mcpServers: { intero: { args: string[] } } };
    expect(mcp("cursor").mcpServers.intero!.args).toEqual(
      cursorManagedEntry.mcpServers.intero.args,
    );
  });

  it("supports an executable and wrapper override like installPlan", () => {
    const document = JSON.parse(
      buildAgentPluginArtifact({
        client: "codex",
        executable: "cmd.exe",
        executablePrefixArgs: ["/d", "/s", "/c", "C:\\Intero\\intero-mcp.cmd"],
      }).get(AGENT_PLUGIN_MCP_PATH)!,
    ) as { mcpServers: { intero: { command: string; args: string[] } } };
    expect(document.mcpServers.intero.command).toBe("cmd.exe");
    expect(document.mcpServers.intero.args).toEqual([
      "/d",
      "/s",
      "/c",
      "C:\\Intero\\intero-mcp.cmd",
      "--mcp-source",
      "codex",
      "--cloud",
    ]);
  });

  it("derives the skill body from the managed instruction source", () => {
    const skill = artifact("codex").get(AGENT_PLUGIN_SKILL_PATH)!;
    expect(skill.startsWith("---\nname: intero\ndescription: ")).toBe(true);
    expect(skill).toContain("\n---\n\n# Intero coordination\n");
    expect(skill).toContain(
      "After understanding the first user request in each new conversation",
    );
    expect(skill).toContain(
      "Use the Intero MCP tools only at semantic branch points.",
    );
    const managedInstructions = codexAdapter
      .installPlan("/Users/example", "/opt/intero-mcp")
      .files.find((file) => file.role === "instructions")!.content;
    expect(skill.endsWith(managedInstructions)).toBe(true);
  });

  it("carries no credential, identifier, or vendor extension payload", () => {
    const forbiddenKey =
      /ticket|credential|token|secret|bearer|authorization|password|project|binding|workspace|member|principal|extensions/i;
    const forbiddenValue =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|ticket_|Bearer |\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/i;
    const collectKeys = (value: unknown, keys: string[] = []): string[] => {
      if (Array.isArray(value)) {
        for (const item of value) collectKeys(item, keys);
      } else if (value && typeof value === "object") {
        for (const [key, nested] of Object.entries(value)) {
          keys.push(key);
          collectKeys(nested, keys);
        }
      }
      return keys;
    };

    for (const client of standardPluginClients) {
      for (const [path, content] of artifact(client)) {
        // Prose may say "credential-free"; no field may carry the thing.
        expect(content).not.toMatch(forbiddenValue);
        if (!path.endsWith(".json")) continue;
        for (const key of collectKeys(JSON.parse(content))) {
          expect(key).not.toMatch(forbiddenKey);
        }
      }
    }
  });
});
