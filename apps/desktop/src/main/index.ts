import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  applyManagedInstall,
  diagnoseManagedInstall,
  integrationVersionIsSupported,
  integrationAdapters,
  managedIntegrationHasState,
  managedIntegrationTargets,
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
    planDigest: string;
    expiresAt: number;
  }
>();

function registerDesktopIntegrationBridge() {
  ipcMain.removeHandler("intero:integration-status");
  ipcMain.removeHandler("intero:integration-preview");
  ipcMain.removeHandler("intero:integration-action");
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
    async (
      event,
      adapter: IntegrationKind,
      action: IntegrationAction,
      locale: "zh-CN" | "en-US",
    ) => {
      assertTrustedRenderer(event);
      assertIntegrationAction(adapter, action);
      assertAgentSupportsMutation(adapter, action);
      if (locale !== "zh-CN" && locale !== "en-US") {
        throw new Error("Unsupported integration confirmation locale.");
      }
      const plan = buildIntegrationPlan(adapter);
      const targets = await integrationTargets(plan);
      const parent = BrowserWindow.fromWebContents(event.sender);
      if (!parent) throw new Error("The trusted Intero window is unavailable.");
      const chinese = locale === "zh-CN";
      const confirmation = await dialog.showMessageBox(parent, {
        type: "warning",
        title: chinese ? "确认 Agent 配置变更" : "Confirm Agent configuration",
        message: chinese
          ? "Intero 将只修改以下路径中的托管配置项。"
          : "Intero will update only managed entries in these paths.",
        detail: targets.join("\n"),
        buttons: chinese ? ["继续", "取消"] : ["Continue", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (confirmation.response !== 0) return null;
      const token = randomUUID();
      const expiresAt = Date.now() + 60_000;
      pruneIntegrationPreviews();
      integrationPreviews.set(token, {
        senderId: event.sender.id,
        adapter,
        action,
        planDigest: digestPlan(plan, action, targets),
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
  ipcMain.handle("intero:integration-action", async (event, token: string) => {
    assertTrustedRenderer(event);
    if (typeof token !== "string") {
      throw new Error("A configuration preview token is required.");
    }
    pruneIntegrationPreviews();
    const preview = integrationPreviews.get(token);
    integrationPreviews.delete(token);
    if (!preview || preview.senderId !== event.sender.id) {
      throw new Error("The configuration preview is missing or expired.");
    }
    const { adapter, action } = preview;
    assertAgentSupportsMutation(adapter, action);
    const plan = buildIntegrationPlan(adapter);
    const currentTargets = await integrationTargets(plan);
    if (digestPlan(plan, action, currentTargets) !== preview.planDigest) {
      throw new Error("Integration plan changed after confirmation.");
    }
    const operation = integrationMutation.then(async () => {
      if (action === "uninstall") {
        await uninstallManagedIntegration(adapter, homedir());
      } else {
        await applyManagedInstall(plan, homedir());
      }
      return integrationStatus();
    });
    integrationMutation = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  });
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
    return { repositoryPath: selection.filePaths[0], snapshot };
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
): Promise<string[]> {
  return managedIntegrationTargets(plan, homedir());
}

function digestPlan(
  plan: ReturnType<typeof buildIntegrationPlan>,
  action: IntegrationAction,
  targets: string[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        action,
        targets,
        files: plan.files.map((file) => ({
          path: resolve(file.path),
          format: file.format,
          marker: file.marker,
          content: file.content,
        })),
      }),
    )
    .digest("hex");
}

function pruneIntegrationPreviews(): void {
  const now = Date.now();
  for (const [token, preview] of integrationPreviews) {
    if (preview.expiresAt <= now) integrationPreviews.delete(token);
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
      try {
        const plan = buildIntegrationPlan(adapter.kind);
        const diagnostics = await diagnoseManagedInstall(plan, homedir());
        const complete = diagnostics.every((item) => item.ok);
        const configured =
          diagnostics.some((item) => item.ok) ||
          (await managedIntegrationHasState(adapter.kind, homedir()));
        const configurationState =
          complete && detectedAgent
            ? agentConfigurationState(adapter.kind, detectedAgent.executable)
            : undefined;
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
          ...(version ? { version } : {}),
          state:
            !detectedAgent && !configured
              ? ("not_installed" as const)
              : !supported
                ? ("unsupported_version" as const)
                : complete && configurationState === "invalid"
                  ? ("needs_repair" as const)
                  : complete
                    ? adapter.kind === "codex"
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

function buildIntegrationPlan(adapter: IntegrationKind) {
  const selected = integrationAdapters.find(
    (candidate) => candidate.kind === adapter,
  );
  if (!selected) throw new Error("Unknown integration adapter.");
  const executable = mcpExecutableSpec();
  return selected.installPlan(
    homedir(),
    executable.command,
    executable.prefixArgs,
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
  const candidates =
    adapter === "codex"
      ? ["codex", "/Applications/Codex.app/Contents/Resources/codex"]
      : adapter === "claude-code"
        ? ["claude", join(homedir(), ".local/bin/claude")]
        : ["opencode", join(homedir(), ".opencode/bin/opencode")];
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
): "valid" | "runtime_unreachable" | "invalid" {
  const argumentsByAdapter: Record<IntegrationKind, string[]> = {
    codex: ["mcp", "get", "intero", "--json"],
    "claude-code": ["mcp", "get", "intero"],
    opencode: ["mcp", "list"],
  };
  try {
    const output = execFileSync(executable, argumentsByAdapter[adapter], {
      encoding: "utf8",
      env: { ...process.env, INTERO_INTEGRATION_PROBE: "1" },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3_000,
    });
    const normalized = output.toLowerCase();
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
    return "valid";
  } catch {
    return "runtime_unreachable";
  }
}

function assertAgentSupportsMutation(
  adapter: IntegrationKind,
  action: IntegrationAction,
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
}

function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  if (
    !frame ||
    frame !== event.sender.mainFrame ||
    event.sender.id !== trustedRendererId ||
    frame.url !== trustedRendererUrl
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
