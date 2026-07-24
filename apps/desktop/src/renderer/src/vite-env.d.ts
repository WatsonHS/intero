/// <reference types="vite/client" />

interface Window {
  interoDesktop?: {
    platform: string;
    runtimeVersion: string;
    getLocalStatus(): Promise<LocalRuntimeStatus>;
    setModelEgress(
      mode: ModelEgressMode,
    ): Promise<{ modelEgress: ModelEgressMode }>;
  };
}

type ModelEgressMode = "managed_api" | "user_provided_api" | "disabled";

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
