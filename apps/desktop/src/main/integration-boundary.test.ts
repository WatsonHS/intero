import {
  codexAdapter,
  cursorAdapter,
  openCodeAdapter,
  standardPluginIsSupported,
  type IntegrationAdapter,
} from "@intero/integrations";
import { describe, expect, it, vi } from "vitest";

import {
  assertBridgeRegistrationIsInstallable,
  bridgeRegistrationForMutation,
  digestIntegrationPlan,
  grokBuildMcpProbeIsValid,
  parseIntegrationActionRequest,
  parseIntegrationPreviewRequest,
  parseWorkspaceCleanupRequest,
  rendererUrlIsTrusted,
  requireProjectRepositoryBinding,
  requireWorkspaceCleanupBinding,
  resolveBridgeRegistration,
  type BridgeRegistration,
  type BridgeRegistrationEvidence,
  type DigestableIntegrationPlan,
  type IntegrationMutationAction,
} from "./integration-boundary.js";

const projectId = "019fcdb4-a6da-7332-8e7e-d907b98d02ee";
const home = "/Users/example";
const bridgeExecutable = "/opt/intero/intero-mcp";
const selection = {
  token: "repository-selection-token-123",
  senderId: 42,
  repositoryPath: "/private/work/intero",
  workspaceId: "019fcdb4-a6da-7332-8e7e-d907b98d02f1",
  expiresAt: 20_000,
  consumed: false,
};

/**
 * The managed diagnosis Desktop would read for one plan, where `present` marks
 * which managed targets the installer actually wrote.
 */
function diagnose(
  adapter: IntegrationAdapter,
  bridgeRegistration: BridgeRegistration,
  present: (path: string) => boolean,
) {
  return adapter
    .installPlan(home, bridgeExecutable, [], { bridgeRegistration })
    .files.map((file) => ({
      path: file.path,
      ok: present(file.path),
      detail: present(file.path)
        ? "managed content is present"
        : "managed content is missing or changed",
    }));
}

/** A spy over one fixed evidence reading, so unread evidence stays visible. */
function evidenceReader(evidence: BridgeRegistrationEvidence) {
  return vi.fn<() => Promise<BridgeRegistrationEvidence>>(async () => evidence);
}

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

  it("binds the confirmation digest to the narrowed hybrid target set", () => {
    const managed = codexAdapter.installPlan(home, bridgeExecutable);
    const narrowed = codexAdapter.installPlan(home, bridgeExecutable, [], {
      bridgeRegistration: "standard_plugin",
    });
    const digestOf = (plan: DigestableIntegrationPlan) =>
      digestIntegrationPlan({
        adapter: "codex",
        action: "repair",
        targets: plan.files.map((file) => file.path),
        plan,
      });

    expect(digestOf(narrowed)).not.toBe(digestOf(managed));
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

describe("ADR-0011 bridge registration", () => {
  it("recognizes a plugin-registered client whose managed MCP entry is absent", () => {
    const managedDiagnostics = diagnose(
      codexAdapter,
      "managed",
      (path) => !path.endsWith("config.toml"),
    );
    const standardPluginDiagnostics = diagnose(
      codexAdapter,
      "standard_plugin",
      () => true,
    );
    const probe = vi.fn<() => "valid">(() => "valid");

    const resolved = resolveBridgeRegistration({
      managedDiagnostics,
      standardPluginDiagnostics,
      probe,
    });

    expect(resolved.bridgeRegistration).toBe("standard_plugin");
    expect(resolved.complete).toBe(true);
    expect(resolved.configurationState).toBe("valid");
    // Only what the standard cannot express is reported as Intero-managed.
    expect(resolved.diagnostics).toEqual(standardPluginDiagnostics);
    expect(
      resolved.diagnostics.some((item) => item.path.endsWith("config.toml")),
    ).toBe(false);
    expect(
      resolved.diagnostics.some((item) => item.path.endsWith("hooks.json")),
    ).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("accepts a hooks-free standard client with no managed target left", () => {
    const standardPluginDiagnostics = diagnose(
      cursorAdapter,
      "standard_plugin",
      () => true,
    );
    expect(standardPluginDiagnostics).toEqual([]);

    expect(
      resolveBridgeRegistration({
        managedDiagnostics: diagnose(cursorAdapter, "managed", () => false),
        standardPluginDiagnostics,
        probe: () => "valid",
      }),
    ).toEqual({
      bridgeRegistration: "standard_plugin",
      diagnostics: [],
      complete: true,
      configurationState: "valid",
    });
  });

  it("never probes a client without Agent Plugins standard support", () => {
    const managedDiagnostics = diagnose(
      openCodeAdapter,
      "managed",
      () => false,
    );
    const probe = vi.fn<() => "valid">(() => "valid");

    const resolved = resolveBridgeRegistration({ managedDiagnostics, probe });

    expect(resolved).toEqual({
      bridgeRegistration: "managed",
      diagnostics: managedDiagnostics,
      complete: false,
      configurationState: undefined,
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it("keeps a complete managed install on the managed reading", () => {
    const managedDiagnostics = diagnose(codexAdapter, "managed", () => true);

    expect(
      resolveBridgeRegistration({
        managedDiagnostics,
        standardPluginDiagnostics: diagnose(
          codexAdapter,
          "standard_plugin",
          () => true,
        ),
        probe: () => "runtime_unreachable",
      }),
    ).toEqual({
      bridgeRegistration: "managed",
      diagnostics: managedDiagnostics,
      complete: true,
      configurationState: "runtime_unreachable",
    });
    // An undetected client still has no probe to run.
    expect(
      resolveBridgeRegistration({ managedDiagnostics }).configurationState,
    ).toBeUndefined();
  });

  it("falls back to the managed reading when the probe does not confirm", () => {
    for (const probeResult of ["runtime_unreachable", "invalid"] as const) {
      const managedDiagnostics = diagnose(
        codexAdapter,
        "managed",
        (path) => !path.endsWith("config.toml"),
      );

      expect(
        resolveBridgeRegistration({
          managedDiagnostics,
          standardPluginDiagnostics: diagnose(
            codexAdapter,
            "standard_plugin",
            () => true,
          ),
          probe: () => probeResult,
        }),
      ).toEqual({
        bridgeRegistration: "managed",
        diagnostics: managedDiagnostics,
        complete: false,
        configurationState: undefined,
      });
    }
  });

  it("does not infer hybrid mode while managed hook targets are missing", () => {
    const probe = vi.fn<() => "valid">(() => "valid");

    const resolved = resolveBridgeRegistration({
      managedDiagnostics: diagnose(codexAdapter, "managed", (path) =>
        path.endsWith("AGENTS.md"),
      ),
      standardPluginDiagnostics: diagnose(
        codexAdapter,
        "standard_plugin",
        (path) => path.endsWith("AGENTS.md"),
      ),
      probe,
    });

    expect(resolved.bridgeRegistration).toBe("managed");
    expect(resolved.complete).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  it("narrows a mutation plan only in the plugin-registered condition", async () => {
    const readEvidence = evidenceReader({
      managedMcpRegistration: false,
      pluginBridgeRegistration: true,
    });

    // Detach replays the recorded manifest, so it never narrows and never
    // spends a client probe to decide.
    await expect(
      bridgeRegistrationForMutation({ action: "uninstall", readEvidence }),
    ).resolves.toBe("managed");
    expect(readEvidence).not.toHaveBeenCalled();
    await expect(
      bridgeRegistrationForMutation({ action: "install", readEvidence }),
    ).resolves.toBe("standard_plugin");
    await expect(
      bridgeRegistrationForMutation({
        action: "repair",
        readEvidence: evidenceReader({
          managedMcpRegistration: true,
          pluginBridgeRegistration: false,
        }),
      }),
    ).resolves.toBe("managed");

    const planFor = async (action: IntegrationMutationAction) =>
      codexAdapter.installPlan(home, bridgeExecutable, [], {
        bridgeRegistration: await bridgeRegistrationForMutation({
          action,
          readEvidence,
        }),
      });

    expect((await planFor("repair")).files.map((file) => file.role)).toEqual([
      "instructions",
      "hooks",
    ]);
    expect((await planFor("uninstall")).files.map((file) => file.role)).toEqual(
      ["instructions", "mcp", "hooks"],
    );
  });

  it("keeps the full managed plan without a confirmed plugin registration", async () => {
    for (const evidence of [
      // Nothing installed and no client reading: a fresh attach stays managed
      // rather than assuming a plugin it has not seen.
      { managedMcpRegistration: false, pluginBridgeRegistration: false },
      // Intero wrote the entry the client resolves, so the client reading is
      // evidence of Intero's own install, not of a plugin.
      { managedMcpRegistration: true, pluginBridgeRegistration: true },
    ] satisfies BridgeRegistrationEvidence[]) {
      await expect(
        bridgeRegistrationForMutation({
          action: "install",
          readEvidence: evidenceReader(evidence),
        }),
      ).resolves.toBe("managed");
    }
  });

  it("narrows a partial hybrid repair that the managed reading still calls managed", async () => {
    // Plugin registered, managed hooks and instructions missing. The truthful
    // reading is an incomplete managed install...
    const resolved = resolveBridgeRegistration({
      managedDiagnostics: diagnose(codexAdapter, "managed", () => false),
      standardPluginDiagnostics: diagnose(
        codexAdapter,
        "standard_plugin",
        () => false,
      ),
      probe: () => "valid",
    });
    expect(resolved.bridgeRegistration).toBe("managed");
    expect(resolved.complete).toBe(false);

    // ...but repairing it from a full managed plan would write a second
    // `intero` entry beside the plugin's, so the mutation narrows anyway.
    const bridgeRegistration = await bridgeRegistrationForMutation({
      action: "repair",
      readEvidence: evidenceReader({
        managedMcpRegistration: false,
        pluginBridgeRegistration: true,
      }),
    });

    expect(bridgeRegistration).toBe("standard_plugin");
    expect(
      codexAdapter
        .installPlan(home, bridgeExecutable, [], { bridgeRegistration })
        .files.map((file) => file.role),
    ).toEqual(["instructions", "hooks"]);
  });

  it("lets an explicit opt-in win over the evidence in both directions", async () => {
    const pluginEvidence = evidenceReader({
      managedMcpRegistration: false,
      pluginBridgeRegistration: true,
    });
    const managedEvidence = evidenceReader({
      managedMcpRegistration: true,
      pluginBridgeRegistration: false,
    });

    await expect(
      bridgeRegistrationForMutation({
        action: "install",
        requested: "standard_plugin",
        readEvidence: managedEvidence,
      }),
    ).resolves.toBe("standard_plugin");
    await expect(
      bridgeRegistrationForMutation({
        action: "repair",
        requested: "managed",
        readEvidence: pluginEvidence,
      }),
    ).resolves.toBe("managed");
    // An explicit choice is decided without spending a client probe.
    expect(managedEvidence).not.toHaveBeenCalled();
    expect(pluginEvidence).not.toHaveBeenCalled();

    // Detach still replays the recorded manifest; an opt-in cannot hide targets
    // an earlier full install still owns.
    await expect(
      bridgeRegistrationForMutation({
        action: "uninstall",
        requested: "standard_plugin",
        readEvidence: pluginEvidence,
      }),
    ).resolves.toBe("managed");
  });

  it("accepts the opt-in only as a declared mode on the boundary input", () => {
    expect(
      parseIntegrationPreviewRequest({
        adapter: "codex",
        action: "install",
        locale: "en-US",
        projectId,
        repositorySelectionToken: selection.token,
        bridgeRegistration: "standard_plugin",
      }).bridgeRegistration,
    ).toBe("standard_plugin");
    expect(
      parseIntegrationPreviewRequest({
        adapter: "codex",
        action: "install",
        locale: "en-US",
      }).bridgeRegistration,
    ).toBeUndefined();
    expect(() =>
      parseIntegrationPreviewRequest({
        adapter: "codex",
        action: "install",
        locale: "en-US",
        bridgeRegistration: "plugin",
      }),
    ).toThrow(/Bridge registration mode is invalid/);

    // The apply side repeats the confirmed mode, and still accepts a bare token
    // from a renderer built before the opt-in existed.
    expect(
      parseIntegrationActionRequest({
        token: "preview-token",
        bridgeRegistration: "managed",
      }),
    ).toEqual({ token: "preview-token", bridgeRegistration: "managed" });
    expect(parseIntegrationActionRequest("preview-token")).toEqual({
      token: "preview-token",
    });
    expect(() => parseIntegrationActionRequest({ token: "" })).toThrow(
      /configuration preview token is required/,
    );
    expect(() =>
      parseIntegrationActionRequest({
        token: "preview-token",
        bridgeRegistration: "plugin",
      }),
    ).toThrow(/Bridge registration mode is invalid/);
  });

  it("rejects an opt-in from a client that cannot load the plugin", async () => {
    for (const adapter of [openCodeAdapter, codexAdapter]) {
      const bridgeRegistration = await bridgeRegistrationForMutation({
        action: "install",
        requested: "standard_plugin",
        readEvidence: evidenceReader({
          managedMcpRegistration: true,
          pluginBridgeRegistration: false,
        }),
      });
      expect(() =>
        assertBridgeRegistrationIsInstallable(
          adapter.kind,
          bridgeRegistration,
          // OpenCode announces no standard support at any version; Codex does,
          // but not at a version below its plugin-loading floor.
          standardPluginIsSupported(adapter.kind, "0.1.0"),
        ),
      ).toThrow(/cannot load the Intero Agent Plugin/);
    }

    // The same guard passes the managed default through untouched, and passes a
    // real opt-in for a capable client.
    expect(() =>
      assertBridgeRegistrationIsInstallable("opencode", "managed", false),
    ).not.toThrow();
    expect(() =>
      assertBridgeRegistrationIsInstallable(
        "cursor",
        "standard_plugin",
        standardPluginIsSupported("cursor", "2099.0.0"),
      ),
    ).not.toThrow();
  });

  it("distinguishes an MCP-only client's empty hybrid plan from its managed plan", async () => {
    const bridgeRegistration = await bridgeRegistrationForMutation({
      action: "install",
      requested: "standard_plugin",
      readEvidence: evidenceReader({
        managedMcpRegistration: false,
        pluginBridgeRegistration: false,
      }),
    });
    const narrowed = cursorAdapter.installPlan(home, bridgeExecutable, [], {
      bridgeRegistration,
    });
    const managed = cursorAdapter.installPlan(home, bridgeExecutable);

    // Cursor is MCP-only, so hybrid mode leaves Intero nothing to write.
    expect(narrowed.files).toEqual([]);
    expect(managed.files.map((file) => file.role)).toEqual(["mcp"]);

    const digestOf = (plan: DigestableIntegrationPlan, targets: string[]) =>
      digestIntegrationPlan({
        adapter: "cursor",
        action: "install",
        targets,
        plan,
      });
    const workspaceTargets = [`${home}/.intero/workspaces/demo/workspace-id`];

    // The confirmation binds the mode: an empty plan and a full plan cannot
    // share a digest, so switching modes after confirmation cannot apply.
    expect(digestOf(narrowed, workspaceTargets)).not.toBe(
      digestOf(managed, [
        ...managed.files.map((file) => file.path),
        ...workspaceTargets,
      ]),
    );
    // Even with an identical target list, the planned file set still differs.
    expect(digestOf(narrowed, workspaceTargets)).not.toBe(
      digestOf(managed, workspaceTargets),
    );
  });
});
