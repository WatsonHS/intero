import { join } from "node:path";

import { SocketDaemonClient, loadConnectionSettings } from "@intero/local-ipc";
import { BrowserWindow, app, ipcMain, shell } from "electron";

type ModelEgressMode = "managed_api" | "user_provided_api" | "disabled";

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
  ipcMain.handle("intero:local-status", localRuntimeStatus);
  ipcMain.handle(
    "intero:set-model-egress",
    async (_event, mode: ModelEgressMode) => {
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
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    const protocol = new URL(url).protocol;
    if (protocol === "https:" || protocol === "http:") {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const current = window.webContents.getURL();
    if (current && new URL(url).origin !== new URL(current).origin) {
      event.preventDefault();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
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
