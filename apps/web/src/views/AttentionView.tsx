import {
  BellSlashIcon,
  CheckCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { ActionInboxItem } from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getActionInbox,
  setNotificationPreferences,
  updateActionInbox,
} from "../api.js";
import { usePilotOptional } from "../pilot/context.js";

const KINDS: Array<{
  id: ActionInboxItem["kind"];
  label: string;
}> = [
  { id: "review_request", label: "定向评审" },
  { id: "human_decision", label: "需要确认的决定" },
  { id: "scope_expansion", label: "范围扩展" },
  { id: "consequential_commitment", label: "重要承诺" },
  { id: "high_impact_contradiction", label: "高影响冲突" },
  { id: "imminent_blocker", label: "临近阻塞" },
];

export function AttentionView({
  onOpenAction,
}: {
  onOpenAction: (sourceRef: string) => void;
}) {
  const queryClient = useQueryClient();
  const pilot = usePilotOptional();
  const inbox = useQuery({
    queryKey: ["action-inbox"],
    queryFn: ({ signal }) => getActionInbox(signal),
    refetchInterval: 5_000,
    enabled: !pilot?.enabled || Boolean(pilot.effectiveIdentity),
  });
  const update = useMutation({
    mutationFn: (input: {
      id: string;
      action: "read" | "unread" | "dismiss" | "resolve";
    }) => updateActionInbox(input.id, input.action),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["action-inbox"] });
    },
  });
  const preferences = useMutation({
    mutationFn: setNotificationPreferences,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["action-inbox"] });
    },
  });
  const current = inbox.data?.preferences;

  function toggleKind(kind: ActionInboxItem["kind"]) {
    const muted = current?.mutedKinds ?? [];
    preferences.mutate({
      mutedKinds: muted.includes(kind)
        ? muted.filter((item) => item !== kind)
        : [...muted, kind],
      ...(current?.muteUntil ? { muteUntil: current.muteUntil } : {}),
    });
  }

  return (
    <div className="h-full overflow-y-auto px-[clamp(24px,4vw,64px)] py-8">
      <header className="flex items-end justify-between gap-6 border-b border-line pb-5">
        <div>
          <p className="text-[10px] font-[650] tracking-[0.12em] text-accent-strong">
            ACTION INBOX
          </p>
          <h1 className="mt-2 text-[25px] font-[560] tracking-[-0.035em]">
            需要你处理的事
          </h1>
          <p className="mt-2 max-w-[620px] text-[12px] leading-[1.7] text-ink-muted">
            这里只放明确指向你的评审、确认和协调决定，不重复展示普通动态。
          </p>
        </div>
        <span className="rounded-full bg-accent-soft px-3 py-1 text-[10.5px] font-[650] text-accent-strong">
          {inbox.data?.unreadCount ?? 0} 未读
        </span>
      </header>

      {inbox.data?.automationSummary.length ? (
        <section
          className="mt-4 flex flex-wrap gap-2"
          data-testid="automation-portfolio-summary"
        >
          {inbox.data.automationSummary.map((summary) => (
            <div
              key={summary.projectId}
              className="max-w-[430px] rounded-btn border border-line bg-panel2 px-3 py-2.5"
            >
              <div className="flex items-center gap-2 text-[10px]">
                <strong className="font-[650] text-ink">
                  {summary.projectName}
                </strong>
                <span className="text-faint">
                  {summary.openSignalCount} 项待协调
                  {summary.confirmedSignalCount
                    ? ` · ${summary.confirmedSignalCount} 项已确认`
                    : ""}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] text-ink-muted">
                <span>总计 {summary.progressFacts.total}</span>
                <span>进行中 {summary.progressFacts.inProgress}</span>
                <span>待测试 {summary.progressFacts.readyForTest}</span>
                <span>已完成 {summary.progressFacts.done}</span>
              </div>
              {summary.risks[0] ? (
                <p className="mt-1.5 line-clamp-2 text-[10.5px] leading-[1.55] text-ink-muted">
                  <strong className="font-[650] text-amber">风险事实：</strong>
                  {summary.risks[0].summary}
                </p>
              ) : null}
              {summary.decisions[0] ? (
                <p className="mt-1 line-clamp-2 text-[10.5px] leading-[1.55] text-ink-muted">
                  <strong className="font-[650] text-ink">最近决定：</strong>
                  {summary.decisions[0].title} · {summary.decisions[0].outcome}
                </p>
              ) : null}
              <p className="mt-1 text-[10.5px] leading-[1.55] text-ink-muted">
                <strong className="font-[650] text-accent-strong">
                  自动解读：
                </strong>
                {summary.interpretation}
              </p>
              <p className="mt-1 text-[9.5px] text-faint">
                事实新鲜度：{new Date(summary.freshnessAt).toLocaleString()}
              </p>
            </div>
          ))}
        </section>
      ) : null}

      <section className="mt-6 grid gap-2.5">
        {inbox.isLoading ? (
          <EmptyState title="正在同步 Inbox…" />
        ) : inbox.isError ? (
          <EmptyState
            title="收件箱读取失败"
            detail="请重新登录，或稍后重试。"
          />
        ) : inbox.data?.items.length ? (
          inbox.data.items.map((item) => (
            <article
              key={item.id}
              className={[
                "grid grid-cols-[minmax(0,1fr)_auto] gap-4 rounded-[13px] border p-[15px_17px]",
                item.readAt
                  ? "border-line bg-panel2"
                  : "border-accent/35 bg-accent-soft/35",
              ].join(" ")}
            >
              <button
                type="button"
                onClick={() => {
                  if (!item.readAt)
                    update.mutate({ id: item.id, action: "read" });
                  onOpenAction(item.sourceRef);
                }}
                className="min-w-0 border-0 bg-transparent p-0 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[9.5px] font-[680] tracking-[0.08em] text-accent-strong">
                    {labelForKind(item.kind)}
                  </span>
                  <span className="text-[10px] text-faint">
                    {relativeTime(item.createdAt)}
                  </span>
                </div>
                <strong className="mt-1.5 block text-[13px] font-[620]">
                  {item.title}
                </strong>
                <p className="mt-1 text-[11.5px] leading-[1.65] text-ink-muted">
                  {item.detail}
                </p>
              </button>
              <div className="flex items-start gap-1">
                <IconButton
                  label={item.readAt ? "标记未读" : "标记已读"}
                  onClick={() =>
                    update.mutate({
                      id: item.id,
                      action: item.readAt ? "unread" : "read",
                    })
                  }
                >
                  {item.readAt ? (
                    <EyeSlashIcon size={14} />
                  ) : (
                    <EyeIcon size={14} />
                  )}
                </IconButton>
                <IconButton
                  label="标记完成"
                  onClick={() =>
                    update.mutate({ id: item.id, action: "resolve" })
                  }
                >
                  <CheckCircleIcon size={14} />
                </IconButton>
                <IconButton
                  label="暂时忽略"
                  onClick={() =>
                    update.mutate({ id: item.id, action: "dismiss" })
                  }
                >
                  <XIcon size={14} />
                </IconButton>
              </div>
            </article>
          ))
        ) : (
          <EmptyState
            title="现在没有需要你处理的事项"
            detail="未指定给个人的 Spec 评审不会出现在这里。"
          />
        )}
      </section>

      <section className="mt-8 rounded-[13px] border border-line bg-panel2 p-[16px_18px]">
        <div className="flex items-center gap-2">
          <BellSlashIcon size={15} className="text-ink-muted" />
          <strong className="text-[12.5px] font-[620]">站内通知偏好</strong>
        </div>
        <p className="mt-1.5 text-[10.5px] leading-[1.6] text-faint">
          静音只影响未读提醒，不会删除事项，也不会启用邮件、推送或外部通知。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {KINDS.map((kind) => {
            const muted = current?.mutedKinds.includes(kind.id) ?? false;
            return (
              <button
                key={kind.id}
                type="button"
                onClick={() => toggleKind(kind.id)}
                className={[
                  "h-8 rounded-btn border px-3 text-[10.5px]",
                  muted
                    ? "border-line bg-bg text-faint"
                    : "border-line2 bg-raise text-ink-muted",
                ].join(" ")}
              >
                {kind.label}
                {muted ? " · 已静音" : ""}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-[7px] border-0 bg-transparent text-faint hover:bg-hover-wash hover:text-ink"
    >
      {children}
    </button>
  );
}

function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-[13px] border border-dashed border-line2 bg-panel2 px-5 py-10 text-center">
      <strong className="text-[12px] font-[620] text-ink-muted">{title}</strong>
      {detail ? (
        <p className="mt-1.5 text-[10.5px] text-faint">{detail}</p>
      ) : null}
    </div>
  );
}

function labelForKind(kind: ActionInboxItem["kind"]) {
  return KINDS.find((item) => item.id === kind)?.label ?? kind;
}

function relativeTime(value: string) {
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 1_000),
  );
  if (seconds < 60) return "刚刚";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} 小时前`;
  return `${Math.floor(seconds / 86_400)} 天前`;
}
