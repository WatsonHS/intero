/// <reference types="vite/client" />

interface Window {
  interoDesktop?: {
    platform: string;
    runtimeVersion: string;
    getLocalStatus(): Promise<LocalRuntimeStatus>;
    setModelEgress(
      mode: ModelEgressMode,
    ): Promise<{ modelEgress: ModelEgressMode }>;
    getIntegrationStatus(): Promise<CodingAgentIntegrationStatus[]>;
    previewIntegration(
      adapter: CodingAgentAdapter,
      action: CodingAgentIntegrationAction,
      locale: "zh-CN" | "en-US",
    ): Promise<CodingAgentIntegrationPreview | null>;
    manageIntegration(token: string): Promise<CodingAgentIntegrationStatus[]>;
  };
}

type ModelEgressMode = "managed_api" | "user_provided_api" | "disabled";
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

interface LocalRuntimeWorkspace {
  id: string;
  root: string;
  repositoryIdentity: string;
  revoked: boolean;
}

type LocalRuntimeStatus =
  | {
      available: true;
      health: {
        status: "ok";
        version: string;
        protocolVersion: number;
        encryptedStorage: boolean;
      };
      workspaces: LocalRuntimeWorkspace[];
      modelEgress: ModelEgressMode;
    }
  | {
      available: false;
      reason: "daemon_unavailable" | "desktop_required";
    };
