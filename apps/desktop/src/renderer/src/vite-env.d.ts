/// <reference types="vite/client" />

interface Window {
  interoDesktop?: {
    platform: string;
    runtimeVersion: string;
    getIntegrationStatus(): Promise<CodingAgentIntegrationStatus[]>;
    previewIntegration(
      adapter: CodingAgentAdapter,
      action: CodingAgentIntegrationAction,
      locale: "zh-CN" | "en-US",
    ): Promise<CodingAgentIntegrationPreview | null>;
    manageIntegration(token: string): Promise<CodingAgentIntegrationStatus[]>;
    getGitAwarenessStatus(): Promise<GitAwarenessStatus[]>;
    getGitAwarenessClients(): Promise<CodingAgentAdapter[]>;
    chooseGitRepository(): Promise<GitRepositorySelection | null>;
    configureGitAwareness(input: {
      repositoryPath: string;
      client: CodingAgentAdapter;
      enabled: boolean;
    }): Promise<GitAwarenessStatus[]>;
    removeGitAwareness(repositoryPath: string): Promise<GitAwarenessStatus[]>;
  };
}

type CodingAgentAdapter = "codex" | "claude-code" | "opencode";
type CodingAgentIntegrationAction = "install" | "repair" | "uninstall";

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
  client: CodingAgentAdapter;
  enabled: boolean;
  snapshot?: GitAwarenessSnapshot;
  lastDeliveredAt?: string;
  lastError?: string;
}

interface GitRepositorySelection {
  repositoryPath: string;
  snapshot: GitAwarenessSnapshot;
}
