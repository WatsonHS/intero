import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("interoDesktop", {
  platform: process.platform,
  runtimeVersion: process.versions.electron,
  getIntegrationStatus: () => ipcRenderer.invoke("intero:integration-status"),
  previewIntegration: (input: {
    adapter: "codex" | "claude-code" | "opencode" | "grok-build" | "cursor";
    action: "install" | "repair" | "uninstall";
    locale: "zh-CN" | "en-US";
    projectId?: string;
    repositorySelectionToken?: string;
    bridgeRegistration?: "managed" | "standard_plugin";
  }) => ipcRenderer.invoke("intero:integration-preview", input),
  manageIntegration: (
    input:
      | string
      | {
          token: string;
          bridgeRegistration?: "managed" | "standard_plugin";
        },
  ) => ipcRenderer.invoke("intero:integration-action", input),
  previewWorkspaceCleanup: (input: {
    adapter: "codex" | "claude-code" | "opencode" | "grok-build" | "cursor";
    locale: "zh-CN" | "en-US";
    projectId: string;
    bindingId: string;
    workspaceId: string;
    repositorySelectionToken: string;
  }) => ipcRenderer.invoke("intero:workspace-cleanup-preview", input),
  cleanupWorkspaceConnection: (token: string) =>
    ipcRenderer.invoke("intero:workspace-cleanup-action", token),
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
