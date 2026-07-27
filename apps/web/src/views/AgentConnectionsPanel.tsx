import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CopyIcon,
  PlugsIcon,
  SpinnerGapIcon,
  TerminalWindowIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { PilotAgentClient } from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createPilotAgentConnection,
  disconnectPilotAgent,
  getPilotOverview,
} from "../pilot/api.js";
import { usePilot } from "../pilot/context.js";
import { codexConnectionDeepLink } from "./agent/deep-link.js";
import { summarizeProjectAgentConnections } from "./agent/connection-state.js";
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
];

type IssuedConnection = {
  bindingId: string;
  client: PilotAgentClient;
  prompt: string;
  mcpUrl: string;
};

export function AgentConnectionsPanel({
  initialProjectId,
  onClose,
}: {
  initialProjectId?: string | undefined;
  onClose: () => void;
}) {
  const pilot = usePilot();
  const queryClient = useQueryClient();
  const projects = pilot.projects.data?.projects ?? [];
  const initialSelection =
    initialProjectId &&
    projects.some((project) => project.id === initialProjectId)
      ? initialProjectId
      : "";
  const [projectId, setProjectId] = useState(initialSelection);
  const [issued, setIssued] = useState<IssuedConnection>();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [launchPending, setLaunchPending] = useState(false);
  const [launchError, setLaunchError] = useState<string>();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (
      initialProjectId &&
      projects.some((project) => project.id === initialProjectId)
    ) {
      setProjectId(initialProjectId);
    }
  }, [initialProjectId, projects]);

  useEffect(() => {
    const previousActiveElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      previousActiveElement?.focus();
    };
  }, [onClose]);

  const project = projects.find((candidate) => candidate.id === projectId);
  const overview = useQuery({
    queryKey: ["pilot", "overview", pilot.identityId, projectId],
    queryFn: ({ signal }) =>
      getPilotOverview(pilot.identityId!, projectId, signal),
    enabled: Boolean(pilot.identityId && projectId),
    refetchInterval: issued ? 1_500 : 5_000,
  });
  const summary = summarizeProjectAgentConnections(
    overview.data?.bindings ?? [],
    pilot.identityId,
  );
  const teams = pilot.teams.data?.teams ?? [];
  const primaryTeam = teams.find((team) => team.id === project?.primaryTeamId);
  const participatingTeams = teams.filter(
    (team) =>
      team.id !== project?.primaryTeamId &&
      Boolean(project?.participatingTeamIds.includes(team.id)),
  );

  const startConnection = useMutation({
    mutationFn: async (client: PilotAgentClient) => ({
      client,
      result: await createPilotAgentConnection(
        pilot.identityId!,
        projectId,
        client,
      ),
    }),
    onSuccess: async ({ client, result }) => {
      setIssued({
        bindingId: result.ticket.id,
        client,
        prompt: result.connectPrompt,
        mcpUrl: result.mcpUrl,
      });
      setCopyStatus("idle");
      pilot.setSelectedProjectId(projectId);
      await queryClient.invalidateQueries({
        queryKey: ["pilot", "overview", pilot.identityId, projectId],
      });
    },
  });
  const disconnect = useMutation({
    mutationFn: (bindingId: string) =>
      disconnectPilotAgent(pilot.identityId!, bindingId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["pilot", "overview", pilot.identityId, projectId],
      });
    },
  });

  const issuedBinding = useMemo(() => {
    if (!issued) return undefined;
    return (overview.data?.bindings ?? []).find(
      (binding) => binding.id === issued.bindingId,
    );
  }, [issued, overview.data?.bindings]);

  const progress = issuedBinding?.validatedAt
    ? 3
    : issuedBinding?.mcpInitializedAt
      ? 2
      : issued
        ? 1
        : 0;

  async function launchCodex(prompt: string) {
    setLaunchError(undefined);
    const desktop =
      typeof window === "undefined" ? undefined : window.interoDesktop;
    if (!desktop) return;
    setLaunchPending(true);
    try {
      const repository = await desktop.chooseGitRepository();
      if (!repository) return;
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
    <div
      className="fixed inset-0 z-[80]"
      role="dialog"
      aria-modal="true"
      aria-label="Coding Agent 连接面板"
      data-testid="agent-connections-panel"
    >
      <button
        type="button"
        aria-label="关闭 Coding Agent 连接"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default border-0 bg-[rgba(9,13,18,0.34)] backdrop-blur-[2px]"
      />
      <section className="absolute inset-y-0 right-0 h-full w-[min(920px,calc(100vw-24px))] overflow-auto border-l border-line bg-bg px-[34px] pb-[70px] pt-[30px] shadow-[-18px_0_50px_rgba(0,0,0,0.16)]">
        <div className="mx-auto max-w-[820px]">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center gap-1.5 rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] text-ink-muted hover:border-accent-strong hover:text-ink"
          >
            <XIcon size={13} />
            关闭
          </button>

          <header className="mt-6">
            <p className="text-[10.5px] font-[650] tracking-[0.11em] text-accent-strong">
              CODING AGENT CONNECTIONS
            </p>
            <h1 className="mt-2 text-[28px] font-[570] tracking-[-0.035em]">
              Coding Agent 连接
            </h1>
            <p className="mt-3 max-w-[650px] text-[12.5px] leading-[1.75] text-ink-muted">
              为一个明确的 Intero Project
              配置当前本地仓库。连接只对该仓库生效，同一仓库以后新建的任务会自动复用。
            </p>
          </header>

          <section className="mt-7 rounded-container border border-line bg-panel2 p-5">
            <label className="grid gap-2">
              <span className="text-[11px] font-[620] text-ink-muted">
                选择要接收工作状态的 Project
              </span>
              <select
                value={projectId}
                data-testid="agent-connection-project"
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setIssued(undefined);
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
                  <span
                    key={team.id}
                    className="rounded-pill bg-raise px-2.5 py-1"
                  >
                    Participating · {team.name}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

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
              无法读取这个 Project 的连接状态。
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
                        : summary.pending.length > 0
                          ? "bg-accent-soft text-accent-strong"
                          : "bg-amber-soft text-amber",
                    ].join(" ")}
                  >
                    {summary.connected.length > 0
                      ? `${summary.connected.length} 个已验证连接`
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
                      .map((binding) => (
                        <div
                          key={binding.id}
                          className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 rounded-card border border-line bg-bg px-3.5 py-3"
                        >
                          <span
                            className={[
                              "grid h-[34px] w-[34px] place-items-center rounded-[10px]",
                              binding.validatedAt
                                ? "bg-green-soft text-green"
                                : binding.mcpInitializedAt
                                  ? "bg-accent-soft text-accent-strong"
                                  : "bg-amber-soft text-amber",
                            ].join(" ")}
                          >
                            {binding.validatedAt ? (
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
                              {binding.client} ·{" "}
                              {binding.authMode === "oauth"
                                ? "旧 OAuth 连接已停用，请重新连接"
                                : binding.validatedAt
                                  ? "Bearer credential 与原生 MCP 已验证"
                                  : binding.mcpInitializedAt
                                    ? "MCP 已加载"
                                    : "等待连接任务写入配置"}
                              {binding.lastSeenAt
                                ? ` · 最后活跃 ${new Date(
                                    binding.lastSeenAt,
                                  ).toLocaleString()}`
                                : ""}
                            </small>
                          </span>
                          {binding.ownerId === pilot.identityId ? (
                            <button
                              type="button"
                              data-testid={`pilot-agent-disconnect-${binding.id}`}
                              data-client={binding.client}
                              disabled={disconnect.isPending}
                              onClick={() => disconnect.mutate(binding.id)}
                              className="h-8 rounded-btn border border-line2 bg-transparent px-3 text-[11px] hover:border-danger hover:text-danger disabled:opacity-50"
                            >
                              断开
                            </button>
                          ) : null}
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="mt-3 text-[11.5px] leading-[1.7] text-ink-muted">
                    这个 Project 还没有经过真实 MCP 验证的 Coding Agent。
                  </p>
                )}
              </section>

              <section className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
                {CLIENTS.map((client) => {
                  const mine = summary.mineConnected.filter(
                    (binding) => binding.client === client.id,
                  ).length;
                  const pending = summary.minePending.some(
                    (binding) => binding.client === client.id,
                  );
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
                      <p className="mt-2 text-[10.5px] leading-[1.65] text-ink-muted">
                        {client.detail}
                      </p>
                      <button
                        type="button"
                        data-testid={`connect-agent-${client.id}`}
                        disabled={startConnection.isPending}
                        onClick={() => startConnection.mutate(client.id)}
                        className="mt-auto h-9 rounded-btn border-0 bg-accent-strong px-3 text-[11px] font-[620] text-on-accent disabled:opacity-50"
                      >
                        {pending
                          ? `重新生成 ${client.label} 连接`
                          : mine > 0
                            ? `连接另一个 ${client.label} 仓库`
                            : `连接 ${client.label}`}
                      </button>
                    </article>
                  );
                })}
              </section>
            </>
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
                    在目标仓库中完成连接
                  </strong>
                  <p className="mt-1.5 text-[11px] leading-[1.65] text-ink-muted">
                    Codex 打开后会把当前本地仓库配置到 {project?.name}
                    。连接任务会兑换一次性 ticket，把 Project-scoped credential
                    写入本地原生配置；新的 GUI 任务完成 MCP initialize
                    和验证工具调用后，这里会自动显示已连接。
                  </p>
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  "单次连接 ticket 已创建",
                  "等待原生 MCP 加载",
                  "MCP + Project credential 已验证",
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

              <div className="mt-4 flex flex-wrap gap-2">
                {issued.client === "codex" ? (
                  typeof window !== "undefined" && window.interoDesktop ? (
                    <button
                      type="button"
                      disabled={launchPending}
                      onClick={() => void launchCodex(issued.prompt)}
                      className="inline-flex h-9 items-center gap-2 rounded-btn border-0 bg-accent-strong px-4 text-[11.5px] font-[620] text-on-accent disabled:opacity-50"
                    >
                      <ArrowSquareOutIcon size={14} />
                      {launchPending
                        ? "正在选择仓库…"
                        : "选择仓库并在 Codex App 中继续"}
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
        </div>
      </section>
    </div>
  );
}
