import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("interoDesktop", {
  platform: process.platform,
  runtimeVersion: process.versions.electron,
  getLocalStatus: () => ipcRenderer.invoke("intero:local-status"),
  setModelEgress: (mode: "managed_api" | "user_provided_api" | "disabled") =>
    ipcRenderer.invoke("intero:set-model-egress", mode),
  getIntegrationStatus: () => ipcRenderer.invoke("intero:integration-status"),
  previewIntegration: (
    adapter: "codex" | "claude-code" | "opencode",
    action: "install" | "repair" | "uninstall",
    locale: "zh-CN" | "en-US",
  ) =>
    ipcRenderer.invoke("intero:integration-preview", adapter, action, locale),
  manageIntegration: (token: string) =>
    ipcRenderer.invoke("intero:integration-action", token),
});
