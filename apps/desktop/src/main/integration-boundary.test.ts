import { describe, expect, it } from "vitest";

import {
  digestIntegrationPlan,
  grokBuildMcpProbeIsValid,
  parseIntegrationPreviewRequest,
  parseWorkspaceCleanupRequest,
  rendererUrlIsTrusted,
  requireProjectRepositoryBinding,
  requireWorkspaceCleanupBinding,
} from "./integration-boundary.js";

const projectId = "019fcdb4-a6da-7332-8e7e-d907b98d02ee";
const selection = {
  token: "repository-selection-token-123",
  senderId: 42,
  repositoryPath: "/private/work/intero",
  workspaceId: "019fcdb4-a6da-7332-8e7e-d907b98d02f1",
  expiresAt: 20_000,
  consumed: false,
};

describe("desktop integration boundary", () => {
  it("requires a fresh same-renderer repository selection for attach and repair", () => {
    const input = parseIntegrationPreviewRequest({
      adapter: "codex",
      action: "install",
      locale: "zh-CN",
      projectId,
      repositorySelectionToken: selection.token,
    });

    expect(
      requireProjectRepositoryBinding(input, selection, 42, 10_000),
    ).toEqual({
      projectId,
      repositorySelectionToken: selection.token,
      repositoryPath: selection.repositoryPath,
      workspaceId: selection.workspaceId,
    });
    expect(() =>
      requireProjectRepositoryBinding(input, selection, 7, 10_000),
    ).toThrow("repository selection");
    expect(() =>
      requireProjectRepositoryBinding(
        input,
        { ...selection, consumed: true },
        42,
        10_000,
      ),
    ).toThrow("repository selection");
  });

  it("does not require a Project/repository pair to preview local uninstall", () => {
    const input = parseIntegrationPreviewRequest({
      adapter: "codex",
      action: "uninstall",
      locale: "en-US",
    });

    expect(
      requireProjectRepositoryBinding(input, undefined, 42, 10_000),
    ).toBeUndefined();
  });

  it("rejects attach input without both Project and repository authority", () => {
    const input = parseIntegrationPreviewRequest({
      adapter: "codex",
      action: "repair",
      locale: "en-US",
      projectId,
    });

    expect(() =>
      requireProjectRepositoryBinding(input, undefined, 42, 10_000),
    ).toThrow("require a Project");
  });

  it("binds cleanup to the exact Project, binding, workspace and fresh repository selection", () => {
    const input = parseWorkspaceCleanupRequest({
      adapter: "cursor",
      locale: "zh-CN",
      projectId,
      bindingId: "019fcdb4-a6da-7332-8e7e-d907b98d02ef",
      workspaceId: selection.workspaceId,
      repositorySelectionToken: selection.token,
    });

    expect(
      requireWorkspaceCleanupBinding(input, selection, 42, 10_000),
    ).toEqual({
      projectId,
      bindingId: "019fcdb4-a6da-7332-8e7e-d907b98d02ef",
      workspaceId: selection.workspaceId,
      repositorySelectionToken: selection.token,
      repositoryPath: selection.repositoryPath,
    });
    expect(() =>
      requireWorkspaceCleanupBinding(input, selection, 7, 10_000),
    ).toThrow("repository selection");
    expect(() =>
      requireWorkspaceCleanupBinding(
        parseWorkspaceCleanupRequest({
          ...input,
          workspaceId: "019fcdb4-a6da-7332-8e7e-d907b98d02f0",
        }),
        selection,
        42,
        10_000,
      ),
    ).toThrow("does not match");
  });

  it("binds the preview digest to client, action, targets, Project and repository", () => {
    const plan = {
      files: [
        {
          path: "/Users/example/.codex/config.toml",
          format: "toml",
          marker: "intero",
          content: "[mcp_servers.intero]",
        },
      ],
    };
    const binding = requireProjectRepositoryBinding(
      parseIntegrationPreviewRequest({
        adapter: "codex",
        action: "install",
        locale: "zh-CN",
        projectId,
        repositorySelectionToken: selection.token,
      }),
      selection,
      42,
      10_000,
    )!;
    const digest = digestIntegrationPlan({
      adapter: "codex",
      action: "install",
      targets: [plan.files[0]!.path],
      plan,
      binding,
    });

    expect(
      digestIntegrationPlan({
        ...{
          adapter: "claude-code",
          action: "install" as const,
          targets: [plan.files[0]!.path],
          plan,
          binding,
        },
      }),
    ).not.toBe(digest);
    expect(
      digestIntegrationPlan({
        adapter: "codex",
        action: "repair",
        targets: [plan.files[0]!.path],
        plan,
        binding,
      }),
    ).not.toBe(digest);
    expect(
      digestIntegrationPlan({
        adapter: "codex",
        action: "install",
        targets: ["/tmp/other"],
        plan,
        binding,
      }),
    ).not.toBe(digest);
    expect(
      digestIntegrationPlan({
        adapter: "codex",
        action: "install",
        targets: [plan.files[0]!.path],
        plan,
        binding: {
          ...binding,
          projectId: "019fcdb4-a6da-7332-8e7e-d907b98d02ef",
        },
      }),
    ).not.toBe(digest);
    expect(
      digestIntegrationPlan({
        adapter: "codex",
        action: "install",
        targets: [plan.files[0]!.path],
        plan,
        binding: { ...binding, repositoryPath: "/private/work/other" },
      }),
    ).not.toBe(digest);
  });

  it("requires both official Grok doctor and inspect evidence", () => {
    expect(
      grokBuildMcpProbeIsValid(
        '{"status":"ok","server":"intero"}',
        '{"mcpServers":["intero"]}',
      ),
    ).toBe(true);
    expect(
      grokBuildMcpProbeIsValid(
        '{"status":"ok","server":"intero"}',
        '{"mcpServers":[]}',
      ),
    ).toBe(false);
    expect(
      grokBuildMcpProbeIsValid(
        '{"healthy":false,"server":"intero"}',
        '{"mcpServers":["intero"]}',
      ),
    ).toBe(false);
    expect(
      grokBuildMcpProbeIsValid(
        'not-json but says "healthy"',
        '{"mcpServers":["intero"]}',
      ),
    ).toBe(false);
  });

  it("trusts canonical SPA routes without widening the renderer origin", () => {
    expect(
      rendererUrlIsTrusted(
        "http://localhost:4311/settings/agent",
        "http://localhost:4311/",
      ),
    ).toBe(true);
    expect(
      rendererUrlIsTrusted(
        "http://localhost:4312/settings/agent",
        "http://localhost:4311/",
      ),
    ).toBe(false);
    expect(
      rendererUrlIsTrusted(
        "file:///Applications/Intero/index.html#/settings/agent",
        "file:///Applications/Intero/index.html",
      ),
    ).toBe(true);
    expect(
      rendererUrlIsTrusted(
        "file:///Applications/Intero/other.html#/settings/agent",
        "file:///Applications/Intero/index.html",
      ),
    ).toBe(false);
  });
});
