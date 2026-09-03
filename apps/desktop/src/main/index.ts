import {
  execFileSync,
  spawn,
  type ExecFileSyncOptionsWithStringEncoding,
} from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  applyManagedInstall,
  cloudWorkspaceClientFiles,
  diagnoseManagedInstall,
  integrationVersionIsSupported,
  integrationAdapters,
  managedIntegrationHasState,
  managedIntegrationTargets,
  standardPluginIsSupported,
  uninstallManagedIntegration,
  type IntegrationKind,
} from "@intero/integrations";
import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  shell,
} from "electron";

import {
  buildGitAwarenessCheckpoint,
  readGitAwarenessSnapshot,
  watchGitMetadata,
  type GitAwarenessSnapshot,
  type GitMetadataSubscription,
} from "./git-awareness.js";
import {
  INTEGRATION_PREVIEW_TTL_MS,
  LOCAL_SELECTION_TTL_MS,
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
  type AgentConfigurationState,
  type BridgeRegistration,
  type ProjectRepositoryBinding,
  type RepositorySelectionBinding,
  type WorkspaceCleanupBinding,
} from "./integration-boundary.js";
import {
  cursorAgentExecutableCandidates,
  cursorAgentMcpListHasIntero,
  isCursorAgentAdapter,
} from "./cursor-agent.js";

type IntegrationAction = "install" | "repair" | "uninstall";
type GitAwarenessClient = "codex" | "claude-code" | "opencode";

interface GitAwarenessEntry {
  repositoryPath: string;
  client: GitAwarenessClient;
  enabled: boolean;
  lastFingerprint?: string;
  lastSnapshot?: GitAwarenessSnapshot;
  lastDeliveredAt?: string;
  lastError?: string;
}

let integrationMutation = Promise.resolve();
let trustedRendererId: number | undefined;
let trustedRendererUrl: string | undefined;
let gitAwarenessEntries: GitAwarenessEntry[] = [];
let gitAwarenessMutation = Promise.resolve();
const gitAwarenessSubscriptions = new Map<string, GitMetadataSubscription>();
const gitAwarenessDeliveries = new Map<string, Promise<void>>();
const mainDirectory = dirname(fileURLToPath(import.meta.url));
const integrationPreviews = new Map<
  string,
  {
    senderId: number;
    adapter: IntegrationKind;
    action: IntegrationAction;
    binding?: ProjectRepositoryBinding;
    planDigest: string;
    expiresAt: number;
  }
>();
const repositorySelections = new Map<string, RepositorySelectionBinding>();
const workspaceCleanupPreviews = new Map<
  string,
  {
    senderId: number;
    adapter: IntegrationKind;
    binding: WorkspaceCleanupBinding;
    digest: string;
    expiresAt: number;
  }
>();

function registerDesktopIntegrationBridge() {
  ipcMain.removeHandler("intero:integration-status");
  ipcMain.removeHandler("intero:integration-preview");
  ipcMain.removeHandler("intero:integration-action");
  ipcMain.removeHandler("intero:workspace-cleanup-preview");
  ipcMain.removeHandler("intero:workspace-cleanup-action");
  ipcMain.removeHandler("intero:git-awareness-status");
  ipcMain.removeHandler("intero:git-awareness-clients");
  ipcMain.removeHandler("intero:git-awareness-choose-repository");
  ipcMain.removeHandler("intero:git-awareness-configure");
  ipcMain.removeHandler("intero:git-awareness-remove");
  ipcMain.handle("intero:integration-status", (event) => {
    assertTrustedRenderer(event);
    return integrationStatus();
  });
  ipcMain.handle(
    "intero:integration-preview",
    async (event, input: unknown) => {
      assertTrustedRenderer(event);
      const previewInput = parseIntegrationPreviewRequest(input);
      const adapter = previewInput.adapter as IntegrationKind;
      const { action, locale } = previewInput;
      assertIntegrationAction(adapter, action);
      const bridgeRegistration = await mutationBridgeRegistration(
        adapter,
        action,
        previewInput.bridgeRegistration,
      );
      assertAgentSupportsMutation(adapter, action, bridgeRegistration);
      pruneExpiredIntegrationAuthority();
      const binding = requireProjectRepositoryBinding(
        previewInput,
        previewInput.repositorySelectionToken
          ? repositorySelections.get(previewInput.repositorySelectionToken)
          : undefined,
        event.sender.id,
        Date.now(),
      );
      const plan = buildIntegrationPlan(adapter, bridgeRegistration);
      const targets = await integrationTargets(plan, adapter, binding);
      const vacuous = await integrationPlanWritesNothing(plan, adapter);
      const parent = BrowserWindow.fromWebContents(event.sender);
      if (!parent) throw new Error("The trusted Intero window is unavailable.");
      const chinese = locale === "zh-CN";
      const confirmation = await dialog.showMessageBox(parent, {
        type: "warning",
        title: chinese ? "确认 Agent 配置变更" : "Confirm Agent configuration",
        message: chinese
          ? "Intero 将只管理以下工具级公共启动器和项目级加密连接目标。"
          : "Intero will manage only the shared client launcher and Project-scoped encrypted connection targets below.",
        detail: [
          `Agent: ${adapter}`,
          `${chinese ? "操作" : "Action"}: ${action}`,
          ...(binding
            ? [
                `Project: ${binding.projectId}`,
                `${chinese ? "仓库" : "Repository"}: ${binding.repositoryPath}`,
              ]
            : []),
          ...(bridgeRegistration === "standard_plugin"
            ? [
                chinese
                  ? "MCP bridge 由已安装的 intero Agent Plugin 注册；Intero 不会写入托管 MCP 条目。"
                  : "The installed intero Agent Plugin owns the MCP bridge registration; Intero writes no managed MCP entry.",
              ]
            : []),
          ...(vacuous
            ? [
                chinese
                  ? "这个客户端没有剩余的托管配置目标：Intero 不会修改它的任何配置文件，下面只是项目级加密连接状态。"
                  : "No managed configuration target is left for this client: Intero modifies none of its configuration files, and the targets below are Project-scoped encrypted connection state only.",
              ]
            : []),
          "",
          chinese ? "配置目标：" : "Configuration targets:",
          ...targets,
        ].join("\n"),
        buttons: chinese ? ["继续", "取消"] : ["Continue", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (confirmation.response !== 0) return null;
      const token = randomUUID();
      const expiresAt = Date.now() + INTEGRATION_PREVIEW_TTL_MS;
      let confirmedBinding = binding;
      if (confirmedBinding) {
        // A user can leave the native confirmation open beyond the short
        // repository-selection lifetime, so check it again at confirmation.
        pruneExpiredIntegrationAuthority();
        const freshBinding = requireProjectRepositoryBinding(
          previewInput,
          repositorySelections.get(confirmedBinding.repositorySelectionToken),
          event.sender.id,
          Date.now(),
        );
        if (!freshBinding) {
          throw new Error("Project-scoped repository authority is required.");
        }
        confirmedBinding = freshBinding;
        // A selection can authorize one confirmed Project-scoped preview only.
        repositorySelections.get(
          confirmedBinding.repositorySelectionToken,
        )!.consumed = true;
      }
      integrationPreviews.set(token, {
        senderId: event.sender.id,
        adapter,
        action,
        ...(confirmedBinding ? { binding: confirmedBinding } : {}),
        planDigest: digestPlan(
          plan,
          adapter,
          action,
          targets,
          confirmedBinding,
        ),
        expiresAt,
      });
      return {
        token,
        adapter,
        action,
        targets,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    },
  );
  ipcMain.handle("intero:integration-action", async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const { token, bridgeRegistration: requestedRegistration } =
      parseIntegrationActionRequest(input);
    pruneExpiredIntegrationAuthority();
    const preview = integrationPreviews.get(token);
    integrationPreviews.delete(token);
    if (!preview || preview.senderId !== event.sender.id) {
      throw new Error("The configuration preview is missing or expired.");
    }
    const { adapter, action, binding } = preview;
    const operation = integrationMutation.then(async () => {
      // Check immediately before this serialized mutation. A preceding queued
      // operation may have changed a managed target after this preview, a
      // client that gained or lost its plugin registration since then yields a
      // different plan, and a registration mode that differs from the confirmed
      // one yields a different plan too — all three fail the digest below
      // rather than writing an unconfirmed target set.
      const bridgeRegistration = await mutationBridgeRegistration(
        adapter,
        action,
        requestedRegistration,
      );
      assertAgentSupportsMutation(adapter, action, bridgeRegistration);
      const plan = buildIntegrationPlan(adapter, bridgeRegistration);
      const currentTargets = await integrationTargets(plan, adapter, binding);
      if (
        digestPlan(plan, adapter, action, currentTargets, binding) !==
        preview.planDigest
      ) {
        throw new Error("Integration plan changed after confirmation.");
      }
      if (action === "uninstall") {
        await uninstallManagedIntegration(adapter, homedir());
      } else {
        // A narrowed plan for an MCP-only client can have no managed file left.
        // With no recorded manifest to reconcile either, there is nothing to
        // write: recording an empty managed install would only claim ownership
        // Intero does not have.
        if (!(await integrationPlanWritesNothing(plan, adapter))) {
          await applyManagedInstall(plan, homedir());
        }
        if (binding) {
          await ensureWorkspaceIdentity(binding);
        }
      }
      return {
        integrations: await integrationStatus(),
        ...(binding ? { workspaceId: binding.workspaceId } : {}),
      };
    });
    integrationMutation = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  });
  ipcMain.handle(
    "intero:workspace-cleanup-preview",
    async (event, input: unknown) => {
      assertTrustedRenderer(event);
      const request = parseWorkspaceCleanupRequest(input);
      const adapter = request.adapter as IntegrationKind;
      assertIntegrationAction(adapter, "uninstall");
      pruneExpiredIntegrationAuthority();
      let binding = requireWorkspaceCleanupBinding(
        request,
        repositorySelections.get(request.repositorySelectionToken),
        event.sender.id,
        Date.now(),
      );
      const plan = await workspaceCleanupPlan(adapter, binding);
      const parent = BrowserWindow.fromWebContents(event.sender);
      if (!parent) throw new Error("The trusted Intero window is unavailable.");
      const chinese = request.locale === "zh-CN";
      const confirmation = await dialog.showMessageBox(parent, {
        type: "warning",
        title: chinese ? "确认清理项目连接" : "Confirm Project cleanup",
        message: chinese
          ? "云端访问已撤销。Intero 将只删除这个仓库和 binding 的本地加密连接状态。"
          : "Cloud access is revoked. Intero will remove only this repository and binding's encrypted local connection state.",
        detail: [
          `Agent: ${adapter}`,
          `Project: ${binding.projectId}`,
          `Binding: ${binding.bindingId}`,
          `${chinese ? "仓库" : "Repository"}: ${binding.repositoryPath}`,
          "",
          chinese ? "清理目标：" : "Cleanup targets:",
          ...(plan.targets.length > 0
            ? plan.targets
            : [
                chinese ? "本地连接已清理" : "Local connection already removed",
              ]),
        ].join("\n"),
        buttons: chinese ? ["清理", "稍后"] : ["Clean up", "Later"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (confirmation.response !== 0) return null;
      pruneExpiredIntegrationAuthority();
      binding = requireWorkspaceCleanupBinding(
        request,
        repositorySelections.get(request.repositorySelectionToken),
        event.sender.id,
        Date.now(),
      );
      repositorySelections.get(request.repositorySelectionToken)!.consumed =
        true;
      const currentPlan = await workspaceCleanupPlan(adapter, binding);
      if (currentPlan.digest !== plan.digest) {
        throw new Error("Workspace connection changed during confirmation.");
      }
      const token = randomUUID();
      const expiresAt = Date.now() + INTEGRATION_PREVIEW_TTL_MS;
      workspaceCleanupPreviews.set(token, {
        senderId: event.sender.id,
        adapter,
        binding,
        digest: currentPlan.digest,
        expiresAt,
      });
      return {
        token,
        targets: currentPlan.targets,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    },
  );
  ipcMain.handle(
    "intero:workspace-cleanup-action",
    async (event, token: unknown) => {
      assertTrustedRenderer(event);
      if (typeof token !== "string") {
        throw new Error("A workspace cleanup preview token is required.");
      }
      pruneExpiredIntegrationAuthority();
      const preview = workspaceCleanupPreviews.get(token);
      workspaceCleanupPreviews.delete(token);
      if (!preview || preview.senderId !== event.sender.id) {
        throw new Error("The workspace cleanup preview is missing or expired.");
      }
      const operation = integrationMutation.then(async () => {
        const plan = await workspaceCleanupPlan(
          preview.adapter,
          preview.binding,
        );
        if (plan.digest !== preview.digest) {
          throw new Error("Workspace connection changed after confirmation.");
        }
        for (const target of plan.targets) {
          try {
            await unlink(target);
          } catch (error) {
            if (
              !error ||
              typeof error !== "object" ||
              !("code" in error) ||
              error.code !== "ENOENT"
            ) {
              throw error;
            }
          }
        }
        return {
          removed: plan.targets,
          alreadyRemoved: plan.targets.length === 0,
        };
      });
      integrationMutation = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
  );
  ipcMain.handle("intero:git-awareness-status", async (event) => {
    assertTrustedRenderer(event);
    return presentGitAwareness();
  });
  ipcMain.handle("intero:git-awareness-clients", async (event) => {
    assertTrustedRenderer(event);
    return connectedGitAwarenessClients();
  });
  ipcMain.handle("intero:git-awareness-choose-repository", async (event) => {
    assertTrustedRenderer(event);
    const parent = BrowserWindow.fromWebContents(event.sender);
    if (!parent) throw new Error("The trusted Intero window is unavailable.");
    const selection = await dialog.showOpenDialog(parent, {
      title: "选择授权给 Intero 的 Git 仓库",
      properties: ["openDirectory"],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const snapshot = await readGitAwarenessSnapshot(selection.filePaths[0]);
    if (!snapshot) throw new Error("所选目录不是可读取的 Git 仓库。");
    pruneExpiredIntegrationAuthority();
    const selectionToken = randomUUID();
    const expiresAt = Date.now() + LOCAL_SELECTION_TTL_MS;
    repositorySelections.set(selectionToken, {
      token: selectionToken,
      senderId: event.sender.id,
      repositoryPath: selection.filePaths[0],
      workspaceId: await selectedRepositoryWorkspaceId(selection.filePaths[0]),
      expiresAt,
      consumed: false,
    });
    return {
      repositoryPath: selection.filePaths[0],
      snapshot,
      selectionToken,
      workspaceId: repositorySelections.get(selectionToken)!.workspaceId,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  });
  ipcMain.handle(
    "intero:git-awareness-configure",
    async (
      event,
      input: {
        repositoryPath: string;
        client: GitAwarenessClient;
        enabled: boolean;
      },
    ) => {
      assertTrustedRenderer(event);
      if (
        !input ||
        typeof input.repositoryPath !== "string" ||
        input.repositoryPath.length > 4_096 ||
        !isAbsolute(input.repositoryPath) ||
        !isGitAwarenessClient(input.client) ||
        typeof input.enabled !== "boolean"
      ) {
        throw new Error("Git 感知配置无效。");
      }
      if (
        input.enabled &&
        !connectedGitAwarenessClients().includes(input.client)
      ) {
        throw new Error("请先为当前项目绑定该 Coding Agent。");
      }
      const existing = gitAwarenessEntries.find(
        (entry) => entry.repositoryPath === input.repositoryPath,
      );
      const snapshot = input.enabled
        ? await readGitAwarenessSnapshot(input.repositoryPath)
        : existing?.lastSnapshot;
      if (input.enabled && !snapshot) {
        throw new Error("所选目录不是可读取的 Git 仓库。");
      }
      await mutateGitAwareness((entries) => {
        const next = entries.filter(
          (entry) => entry.repositoryPath !== input.repositoryPath,
        );
        next.push({
          repositoryPath: input.repositoryPath,
          client: input.client,
          enabled: input.enabled,
          ...(snapshot
            ? {
                lastFingerprint: snapshot.fingerprint,
                lastSnapshot: snapshot,
              }
            : {}),
          ...(existing?.lastDeliveredAt
            ? { lastDeliveredAt: existing.lastDeliveredAt }
            : {}),
        });
        return next;
      });
      await reconcileGitAwarenessSubscriptions();
      return presentGitAwareness();
    },
  );
  ipcMain.handle(
    "intero:git-awareness-remove",
    async (event, repositoryPath) => {
      assertTrustedRenderer(event);
      if (typeof repositoryPath !== "string") {
        throw new Error("Repository path is required.");
      }
      await mutateGitAwareness((entries) =>
        entries.filter((entry) => entry.repositoryPath !== repositoryPath),
      );
      await reconcileGitAwarenessSubscriptions();
      return presentGitAwareness();
    },
  );
}

function gitAwarenessConfigPath(): string {
  return join(app.getPath("userData"), "git-awareness.json");
}

async function loadGitAwareness(): Promise<void> {
  try {
    const raw = await readFile(gitAwarenessConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    gitAwarenessEntries = parsed.flatMap((value) =>
      isGitAwarenessEntry(value) ? [value] : [],
    );
  } catch {
    gitAwarenessEntries = [];
  }
}

async function mutateGitAwareness(
  mutate: (entries: GitAwarenessEntry[]) => GitAwarenessEntry[],
): Promise<void> {
  const operation = gitAwarenessMutation.then(async () => {
    gitAwarenessEntries = mutate(gitAwarenessEntries);
    await mkdir(dirname(gitAwarenessConfigPath()), { recursive: true });
    await writeFile(
      gitAwarenessConfigPath(),
      `${JSON.stringify(gitAwarenessEntries, null, 2)}\n`,
      { mode: 0o600 },
    );
    await chmod(gitAwarenessConfigPath(), 0o600);
  });
  gitAwarenessMutation = operation.then(
    () => undefined,
    () => undefined,
  );
  await operation;
}

function presentGitAwareness() {
  return gitAwarenessEntries.map((entry) => ({
    repositoryPath: entry.repositoryPath,
    repositoryName:
      entry.lastSnapshot?.repository ?? basename(entry.repositoryPath),
    client: entry.client,
    enabled: entry.enabled,
    ...(entry.lastSnapshot ? { snapshot: entry.lastSnapshot } : {}),
    ...(entry.lastDeliveredAt
      ? { lastDeliveredAt: entry.lastDeliveredAt }
      : {}),
    ...(entry.lastError ? { lastError: entry.lastError } : {}),
  }));
}

function connectedGitAwarenessClients(): GitAwarenessClient[] {
  let executable: ReturnType<typeof mcpExecutableSpec>;
  try {
    executable = mcpExecutableSpec();
  } catch {
    return [];
  }
  return (["codex", "claude-code", "opencode"] as const).filter((client) => {
    try {
      execFileSync(
        executable.command,
        [...executable.prefixArgs, "cloud", "status", "--mcp-source", client],
        {
          stdio: "ignore",
          timeout: 2_000,
          windowsHide: true,
        },
      );
      return true;
    } catch {
      return false;
    }
  });
}

async function reconcileGitAwarenessSubscriptions(): Promise<void> {
  const enabledPaths = new Set(
    gitAwarenessEntries
      .filter((entry) => entry.enabled)
      .map((entry) => entry.repositoryPath),
  );
  for (const [repositoryPath, subscription] of gitAwarenessSubscriptions) {
    if (!enabledPaths.has(repositoryPath)) {
      subscription.close();
      gitAwarenessSubscriptions.delete(repositoryPath);
    }
  }
  for (const repositoryPath of enabledPaths) {
    if (gitAwarenessSubscriptions.has(repositoryPath)) continue;
    try {
      const subscription = await watchGitMetadata({
        repositoryPath,
        onChange: () => queueGitAwarenessDelivery(repositoryPath),
      });
      gitAwarenessSubscriptions.set(repositoryPath, subscription);
    } catch {
      await setGitAwarenessError(
        repositoryPath,
        "无法监听该仓库的 Git 元数据。",
      );
    }
  }
}

function stopGitAwarenessSubscriptions(): void {
  for (const subscription of gitAwarenessSubscriptions.values()) {
    subscription.close();
  }
  gitAwarenessSubscriptions.clear();
}

function queueGitAwarenessDelivery(repositoryPath: string): Promise<void> {
  const previous =
    gitAwarenessDeliveries.get(repositoryPath) ?? Promise.resolve();
  const operation = previous
    .then(() => deliverGitAwarenessChange(repositoryPath))
    .finally(() => {
      if (gitAwarenessDeliveries.get(repositoryPath) === operation) {
        gitAwarenessDeliveries.delete(repositoryPath);
      }
    });
  gitAwarenessDeliveries.set(repositoryPath, operation);
  return operation;
}

async function deliverGitAwarenessChange(
  repositoryPath: string,
): Promise<void> {
  const entry = gitAwarenessEntries.find(
    (candidate) =>
      candidate.repositoryPath === repositoryPath && candidate.enabled,
  );
  if (!entry) return;
  // Exactly one bounded snapshot is read for one debounced metadata change.
  const snapshot = await readGitAwarenessSnapshot(repositoryPath);
  if (!snapshot || snapshot.fingerprint === entry.lastFingerprint) return;
  try {
    await sendGitAwareness(entry, snapshot);
    await mutateGitAwareness((entries) =>
      entries.map((candidate) =>
        candidate.repositoryPath === repositoryPath
          ? withoutGitAwarenessError({
              ...candidate,
              lastFingerprint: snapshot.fingerprint,
              lastSnapshot: snapshot,
              lastDeliveredAt: new Date().toISOString(),
            })
          : candidate,
      ),
    );
  } catch {
    await mutateGitAwareness((entries) =>
      entries.map((candidate) =>
        candidate.repositoryPath === repositoryPath
          ? {
              ...candidate,
              lastSnapshot: snapshot,
              lastError:
                "Git 变化尚未交给 direct-cloud MCP；下次变化时会重试。",
            }
          : candidate,
      ),
    );
  }
}

async function sendGitAwareness(
  entry: GitAwarenessEntry,
  snapshot: GitAwarenessSnapshot,
): Promise<void> {
  const executable = mcpExecutableSpec();
  const checkpoint = buildGitAwarenessCheckpoint(
    entry.repositoryPath,
    snapshot,
    entry.lastSnapshot,
  );
  const args = [
    ...executable.prefixArgs,
    "cloud",
    "checkpoint",
    "--mcp-source",
    entry.client,
    "--event-type",
    checkpoint.eventType,
    "--client-event-id",
    checkpoint.clientEventId,
    "--workstream-key",
    checkpoint.workstreamKey,
    "--workstream-title",
    checkpoint.workstreamTitle,
    "--current-focus",
    checkpoint.currentFocus,
    "--completed-outcome",
    checkpoint.completedOutcome,
    "--next-step",
    checkpoint.nextStep,
    ...checkpoint.evidence.flatMap((value) => ["--evidence", value]),
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable.command, args, {
      stdio: "ignore",
      windowsHide: true,
    });
    const timeout = setTimeout(() => child.kill(), 5_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      code === 0
        ? resolve()
        : reject(new Error("Git awareness delivery failed."));
    });
  });
}

async function setGitAwarenessError(
  repositoryPath: string,
  lastError: string,
): Promise<void> {
  await mutateGitAwareness((entries) =>
    entries.map((entry) =>
      entry.repositoryPath === repositoryPath ? { ...entry, lastError } : entry,
    ),
  );
}

function withoutGitAwarenessError(entry: GitAwarenessEntry): GitAwarenessEntry {
  const { lastError: _lastError, ...rest } = entry;
  return rest;
}

function isGitAwarenessClient(value: unknown): value is GitAwarenessClient {
  return value === "codex" || value === "claude-code" || value === "opencode";
}

function isGitAwarenessEntry(value: unknown): value is GitAwarenessEntry {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as GitAwarenessEntry).repositoryPath === "string" &&
    isGitAwarenessClient((value as GitAwarenessEntry).client) &&
    typeof (value as GitAwarenessEntry).enabled === "boolean" &&
    ((value as GitAwarenessEntry).lastFingerprint === undefined ||
      typeof (value as GitAwarenessEntry).lastFingerprint === "string") &&
    ((value as GitAwarenessEntry).lastSnapshot === undefined ||
      isGitAwarenessSnapshot((value as GitAwarenessEntry).lastSnapshot)) &&
    ((value as GitAwarenessEntry).lastDeliveredAt === undefined ||
      typeof (value as GitAwarenessEntry).lastDeliveredAt === "string") &&
    ((value as GitAwarenessEntry).lastError === undefined ||
      typeof (value as GitAwarenessEntry).lastError === "string")
  );
}

function isGitAwarenessSnapshot(value: unknown): value is GitAwarenessSnapshot {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as GitAwarenessSnapshot).repository === "string" &&
    ((value as GitAwarenessSnapshot).branch === undefined ||
      typeof (value as GitAwarenessSnapshot).branch === "string") &&
    ((value as GitAwarenessSnapshot).head === undefined ||
      typeof (value as GitAwarenessSnapshot).head === "string") &&
    ((value as GitAwarenessSnapshot).staged === "clean" ||
      (value as GitAwarenessSnapshot).staged === "changed") &&
    typeof (value as GitAwarenessSnapshot).fingerprint === "string"
  );
}

function assertIntegrationAction(
  adapter: IntegrationKind,
  action: IntegrationAction,
): void {
  if (
    !integrationAdapters.some((candidate) => candidate.kind === adapter) ||
    !["install", "repair", "uninstall"].includes(action)
  ) {
    throw new Error("Unsupported integration action.");
  }
}

async function integrationTargets(
  plan: ReturnType<typeof buildIntegrationPlan>,
  adapter?: IntegrationKind,
  binding?: ProjectRepositoryBinding,
): Promise<string[]> {
  const managedTargets = await managedIntegrationTargets(plan, homedir());
  if (!adapter || !binding) return managedTargets;
  const workspaceFiles = cloudWorkspaceClientFiles(
    homedir(),
    binding.repositoryPath,
    adapter,
  );
  return [
    ...managedTargets,
    workspaceFiles.workspaceId,
    workspaceFiles.connection,
    workspaceFiles.outbox,
    workspaceFiles.metadata,
  ];
}

async function selectedRepositoryWorkspaceId(
  repositoryPath: string,
): Promise<string> {
  const files = cloudWorkspaceClientFiles(homedir(), repositoryPath, "codex");
  if (!existsSync(files.workspaceId)) return randomUUID();
  const workspaceId = (await readFile(files.workspaceId, "utf8")).trim();
  if (!isOpaqueWorkspaceId(workspaceId)) {
    throw new Error(
      "The selected repository has an invalid local Intero workspace identity.",
    );
  }
  return workspaceId;
}

async function ensureWorkspaceIdentity(
  binding: ProjectRepositoryBinding,
): Promise<void> {
  const files = cloudWorkspaceClientFiles(
    homedir(),
    binding.repositoryPath,
    "codex",
  );
  await mkdir(files.directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(files.workspaceId, `${binding.workspaceId}\n`, {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if (!existsSync(files.workspaceId)) throw error;
  }
  await chmod(files.workspaceId, 0o600);
  const persisted = (await readFile(files.workspaceId, "utf8")).trim();
  if (persisted !== binding.workspaceId) {
    throw new Error(
      "The selected repository already has a different Intero workspace identity.",
    );
  }
}

function isOpaqueWorkspaceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function digestPlan(
  plan: ReturnType<typeof buildIntegrationPlan>,
  adapter: IntegrationKind,
  action: IntegrationAction,
  targets: string[],
  binding?: ProjectRepositoryBinding,
): string {
  return digestIntegrationPlan({
    adapter,
    action,
    targets,
    ...(binding ? { binding } : {}),
    plan: {
      files: plan.files.map((file) => ({ ...file, path: resolve(file.path) })),
    },
  });
}

async function workspaceCleanupPlan(
  adapter: IntegrationKind,
  binding: WorkspaceCleanupBinding,
): Promise<{ targets: string[]; digest: string }> {
  const files = cloudWorkspaceClientFiles(
    homedir(),
    binding.repositoryPath,
    adapter,
  );
  const candidates = [files.connection, files.outbox, files.metadata];
  const targets = candidates.filter(existsSync);
  const metadataExists = existsSync(files.metadata);
  if (!metadataExists && targets.length > 0) {
    throw new Error(
      "Local workspace connection metadata is missing; no files were removed.",
    );
  }
  if (metadataExists) {
    let metadata: unknown;
    try {
      metadata = JSON.parse(await readFile(files.metadata, "utf8"));
    } catch {
      throw new Error(
        "Local workspace connection metadata is invalid; no files were removed.",
      );
    }
    if (!workspaceMetadataMatches(metadata, adapter, binding)) {
      throw new Error(
        "The selected repository is attached to a different Project or binding.",
      );
    }
    const workspaceId = (await readFile(files.workspaceId, "utf8")).trim();
    if (workspaceId !== binding.workspaceId) {
      throw new Error(
        "The selected repository has a different local workspace identity.",
      );
    }
  }
  const fingerprints = await Promise.all(
    targets.map(async (target) => ({
      target,
      hash: createHash("sha256")
        .update(await readFile(target))
        .digest("hex"),
    })),
  );
  return {
    targets,
    digest: createHash("sha256")
      .update(
        JSON.stringify({
          adapter,
          binding,
          fingerprints,
        }),
      )
      .digest("hex"),
  };
}

function workspaceMetadataMatches(
  value: unknown,
  adapter: IntegrationKind,
  binding: WorkspaceCleanupBinding,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  return (
    metadata.schemaVersion === 1 &&
    metadata.projectId === binding.projectId &&
    metadata.bindingId === binding.bindingId &&
    metadata.client === adapter &&
    metadata.workspaceId === binding.workspaceId
  );
}

function pruneExpiredIntegrationAuthority(): void {
  const now = Date.now();
  for (const [token, preview] of integrationPreviews) {
    if (preview.expiresAt <= now) integrationPreviews.delete(token);
  }
  for (const [token, preview] of workspaceCleanupPreviews) {
    if (preview.expiresAt <= now) workspaceCleanupPreviews.delete(token);
  }
  for (const [token, selection] of repositorySelections) {
    if (selection.expiresAt <= now || selection.consumed) {
      repositorySelections.delete(token);
    }
  }
}

async function integrationStatus(): Promise<CodingAgentIntegrationStatus[]> {
  return Promise.all(
    integrationAdapters.map(async (adapter) => {
      const detectedAgent = detectAgent(adapter.kind);
      const version = detectedAgent?.version;
      const supported =
        detectedAgent !== undefined &&
        integrationVersionIsSupported(adapter.kind, detectedAgent.version);
      // Whether hybrid mode is even offerable for this client at this version.
      // Pure version arithmetic, so it costs the status refresh no client probe.
      const standardPluginCapable =
        detectedAgent !== undefined &&
        standardPluginIsSupported(adapter.kind, detectedAgent.version);
      try {
        const plan = buildIntegrationPlan(adapter.kind);
        const {
          bridgeRegistration,
          diagnostics,
          complete,
          configurationState,
        } = await integrationRegistration(adapter.kind, plan, detectedAgent);
        const configured =
          complete ||
          diagnostics.some((item) => item.ok) ||
          (await managedIntegrationHasState(adapter.kind, homedir()));
        const warnings = [
          ...(configurationState === "runtime_unreachable"
            ? ["agent_runtime_unreachable"]
            : []),
          ...(adapter.kind === "codex" &&
          existsSync(join(dirname(plan.files[0]!.path), "AGENTS.override.md"))
            ? ["codex_override_shadows_instructions"]
            : []),
        ];
        return {
          adapter: adapter.kind,
          detected: detectedAgent !== undefined,
          supported,
          configured,
          bridgeRegistration,
          standardPluginCapable,
          ...(version ? { version } : {}),
          state:
            !detectedAgent && !configured
              ? ("not_installed" as const)
              : !supported
                ? ("unsupported_version" as const)
                : complete && configurationState === "invalid"
                  ? ("needs_repair" as const)
                  : complete
                    ? // Codex asks the user to trust an MCP entry Intero just
                      // wrote. Hybrid mode writes none, and only reaches here
                      // once the client itself resolved the plugin-registered
                      // server, so there is nothing left to wait for.
                      adapter.kind === "codex" &&
                      bridgeRegistration === "managed"
                      ? ("pending_trust" as const)
                      : configurationState === "valid"
                        ? ("config_valid" as const)
                        : ("config_written" as const)
                    : configured
                      ? ("needs_repair" as const)
                      : ("not_installed" as const),
          diagnostics,
          warnings,
        };
      } catch {
        return {
          adapter: adapter.kind,
          detected: detectedAgent !== undefined,
          supported,
          configured: false,
          bridgeRegistration: "managed" as const,
          standardPluginCapable,
          ...(version ? { version } : {}),
          state: "needs_repair" as const,
          diagnostics: [],
          warnings: [],
        };
      }
    }),
  );
}

interface CodingAgentIntegrationStatus {
  adapter: IntegrationKind;
  detected: boolean;
  supported: boolean;
  configured: boolean;
  /** Who owns the `intero` MCP registration Intero is reporting on. */
  bridgeRegistration: BridgeRegistration;
  /**
   * Whether this detected client version can load the published Agent Plugin,
   * and therefore whether the hybrid-mode opt-in is offerable for it at all.
   */
  standardPluginCapable: boolean;
  version?: string;
  state:
    | "not_installed"
    | "config_written"
    | "config_valid"
    | "pending_trust"
    | "needs_repair"
    | "unsupported_version";
  diagnostics: Array<{ path: string; ok: boolean; detail: string }>;
  warnings: string[];
}

function buildIntegrationPlan(
  adapter: IntegrationKind,
  bridgeRegistration: BridgeRegistration = "managed",
) {
  const selected = integrationAdapters.find(
    (candidate) => candidate.kind === adapter,
  );
  if (!selected) throw new Error("Unknown integration adapter.");
  const executable = mcpExecutableSpec();
  return selected.installPlan(
    homedir(),
    executable.command,
    executable.prefixArgs,
    { bridgeRegistration },
  );
}

/**
 * Reads who owns this client's bridge registration right now (ADR-0011). The
 * narrowed plan is only diagnosed when the managed one is incomplete and the
 * detected client version can load the published Agent Plugin, so hybrid mode
 * is recognized where it is real and is never inferred as the default.
 */
async function integrationRegistration(
  adapter: IntegrationKind,
  plan: ReturnType<typeof buildIntegrationPlan>,
  detected: { executable: string; version: string } | undefined,
) {
  const managedDiagnostics = await diagnoseManagedInstall(plan, homedir());
  const standardPluginCapable =
    detected !== undefined &&
    !managedDiagnostics.every((item) => item.ok) &&
    standardPluginIsSupported(adapter, detected.version);
  return resolveBridgeRegistration({
    managedDiagnostics,
    ...(standardPluginCapable
      ? {
          standardPluginDiagnostics: await diagnoseManagedInstall(
            buildIntegrationPlan(adapter, "standard_plugin"),
            homedir(),
          ),
        }
      : {}),
    ...(detected
      ? {
          probe: (): AgentConfigurationState =>
            agentConfigurationState(adapter, detected.executable),
        }
      : {}),
  });
}

/**
 * Which registration the next attach, repair, or detach plan is built for. An
 * explicit renderer opt-in wins and costs no client probe; without one, the
 * evidence below decides. Only a client that is standard-capable at its
 * detected version is ever read for hybrid mode, so a narrowed plan can never
 * be produced for a client that cannot load the plugin at all — and an explicit
 * opt-in for such a client is rejected by `assertAgentSupportsMutation`.
 */
async function mutationBridgeRegistration(
  adapter: IntegrationKind,
  action: IntegrationAction,
  requested: BridgeRegistration | undefined,
): Promise<BridgeRegistration> {
  return bridgeRegistrationForMutation({
    action,
    requested,
    readEvidence: async () => {
      const detected = detectAgent(adapter);
      if (!detected || !standardPluginIsSupported(adapter, detected.version)) {
        // Unread evidence is absent evidence: this client keeps the full
        // managed plan without spending a probe on a plugin it cannot load.
        return {
          managedMcpRegistration: false,
          pluginBridgeRegistration: false,
        };
      }
      const managedMcpRegistration =
        await managedMcpRegistrationIsPresent(adapter);
      return {
        managedMcpRegistration,
        pluginBridgeRegistration:
          !managedMcpRegistration &&
          agentConfigurationState(adapter, detected.executable) === "valid",
      };
    },
  });
}

/**
 * Whether Intero's own managed `intero` MCP entry is present and unchanged.
 * This is what separates "the client resolves a server Intero wrote" from "the
 * client resolves a server something else registered", which is the only
 * evidence that lets a repair narrow away the managed MCP target.
 */
async function managedMcpRegistrationIsPresent(
  adapter: IntegrationKind,
): Promise<boolean> {
  const plan = buildIntegrationPlan(adapter);
  const mcpTargets = new Set(
    plan.files
      .filter((file) => file.role === "mcp")
      .map((file) => resolve(file.path)),
  );
  if (mcpTargets.size === 0) return false;
  const diagnostics = await diagnoseManagedInstall(plan, homedir());
  const mcpDiagnostics = diagnostics.filter((item) =>
    mcpTargets.has(resolve(item.path)),
  );
  return (
    mcpDiagnostics.length === mcpTargets.size &&
    mcpDiagnostics.every((item) => item.ok)
  );
}

/**
 * Whether applying this plan would write nothing at all. A narrowed plan for an
 * MCP-only client has no managed file left, and with no recorded manifest there
 * is no earlier managed target to retire either.
 */
async function integrationPlanWritesNothing(
  plan: ReturnType<typeof buildIntegrationPlan>,
  adapter: IntegrationKind,
): Promise<boolean> {
  return (
    plan.files.length === 0 &&
    !(await managedIntegrationHasState(adapter, homedir()))
  );
}

function mcpExecutableSpec(): { command: string; prefixArgs: string[] } {
  const candidates = [
    process.env.INTERO_MCP_EXECUTABLE,
    join(
      process.resourcesPath,
      process.platform === "win32" ? "intero-mcp.cmd" : "intero-mcp",
    ),
    resolve(process.cwd(), "apps/mcp-stdio/dist/index.js"),
    resolve(process.cwd(), "../mcp-stdio/dist/index.js"),
    resolve(app.getAppPath(), "../mcp-stdio/dist/index.js"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const executable = candidates.find(existsSync);
  if (!executable) {
    throw new Error("The Intero MCP bridge has not been built.");
  }
  if (process.platform === "win32" && executable.endsWith(".cmd")) {
    return {
      command: process.env.ComSpec ?? process.env.COMSPEC ?? "cmd.exe",
      prefixArgs: ["/d", "/s", "/c", executable],
    };
  }
  return { command: executable, prefixArgs: [] };
}

function detectAgent(
  adapter: IntegrationKind,
): { executable: string; version: string } | undefined {
  const grokHome = process.env.GROK_HOME || join(homedir(), ".grok");
  const candidates =
    adapter === "codex"
      ? ["codex", "/Applications/Codex.app/Contents/Resources/codex"]
      : adapter === "claude-code"
        ? ["claude", join(homedir(), ".local/bin/claude")]
        : adapter === "opencode"
          ? ["opencode", join(homedir(), ".opencode/bin/opencode")]
          : isCursorAgentAdapter(adapter)
            ? cursorAgentExecutableCandidates(homedir())
            : ["grok", join(grokHome, "bin", "grok")];
  for (const executable of candidates) {
    try {
      const output = execFileSync(executable, ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1_500,
      }).trim();
      if (output) return { executable, version: output.slice(0, 120) };
    } catch {
      // Try the next trusted executable location.
    }
  }
  return undefined;
}

function agentConfigurationState(
  adapter: IntegrationKind,
  executable: string,
): AgentConfigurationState {
  try {
    const options: ExecFileSyncOptionsWithStringEncoding = {
      encoding: "utf8",
      env: {
        ...process.env,
        INTERO_INTEGRATION_PROBE: "1",
        ...(adapter === "grok-build"
          ? { GROK_HOME: process.env.GROK_HOME || join(homedir(), ".grok") }
          : {}),
      },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3_000,
    };
    const grokProbe =
      adapter === "grok-build"
        ? [
            execFileSync(
              executable,
              ["mcp", "doctor", "intero", "--json"],
              options,
            ),
            execFileSync(executable, ["inspect", "--json"], options),
          ]
        : undefined;
    const output =
      grokProbe?.join("\n") ??
      execFileSync(
        executable,
        adapter === "codex"
          ? ["mcp", "get", "intero", "--json"]
          : adapter === "claude-code"
            ? ["mcp", "get", "intero"]
            : ["mcp", "list"],
        options,
      );
    const normalized = output.toLowerCase();
    if (isCursorAgentAdapter(adapter) && !cursorAgentMcpListHasIntero(output)) {
      return "invalid";
    }
    if (!normalized.includes("intero")) return "invalid";
    if (
      /\b(enoent|not found|no such file|invalid|malformed)\b/.test(normalized)
    )
      return "invalid";
    if (
      /\b(fail(?:ed|ure)?|error|disconnected|not connected|unreachable)\b/.test(
        normalized,
      )
    ) {
      return "runtime_unreachable";
    }
    if (adapter === "claude-code") {
      return normalized.includes("connected") ? "valid" : "runtime_unreachable";
    }
    if (adapter === "opencode") {
      return normalized.includes("connected") || output.includes("✓")
        ? "valid"
        : "runtime_unreachable";
    }
    if (adapter === "grok-build") {
      if (!grokProbe) return "runtime_unreachable";
      const [doctorOutput, inspectOutput] = grokProbe;
      if (doctorOutput === undefined || inspectOutput === undefined) {
        return "runtime_unreachable";
      }
      return grokBuildMcpProbeIsValid(doctorOutput, inspectOutput)
        ? "valid"
        : "runtime_unreachable";
    }
    return "valid";
  } catch {
    return "runtime_unreachable";
  }
}

function assertAgentSupportsMutation(
  adapter: IntegrationKind,
  action: IntegrationAction,
  bridgeRegistration: BridgeRegistration,
): void {
  if (action === "uninstall") return;
  const detected = detectAgent(adapter);
  if (!detected) {
    throw new Error(`The ${adapter} executable was not detected.`);
  }
  if (!integrationVersionIsSupported(adapter, detected.version)) {
    throw new Error(
      `The installed ${adapter} version is below Intero's supported minimum.`,
    );
  }
  assertBridgeRegistrationIsInstallable(
    adapter,
    bridgeRegistration,
    standardPluginIsSupported(adapter, detected.version),
  );
}

function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  if (
    !frame ||
    frame !== event.sender.mainFrame ||
    event.sender.id !== trustedRendererId ||
    !trustedRendererUrl ||
    !rendererUrlIsTrusted(frame.url, trustedRendererUrl)
  ) {
    throw new Error("Integration management is limited to the main frame.");
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#14130f",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(mainDirectory, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  trustedRendererId = window.webContents.id;
  const rendererUrl = new URL(
    process.env.ELECTRON_RENDERER_URL ??
      pathToFileURL(join(mainDirectory, "../renderer/index.html")).href,
  ).href;
  trustedRendererUrl = rendererUrl;
  window.webContents.session.setPermissionCheckHandler(
    (webContents, permission) =>
      permission === "media" && webContents?.id === window.webContents.id,
  );
  window.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      callback(
        permission === "media" && webContents.id === window.webContents.id,
      );
    },
  );

  window.webContents.setWindowOpenHandler(({ url }) => {
    const protocol = new URL(url).protocol;
    if (
      protocol === "https:" ||
      protocol === "http:" ||
      protocol === "codex:"
    ) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== trustedRendererUrl) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (url !== trustedRendererUrl) event.preventDefault();
  });
  window.webContents.once("destroyed", () => {
    if (trustedRendererId === window.webContents.id) {
      trustedRendererId = undefined;
      trustedRendererUrl = undefined;
      integrationPreviews.clear();
    }
  });

  void window.loadURL(rendererUrl);
}

app.whenReady().then(async () => {
  await loadGitAwareness();
  await reconcileGitAwarenessSubscriptions();
  registerDesktopIntegrationBridge();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  stopGitAwarenessSubscriptions();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
