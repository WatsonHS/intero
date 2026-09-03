import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CopyIcon,
  FolderOpenIcon,
  PlugsIcon,
  SpinnerGapIcon,
  TerminalWindowIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  PILOT_AGENT_CONFIGURATION_VERSION,
  type PilotAgentClient,
} from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  cleanupWorkspaceConnection,
  getCodingAgentIntegrations,
  manageCodingAgentIntegration,
  previewCodingAgentIntegration,
  previewWorkspaceConnectionCleanup,
} from "../api.js";
import { useI18n } from "../i18n/index.js";
import {
  createPilotAgentConnection,
  disconnectPilotAgent,
  getPilotOverview,
  PilotApiError,
} from "../pilot/api.js";
import { usePilot } from "../pilot/context.js";
import { codexConnectionDeepLink } from "./agent/deep-link.js";
import {
  agentBindingIsConnected,
  agentRequiresLifecycleHook,
  summarizeProjectAgentConnections,
} from "./agent/connection-state.js";
import {
  attachmentAttemptContextKey,
  attachmentMutationIdForAttempt,
  settleAttachmentMutation,
} from "./agent/attachment-mutation.js";
import { copyTextToClipboard } from "./agent/copy-text.js";

const CLIENTS: Array<{
  id: PilotAgentClient;
  label: string;
  detail: string;
}> = [
  {
    id: "codex",
    label: "Codex",
    detail: "在 Codex App 中打开一个项目任务并自动完成原生 MCP 验证。",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    detail: "使用 Claude Code 的项目级原生配置完成 MCP 连接。",
  },
  {
    id: "opencode",
    label: "OpenCode",
    detail: "使用 OpenCode 的项目级原生配置完成 MCP 连接。",
  },
  {
    id: "cursor",
    label: "Cursor",
    detail: "使用 Cursor Agent 的原生 MCP 配置完成项目级连接与验证。",
  },
  {
    id: "grok-build",
    label: "Grok Build",
    detail: "使用 Grok Build 原生 MCP 配置完成项目级连接与验证。",
  },
];

const CLIENT_LABELS = Object.fromEntries(
  CLIENTS.map((client) => [client.id, client.label]),
) as Record<PilotAgentClient, string>;

type IssuedConnection = {
  bindingId: string;
  client: PilotAgentClient;
  prompt: string;
  mcpUrl: string;
  expiresAt: string;
};

type AttachmentPhase =
  "awaiting_confirmation" | "configuring" | "creating_binding";

type RevokedConnection = {
  client: PilotAgentClient;
  name: string;
  bindingId: string;
  projectId: string;
  workspaceId: string;
  cleanupState: "pending" | "removed" | "cancelled" | "failed";
};

type ConnectionMutationResult =
  | { cancelled: true; client: PilotAgentClient }
  | {
      cancelled: false;
      client: PilotAgentClient;
      result: Awaited<ReturnType<typeof createPilotAgentConnection>>;
    };

function isUnresolvedFallbackTransportError(
  error: Error,
  desktop: Window["interoDesktop"] | undefined,
) {
  if (desktop || error instanceof PilotApiError) return false;
  if (error.name === "AbortError") return false;
  // fetch rejects with TypeError when the browser cannot determine whether
  // the request reached the server. Retain the id only for that narrow case.
  return error instanceof TypeError || error.name === "NetworkError";
}

export function AgentConnectionsSettings({
  initialProjectId,
  onConnectedClientsChange,
}: {
  initialProjectId?: string | undefined;
  onConnectedClientsChange?: (clients: PilotAgentClient[]) => void;
}) {
  const { locale } = useI18n();
  const pilot = usePilot();
  const queryClient = useQueryClient();
  const projects = pilot.projects.data?.projects ?? [];
  const preferredProjectId = initialProjectId ?? pilot.selectedProjectId;
  const initialSelection =
    preferredProjectId &&
    projects.some((project) => project.id === preferredProjectId)
      ? preferredProjectId
      : "";
  const [projectId, setProjectId] = useState(initialSelection);
  const [issued, setIssued] = useState<IssuedConnection>();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [launchPending, setLaunchPending] = useState(false);
  const [launchError, setLaunchError] = useState<string>();
  const [repository, setRepository] = useState<GitRepositorySelection>();
  const [attachmentClient, setAttachmentClient] = useState<PilotAgentClient>();
  const [attachmentPhase, setAttachmentPhase] = useState<AttachmentPhase>();
  const [revokedConnection, setRevokedConnection] =
    useState<RevokedConnection>();
  // ADR-0011 opt-in, per client. An absent entry means "follow Desktop's own
  // reading of who owns the bridge"; a present one is sent explicitly and wins.
  const [bridgeChoice, setBridgeChoice] = useState<
    Partial<Record<PilotAgentClient, CodingAgentBridgeRegistration>>
  >({});
  const [now, setNow] = useState(() => Date.now());
  const pendingMutationIds = useRef(new Map<string, string>());
  const desktop =
    typeof window === "undefined" ? undefined : window.interoDesktop;
  const localIntegrations = useQuery({
    queryKey: ["desktop", "coding-agent-integrations"],
    queryFn: getCodingAgentIntegrations,
    enabled: Boolean(desktop),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (
      preferredProjectId &&
      projects.some((project) => project.id === preferredProjectId)
    ) {
      setProjectId(preferredProjectId);
    }
  }, [preferredProjectId, projects]);

  const project = projects.find((candidate) => candidate.id === projectId);
  const overview = useQuery({
    queryKey: ["pilot", "overview", pilot.identityId, projectId],
    queryFn: ({ signal }) =>
      getPilotOverview(pilot.identityId!, projectId, signal),
    enabled: Boolean(pilot.identityId && projectId),
    refetchInterval: issued
      ? (query) => {
          const bindings = query.state.data?.bindings ?? [];
          const pending = bindings.some(
            (binding) =>
              binding.id === issued.bindingId &&
              !binding.disconnectedAt &&
              !agentBindingIsConnected(binding),
          );
          return pending && Date.parse(issued.expiresAt) > Date.now()
            ? 2_000
            : false;
        }
      : false,
    refetchOnWindowFocus: true,
  });
  const summary = useMemo(
    () =>
      summarizeProjectAgentConnections(
        overview.data?.bindings ?? [],
        pilot.identityId,
      ),
    [overview.data?.bindings, pilot.identityId],
  );
  const connectedClients = useMemo(
    () =>
      Array.from(
        new Set(summary.mineConnected.map((binding) => binding.client)),
      ),
    [summary.mineConnected],
  );
  useEffect(() => {
    onConnectedClientsChange?.(connectedClients);
  }, [connectedClients, onConnectedClientsChange]);
  const teams = pilot.teams.data?.teams ?? [];
  const primaryTeam = teams.find((team) => team.id === project?.primaryTeamId);
  const participatingTeams = teams.filter(
    (team) =>
      team.id !== project?.primaryTeamId &&
      Boolean(project?.participatingTeamIds.includes(team.id)),
  );

  const startConnection = useMutation<
    ConnectionMutationResult,
    Error,
    {
      client: PilotAgentClient;
      bindingId?: string;
      clientMutationId: string;
    }
  >({
    mutationFn: async ({
      client,
      bindingId,
      clientMutationId,
    }): Promise<ConnectionMutationResult> => {
      setAttachmentClient(client);
      setRevokedConnection(undefined);
      let expectedWorkspaceId: string | undefined;
      if (desktop) {
        if (!repository || Date.parse(repository.expiresAt) <= Date.now()) {
          throw new Error("请重新选择本地仓库后再 Attach Coding Agent。");
        }
        const local = localIntegrations.data?.find(
          (integration) => integration.adapter === client,
        );
        if (!local?.detected) {
          throw new Error(`Intero Desktop 未检测到 ${CLIENT_LABELS[client]}。`);
        }
        if (!local.supported) {
          throw new Error(
            `${CLIENT_LABELS[client]} 版本低于 Intero 当前支持范围。`,
          );
        }
        const bridgeRegistration = local.standardPluginCapable
          ? bridgeChoice[client]
          : undefined;
        setAttachmentPhase("awaiting_confirmation");
        const preview = await previewCodingAgentIntegration({
          adapter: client,
          action: local.configured ? "repair" : "install",
          locale,
          projectId,
          repositorySelectionToken: repository.selectionToken,
          ...(bridgeRegistration ? { bridgeRegistration } : {}),
        });
        if (!preview) return { cancelled: true, client };
        // The native boundary consumes this authority when confirmation is
        // granted. Keep the path for launch/display, but require a fresh
        // picker gesture before another mutation.
        setRepository((current) =>
          current?.selectionToken === repository.selectionToken
            ? { ...current, expiresAt: new Date(0).toISOString() }
            : current,
        );
        setAttachmentPhase("configuring");
        const managed = await manageCodingAgentIntegration({
          adapter: client,
          token: preview.token,
          ...(bridgeRegistration ? { bridgeRegistration } : {}),
        });
        if (
          !managed.workspaceId ||
          managed.workspaceId !== repository.workspaceId
        ) {
          throw new Error(
            "Desktop 返回的仓库工作区与已确认仓库不一致；未创建云端连接。",
          );
        }
        expectedWorkspaceId = managed.workspaceId;
        await queryClient.invalidateQueries({
          queryKey: ["desktop", "coding-agent-integrations"],
        });
      }
      setAttachmentPhase("creating_binding");
      return {
        cancelled: false,
        client,
        result: await createPilotAgentConnection(
          pilot.identityId!,
          projectId,
          client,
          bindingId,
          clientMutationId,
          desktop ? "desktop_bridge" : "web_cli",
          expectedWorkspaceId,
        ),
      };
    },
    onSuccess: async (outcome, variables) => {
      const contextKey = attachmentAttemptContextKey(
        projectId,
        variables.client,
        variables.bindingId,
      );
      if (outcome.cancelled) {
        settleAttachmentMutation(
          pendingMutationIds.current,
          contextKey,
          "cancelled",
        );
        return;
      }
      settleAttachmentMutation(
        pendingMutationIds.current,
        contextKey,
        "completed",
      );
      const { client, result } = outcome;
      setIssued({
        bindingId: result.bindingId,
        client,
        prompt: result.connectPrompt,
        mcpUrl: result.mcpUrl,
        expiresAt: result.ticket.expiresAt,
      });
      setCopyStatus("idle");
      pilot.setSelectedProjectId(projectId);
      await queryClient.invalidateQueries({
        queryKey: ["pilot", "overview", pilot.identityId, projectId],
      });
    },
    onError: (error, variables) => {
      const contextKey = attachmentAttemptContextKey(
        projectId,
        variables.client,
        variables.bindingId,
      );
      settleAttachmentMutation(
        pendingMutationIds.current,
        contextKey,
        isUnresolvedFallbackTransportError(error, desktop)
          ? "unresolved_error"
          : "terminal_error",
      );
    },
    onSettled: () => {
      setAttachmentClient(undefined);
      setAttachmentPhase(undefined);
    },
  });
  const cleanupConnection = useMutation<
    { connection: RevokedConnection; removed: boolean },
    Error,
    RevokedConnection
  >({
    mutationFn: async (connection) => {
      if (!desktop || !repository || !repositorySelectionCurrent) {
        throw new Error("请重新选择这个 binding 对应的本地仓库后再清理。");
      }
      const preview = await previewWorkspaceConnectionCleanup({
        adapter: connection.client,
        locale,
        projectId: connection.projectId,
        bindingId: connection.bindingId,
        workspaceId: connection.workspaceId,
        repositorySelectionToken: repository.selectionToken,
      });
      if (!preview) return { connection, removed: false };
      setRepository((current) =>
        current?.selectionToken === repository.selectionToken
          ? { ...current, expiresAt: new Date(0).toISOString() }
          : current,
      );
      await cleanupWorkspaceConnection(preview.token);
      return { connection, removed: true };
    },
    onSuccess: ({ connection, removed }) => {
      setRevokedConnection((current) =>
        current?.bindingId === connection.bindingId
          ? {
              ...current,
              cleanupState: removed ? "removed" : "cancelled",
            }
          : current,
      );
    },
    onError: (_error, connection) => {
      setRevokedConnection((current) =>
        current?.bindingId === connection.bindingId
          ? { ...current, cleanupState: "failed" }
          : current,
      );
    },
  });
  const disconnect = useMutation({
    mutationFn: async (bindingId: string) => {
      const binding = overview.data?.bindings.find(
        (candidate) => candidate.id === bindingId,
      );
      const result = await disconnectPilotAgent(pilot.identityId!, bindingId);
      return { binding, result };
    },
    onSuccess: async ({ binding }) => {
      if (binding) {
        const revoked: RevokedConnection = {
          client: binding.client,
          name: binding.name,
          bindingId: binding.id,
          projectId: binding.projectId,
          workspaceId: binding.workspaceId,
          cleanupState: "pending",
        };
        setRevokedConnection(revoked);
        if (desktop && repositorySelectionCurrent) {
          cleanupConnection.mutate(revoked);
        }
      }
      await queryClient.invalidateQueries({
        queryKey: ["pilot", "overview", pilot.identityId, projectId],
      });
    },
  });

  const issuedBinding = useMemo(() => {
    if (!issued) return undefined;
    const bindings = overview.data?.bindings ?? [];
    const exact = bindings.find(
      (binding) => binding.id === issued.bindingId && !binding.disconnectedAt,
    );
    return (
      exact ??
      bindings
        .filter(
          (binding) =>
            !binding.disconnectedAt &&
            binding.ownerId === pilot.identityId &&
            binding.client === issued.client,
        )
        .toSorted(
          (left, right) =>
            Date.parse(right.createdAt) - Date.parse(left.createdAt),
        )[0]
    );
  }, [issued, overview.data?.bindings, pilot.identityId]);

  const configurationCurrent =
    issuedBinding?.configurationVersion === PILOT_AGENT_CONFIGURATION_VERSION;
  const progress =
    issuedBinding && agentBindingIsConnected(issuedBinding)
      ? 4
      : configurationCurrent && issuedBinding?.validatedAt
        ? 3
        : issuedBinding?.mcpInitializedAt
          ? 2
          : issued
            ? 1
            : 0;
  const issuedExpired = issued ? Date.parse(issued.expiresAt) <= now : false;
  const repositorySelectionCurrent = Boolean(
    repository && Date.parse(repository.expiresAt) > now,
  );

  useEffect(() => {
    if (
      (!issued || issuedExpired) &&
      (!repository || !repositorySelectionCurrent)
    ) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [issued, issuedExpired, repository, repositorySelectionCurrent]);

  function connectionVariables(client: PilotAgentClient, bindingId?: string) {
    const contextKey = attachmentAttemptContextKey(
      projectId,
      client,
      bindingId,
    );
    const clientMutationId = attachmentMutationIdForAttempt(
      pendingMutationIds.current,
      contextKey,
      () => globalThis.crypto.randomUUID(),
    );
    pendingMutationIds.current.set(contextKey, clientMutationId);
    return {
      client,
      ...(bindingId ? { bindingId } : {}),
      clientMutationId,
    };
  }

  async function chooseRepository() {
    if (!desktop) return;
    setLaunchError(undefined);
    setLaunchPending(true);
    try {
      const selection = await desktop.chooseGitRepository();
      if (selection) {
        setRepository(selection);
        setIssued(undefined);
        pendingMutationIds.current.clear();
      }
    } catch {
      setLaunchError("无法读取所选仓库，请确认它是可访问的 Git 仓库。");
    } finally {
      setLaunchPending(false);
    }
  }

  async function launchCodex(prompt: string) {
    setLaunchError(undefined);
    if (!desktop || !repository) return;
    setLaunchPending(true);
    try {
      window.open(
        codexConnectionDeepLink(prompt, repository.repositoryPath),
        "_blank",
        "noopener,noreferrer",
      );
    } catch {
      setLaunchError("无法打开所选仓库，请复制连接任务后在 Codex 中继续。");
    } finally {
      setLaunchPending(false);
    }
  }

  return (
    <section
      id="agent-connections"
      className="mt-7"
      data-testid="agent-connections-settings"
    >
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[14px] font-[620]">Attach Coding Agent</h2>
          <span className="rounded-pill bg-accent-soft px-2.5 py-1 text-[9.5px] font-[650] text-accent-strong">
            {desktop ? "DESKTOP CONTROLLED" : "WEB / CLI FALLBACK"}
          </span>
        </div>
        <p className="mt-2 max-w-[650px] text-[12px] leading-[1.7] text-ink-muted">
          {desktop
            ? "先选择本地仓库和已授权 Project，再由 Intero Desktop 检测 Coding Agent、预览工具级公共 launcher 与该仓库独立的加密连接目标，并请求一次确认。公共 launcher 不持有 credential；每个仓库分别绑定 Project，只有原生 MCP 完成初始化与服务端验证后才会显示 Connected。"
            : "浏览器保留远程开发与恢复路径：选择 Project 后生成一次性连接任务，在 Coding Agent 所在主机完成相同的 ticket、binding 与服务端验证。"}
        </p>
      </header>

      {desktop ? (
        <section className="mt-4 rounded-container border border-line bg-panel2 p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-raise text-accent-strong">
              <FolderOpenIcon size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="text-[12.5px] font-[630]">本地仓库</strong>
              {repository ? (
                <span className="mt-1.5 grid gap-1">
                  <span
                    className="truncate font-mono text-[10.5px] text-ink-muted"
                    data-testid="agent-attachment-repository"
                    title={repository.repositoryPath}
                  >
                    {repository.repositoryPath}
                  </span>
                  <small className="text-[10px] text-faint">
                    {repository.snapshot.branch
                      ? `分支 ${repository.snapshot.branch}`
                      : "未命名分支"}
                    {repository.snapshot.head
                      ? ` · ${repository.snapshot.head.slice(0, 12)}`
                      : ""}
                  </small>
                </span>
              ) : (
                <p className="mt-1.5 text-[10.5px] leading-[1.6] text-ink-muted">
                  绝对路径只保存在本机确认上下文中，不会因为 Attach 被上传到
                  Intero 云端。
                </p>
              )}
            </span>
            <button
              type="button"
              data-testid="agent-attachment-choose-repository"
              disabled={launchPending || startConnection.isPending}
              onClick={() => void chooseRepository()}
              className="h-9 rounded-btn border border-line2 px-3.5 text-[11px] hover:border-accent-strong disabled:opacity-50"
            >
              {repositorySelectionCurrent
                ? "更换仓库"
                : repository
                  ? "重新确认仓库"
                  : "选择仓库"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="mt-4 rounded-container border border-line bg-panel2 p-5">
        <label className="grid gap-2">
          <span className="text-[11px] font-[620] text-ink-muted">
            选择要接收工作状态的 Project
          </span>
          <select
            value={projectId}
            data-testid="agent-connection-project"
            onChange={(event) => {
              const nextProjectId = event.target.value;
              setProjectId(nextProjectId);
              setIssued(undefined);
              pendingMutationIds.current.clear();
              if (nextProjectId) {
                pilot.setSelectedProjectId(nextProjectId);
              }
            }}
            className="h-10 rounded-btn border border-line2 bg-bg px-3 text-[12.5px] text-ink outline-none focus:border-accent-strong"
          >
            <option value="">请选择 Project…</option>
            {projects.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        {project ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[10.5px] text-ink-muted">
            <span className="rounded-pill bg-raise px-2.5 py-1">
              Primary Team · {primaryTeam?.name ?? "不可见"}
            </span>
            {participatingTeams.map((team) => (
              <span key={team.id} className="rounded-pill bg-raise px-2.5 py-1">
                Participating · {team.name}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {desktop && localIntegrations.isLoading ? (
        <div className="mt-4 flex items-center gap-2 rounded-card bg-panel2 p-4 text-[11px] text-ink-muted">
          <SpinnerGapIcon size={14} className="animate-spin" />
          正在检测本机 Coding Agent 与托管配置…
        </div>
      ) : null}

      {desktop && localIntegrations.isError ? (
        <div className="mt-4 flex items-center gap-2 rounded-card bg-danger-soft p-4 text-[11px] text-danger">
          <WarningCircleIcon size={15} />
          无法读取本机 Agent 状态；未确认前不会写入任何配置。
          <button
            type="button"
            className="ml-auto h-8 rounded-btn border border-danger px-3 text-[10px]"
            onClick={() => void localIntegrations.refetch()}
          >
            重试检测
          </button>
        </div>
      ) : null}

      {!projectId ? (
        <div className="mt-4 rounded-card border border-dashed border-line2 p-6 text-[12px] text-ink-muted">
          先明确选择 Project，Intero 不会自动回退到列表中的第一个项目。
        </div>
      ) : null}

      {projectId && overview.isLoading ? (
        <div className="mt-4 flex items-center gap-2 rounded-card bg-panel2 p-5 text-[12px] text-ink-muted">
          <SpinnerGapIcon size={15} className="animate-spin" />
          正在读取 Project 连接状态…
        </div>
      ) : null}

      {projectId && overview.isError ? (
        <div className="mt-4 flex items-center gap-2 rounded-card bg-danger-soft p-5 text-[12px] text-danger">
          <WarningCircleIcon size={16} />
          <span className="flex-1">
            无法读取这个 Project 的连接状态 · AGENT_OVERVIEW_UNAVAILABLE
          </span>
          <button
            type="button"
            onClick={() => void overview.refetch()}
            className="h-8 rounded-btn border border-danger px-3 text-[10.5px]"
          >
            重试
          </button>
        </div>
      ) : null}

      {projectId && overview.data ? (
        <>
          <section
            className="mt-4 rounded-container border border-line bg-panel2 p-5"
            {...(summary.connected.length > 0
              ? { "data-testid": "agent-connection-success" }
              : {})}
          >
            <div className="flex items-center gap-2">
              <strong className="text-[13px] font-[630]">
                {project?.name}
              </strong>
              <span
                className={[
                  "rounded-pill px-2.5 py-1 text-[10px]",
                  summary.connected.length > 0
                    ? "bg-green-soft text-green"
                    : summary.outdated.length > 0
                      ? "bg-amber-soft text-amber"
                      : summary.lifecyclePending.length > 0
                        ? "bg-amber-soft text-amber"
                        : summary.pending.length > 0
                          ? "bg-accent-soft text-accent-strong"
                          : "bg-amber-soft text-amber",
                ].join(" ")}
              >
                {summary.connected.length > 0
                  ? summary.outdated.length > 0
                    ? `${summary.connected.length} 个完整连接 · ${summary.outdated.length} 个待修复`
                    : `${summary.connected.length} 个完整连接`
                  : summary.outdated.length > 0
                    ? `${summary.outdated.length} 个连接配置待修复`
                    : summary.lifecyclePending.length > 0
                      ? `${summary.lifecyclePending.length} 个 MCP 已验证，Hook 待确认`
                      : summary.pending.length > 0
                        ? `${summary.pending.length} 个连接正在配置`
                        : "尚未连接"}
              </span>
            </div>

            {(overview.data.bindings ?? []).filter(
              (binding) => !binding.disconnectedAt,
            ).length > 0 ? (
              <div className="mt-4 grid gap-2">
                {overview.data.bindings
                  .filter((binding) => !binding.disconnectedAt)
                  .map((binding) => {
                    const connected = agentBindingIsConnected(binding);
                    const lifecycleRequired = agentRequiresLifecycleHook(
                      binding.client,
                    );
                    const ageMs = Date.now() - Date.parse(binding.createdAt);
                    const timedOut =
                      ageMs > 10 * 60_000 &&
                      (!binding.validatedAt ||
                        (lifecycleRequired && !binding.activityUpdatedAt));
                    const nextAction =
                      binding.authMode === "oauth"
                        ? "下一步：撤销旧连接，并生成新的项目级原生连接任务。"
                        : connected
                          ? "连接完整；新的项目任务会自动复用。"
                          : binding.validatedAt &&
                              lifecycleRequired &&
                              !binding.activityUpdatedAt
                            ? "下一步：在 Coding Agent 中确认 Hook，并在该仓库新建一次会话。"
                            : binding.mcpInitializedAt
                              ? "下一步：等待连接任务写入凭据并完成 MCP 验证。"
                              : "下一步：在目标仓库运行连接任务，写入项目配置。";
                    const errorCode = timedOut
                      ? binding.validatedAt && lifecycleRequired
                        ? "AGENT_HOOK_TIMEOUT"
                        : "AGENT_CONNECTION_TIMEOUT"
                      : undefined;
                    return (
                      <div
                        key={binding.id}
                        data-testid={`pilot-agent-binding-${binding.id}`}
                        className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 rounded-card border border-line bg-bg px-3.5 py-3"
                      >
                        <span
                          className={[
                            "grid h-[34px] w-[34px] place-items-center rounded-[10px]",
                            connected
                              ? "bg-green-soft text-green"
                              : binding.validatedAt
                                ? "bg-amber-soft text-amber"
                                : binding.mcpInitializedAt
                                  ? "bg-accent-soft text-accent-strong"
                                  : "bg-amber-soft text-amber",
                          ].join(" ")}
                        >
                          {connected ? (
                            <CheckCircleIcon size={16} weight="fill" />
                          ) : (
                            <PlugsIcon size={16} />
                          )}
                        </span>
                        <span className="grid min-w-0">
                          <strong className="truncate text-[12px] font-[620]">
                            {binding.name}
                          </strong>
                          <small className="mt-1 text-[10.5px] text-ink-muted">
                            {CLIENT_LABELS[binding.client]} ·{" "}
                            {binding.authMode === "oauth"
                              ? "旧 OAuth 连接已停用，请重新连接"
                              : connected
                                ? lifecycleRequired
                                  ? "原生 MCP 与 SessionStart Hook 已验证"
                                  : "原生 MCP 与项目配置已验证"
                                : binding.validatedAt &&
                                    (!lifecycleRequired ||
                                      binding.activityUpdatedAt) &&
                                    binding.configurationVersion !==
                                      PILOT_AGENT_CONFIGURATION_VERSION
                                  ? `项目配置 v${binding.configurationVersion ?? "旧版"} · 需要升级到 v${PILOT_AGENT_CONFIGURATION_VERSION}`
                                  : binding.validatedAt && lifecycleRequired
                                    ? "原生 MCP 已验证 · 等待 Hook 首次上报"
                                    : binding.mcpInitializedAt
                                      ? "MCP 已加载"
                                      : "等待连接任务写入配置"}
                            {binding.lastSeenAt
                              ? ` · 最后活跃 ${new Date(
                                  binding.lastSeenAt,
                                ).toLocaleString()}`
                              : ""}
                          </small>
                          <small
                            className={[
                              "mt-1 text-[10px] leading-[1.5]",
                              errorCode ? "text-danger" : "text-faint",
                            ].join(" ")}
                          >
                            {nextAction}
                            {errorCode ? ` · ${errorCode}` : ""}
                          </small>
                        </span>
                        {binding.ownerId === pilot.identityId ? (
                          <span className="flex items-center gap-2">
                            {binding.validatedAt &&
                            (!lifecycleRequired || binding.activityUpdatedAt) &&
                            binding.configurationVersion !==
                              PILOT_AGENT_CONFIGURATION_VERSION ? (
                              <button
                                type="button"
                                data-testid={`pilot-agent-repair-${binding.id}`}
                                disabled={startConnection.isPending}
                                onClick={() =>
                                  startConnection.mutate(
                                    connectionVariables(
                                      binding.client,
                                      binding.id,
                                    ),
                                  )
                                }
                                className="h-8 rounded-btn border-0 bg-accent-strong px-3 text-[11px] font-[620] text-on-accent disabled:opacity-50"
                              >
                                修复配置
                              </button>
                            ) : null}
                            {timedOut ? (
                              <button
                                type="button"
                                data-testid={`pilot-agent-retry-${binding.id}`}
                                disabled={startConnection.isPending}
                                onClick={() =>
                                  startConnection.mutate(
                                    connectionVariables(
                                      binding.client,
                                      binding.id,
                                    ),
                                  )
                                }
                                className="h-8 rounded-btn border-0 bg-accent-strong px-3 text-[11px] font-[620] text-on-accent disabled:opacity-50"
                              >
                                重试
                              </button>
                            ) : null}
                            <button
                              type="button"
                              data-testid={`pilot-agent-disconnect-${binding.id}`}
                              data-client={binding.client}
                              disabled={
                                disconnect.isPending ||
                                cleanupConnection.isPending
                              }
                              onClick={() => disconnect.mutate(binding.id)}
                              className="h-8 rounded-btn border border-line2 bg-transparent px-3 text-[11px] hover:border-danger hover:text-danger disabled:opacity-50"
                            >
                              撤销连接
                            </button>
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            ) : (
              <p className="mt-3 text-[11.5px] leading-[1.7] text-ink-muted">
                这个 Project 还没有经过真实 MCP 验证的 Coding Agent。
              </p>
            )}
            {summary.lifecyclePending.length > 0 ? (
              <div className="mt-4 flex items-start gap-2 rounded-card border border-amber-soft bg-amber-soft px-3.5 py-3 text-[11px] leading-[1.65] text-amber">
                <WarningCircleIcon size={15} className="mt-0.5 shrink-0" />
                <span>
                  MCP 已经可用，但 SessionStart 还没有到达。请在对应 Coding
                  Agent 的 Hook 审核提示中确认当前仓库的 Intero
                  Hook，然后新建一个会话；页面会在首次生命周期上报后自动变为完整连接。
                </span>
              </div>
            ) : null}
            {summary.outdated.length > 0 ? (
              <div className="mt-4 flex items-start gap-2 rounded-card border border-amber-soft bg-amber-soft px-3.5 py-3 text-[11px] leading-[1.65] text-amber">
                <WarningCircleIcon size={15} className="mt-0.5 shrink-0" />
                <span>
                  这些连接的凭据仍然有效，但项目级 MCP、Hook
                  或持久化指令版本已经落后。点击“修复配置”会生成升级任务；Coding
                  Agent 回报当前配置版本后，连接会恢复为完整状态。
                </span>
              </div>
            ) : null}
          </section>

          <section className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
            {CLIENTS.map((client) => {
              const mine = summary.mineConnected.filter(
                (binding) => binding.client === client.id,
              ).length;
              const outdatedBinding = summary.mineOutdated.find(
                (binding) => binding.client === client.id,
              );
              const pending = summary.minePending.some(
                (binding) => binding.client === client.id,
              );
              const lifecyclePending = summary.mineLifecyclePending.some(
                (binding) => binding.client === client.id,
              );
              const lifecyclePendingBinding = summary.mineLifecyclePending.find(
                (binding) => binding.client === client.id,
              );
              const local = localIntegrations.data?.find(
                (integration) => integration.adapter === client.id,
              );
              const localUnavailable = Boolean(
                desktop &&
                (!repositorySelectionCurrent ||
                  !local ||
                  !local.detected ||
                  !local.supported),
              );
              const localStatus = !desktop
                ? "Web / CLI fallback"
                : !local
                  ? "检测中"
                  : !local.detected
                    ? "未检测到"
                    : !local.supported
                      ? `版本不受支持${local.version ? ` · ${local.version}` : ""}`
                      : local.state === "needs_repair"
                        ? "公共 launcher 需要修复"
                        : local.state === "config_valid"
                          ? "公共 launcher 已验证"
                          : local.state === "pending_trust"
                            ? "公共 launcher 已写入 · 等待客户端信任"
                            : local.configured
                              ? "公共 launcher 已写入"
                              : `已检测${local.version ? ` · ${local.version}` : ""}`;
              // Checked reflects the explicit opt-in when there is one, and
              // otherwise Desktop's current reading of who owns the bridge.
              const pluginOwnsBridge =
                (bridgeChoice[client.id] ?? local?.bridgeRegistration) ===
                "standard_plugin";
              const pluginNotDetected =
                bridgeChoice[client.id] === "standard_plugin" &&
                local?.bridgeRegistration !== "standard_plugin";
              const thisClientPending =
                startConnection.isPending && attachmentClient === client.id;
              const pendingLabel =
                attachmentPhase === "awaiting_confirmation"
                  ? "等待确认配置目标…"
                  : attachmentPhase === "configuring"
                    ? "正在写入托管配置…"
                    : "正在创建 Project binding…";
              return (
                <article
                  key={client.id}
                  className="flex min-h-[165px] flex-col rounded-container border border-line bg-panel2 p-4"
                >
                  <TerminalWindowIcon
                    size={19}
                    className="text-accent-strong"
                  />
                  <strong className="mt-3 text-[13px] font-[630]">
                    {client.label}
                  </strong>
                  <span
                    className={[
                      "mt-1.5 w-fit rounded-pill px-2 py-0.5 text-[9px]",
                      desktop && local?.detected && local.supported
                        ? "bg-green-soft text-green"
                        : desktop
                          ? "bg-amber-soft text-amber"
                          : "bg-raise text-faint",
                    ].join(" ")}
                    data-local-state={local?.state ?? "fallback"}
                    data-bridge-registration={
                      local?.bridgeRegistration ?? "managed"
                    }
                  >
                    {localStatus}
                    {local?.bridgeRegistration === "standard_plugin"
                      ? " · 由 Agent Plugin 注册"
                      : null}
                  </span>
                  <p className="mt-2 text-[10.5px] leading-[1.65] text-ink-muted">
                    {client.detail}
                  </p>
                  {desktop && local?.standardPluginCapable ? (
                    <>
                      <label className="mt-2 flex items-start gap-1.5 text-[10px] leading-[1.6] text-ink-muted">
                        <input
                          type="checkbox"
                          data-testid={`bridge-registration-${client.id}`}
                          checked={pluginOwnsBridge}
                          disabled={startConnection.isPending}
                          onChange={(event) =>
                            setBridgeChoice((current) => ({
                              ...current,
                              [client.id]: event.target.checked
                                ? "standard_plugin"
                                : "managed",
                            }))
                          }
                          className="mt-[1px] shrink-0"
                        />
                        <span>
                          {locale === "zh-CN"
                            ? "由 intero Agent Plugin 注册 MCP bridge；Intero 只写入 Hook 与常驻指令。"
                            : "Let the intero Agent Plugin own the MCP bridge; Intero writes only hooks and instructions."}
                        </span>
                      </label>
                      {pluginNotDetected ? (
                        <p
                          className="mt-1.5 text-[10px] leading-[1.6] text-amber"
                          data-testid={`bridge-registration-guidance-${client.id}`}
                        >
                          {locale === "zh-CN"
                            ? `尚未检测到 ${client.label} 中的 intero Agent Plugin：请先在客户端安装该插件，否则 Intero 不写入托管 MCP 条目，bridge 无人注册。`
                            : `The intero Agent Plugin is not detected in ${client.label} yet: install it in the client first, or no one registers the bridge — Intero writes no managed MCP entry.`}
                        </p>
                      ) : null}
                    </>
                  ) : null}
                  <button
                    type="button"
                    data-testid={`connect-agent-${client.id}`}
                    disabled={startConnection.isPending || localUnavailable}
                    onClick={() =>
                      startConnection.mutate(
                        connectionVariables(
                          client.id,
                          outdatedBinding?.id ?? lifecyclePendingBinding?.id,
                        ),
                      )
                    }
                    className="mt-auto h-9 rounded-btn border-0 bg-accent-strong px-3 text-[11px] font-[620] text-on-accent disabled:opacity-50"
                  >
                    {thisClientPending
                      ? pendingLabel
                      : desktop && !repositorySelectionCurrent
                        ? "先选择本地仓库"
                        : desktop && local && !local.detected
                          ? `未检测到 ${client.label}`
                          : desktop && local && !local.supported
                            ? `${client.label} 版本不受支持`
                            : lifecyclePending
                              ? `重新生成 ${client.label} 修复任务`
                              : outdatedBinding
                                ? `修复 ${client.label} 项目配置`
                                : pending
                                  ? `重新生成 ${client.label} 连接`
                                  : mine > 0
                                    ? `连接另一个 ${client.label} 仓库`
                                    : desktop
                                      ? `Attach ${client.label}`
                                      : `连接 ${client.label}`}
                  </button>
                </article>
              );
            })}
          </section>
        </>
      ) : null}

      {revokedConnection ? (
        <div
          className="mt-4 flex items-start gap-2 rounded-card border border-green-soft bg-green-soft px-3.5 py-3 text-[11px] leading-[1.65] text-green"
          data-testid="agent-connection-revoked"
        >
          <CheckCircleIcon
            size={15}
            className="mt-0.5 shrink-0"
            weight="fill"
          />
          <span>
            {revokedConnection.name} 的云端访问已撤销，旧 credential 立即失效。
            {revokedConnection.cleanupState === "removed"
              ? " 这个仓库的匹配加密连接状态也已删除；工具级公共 bridge 保留给其他 Project 使用。"
              : revokedConnection.cleanupState === "cancelled"
                ? " 本地清理已选择稍后处理；重新选择对应仓库即可继续。"
                : revokedConnection.cleanupState === "failed"
                  ? " 本地清理未完成；Intero 未删除不匹配的文件，可重新选择对应仓库后重试。"
                  : desktop
                    ? " 云端撤销不依赖本地清理；选择对应仓库后，Desktop 只会删除匹配 Project、binding 与 workspace 的加密连接状态。"
                    : " 当前是 Web/CLI fallback；请在 Agent 主机删除这个 binding 的本地连接状态，云端撤销不受影响。"}
          </span>
          {desktop && revokedConnection.cleanupState !== "removed" ? (
            <button
              type="button"
              disabled={cleanupConnection.isPending || launchPending}
              onClick={() => {
                if (!repositorySelectionCurrent) {
                  void chooseRepository();
                  return;
                }
                cleanupConnection.mutate(revokedConnection);
              }}
              className="ml-auto h-8 shrink-0 rounded-btn border border-green px-3 text-[10.5px] disabled:opacity-50"
            >
              {cleanupConnection.isPending
                ? "正在清理…"
                : repositorySelectionCurrent
                  ? "清理本地连接"
                  : "选择仓库"}
            </button>
          ) : null}
        </div>
      ) : null}

      {issued ? (
        <section
          className="mt-4 rounded-container border border-accent-soft bg-accent-soft p-5"
          data-testid="agent-connection-launch"
        >
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-accent-strong text-on-accent">
              <PlugsIcon size={17} />
            </span>
            <span>
              <strong className="text-[13px] font-[630]">
                在 {CLIENT_LABELS[issued.client]} 中完成原生验证
              </strong>
              <p className="mt-1.5 text-[11px] leading-[1.65] text-ink-muted">
                {repository
                  ? `Desktop 已将本地控制操作绑定到 ${repository.snapshot.repository} 与 ${project?.name}。`
                  : `请在 Coding Agent 所在仓库完成到 ${project?.name} 的连接。`}
                任务会复用匹配的 Project-scoped credential，必要时才兑换
                ticket，并把当前配置版本写入原生配置；新的客户端会话完成 MCP
                与配置版本验证后，这里才会显示完整连接。
                {agentRequiresLifecycleHook(issued.client)
                  ? " 该客户端还需一次 SessionStart Hook 上报。"
                  : ` ${CLIENT_LABELS[issued.client]} 当前不声明未稳定的生命周期 Hook，完成态以原生 MCP 与服务端验证为准。`}
              </p>
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              "单次连接 ticket 已创建",
              "等待原生 MCP 加载",
              `MCP + credential + 配置 v${PILOT_AGENT_CONFIGURATION_VERSION} 已验证`,
              agentRequiresLifecycleHook(issued.client)
                ? "SessionStart Hook 已验证"
                : "服务端连接状态已验证",
            ].map((label, index) => (
              <span
                key={label}
                className={[
                  "rounded-[9px] px-2.5 py-2 text-center text-[10px]",
                  progress > index
                    ? "bg-green-soft text-green"
                    : index === 1 && progress === 1
                      ? "bg-amber-soft text-amber"
                      : "bg-raise text-faint",
                ].join(" ")}
              >
                {progress > index ? "✓ " : ""}
                {label}
              </span>
            ))}
          </div>

          <div
            className={[
              "mt-3 rounded-card px-3.5 py-2.5 text-[10.5px] leading-[1.6]",
              issuedExpired
                ? "bg-danger-soft text-danger"
                : "bg-raise text-ink-muted",
            ].join(" ")}
            data-testid="agent-connection-expiry"
          >
            {issuedExpired
              ? "连接 ticket 已过期 · AGENT_TICKET_EXPIRED。点击下方重试会生成新的单次任务，旧 ticket 不再可用。"
              : `连接任务有效至 ${new Date(issued.expiresAt).toLocaleString()}。${agentRequiresLifecycleHook(issued.client) ? "如果 MCP 已验证但 Hook 长时间没有到达，可重新生成修复任务。" : "完成 MCP initialize 与 intero.validate_connection 后会自动更新状态。"}`}
          </div>

          {startConnection.isError ? (
            <p
              className="mt-3 rounded-card bg-danger-soft px-3.5 py-2.5 text-[10.5px] text-danger"
              role="alert"
            >
              连接任务生成失败 · AGENT_TICKET_ISSUE_FAILED。检查诊断中心后重试。
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {issuedExpired ? (
              <button
                type="button"
                disabled={startConnection.isPending}
                onClick={() =>
                  startConnection.mutate(
                    connectionVariables(issued.client, issuedBinding?.id),
                  )
                }
                className="h-9 rounded-btn border-0 bg-accent-strong px-4 text-[11px] font-[620] text-on-accent disabled:opacity-50"
              >
                重新生成连接任务
              </button>
            ) : null}
            {issued.client === "codex" ? (
              typeof window !== "undefined" && window.interoDesktop ? (
                <button
                  type="button"
                  disabled={launchPending}
                  onClick={() => void launchCodex(issued.prompt)}
                  className="inline-flex h-9 items-center gap-2 rounded-btn border-0 bg-accent-strong px-4 text-[11.5px] font-[620] text-on-accent disabled:opacity-50"
                >
                  <ArrowSquareOutIcon size={14} />
                  {launchPending ? "正在打开 Codex…" : "在 Codex App 中继续"}
                </button>
              ) : (
                <a
                  href={codexConnectionDeepLink(issued.prompt)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-2 rounded-btn bg-accent-strong px-4 text-[11.5px] font-[620] text-on-accent no-underline"
                >
                  <ArrowSquareOutIcon size={14} />在 Codex App 中继续
                </a>
              )
            ) : null}
            <button
              type="button"
              onClick={async () => {
                setCopyStatus("idle");
                try {
                  await copyTextToClipboard(issued.prompt);
                  setCopyStatus("copied");
                } catch {
                  setCopyStatus("failed");
                }
              }}
              className="inline-flex h-9 items-center gap-2 rounded-btn border border-line2 bg-transparent px-4 text-[11.5px] hover:border-accent-strong"
            >
              <CopyIcon size={14} />
              {copyStatus === "copied"
                ? "已复制连接任务"
                : copyStatus === "failed"
                  ? "复制失败"
                  : "复制连接任务"}
            </button>
          </div>
          {copyStatus === "failed" ? (
            <p
              className="mt-3 text-[10.5px] text-danger"
              role="alert"
              data-testid="agent-connect-copy-error"
            >
              无法访问剪贴板。请展开下方完整连接任务，选择文本后手动复制。
            </p>
          ) : null}
          {launchError ? (
            <p className="mt-3 text-[10.5px] text-danger">{launchError}</p>
          ) : null}

          <details className="mt-4 border-t border-line pt-3">
            <summary className="cursor-pointer text-[10.5px] text-ink-muted">
              其他方式：查看完整连接任务
            </summary>
            <pre
              className="mt-3 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-inset bg-bg p-4 font-mono text-[10px] leading-[1.6] text-ink-muted"
              data-testid="agent-connect-prompt"
            >
              {issued.prompt}
            </pre>
          </details>
        </section>
      ) : null}

      {startConnection.isError ? (
        <p className="mt-4 rounded-card bg-danger-soft p-4 text-[11.5px] text-danger">
          {startConnection.error instanceof Error
            ? startConnection.error.message
            : "无法开始连接。"}
        </p>
      ) : null}
    </section>
  );
}
