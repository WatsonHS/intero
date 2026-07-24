import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
import { SocketDaemonClient, loadConnectionSettings } from "@intero/local-ipc";
import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  shell,
} from "electron";

type ModelEgressMode = "managed_api" | "user_provided_api" | "disabled";
type IntegrationAction = "install" | "repair" | "uninstall";

let integrationMutation = Promise.resolve();
let trustedRendererId: number | undefined;
let trustedRendererUrl: string | undefined;
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

async function daemonClient(): Promise<SocketDaemonClient> {
  const connection = await loadConnectionSettings();
  return new SocketDaemonClient(connection.socketPath, connection.authToken);
}

async function localRuntimeStatus() {
  try {
    const daemon = await daemonClient();
    const [health, workspaceState, settings] = await Promise.all([
      daemon.call("system.health", {}),
      daemon.call("workspace.list", {}),
      daemon.call("settings.get", {}),
    ]);
    if (
      !isRecord(health) ||
      health.status !== "ok" ||
      typeof health.version !== "string" ||
      typeof health.protocolVersion !== "number" ||
      typeof health.encryptedStorage !== "boolean" ||
      !isRecord(workspaceState) ||
      !Array.isArray(workspaceState.workspaces) ||
      !isRecord(settings) ||
      !isModelEgressMode(settings.modelEgress)
    ) {
      throw new Error("interod returned an invalid local status.");
    }
    const workspaces = workspaceState.workspaces.filter(
      (
        workspace,
      ): workspace is {
        id: string;
        root: string;
        repositoryIdentity: string;
        revoked: boolean;
      } =>
        isRecord(workspace) &&
        typeof workspace.id === "string" &&
        typeof workspace.root === "string" &&
        typeof workspace.repositoryIdentity === "string" &&
        typeof workspace.revoked === "boolean",
    );
    return {
      available: true as const,
      health: {
        status: "ok" as const,
        version: health.version,
        protocolVersion: health.protocolVersion,
        encryptedStorage: health.encryptedStorage,
      },
      workspaces,
      modelEgress: settings.modelEgress,
    };
  } catch {
    return {
      available: false as const,
      reason: "daemon_unavailable" as const,
    };
  }
}

function registerLocalRuntimeBridge() {
  ipcMain.removeHandler("intero:local-status");
  ipcMain.removeHandler("intero:set-model-egress");
  ipcMain.removeHandler("intero:integration-status");
  ipcMain.removeHandler("intero:integration-preview");
  ipcMain.removeHandler("intero:integration-action");
  ipcMain.handle("intero:local-status", (event) => {
    assertTrustedRenderer(event);
    return localRuntimeStatus();
  });
  ipcMain.handle(
    "intero:set-model-egress",
    async (event, mode: ModelEgressMode) => {
      assertTrustedRenderer(event);
      if (
        mode !== "managed_api" &&
        mode !== "user_provided_api" &&
        mode !== "disabled"
      ) {
        throw new Error("Unsupported model egress mode.");
      }
      const daemon = await daemonClient();
      const result = await daemon.call("settings.set_model_egress", { mode });
      if (!isRecord(result) || !isModelEgressMode(result.modelEgress)) {
        throw new Error("interod did not confirm the model egress policy.");
      }
      return { modelEgress: result.modelEgress };
    },
  );
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
  const connectionDirectory = dirname(
    process.env.INTERO_CONNECTION_FILE ??
      join(
        process.env.INTERO_DATA_DIR ?? join(homedir(), ".intero"),
        "connection.json",
      ),
  );
  return selected.installPlan(
    homedir(),
    executable.command,
    {
      hook: join(connectionDirectory, "connection-hook.json"),
      mcp: join(connectionDirectory, "connection-mcp.json"),
    },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isModelEgressMode(value: unknown): value is ModelEgressMode {
  return (
    value === "managed_api" ||
    value === "user_provided_api" ||
    value === "disabled"
  );
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f2efe8",
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
    if (protocol === "https:" || protocol === "http:") {
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

app.whenReady().then(() => {
  registerLocalRuntimeBridge();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
