import type { WorkspaceId } from "@intero/domain";
import { uuidv7 } from "@intero/domain";
import { describe, expect, it } from "vitest";

import {
  adapterSupportsStandardPlugin,
  cloudWorkspaceClientFiles,
  codexAdapter,
  cursorAdapter,
  integrationAdapters,
  integrationVersionIsSupported,
  standardPluginClients,
  standardPluginIsSupported,
} from "./index.js";

describe("IntegrationAdapter conformance", () => {
  const workspaceId = uuidv7() as WorkspaceId;

  it("isolates encrypted client state by repository without exposing its path", () => {
    const first = cloudWorkspaceClientFiles(
      "/Users/alex",
      "/workspaces/project-a",
      "cursor",
    );
    const repeated = cloudWorkspaceClientFiles(
      "/Users/alex",
      "/workspaces/project-a",
      "cursor",
    );
    const second = cloudWorkspaceClientFiles(
      "/Users/alex",
      "/workspaces/project-b",
      "cursor",
    );

    expect(first).toEqual(repeated);
    expect(first.directory).not.toBe(second.directory);
    expect(first.directory).not.toContain("project-a");
    expect(second.directory).not.toContain("project-b");
  });

  it.each(integrationAdapters)(
    "$kind exposes MCP and strips unknown metadata",
    (adapter) => {
      const eventName =
        adapter.kind === "opencode" ? "session.created" : "SessionStart";
      const normalized = adapter.normalize({
        sourceEvent: eventName,
        workspaceId,
        metadata: { summary: "Session began", rawNoise: "must be dropped" },
      });
      expect(adapter.capabilities.mcp).toBe(true);
      expect(normalized.success).toBe(
        adapter.kind !== "grok-build" && adapter.kind !== "cursor",
      );
      if (adapter.kind === "grok-build" || adapter.kind === "cursor") {
        expect(adapter.capabilities.lifecycleHooks).toBe(false);
      }
      if (normalized.success)
        expect(normalized.data.payload).toEqual({ summary: "Session began" });
    },
  );

  it.each(integrationAdapters)(
    "$kind rejects forbidden nested fields",
    (adapter) => {
      const eventName =
        adapter.kind === "opencode" ? "session.created" : "SessionStart";
      expect(
        adapter.normalize({
          sourceEvent: eventName,
          workspaceId,
          metadata: { nested: { prompt: "private" } },
        }).success,
      ).toBe(false);
    },
  );

  it("accepts lifecycle events only and makes retries idempotent", () => {
    const input = {
      sourceEvent: "SessionStart",
      workspaceId,
      sessionId: "session-123",
      eventId: "event-456",
      occurredAt: "2026-07-25T00:00:00.000Z",
    };
    const first = integrationAdapters[0].normalize(input);
    const second = integrationAdapters[0].normalize(input);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (first.success && second.success) {
      expect(first.data.idempotencyKey).toBe(second.data.idempotencyKey);
    }
    expect(
      integrationAdapters[0].normalize({
        ...input,
        sourceEvent: "PostToolUse",
        metadata: { tool_input: "CANARY_PRIVATE_TOOL_INPUT" },
      }).success,
    ).toBe(false);
    expect(
      integrationAdapters[0].normalize({
        ...input,
        sourceEvent: "Stop",
      }).success,
    ).toBe(false);
  });

  it("generates auto-loaded instructions and source-bound MCP commands", () => {
    const home = "/Users/example";
    const plans = integrationAdapters.map((adapter) =>
      adapter.installPlan(home, "/opt/intero-mcp"),
    );
    expect(
      plans[0]!.files.some((file) => file.path.endsWith("AGENTS.md")),
    ).toBe(true);
    expect(
      plans[1]!.files.some((file) => file.path.endsWith("rules/intero.md")),
    ).toBe(true);
    expect(
      plans.every((plan) =>
        plan.files.some((file) => file.content.includes("--cloud")),
      ),
    ).toBe(true);
    expect(
      plans
        .filter(
          (plan) => plan.adapter !== "grok-build" && plan.adapter !== "cursor",
        )
        .every((plan) =>
          plan.files.some((file) =>
            file.content.includes(
              "After understanding the first user request in each new conversation",
            ),
          ),
        ),
    ).toBe(true);
    expect(plans[2]!.files.at(-1)?.content).toContain("event_id: randomUUID()");
    const grokPlan = plans.find((plan) => plan.adapter === "grok-build")!;
    expect(grokPlan.files).toHaveLength(1);
    expect(grokPlan.files[0]!.path).toBe("/Users/example/.grok/config.toml");
    expect(grokPlan.files[0]!.content).toContain("[mcp_servers.intero]");
    expect(grokPlan.files[0]!.content).toContain('"grok-build"');
    expect(grokPlan.files[0]!.content).not.toContain("hook");
    const cursorPlan = plans.find((plan) => plan.adapter === "cursor")!;
    expect(cursorPlan.files).toHaveLength(1);
    expect(cursorPlan.files[0]!.path).toBe("/Users/example/.cursor/mcp.json");
    expect(JSON.parse(cursorPlan.files[0]!.content)).toEqual({
      mcpServers: {
        intero: {
          command: "/opt/intero-mcp",
          args: ["--mcp-source", "cursor", "--cloud"],
          env: {},
        },
      },
    });
  });

  it("distinguishes repeated OpenCode idle transitions", () => {
    const adapter = integrationAdapters.find(
      (candidate) => candidate.kind === "opencode",
    )!;
    const first = adapter.normalize({
      sourceEvent: "session.idle",
      workspaceId,
      sessionId: "session-123",
      eventId: "idle-1",
    });
    const second = adapter.normalize({
      sourceEvent: "session.idle",
      workspaceId,
      sessionId: "session-123",
      eventId: "idle-2",
    });
    expect(first.success && second.success).toBe(true);
    if (first.success && second.success) {
      expect(first.data.idempotencyKey).not.toBe(second.data.idempotencyKey);
    }
  });

  it("applies a wrapper prefix to every managed command", () => {
    const prefix = [
      "/d",
      "/s",
      "/c",
      "C:\\Program Files\\Intero\\intero-mcp.cmd",
    ];
    const plans = integrationAdapters.map((adapter) =>
      adapter.installPlan("C:\\Users\\example", "cmd.exe", prefix),
    );
    for (const plan of plans) {
      expect(
        plan.files.every(
          (file) =>
            file.content.includes("cmd.exe") || file.format === "markdown",
        ),
      ).toBe(true);
      expect(
        plan.files.some((file) => file.content.includes("intero-mcp.cmd")),
      ).toBe(true);
    }
    expect(
      plans[0]!.files.find((file) => file.path.endsWith("hooks.json"))?.content,
    ).toContain('"commandWindows"');
  });

  it("enforces the published minimum Agent versions", () => {
    expect(integrationVersionIsSupported("codex", "codex-cli 0.146.0")).toBe(
      true,
    );
    expect(integrationVersionIsSupported("claude-code", "2.1.139")).toBe(false);
    expect(integrationVersionIsSupported("claude-code", "2.1.140")).toBe(true);
    expect(integrationVersionIsSupported("opencode", "1.4.10")).toBe(false);
    expect(integrationVersionIsSupported("grok-build", "0.1.0")).toBe(true);
    expect(integrationVersionIsSupported("cursor", "0.0.1")).toBe(true);
  });

  it("limits Agent Plugins standard support to its launch clients", () => {
    expect([...standardPluginClients]).toEqual(["codex", "cursor"]);
    expect(
      integrationAdapters
        .filter((adapter) => adapterSupportsStandardPlugin(adapter.kind))
        .map((adapter) => adapter.kind),
    ).toEqual([...standardPluginClients]);
    // Claude Code ships a near-identical native plugin format that is not the
    // standard; OpenCode and Grok Build have announced no support.
    expect(adapterSupportsStandardPlugin("claude-code")).toBe(false);
    expect(standardPluginIsSupported("claude-code", "9.9.9")).toBe(false);
    expect(standardPluginIsSupported("opencode", "9.9.9")).toBe(false);
    expect(standardPluginIsSupported("grok-build", "9.9.9")).toBe(false);
    expect(standardPluginIsSupported("codex", "codex-cli 0.145.9")).toBe(false);
    expect(standardPluginIsSupported("codex", "codex-cli 0.146.0")).toBe(true);
    expect(standardPluginIsSupported("cursor", "0.0.1")).toBe(true);
    expect(standardPluginIsSupported("cursor", "no version here")).toBe(false);
  });

  it("narrows a hybrid plan to what the standard cannot express", () => {
    const home = "/Users/example";
    const full = codexAdapter.installPlan(home, "/opt/intero-mcp");
    const hybrid = codexAdapter.installPlan(home, "/opt/intero-mcp", [], {
      bridgeRegistration: "standard_plugin",
    });

    expect(full.files.map((file) => file.role)).toEqual([
      "instructions",
      "mcp",
      "hooks",
    ]);
    expect(hybrid.files.map((file) => file.role)).toEqual([
      "instructions",
      "hooks",
    ]);
    expect(hybrid.files.map((file) => file.path)).toEqual([
      `${home}/.codex/AGENTS.md`,
      `${home}/.codex/hooks.json`,
    ]);
    expect(hybrid.files.some((file) => file.path.endsWith("config.toml"))).toBe(
      false,
    );
    expect(hybrid.diagnostics).not.toContain(
      "Codex config contains mcp_servers.intero",
    );
    expect(hybrid.diagnostics).toContain(
      "The intero Agent Plugin owns the MCP bridge registration; no managed MCP entry is written",
    );
    expect(hybrid.allowedRoots).toEqual(full.allowedRoots);

    // The default and the explicit managed mode stay the full plan.
    expect(
      codexAdapter.installPlan(home, "/opt/intero-mcp", [], {
        bridgeRegistration: "managed",
      }),
    ).toEqual(full);
    expect(codexAdapter.installPlan(home, "/opt/intero-mcp", [])).toEqual(full);
  });

  it("leaves a hooks-free standard client with nothing managed to write", () => {
    const hybrid = cursorAdapter.installPlan("/Users/example", "/opt/mcp", [], {
      bridgeRegistration: "standard_plugin",
    });
    expect(hybrid.files).toEqual([]);
    expect(hybrid.diagnostics).toContain(
      "The intero Agent Plugin owns the MCP bridge registration; no managed MCP entry is written",
    );
  });

  it("refuses to narrow a client without Agent Plugins support", () => {
    for (const adapter of integrationAdapters.filter(
      (candidate) => !adapterSupportsStandardPlugin(candidate.kind),
    )) {
      expect(() =>
        adapter.installPlan("/Users/example", "/opt/intero-mcp", [], {
          bridgeRegistration: "standard_plugin",
        }),
      ).toThrow(/no Agent Plugins standard support/);
    }
  });
});
