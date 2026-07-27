import { BellIcon } from "@phosphor-icons/react";
import type { ActionInboxItem } from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getActionInbox, setNotificationPreferences } from "../../api.js";
import { Checkbox } from "../../design/primitives.js";

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
  const inbox = useQuery({
    queryKey: ["action-inbox"],
    queryFn: ({ signal }) => getActionInbox(signal),
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
        <strong className="text-[14px] font-[620]">站内通知</strong>
      </div>
      <p className="mt-2 max-w-[560px] text-[12px] leading-[1.7] text-ink-muted">
        选择哪些定向事项显示未读提醒。静音不删除 Inbox
        内容；当前不发送邮件、系统推送或外部消息。
      </p>
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
