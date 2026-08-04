import { createHash } from "node:crypto";

export const LOCAL_SELECTION_TTL_MS = 60_000;
export const INTEGRATION_PREVIEW_TTL_MS = 60_000;

export type IntegrationMutationAction = "install" | "repair" | "uninstall";

export interface IntegrationPreviewRequest {
  adapter: string;
  action: IntegrationMutationAction;
  locale: "zh-CN" | "en-US";
  projectId?: string;
  repositorySelectionToken?: string;
}

export interface RepositorySelectionBinding {
  token: string;
  senderId: number;
  repositoryPath: string;
  workspaceId: string;
  expiresAt: number;
  consumed: boolean;
}

export interface ProjectRepositoryBinding {
  projectId: string;
  repositorySelectionToken: string;
  repositoryPath: string;
  workspaceId: string;
}

export interface WorkspaceCleanupRequest {
  adapter: string;
  locale: "zh-CN" | "en-US";
  projectId: string;
  bindingId: string;
  workspaceId: string;
  repositorySelectionToken: string;
}

export interface WorkspaceCleanupBinding extends ProjectRepositoryBinding {
  bindingId: string;
  workspaceId: string;
}

export interface DigestableIntegrationPlan {
  files: Array<{
    path: string;
    format: string;
    marker: string;
    content: string;
  }>;
}

/**
 * Parses the narrow renderer input before any native configuration is read or
 * modified. Project/repository authority is required only for attach/repair;
 * detach deliberately remains a local cleanup operation.
 */
export function parseIntegrationPreviewRequest(
  value: unknown,
): IntegrationPreviewRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Integration preview input is required.");
  }
  const input = value as Partial<IntegrationPreviewRequest>;
  if (
    typeof input.adapter !== "string" ||
    input.adapter.length === 0 ||
    input.adapter.length > 80 ||
    !isIntegrationMutationAction(input.action) ||
    (input.locale !== "zh-CN" && input.locale !== "en-US")
  ) {
    throw new Error("Integration preview input is invalid.");
  }
  if (
    input.projectId !== undefined &&
    (typeof input.projectId !== "string" ||
      !isProjectId(input.projectId) ||
      input.projectId.length > 80)
  ) {
    throw new Error("Project scope is invalid.");
  }
  if (
    input.repositorySelectionToken !== undefined &&
    (typeof input.repositorySelectionToken !== "string" ||
      !isOpaqueToken(input.repositorySelectionToken))
  ) {
    throw new Error("Repository selection token is invalid.");
  }
  return {
    adapter: input.adapter,
    action: input.action,
    locale: input.locale,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.repositorySelectionToken
      ? { repositorySelectionToken: input.repositorySelectionToken }
      : {}),
  };
}

export function parseWorkspaceCleanupRequest(
  value: unknown,
): WorkspaceCleanupRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workspace cleanup input is required.");
  }
  const input = value as Partial<WorkspaceCleanupRequest>;
  if (
    typeof input.adapter !== "string" ||
    input.adapter.length === 0 ||
    input.adapter.length > 80 ||
    (input.locale !== "zh-CN" && input.locale !== "en-US") ||
    typeof input.projectId !== "string" ||
    !isProjectId(input.projectId) ||
    typeof input.bindingId !== "string" ||
    !isProjectId(input.bindingId) ||
    typeof input.workspaceId !== "string" ||
    !isProjectId(input.workspaceId) ||
    typeof input.repositorySelectionToken !== "string" ||
    !isOpaqueToken(input.repositorySelectionToken)
  ) {
    throw new Error("Workspace cleanup input is invalid.");
  }
  return input as WorkspaceCleanupRequest;
}

export function requireWorkspaceCleanupBinding(
  input: WorkspaceCleanupRequest,
  selection: RepositorySelectionBinding | undefined,
  senderId: number,
  now: number,
): WorkspaceCleanupBinding {
  const binding = requireProjectRepositoryBinding(
    {
      adapter: input.adapter,
      action: "repair",
      locale: input.locale,
      projectId: input.projectId,
      repositorySelectionToken: input.repositorySelectionToken,
    },
    selection,
    senderId,
    now,
  );
  if (!binding) throw new Error("Workspace cleanup requires a repository.");
  if (input.workspaceId !== binding.workspaceId) {
    throw new Error(
      "The selected repository does not match this Agent connection workspace.",
    );
  }
  return {
    ...binding,
    bindingId: input.bindingId,
    workspaceId: binding.workspaceId,
  };
}

export function requireProjectRepositoryBinding(
  input: IntegrationPreviewRequest,
  selection: RepositorySelectionBinding | undefined,
  senderId: number,
  now: number,
): ProjectRepositoryBinding | undefined {
  if (!requiresProjectRepositoryBinding(input.action)) return undefined;
  if (!input.projectId || !input.repositorySelectionToken) {
    throw new Error(
      "Install and repair require a Project and a fresh repository selection.",
    );
  }
  if (
    !selection ||
    selection.token !== input.repositorySelectionToken ||
    selection.senderId !== senderId ||
    selection.consumed ||
    selection.expiresAt <= now
  ) {
    throw new Error(
      "The repository selection is missing, expired, or already used.",
    );
  }
  return {
    projectId: input.projectId,
    repositorySelectionToken: input.repositorySelectionToken,
    repositoryPath: selection.repositoryPath,
    workspaceId: selection.workspaceId,
  };
}

export function requiresProjectRepositoryBinding(
  action: IntegrationMutationAction,
): boolean {
  return action === "install" || action === "repair";
}

export function digestIntegrationPlan(input: {
  adapter: string;
  action: IntegrationMutationAction;
  targets: string[];
  plan: DigestableIntegrationPlan;
  binding?: ProjectRepositoryBinding;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        adapter: input.adapter,
        action: input.action,
        targets: input.targets,
        projectId: input.binding?.projectId,
        repositoryPath: input.binding?.repositoryPath,
        workspaceId: input.binding?.workspaceId,
        repositorySelectionToken: input.binding?.repositorySelectionToken,
        files: input.plan.files.map((file) => ({
          path: file.path,
          format: file.format,
          marker: file.marker,
          content: file.content,
        })),
      }),
    )
    .digest("hex");
}

/**
 * Grok Build's documented local MCP contract is a healthy named-server doctor
 * result plus an inspect report that discovers that server. Both reports are
 * required so a syntactically present but undiscovered entry is not presented
 * as connected.
 */
export function grokBuildMcpProbeIsValid(
  doctorOutput: string,
  inspectOutput: string,
): boolean {
  const inspect = inspectOutput.toLowerCase();
  let doctorReport: unknown;
  try {
    doctorReport = JSON.parse(doctorOutput);
  } catch {
    return false;
  }
  const doctorHealthy = jsonReportContainsHealthyStatus(doctorReport);
  return doctorHealthy && inspect.includes("intero");
}

function jsonReportContainsHealthyStatus(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(jsonReportContainsHealthyStatus);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.healthy === true) return true;
  if (
    typeof record.status === "string" &&
    (record.status.toLowerCase() === "ok" ||
      record.status.toLowerCase() === "healthy")
  ) {
    return true;
  }
  return Object.values(record).some(jsonReportContainsHealthyStatus);
}

/**
 * The canonical Web renderer uses browser history over HTTP and hash history
 * in packaged file builds. Route changes must not invalidate the preload IPC
 * boundary, while a different origin or packaged file must still fail closed.
 */
export function rendererUrlIsTrusted(
  actualUrl: string,
  canonicalUrl: string,
): boolean {
  try {
    const actual = new URL(actualUrl);
    const canonical = new URL(canonicalUrl);
    if (canonical.protocol === "http:" || canonical.protocol === "https:") {
      return actual.origin === canonical.origin;
    }
    if (canonical.protocol === "file:") {
      return (
        actual.protocol === "file:" &&
        actual.host === canonical.host &&
        actual.pathname === canonical.pathname &&
        actual.search === canonical.search
      );
    }
    return actual.href === canonical.href;
  } catch {
    return false;
  }
}

function isIntegrationMutationAction(
  action: unknown,
): action is IntegrationMutationAction {
  return action === "install" || action === "repair" || action === "uninstall";
}

function isProjectId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isOpaqueToken(value: string): boolean {
  return (
    value.length >= 16 && value.length <= 200 && /^[A-Za-z0-9_-]+$/.test(value)
  );
}
