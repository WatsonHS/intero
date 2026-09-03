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
  /**
   * The explicit ADR-0011 opt-in. Absent means "use Intero's own reading of who
   * owns the bridge"; present always wins over that reading, and a mode the
   * detected client cannot honour is rejected before any plan is built.
   */
  bridgeRegistration?: BridgeRegistration;
}

export interface IntegrationActionRequest {
  token: string;
  bridgeRegistration?: BridgeRegistration;
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
  if (
    input.bridgeRegistration !== undefined &&
    !isBridgeRegistration(input.bridgeRegistration)
  ) {
    throw new Error("Bridge registration mode is invalid.");
  }
  return {
    adapter: input.adapter,
    action: input.action,
    locale: input.locale,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.repositorySelectionToken
      ? { repositorySelectionToken: input.repositorySelectionToken }
      : {}),
    ...(input.bridgeRegistration
      ? { bridgeRegistration: input.bridgeRegistration }
      : {}),
  };
}

/**
 * Parses the apply-side input. The confirmed preview token stays the only
 * authority; the optional registration repeats the explicit opt-in the preview
 * carried, so a mode that changed between confirmation and apply builds a
 * different plan and fails the existing plan-digest check instead of silently
 * writing a different target set. A bare token string is still accepted so a
 * renderer bundle built before the opt-in existed keeps working.
 */
export function parseIntegrationActionRequest(
  value: unknown,
): IntegrationActionRequest {
  if (typeof value === "string") return { token: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A configuration preview token is required.");
  }
  const input = value as Partial<IntegrationActionRequest>;
  if (
    typeof input.token !== "string" ||
    input.token.length === 0 ||
    input.token.length > 200
  ) {
    throw new Error("A configuration preview token is required.");
  }
  if (
    input.bridgeRegistration !== undefined &&
    !isBridgeRegistration(input.bridgeRegistration)
  ) {
    throw new Error("Bridge registration mode is invalid.");
  }
  return {
    token: input.token,
    ...(input.bridgeRegistration
      ? { bridgeRegistration: input.bridgeRegistration }
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
 * Who owns the credential-free `intero` MCP registration for one client
 * (ADR-0011). `managed` is the default path Intero writes itself;
 * `standard_plugin` is hybrid mode, where the published Agent Plugin owns the
 * registration and the managed plan narrows to what the standard cannot
 * express.
 */
export type BridgeRegistration = "managed" | "standard_plugin";

export type AgentConfigurationState =
  "valid" | "runtime_unreachable" | "invalid";

export interface ManagedInstallDiagnostic {
  path: string;
  ok: boolean;
  detail: string;
}

export interface ResolvedBridgeRegistration {
  bridgeRegistration: BridgeRegistration;
  diagnostics: ManagedInstallDiagnostic[];
  complete: boolean;
  configurationState: AgentConfigurationState | undefined;
}

/**
 * Resolves who registered the bridge from the managed diagnosis, the narrowed
 * ADR-0011 diagnosis, and one client probe.
 *
 * The managed diagnosis stays authoritative: a complete managed install
 * resolves exactly as it did before hybrid mode existed. Only an incomplete
 * managed diagnosis consults the narrowed plan, and only for a detected client
 * version that can actually load the published plugin — the caller expresses
 * that by supplying `standardPluginDiagnostics`. A client without standard
 * support therefore never reaches the probe.
 *
 * The narrowed plan is the managed plan minus its MCP targets, so a narrowed
 * diagnosis that passes while the managed one fails already proves no managed
 * MCP entry is present. Only a positive probe is then accepted as evidence
 * that something else registered `intero`: an unreachable or rejecting client
 * runtime proves nothing, and falls back to the managed reading unchanged.
 *
 * An empty `standardPluginDiagnostics` is vacuously complete, which is the
 * honest reading of an MCP-only client (Cursor) whose narrowed plan has no
 * managed target left at all.
 */
export function resolveBridgeRegistration(input: {
  managedDiagnostics: ManagedInstallDiagnostic[];
  standardPluginDiagnostics?: ManagedInstallDiagnostic[] | undefined;
  probe?: (() => AgentConfigurationState) | undefined;
}): ResolvedBridgeRegistration {
  if (input.managedDiagnostics.every((item) => item.ok)) {
    return {
      bridgeRegistration: "managed",
      diagnostics: input.managedDiagnostics,
      complete: true,
      configurationState: input.probe?.(),
    };
  }
  if (
    input.standardPluginDiagnostics &&
    input.probe &&
    input.standardPluginDiagnostics.every((item) => item.ok)
  ) {
    const configurationState = input.probe();
    if (configurationState === "valid") {
      return {
        bridgeRegistration: "standard_plugin",
        diagnostics: input.standardPluginDiagnostics,
        complete: true,
        configurationState,
      };
    }
  }
  return {
    bridgeRegistration: "managed",
    diagnostics: input.managedDiagnostics,
    complete: false,
    configurationState: undefined,
  };
}

/**
 * What an attach or repair knows about who owns the `intero` registration this
 * client would actually use, independent of whether the managed install around
 * it is complete.
 */
export interface BridgeRegistrationEvidence {
  /**
   * Whether Intero's own managed MCP target is present and unchanged. A present
   * managed entry is the registration this client is already using, so no
   * client reading can move the default off `managed`.
   */
  managedMcpRegistration: boolean;
  /**
   * Whether the client itself resolves an `intero` server that the managed
   * diagnosis above does not account for. Only a positive client reading counts:
   * an unread, unreachable, or rejecting client is reported as `false`, and a
   * client that cannot load the published plugin at all is never read.
   */
  pluginBridgeRegistration: boolean;
}

/**
 * Which registration a mutation plan is built for.
 *
 * An explicit opt-in always wins, and is not cross-checked here: the caller
 * still fails closed on a client that cannot load the published plugin, and
 * asking for a mode this evidence does not yet show is exactly how a user
 * declares that the plugin is the intended owner.
 *
 * Without an explicit choice the default is evidence-based rather than
 * state-based. `resolveBridgeRegistration` stays a truthful reading of the
 * install and only calls a partially installed hybrid client `managed`, but
 * repairing that client from a full managed plan would write a second `intero`
 * entry beside the plugin's. So a confirmed plugin registration the managed
 * diagnosis does not account for narrows the plan even when the narrowed
 * diagnosis is incomplete — repair then writes only the missing hooks and
 * instructions. With no confirmed plugin registration the default stays the
 * full managed install.
 *
 * Detach keeps the full managed set: it replays the recorded install manifest
 * rather than a plan, so narrowing would only hide targets an earlier full
 * install still owns — and it must not spend a client probe, or honour an
 * opt-in, to decide something it does not use.
 */
export async function bridgeRegistrationForMutation(input: {
  action: IntegrationMutationAction;
  requested?: BridgeRegistration | undefined;
  readEvidence: () => Promise<BridgeRegistrationEvidence>;
}): Promise<BridgeRegistration> {
  if (input.action === "uninstall") return "managed";
  if (input.requested) return input.requested;
  const evidence = await input.readEvidence();
  return evidence.pluginBridgeRegistration && !evidence.managedMcpRegistration
    ? "standard_plugin"
    : "managed";
}

/**
 * Fail-closed guard for the ADR-0011 opt-in. A narrowed plan omits the managed
 * MCP entry, so it is only ever a truthful install for a client that can load
 * the published plugin replacing it. `supportsStandardPlugin` is the per-client,
 * per-version capability the caller has already detected; a client with no
 * standard support at all is never capable at any version, so an explicit
 * opt-in for it is rejected before any plan is built.
 */
export function assertBridgeRegistrationIsInstallable(
  adapter: string,
  bridgeRegistration: BridgeRegistration,
  supportsStandardPlugin: boolean,
): void {
  if (bridgeRegistration === "standard_plugin" && !supportsStandardPlugin) {
    throw new Error(
      `The installed ${adapter} version cannot load the Intero Agent Plugin.`,
    );
  }
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

function isBridgeRegistration(value: unknown): value is BridgeRegistration {
  return value === "managed" || value === "standard_plugin";
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
