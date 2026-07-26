import {
  CheckCircleIcon,
  GitBranchIcon,
  GitCommitIcon,
  HardDriveIcon,
  PauseCircleIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

import { SelectMenu } from "../../design/primitives.js";

type GitClient = "codex" | "claude-code" | "opencode";

const CLIENT_LABELS: Record<GitClient, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
  opencode: "OpenCode",
};

export function GitAwarenessSettings({
  projectName,
  connectedClients,
  onBindAgent,
}: {
  projectName?: string;
  connectedClients: GitClient[];
  onBindAgent: () => void;
}) {
  const desktop =
    typeof window === "undefined" ? undefined : window.interoDesktop;
  const [desktopClients, setDesktopClients] = useState<GitClient[]>([]);
  const availableClients = useMemo(
    () => Array.from(new Set([...connectedClients, ...desktopClients])),
    [connectedClients, desktopClients],
  );
  const [entries, setEntries] = useState<GitAwarenessStatus[]>([]);
  const [selection, setSelection] = useState<GitRepositorySelection | null>(
    null,
  );
  const [client, setClient] = useState<GitClient>(
    availableClients[0] ?? "codex",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!availableClients.includes(client) && availableClients[0]) {
      setClient(availableClients[0]);
    }
  }, [availableClients, client]);

  useEffect(() => {
    let cancelled = false;
    if (!desktop) return;
    void Promise.all([
      desktop.getGitAwarenessStatus(),
      desktop.getGitAwarenessClients(),
    ])
      .then(([nextEntries, nextClients]) => {
        if (!cancelled) {
          setEntries(nextEntries);
          setDesktopClients(nextClients);
        }
      })
      .catch(() => {
        if (!cancelled) setError("无法读取桌面 Git 感知配置。");
      });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  if (!desktop) {
    return (
      <section
        className="mt-3.5 rounded-[13px] border border-line bg-panel2 p-[15px_16px]"
        data-testid="git-awareness-unavailable"
      >
        <div className="flex items-start gap-3">
          <HardDriveIcon size={17} className="mt-0.5 text-faint" />
          <span>
            <strong className="text-[12.5px] font-[620]">桌面 Git 感知</strong>
            <p className="mt-1.5 text-[10.5px] leading-[1.65] text-ink-muted">
              这是可选的桌面增强。请在 Intero 桌面 App
              中选择并授权仓库；浏览器端不会读取本机仓库。
            </p>
          </span>
        </div>
      </section>
    );
  }
  const desktopApi = desktop;

  async function chooseRepository() {
    setPending(true);
    setError(undefined);
    try {
      const next = await desktopApi.chooseGitRepository();
      setSelection(next);
    } catch {
      setError("无法读取所选 Git 仓库。");
    } finally {
      setPending(false);
    }
  }

  async function configure(
    repositoryPath: string,
    selectedClient: GitClient,
    enabled: boolean,
  ) {
    setPending(true);
    setError(undefined);
    try {
      const next = await desktopApi.configureGitAwareness({
        repositoryPath,
        client: selectedClient,
        enabled,
      });
      setEntries(next);
      setSelection(null);
    } catch {
      setError("保存失败。请确认仓库可读取且 Coding Agent 已连接。");
    } finally {
      setPending(false);
    }
  }

  async function remove(repositoryPath: string) {
    setPending(true);
    setError(undefined);
    try {
      setEntries(await desktopApi.removeGitAwareness(repositoryPath));
    } catch {
      setError("移除仓库授权失败。");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="mt-3.5 rounded-[13px] border border-line bg-panel2 p-[15px_16px]"
      data-testid="git-awareness-settings"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] bg-raise text-accent-strong">
          <GitBranchIcon size={16} />
        </span>
        <span className="min-w-0">
          <strong className="text-[12.5px] font-[620]">桌面 Git 感知</strong>
          <p className="mt-1.5 max-w-[620px] text-[10.5px] leading-[1.65] text-ink-muted">
            为 {projectName ?? "当前项目"} 明确授权仓库。Intero 只在桌面 App
            运行期间监听 Git 元数据变化，并通过已绑定的 Coding Agent 和
            direct-cloud MCP 发送仓库名、分支、短提交号及暂存区是否变化。
            不读取文件名、Diff 或工作区内容，也不在本地保存 Work State。
          </p>
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => void chooseRepository()}
          className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-btn border border-line2 bg-transparent px-3 text-[11px] hover:border-accent-strong disabled:opacity-50"
        >
          <PlusIcon size={12} />
          选择仓库
        </button>
      </div>

      {availableClients.length === 0 ? (
        <div className="mt-3 flex items-center gap-3 rounded-[9px] bg-raise px-3 py-2">
          <p className="text-[10.5px] leading-[1.6] text-ink-muted">
            尚未检测到 direct-cloud Coding Agent
            绑定。先完成项目绑定，再启用仓库感知。
          </p>
          <button
            type="button"
            onClick={onBindAgent}
            className="ml-auto h-8 shrink-0 rounded-btn border border-line2 bg-transparent px-3 text-[11px] hover:border-accent-strong"
          >
            绑定 Coding Agent
          </button>
        </div>
      ) : null}

      {selection ? (
        <div
          className="mt-3 grid grid-cols-[minmax(0,1fr)_180px_auto] items-center gap-3 rounded-[10px] border border-accent-soft bg-accent-soft px-3 py-3"
          data-testid="git-awareness-selection"
        >
          <RepositorySummary
            name={selection.snapshot.repository}
            path={selection.repositoryPath}
            snapshot={selection.snapshot}
          />
          <SelectMenu
            value={client}
            label="用于 Git 感知的 Coding Agent"
            disabled={availableClients.length === 0}
            options={availableClients.map((id) => ({
              id,
              label: CLIENT_LABELS[id],
            }))}
            onChange={setClient}
          >
            <span className="flex h-8 w-full items-center justify-between rounded-btn border border-line2 bg-panel px-3 text-[11px]">
              {CLIENT_LABELS[client]}
              <span className="text-faint">⌄</span>
            </span>
          </SelectMenu>
          <button
            type="button"
            disabled={pending || availableClients.length === 0}
            onClick={() =>
              void configure(selection.repositoryPath, client, true)
            }
            className="h-8 rounded-btn border border-accent-strong bg-accent-strong px-3 text-[11px] text-on-accent disabled:opacity-50"
          >
            授权并启用
          </button>
        </div>
      ) : null}

      {entries.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {entries.map((entry) => (
            <div
              key={entry.repositoryPath}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] border border-line bg-panel px-3 py-3"
              data-testid={`git-awareness-entry-${entry.repositoryName}`}
            >
              <RepositorySummary
                name={entry.repositoryName}
                path={entry.repositoryPath}
                client={entry.client}
                enabled={entry.enabled}
                {...(entry.snapshot ? { snapshot: entry.snapshot } : {})}
                {...(entry.lastDeliveredAt
                  ? { lastDeliveredAt: entry.lastDeliveredAt }
                  : {})}
                {...(entry.lastError ? { error: entry.lastError } : {})}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void configure(
                      entry.repositoryPath,
                      entry.client,
                      !entry.enabled,
                    )
                  }
                  className="inline-flex h-8 items-center gap-1.5 rounded-btn border border-line2 bg-transparent px-3 text-[11px] hover:border-accent-strong disabled:opacity-50"
                >
                  {entry.enabled ? (
                    <PauseCircleIcon size={13} />
                  ) : (
                    <CheckCircleIcon size={13} />
                  )}
                  {entry.enabled ? "暂停" : "启用"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`移除 ${entry.repositoryName}`}
                  onClick={() => void remove(entry.repositoryPath)}
                  className="grid h-8 w-8 place-items-center rounded-btn border border-line2 bg-transparent text-faint hover:border-danger hover:text-danger disabled:opacity-50"
                >
                  <TrashIcon size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <p
          className="mt-3 flex items-center gap-2 text-[10.5px] text-danger"
          role="alert"
        >
          <WarningCircleIcon size={13} />
          {error}
        </p>
      ) : null}
    </section>
  );
}

function RepositorySummary({
  name,
  path,
  snapshot,
  client,
  enabled,
  lastDeliveredAt,
  error,
}: {
  name: string;
  path: string;
  snapshot?: GitAwarenessSnapshot;
  client?: GitClient;
  enabled?: boolean;
  lastDeliveredAt?: string;
  error?: string;
}) {
  return (
    <span className="grid min-w-0">
      <span className="flex min-w-0 items-center gap-2">
        <strong className="truncate text-[11.5px] font-[620]">{name}</strong>
        {client ? (
          <small className="rounded-quiet bg-raise px-1.5 py-0.5 text-[9.5px] text-faint">
            {CLIENT_LABELS[client]}
          </small>
        ) : null}
        {enabled !== undefined ? (
          <small
            className={[
              "rounded-quiet px-1.5 py-0.5 text-[9.5px]",
              enabled ? "bg-green-soft text-green" : "bg-raise text-faint",
            ].join(" ")}
          >
            {enabled ? "监听中" : "已暂停"}
          </small>
        ) : null}
      </span>
      <small
        className="mt-1 truncate font-mono text-[9.5px] text-faint"
        title={path}
      >
        {path}
      </small>
      {snapshot ? (
        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-muted">
          {snapshot.branch ? (
            <span className="inline-flex items-center gap-1">
              <GitBranchIcon size={11} />
              {snapshot.branch}
            </span>
          ) : null}
          {snapshot.head ? (
            <span className="inline-flex items-center gap-1 font-mono">
              <GitCommitIcon size={11} />
              {snapshot.head}
            </span>
          ) : null}
          <span>
            暂存区：{snapshot.staged === "changed" ? "有变化" : "无变化"}
          </span>
          {lastDeliveredAt ? (
            <span>上次发送：{new Date(lastDeliveredAt).toLocaleString()}</span>
          ) : null}
        </span>
      ) : null}
      {error ? (
        <small className="mt-1.5 text-[10px] text-danger">{error}</small>
      ) : null}
    </span>
  );
}
