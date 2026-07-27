import {
  CheckCircleIcon,
  InfoIcon,
  WarningCircleIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../i18n/index.js";

export type NotificationTone = "success" | "danger" | "warning" | "info";

export interface NotificationOptions {
  title?: string;
  /** Set to 0 to keep the notification visible until it is dismissed. */
  durationMs?: number;
}

export interface NotificationInput extends NotificationOptions {
  message: ReactNode;
  tone?: NotificationTone;
}

export interface AppNotification extends NotificationInput {
  id: string;
  tone: NotificationTone;
  durationMs: number;
}

export type NotificationAction =
  | { type: "add"; notification: AppNotification }
  | { type: "dismiss"; id: string }
  | { type: "clear" };

export interface NotificationsApi {
  notify: (input: NotificationInput) => string;
  success: (message: ReactNode, options?: NotificationOptions) => string;
  error: (message: ReactNode, options?: NotificationOptions) => string;
  warning: (message: ReactNode, options?: NotificationOptions) => string;
  info: (message: ReactNode, options?: NotificationOptions) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const DEFAULT_DURATION_MS = 4_000;
export const MAX_VISIBLE_NOTIFICATIONS = 4;
const NotificationsContext = createContext<NotificationsApi | undefined>(
  undefined,
);
let nextNotificationId = 0;

export function notificationReducer(
  state: AppNotification[],
  action: NotificationAction,
): AppNotification[] {
  switch (action.type) {
    case "add":
      return [...state, action.notification].slice(-MAX_VISIBLE_NOTIFICATIONS);
    case "dismiss":
      return state.filter((notification) => notification.id !== action.id);
    case "clear":
      return [];
  }
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, dispatch] = useReducer(notificationReducer, []);

  const dismiss = useCallback(
    (id: string) => dispatch({ type: "dismiss", id }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: "clear" }), []);
  const notify = useCallback((input: NotificationInput) => {
    const id = `notification-${++nextNotificationId}`;
    dispatch({
      type: "add",
      notification: {
        ...input,
        id,
        tone: input.tone ?? "info",
        durationMs: input.durationMs ?? DEFAULT_DURATION_MS,
      },
    });
    return id;
  }, []);
  const success = useCallback(
    (message: ReactNode, options: NotificationOptions = {}) =>
      notify({ ...options, message, tone: "success" }),
    [notify],
  );
  const error = useCallback(
    (message: ReactNode, options: NotificationOptions = {}) =>
      notify({ ...options, message, tone: "danger" }),
    [notify],
  );
  const warning = useCallback(
    (message: ReactNode, options: NotificationOptions = {}) =>
      notify({ ...options, message, tone: "warning" }),
    [notify],
  );
  const info = useCallback(
    (message: ReactNode, options: NotificationOptions = {}) =>
      notify({ ...options, message, tone: "info" }),
    [notify],
  );
  const value = useMemo<NotificationsApi>(
    () => ({ notify, success, error, warning, info, dismiss, clear }),
    [clear, dismiss, error, info, notify, success, warning],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      {typeof document !== "undefined"
        ? createPortal(
            <NotificationViewport
              notifications={notifications}
              onDismiss={dismiss}
            />,
            document.body,
          )
        : null}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsApi {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error(
      "useNotifications must be used inside NotificationProvider.",
    );
  }
  return context;
}

export function NotificationViewport({
  notifications,
  onDismiss,
}: {
  notifications: AppNotification[];
  onDismiss: (id: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div
      className="pointer-events-none fixed bottom-6 right-6 z-[80] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
      aria-label={t("app.notifications")}
    >
      {notifications.map((notification) => (
        <NotificationCard
          key={notification.id}
          notification={notification}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}

export function NotificationCard({
  notification,
  onDismiss,
}: {
  notification: AppNotification;
  onDismiss: (id: string) => void;
}) {
  const { t } = useI18n();
  const Icon =
    notification.tone === "success"
      ? CheckCircleIcon
      : notification.tone === "danger"
        ? WarningCircleIcon
        : notification.tone === "warning"
          ? WarningIcon
          : InfoIcon;

  useEffect(() => {
    if (notification.durationMs <= 0) return;
    const timeout = window.setTimeout(
      () => onDismiss(notification.id),
      notification.durationMs,
    );
    return () => window.clearTimeout(timeout);
  }, [notification.durationMs, notification.id, onDismiss]);

  return (
    <div
      data-testid="app-notification"
      role={notification.tone === "danger" ? "alert" : "status"}
      className={[
        "pointer-events-auto flex items-start gap-2.5 rounded-[13px] border bg-panel2 px-3.5 py-3 text-[11.5px] leading-[1.6] shadow-[0_18px_50px_rgba(0,0,0,0.18)] animate-card-enter",
        notification.tone === "success"
          ? "border-green/25 text-green"
          : notification.tone === "danger"
            ? "border-danger/25 text-danger"
            : notification.tone === "warning"
              ? "border-amber/25 text-amber"
              : "border-accent-strong/25 text-accent-strong",
      ].join(" ")}
    >
      <Icon size={16} weight="fill" className="mt-0.5 shrink-0" />
      <span className="grid min-w-0 flex-1 gap-0.5">
        {notification.title ? (
          <strong className="font-[620] text-current">
            {notification.title}
          </strong>
        ) : null}
        <span className="text-current">{notification.message}</span>
      </span>
      <button
        type="button"
        aria-label={t("general.close")}
        onClick={() => onDismiss(notification.id)}
        className="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-quiet border-0 bg-transparent text-current opacity-60 hover:bg-hover-wash hover:opacity-100"
      >
        <XIcon size={11} />
      </button>
    </div>
  );
}
