import type { WorkspaceId } from "@intero/domain";
import { uuidv7 } from "@intero/domain";
import { describe, expect, it } from "vitest";

import { integrationAdapters } from "./index.js";

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
});
