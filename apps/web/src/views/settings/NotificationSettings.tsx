import { BellIcon } from "@phosphor-icons/react";
import type { ActionInboxItem } from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  currentBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  type BrowserNotificationPermission,
} from "../../action-inbox-browser-notifications.js";
import { getActionInbox, setNotificationPreferences } from "../../api.js";
import { Checkbox } from "../../design/primitives.js";
import { usePilotOptional } from "../../pilot/context.js";

const OPTIONS: Array<{
  id: ActionInboxItem["kind"];
  label: string;
}> = [
  { id: "review_request", label: "定向评审" },
  { id: "human_decision", label: "确认与协调决定" },
  { id: "scope_expansion", label: "范围扩展" },
  { id: "consequential_commitment", label: "重要承诺" },
  { id: "high_impact_contradiction", label: "高影响冲突" },
  { id: "imminent_blocker", label: "临近阻塞" },
];

export function NotificationSettings() {
  const queryClient = useQueryClient();
  const pilot = usePilotOptional();
  const [browserPermission, setBrowserPermission] =
    useState<BrowserNotificationPermission>(
      currentBrowserNotificationPermission,
    );
  const [browserPermissionPending, setBrowserPermissionPending] =
    useState(false);
  const inbox = useQuery({
    queryKey: ["action-inbox"],
    queryFn: ({ signal }) => getActionInbox(signal),
    enabled: !pilot?.enabled || Boolean(pilot.effectiveIdentity),
  });
  const update = useMutation({
    mutationFn: setNotificationPreferences,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["action-inbox"] });
    },
  });
  const muted = inbox.data?.preferences.mutedKinds ?? [];

  return (
    <section className="mt-8" data-testid="notification-settings">
      <div className="flex items-center gap-2">
        <BellIcon size={16} className="text-ink-muted" />
        <strong className="text-[14px] font-[620]">通知</strong>
      </div>
      <p className="mt-2 max-w-[560px] text-[12px] leading-[1.7] text-ink-muted">
        选择哪些定向事项显示未读提醒。静音不删除 Inbox
        内容；允许浏览器通知后，页面在后台时也能提醒你，Action Inbox
        仍是最终记录。
      </p>
      <div className="mt-3.5 flex items-center gap-3 rounded-[13px] border border-line bg-panel2 p-[14px_16px]">
        <span className="grid min-w-0 gap-1">
          <strong className="text-[11.5px] font-[620]">浏览器通知</strong>
          <small className="text-[10.5px] leading-[1.55] text-ink-muted">
            {browserPermission === "granted"
              ? "已允许；只在页面位于后台时提醒新到达且未静音的事项。"
              : browserPermission === "denied"
                ? "浏览器已拒绝通知。请在站点权限中重新允许。"
                : browserPermission === "unsupported"
                  ? "当前浏览器或运行环境不支持系统通知。"
                  : "需要你明确允许，Intero 不会自动弹出权限请求。"}
          </small>
        </span>
        <button
          type="button"
          disabled={
            browserPermissionPending ||
            browserPermission === "granted" ||
            browserPermission === "denied" ||
            browserPermission === "unsupported"
          }
          onClick={async () => {
            setBrowserPermissionPending(true);
            try {
              setBrowserPermission(
                await requestBrowserNotificationPermission(),
              );
            } finally {
              setBrowserPermissionPending(false);
            }
          }}
          className="ml-auto h-8 shrink-0 rounded-btn border border-line2 bg-transparent px-3 text-[11px] hover:border-accent-strong disabled:opacity-55"
        >
          {browserPermissionPending
            ? "正在请求…"
            : browserPermission === "granted"
              ? "已开启"
              : "开启浏览器通知"}
        </button>
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-2 rounded-[13px] border border-line bg-panel2 p-[16px_18px]">
        {OPTIONS.map((option) => {
          const enabled = !muted.includes(option.id);
          return (
            <Checkbox
              key={option.id}
              checked={enabled}
              disabled={update.isPending}
              label={option.label}
              className="rounded-btn bg-raise px-3 py-2.5"
              onChange={() =>
                update.mutate({
                  mutedKinds: enabled
                    ? [...muted, option.id]
                    : muted.filter((kind) => kind !== option.id),
                })
              }
            />
          );
        })}
      </div>
    </section>
  );
}
