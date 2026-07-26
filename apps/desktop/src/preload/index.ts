import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("interoDesktop", {
  platform: process.platform,
  runtimeVersion: process.versions.electron,
  getIntegrationStatus: () => ipcRenderer.invoke("intero:integration-status"),
  previewIntegration: (
    adapter: "codex" | "claude-code" | "opencode",
    action: "install" | "repair" | "uninstall",
    locale: "zh-CN" | "en-US",
  ) =>
    ipcRenderer.invoke("intero:integration-preview", adapter, action, locale),
  manageIntegration: (token: string) =>
    ipcRenderer.invoke("intero:integration-action", token),
  getGitAwarenessStatus: () =>
    ipcRenderer.invoke("intero:git-awareness-status"),
  getGitAwarenessClients: () =>
    ipcRenderer.invoke("intero:git-awareness-clients"),
  chooseGitRepository: () =>
    ipcRenderer.invoke("intero:git-awareness-choose-repository"),
  configureGitAwareness: (input: {
    repositoryPath: string;
    client: "codex" | "claude-code" | "opencode";
    enabled: boolean;
  }) => ipcRenderer.invoke("intero:git-awareness-configure", input),
  removeGitAwareness: (repositoryPath: string) =>
    ipcRenderer.invoke("intero:git-awareness-remove", repositoryPath),
});
