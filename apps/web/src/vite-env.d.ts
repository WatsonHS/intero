/// <reference types="vite/client" />

interface Window {
  interoDesktop?: {
    platform: string;
    runtimeVersion: string;
    getIntegrationStatus(): Promise<CodingAgentIntegrationStatus[]>;
    previewIntegration(input: {
      adapter: CodingAgentAdapter;
      action: CodingAgentIntegrationAction;
      locale: "zh-CN" | "en-US";
      projectId?: string;
      repositorySelectionToken?: string;
    }): Promise<CodingAgentIntegrationPreview | null>;
    manageIntegration(token: string): Promise<{
      integrations: CodingAgentIntegrationStatus[];
      workspaceId?: string;
    }>;
    previewWorkspaceCleanup(input: {
      adapter: CodingAgentAdapter;
      locale: "zh-CN" | "en-US";
      projectId: string;
      bindingId: string;
      workspaceId: string;
      repositorySelectionToken: string;
    }): Promise<WorkspaceCleanupPreview | null>;
    cleanupWorkspaceConnection(token: string): Promise<{
      removed: string[];
      alreadyRemoved: boolean;
    }>;
    getGitAwarenessStatus(): Promise<GitAwarenessStatus[]>;
    getGitAwarenessClients(): Promise<GitAwarenessClient[]>;
    chooseGitRepository(): Promise<GitRepositorySelection | null>;
    configureGitAwareness(input: {
      repositoryPath: string;
      client: GitAwarenessClient;
      enabled: boolean;
    }): Promise<GitAwarenessStatus[]>;
    removeGitAwareness(repositoryPath: string): Promise<GitAwarenessStatus[]>;
  };
}

type CodingAgentAdapter =
  "codex" | "claude-code" | "opencode" | "cursor" | "grok-build";
type CodingAgentIntegrationAction = "install" | "repair" | "uninstall";
type GitAwarenessClient = "codex" | "claude-code" | "opencode";

interface CodingAgentIntegrationStatus {
  adapter: CodingAgentAdapter;
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

interface CodingAgentIntegrationPreview {
  token: string;
  adapter: CodingAgentAdapter;
  action: CodingAgentIntegrationAction;
  targets: string[];
  expiresAt: string;
}

interface WorkspaceCleanupPreview {
  token: string;
  targets: string[];
  expiresAt: string;
}

interface GitAwarenessSnapshot {
  repository: string;
  branch?: string;
  head?: string;
  staged: "clean" | "changed";
  fingerprint: string;
}

interface GitAwarenessStatus {
  repositoryPath: string;
  repositoryName: string;
  client: GitAwarenessClient;
  enabled: boolean;
  snapshot?: GitAwarenessSnapshot;
  lastDeliveredAt?: string;
  lastError?: string;
}

interface GitRepositorySelection {
  repositoryPath: string;
  snapshot: GitAwarenessSnapshot;
  selectionToken: string;
  workspaceId: string;
  expiresAt: string;
}
