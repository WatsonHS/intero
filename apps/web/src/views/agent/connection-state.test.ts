import { describe, expect, it } from "vitest";
import { PILOT_AGENT_CONFIGURATION_VERSION } from "@intero/domain";

import type { PilotSafeAgentBinding } from "../../pilot/api.js";
import { summarizeProjectAgentConnections } from "./connection-state.js";

function binding(
  input: Partial<PilotSafeAgentBinding> &
    Pick<PilotSafeAgentBinding, "id" | "ownerId">,
): PilotSafeAgentBinding {
  return {
    projectId: "018f0000-0000-7000-8000-000000000001" as never,
    client: "codex",
    name: "Codex · repository",
    workspaceId: "018f0000-0000-7000-8000-000000000002",
    preferredLanguage: "zh-CN",
    createdAt: "2026-07-27T00:00:00.000Z",
    ...input,
  };
}

describe("summarizeProjectAgentConnections", () => {
  it("distinguishes project-wide connections from the current member's", () => {
    const result = summarizeProjectAgentConnections(
      [
        binding({
          id: "018f0000-0000-7000-8000-000000000010",
          ownerId: "018f0000-0000-7000-8000-000000000020" as never,
          validatedAt: "2026-07-27T00:01:00.000Z",
          activityUpdatedAt: "2026-07-27T00:01:30.000Z",
          configurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
        }),
        binding({
          id: "018f0000-0000-7000-8000-000000000011",
          ownerId: "018f0000-0000-7000-8000-000000000021" as never,
          validatedAt: "2026-07-27T00:02:00.000Z",
        }),
        binding({
          id: "018f0000-0000-7000-8000-000000000012",
          ownerId: "018f0000-0000-7000-8000-000000000021" as never,
          mcpInitializedAt: "2026-07-27T00:03:00.000Z",
        }),
        binding({
          id: "018f0000-0000-7000-8000-000000000013",
          ownerId: "018f0000-0000-7000-8000-000000000021" as never,
          validatedAt: "2026-07-27T00:04:00.000Z",
          activityUpdatedAt: "2026-07-27T00:04:30.000Z",
        }),
      ],
      "018f0000-0000-7000-8000-000000000021",
    );

    expect(result.connected).toHaveLength(1);
    expect(result.outdated).toHaveLength(1);
    expect(result.lifecyclePending).toHaveLength(1);
    expect(result.pending).toHaveLength(1);
    expect(result.mineConnected).toHaveLength(0);
    expect(result.mineOutdated).toHaveLength(1);
    expect(result.mineLifecyclePending).toHaveLength(1);
    expect(result.minePending).toHaveLength(1);
  });

  it("does not count disconnected bindings", () => {
    const result = summarizeProjectAgentConnections([
      binding({
        id: "018f0000-0000-7000-8000-000000000012",
        ownerId: "018f0000-0000-7000-8000-000000000022" as never,
        validatedAt: "2026-07-27T00:01:00.000Z",
        activityUpdatedAt: "2026-07-27T00:02:00.000Z",
        configurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
        disconnectedAt: "2026-07-27T00:03:00.000Z",
      }),
    ]);

    expect(result.connected).toHaveLength(0);
    expect(result.outdated).toHaveLength(0);
    expect(result.lifecyclePending).toHaveLength(0);
    expect(result.pending).toHaveLength(0);
  });

  it("does not count retired OAuth bindings as active connections", () => {
    const result = summarizeProjectAgentConnections([
      binding({
        id: "018f0000-0000-7000-8000-000000000013",
        ownerId: "018f0000-0000-7000-8000-000000000022" as never,
        authMode: "oauth",
        validatedAt: "2026-07-27T00:01:00.000Z",
        activityUpdatedAt: "2026-07-27T00:02:00.000Z",
        configurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
      }),
    ]);

    expect(result.connected).toHaveLength(0);
    expect(result.outdated).toHaveLength(0);
    expect(result.lifecyclePending).toHaveLength(0);
    expect(result.pending).toHaveLength(0);
  });

  it.each([
    ["grok-build", "Grok Build"],
    ["cursor", "Cursor"],
  ] as const)(
    "treats validated %s as connected without inventing a lifecycle hook",
    (client, name) => {
      const result = summarizeProjectAgentConnections([
        binding({
          id: "018f0000-0000-7000-8000-000000000014",
          ownerId: "018f0000-0000-7000-8000-000000000022" as never,
          client,
          name: `${name} · repository`,
          validatedAt: "2026-08-05T00:01:00.000Z",
          configurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
        }),
      ]);

      expect(result.connected).toHaveLength(1);
      expect(result.lifecyclePending).toHaveLength(0);
    },
  );
});
