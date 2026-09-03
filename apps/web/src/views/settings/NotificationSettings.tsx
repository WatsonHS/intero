import { BellIcon } from "@phosphor-icons/react";
import type { ActionInboxItem, MessageNotificationMode } from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  currentBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  type BrowserNotificationPermission,
} from "../../action-inbox-browser-notifications.js";
import {
  deletePushSubscription,
  getActionInbox,
  getWebPushConfig,
  setNotificationPreferences,
  upsertPushSubscription,
} from "../../api.js";
import { Checkbox, SegmentedControl } from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";
import type { TranslationKey } from "../../i18n/locales/zh-CN.js";
import { usePilotOptional } from "../../pilot/context.js";
import {
  currentPushSubscription,
  subscribeWebPush,
  unsubscribeWebPush,
} from "../../web-push-client.js";

const OPTIONS: Array<{
  id: ActionInboxItem["kind"];
  label: TranslationKey;
}> = [
  { id: "review_request", label: "settings.notifications.kind.review_request" },
  { id: "human_decision", label: "settings.notifications.kind.human_decision" },
  {
    id: "scope_expansion",
    label: "settings.notifications.kind.scope_expansion",
  },
  {
    id: "consequential_commitment",
    label: "settings.notifications.kind.consequential_commitment",
  },
  {
    id: "high_impact_contradiction",
    label: "settings.notifications.kind.high_impact_contradiction",
  },
  {
    id: "imminent_blocker",
    label: "settings.notifications.kind.imminent_blocker",
  },
];

export function NotificationSettings() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const pilot = usePilotOptional();
  const desktop =
    typeof window === "undefined" ? undefined : window.interoDesktop;
  const [browserPermission, setBrowserPermission] =
    useState<BrowserNotificationPermission>(
      currentBrowserNotificationPermission,
    );
  const [browserPermissionPending, setBrowserPermissionPending] =
    useState(false);
  const [pushPending, setPushPending] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [closeToTray, setCloseToTray] = useState(false);
  const inbox = useQuery({
    queryKey: ["action-inbox"],
    queryFn: ({ signal }) => getActionInbox(signal),
    enabled: !pilot?.enabled || Boolean(pilot.effectiveIdentity),
  });
  const webPush = useQuery({
    queryKey: ["web-push-config"],
    queryFn: ({ signal }) => getWebPushConfig(signal),
    enabled: !pilot?.enabled || Boolean(pilot.effectiveIdentity),
  });
  const update = useMutation({
    mutationFn: setNotificationPreferences,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["action-inbox"] });
    },
  });
  const muted = inbox.data?.preferences.mutedKinds ?? [];
  const messages: MessageNotificationMode =
    inbox.data?.preferences.messages ?? "mentions";

  useEffect(() => {
    void currentPushSubscription().then((subscription) =>
      setPushSubscribed(Boolean(subscription)),
    );
  }, []);

  useEffect(() => {
    void desktop?.getDesktopSettings?.().then((settings) => {
      setCloseToTray(Boolean(settings.closeToTray));
    });
  }, [desktop]);

  const browserStatusKey: TranslationKey =
    browserPermission === "granted"
      ? "settings.notifications.browserGranted"
      : browserPermission === "denied"
        ? "settings.notifications.browserDenied"
        : browserPermission === "unsupported"
          ? "settings.notifications.browserUnsupported"
          : "settings.notifications.browserPrompt";

  return (
    <section className="mt-8" data-testid="notification-settings">
      <div className="flex items-center gap-2">
        <BellIcon size={16} className="text-ink-muted" />
        <strong className="text-[14px] font-[620]">
          {t("settings.notifications.title")}
        </strong>
      </div>
      <p className="mt-2 max-w-[560px] text-[12px] leading-[1.7] text-ink-muted">
        {t("settings.notifications.lede")}
      </p>
      <div className="mt-3.5 flex items-center gap-3 rounded-[13px] border border-line bg-panel2 p-[14px_16px]">
        <span className="grid min-w-0 gap-1">
          <strong className="text-[11.5px] font-[620]">
            {t("settings.notifications.browser")}
          </strong>
          <small className="text-[10.5px] leading-[1.55] text-ink-muted">
            {t(browserStatusKey)}
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
            ? t("settings.notifications.browserPending")
            : browserPermission === "granted"
              ? t("settings.notifications.browserOn")
              : t("settings.notifications.browserEnable")}
        </button>
      </div>
      <div className="mt-3.5 rounded-[13px] border border-line bg-panel2 p-[16px_18px]">
        <strong className="text-[11.5px] font-[620]">
          {t("settings.notifications.messages")}
        </strong>
        <p className="mt-1 max-w-[520px] text-[10.5px] leading-[1.55] text-ink-muted">
          {t("settings.notifications.messagesLede")}
        </p>
        <div data-testid="notification-messages-mode">
          <SegmentedControl
            className="mt-3 w-fit"
            value={messages}
            onChange={(next) =>
              update.mutate({
                mutedKinds: muted,
                messages: next,
                ...(inbox.data?.preferences.muteUntil
                  ? { muteUntil: inbox.data.preferences.muteUntil }
                  : {}),
              })
            }
            items={[
              {
                id: "all",
                label: t("settings.notifications.messagesAll"),
                testId: "notification-messages-all",
              },
              {
                id: "mentions",
                label: t("settings.notifications.messagesMentions"),
                testId: "notification-messages-mentions",
              },
              {
                id: "none",
                label: t("settings.notifications.messagesNone"),
                testId: "notification-messages-none",
              },
            ]}
          />
        </div>
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-2 rounded-[13px] border border-line bg-panel2 p-[16px_18px]">
        {OPTIONS.map((option) => {
          const enabled = !muted.includes(option.id);
          return (
            <Checkbox
              key={option.id}
              checked={enabled}
              disabled={update.isPending}
              label={t(option.label)}
              className="rounded-btn bg-raise px-3 py-2.5"
              onChange={() =>
                update.mutate({
                  mutedKinds: enabled
                    ? [...muted, option.id]
                    : muted.filter((kind) => kind !== option.id),
                  messages,
                  ...(inbox.data?.preferences.muteUntil
                    ? { muteUntil: inbox.data.preferences.muteUntil }
                    : {}),
                })
              }
            />
          );
        })}
      </div>
      <div className="mt-3.5 flex items-center gap-3 rounded-[13px] border border-line bg-panel2 p-[14px_16px]">
        <span className="grid min-w-0 gap-1">
          <strong className="text-[11.5px] font-[620]">
            {t("settings.notifications.webPush")}
          </strong>
          <small className="text-[10.5px] leading-[1.55] text-ink-muted">
            {webPush.data?.enabled
              ? t("settings.notifications.webPushLede")
              : t("settings.notifications.webPushUnavailable")}
          </small>
        </span>
        <button
          type="button"
          disabled={
            pushPending ||
            !webPush.data?.enabled ||
            !webPush.data.publicKey ||
            browserPermission !== "granted"
          }
          onClick={async () => {
            const publicKey = webPush.data?.publicKey;
            if (!publicKey) return;
            setPushPending(true);
            try {
              if (pushSubscribed) {
                const current = await currentPushSubscription();
                if (current) {
                  await deletePushSubscription(current.endpoint);
                  await unsubscribeWebPush();
                }
                setPushSubscribed(false);
              } else {
                const subscription = await subscribeWebPush(publicKey);
                await upsertPushSubscription({
                  endpoint: subscription.endpoint,
                  keys: subscription.keys,
                  userAgent: navigator.userAgent.slice(0, 400),
                });
                setPushSubscribed(true);
              }
            } finally {
              setPushPending(false);
            }
          }}
          className="ml-auto h-8 shrink-0 rounded-btn border border-line2 bg-transparent px-3 text-[11px] hover:border-accent-strong disabled:opacity-55"
        >
          {pushPending
            ? t("settings.notifications.webPushPending")
            : pushSubscribed
              ? t("settings.notifications.webPushOn")
              : t("settings.notifications.webPushOff")}
        </button>
      </div>
      {desktop?.setCloseToTray ? (
        <div className="mt-3.5 rounded-[13px] border border-line bg-panel2 p-[14px_16px]">
          <Checkbox
            checked={closeToTray}
            label={t("settings.notifications.closeToTray")}
            className="rounded-btn bg-raise px-3 py-2.5"
            onChange={() => {
              const next = !closeToTray;
              setCloseToTray(next);
              void desktop.setCloseToTray?.(next);
            }}
          />
          <p className="mt-2 text-[10.5px] leading-[1.55] text-ink-muted">
            {t("settings.notifications.closeToTrayLede")}
          </p>
        </div>
      ) : null}
    </section>
  );
}
