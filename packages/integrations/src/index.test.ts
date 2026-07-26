import type { WorkspaceId } from "@intero/domain";
import { uuidv7 } from "@intero/domain";
import { describe, expect, it } from "vitest";

import { integrationAdapters, integrationVersionIsSupported } from "./index.js";

describe("IntegrationAdapter conformance", () => {
  const workspaceId = uuidv7() as WorkspaceId;

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
      expect(normalized.success).toBe(true);
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
    expect(plans[2]!.files.at(-1)?.content).toContain("event_id: randomUUID()");
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
  });
});
