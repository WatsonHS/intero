import type { ReactNode } from "react";
import {
  defaultNotificationPreferences,
  type PrincipalId,
  type TypingEvent,
} from "@intero/domain";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createRealtimeSession,
  createRealtimeSubscription,
  getBootstrap,
  sendPresenceHeartbeat,
} from "../api.js";
import { useNotifications } from "../design/notifications.js";
import { useI18n } from "../i18n/index.js";
import { selectNewMessageNotifications } from "../message-browser-notifications.js";
import { usePilotOptional } from "../pilot/context.js";
import { presentSystemNotification } from "../system-notifications.js";
import type { ActionInboxSnapshot } from "../action-inbox-browser-notifications.js";
import {
  ConversationRealtimeCoordinator,
  type ConversationRealtimeStatus,
} from "./coordinator.js";
import type { CallEventEnvelope } from "../calls/types.js";
import { repairConversationChange } from "./sync.js";

interface ConversationRealtimeContextValue {
  status: ConversationRealtimeStatus;
  watchThread: (threadId: string) => Promise<() => void>;
  watchCallEvents: (
    threadId: string,
    listener: (event: CallEventEnvelope) => void,
  ) => Promise<() => void>;
  watchTyping: (
    threadId: string,
    listener: (event: TypingEvent) => void,
  ) => Promise<() => void>;
}

const ConversationRealtimeContext =
  createContext<ConversationRealtimeContextValue>({
    status: "disabled",
    watchThread: async () => () => undefined,
    watchCallEvents: async () => () => undefined,
    watchTyping: async () => () => undefined,
  });

export function ConversationRealtimeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pilot = usePilotOptional();
  const notifications = useNotifications();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ConversationRealtimeStatus>("disabled");
  const coordinatorRef = useRef<ConversationRealtimeCoordinator | undefined>(
    undefined,
  );
  const notifiedMentionIds = useRef(new Set<string>());
  const callEventListeners = useRef(
    new Map<string, Set<(event: CallEventEnvelope) => void>>(),
  );
  const typingListeners = useRef(
    new Map<string, Set<(event: TypingEvent) => void>>(),
  );
  const pendingCallInvites = useRef(new Map<string, CallEventEnvelope>());
  const lastActivityAt = useRef(Date.now());
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
    enabled: !pilot?.enabled,
  });
  const enabled = pilot?.enabled
    ? Boolean(
        pilot.identityId &&
        pilot.bootstrap.data?.adapters.realtime === "centrifugo",
      )
    : Boolean(
        bootstrap.data?.currentPrincipal &&
        bootstrap.data.adapters?.realtime === "centrifugo",
      );
  const identityId = pilot?.enabled
    ? pilot.identityId
    : bootstrap.data?.currentPrincipal?.id;

  useEffect(() => {
    if (!enabled || !identityId) {
      coordinatorRef.current?.stop();
      coordinatorRef.current = undefined;
      setStatus("disabled");
      return;
    }
    const coordinator = new ConversationRealtimeCoordinator({
      createSession: createRealtimeSession,
      createSubscription: createRealtimeSubscription,
      onStatus: setStatus,
      onTyping: (event) => {
        const listeners = typingListeners.current.get(event.threadId);
        if (!listeners) return;
        for (const listener of listeners) listener(event);
      },
      onChange: (event) => {
        void repairConversationChange(queryClient, event, identityId)
          .then((messages) => {
            const inPlaceRevision =
              event.reason === "message_updated" ||
              event.reason === "message_edited" ||
              event.reason === "message_deleted";
            if (
              !inPlaceRevision ||
              (event.reason === "message_updated" &&
                messages.some(
                  (message) =>
                    message.streamState === "complete" ||
                    message.streamState === "failed",
                ))
            ) {
              void queryClient.invalidateQueries({
                queryKey: ["pilot", "stand_in"],
              });
            }
            const cached = queryClient.getQueryData<{
              items: Array<{
                thread: {
                  id: string;
                  title: string;
                  accessMode: "human_only_e2ee" | "agent_readable";
                  mutedUntil?: string;
                };
                principals: Array<{ id: string; displayName: string }>;
              }>;
            }>(["threads"]);
            const inbox = queryClient.getQueryData<ActionInboxSnapshot>([
              "action-inbox",
            ]);
            const preferences =
              inbox?.preferences ??
              defaultNotificationPreferences(identityId as PrincipalId);
            const threadsById = new Map(
              (cached?.items ?? []).map((item) => [
                item.thread.id,
                {
                  title: item.thread.title,
                  accessMode: item.thread.accessMode,
                  ...(item.thread.mutedUntil
                    ? { mutedUntil: item.thread.mutedUntil }
                    : {}),
                },
              ]),
            );
            const windowFocused =
              typeof document === "undefined"
                ? true
                : document.visibilityState === "visible" && document.hasFocus();
            const pathname =
              typeof window === "undefined" ? "" : window.location.pathname;
            const activeThreadId = pathname.startsWith("/communications/")
              ? pathname.slice("/communications/".length).split("/")[0]
              : undefined;
            for (const selected of selectNewMessageNotifications({
              messages,
              viewerId: identityId,
              ...(activeThreadId ? { activeThreadId } : {}),
              windowFocused,
              preferences,
              threadsById,
              occurredAt: event.occurredAt,
            })) {
              if (notifiedMentionIds.current.has(selected.message.id)) continue;
              notifiedMentionIds.current.add(selected.message.id);
              if (notifiedMentionIds.current.size > 500) {
                notifiedMentionIds.current = new Set([selected.message.id]);
              }
              const thread = cached?.items.find(
                (item) => item.thread.id === selected.threadId,
              );
              const sender = thread?.principals.find(
                (principal) => principal.id === selected.message.senderId,
              );
              if (selected.mentioned) {
                notifications.info(
                  t("chat.mentionNotificationBody", {
                    sender: sender?.displayName ?? t("chat.someone"),
                    thread: selected.threadTitle || t("chat.title"),
                  }),
                  { title: t("chat.mentionNotificationTitle") },
                );
              }
              const copy =
                selected.accessMode === "human_only_e2ee"
                  ? {
                      title: t("chat.messageNotificationEncrypted", {
                        thread: selected.threadTitle || t("chat.title"),
                      }),
                    }
                  : selected.mentioned
                    ? {
                        title: t("chat.mentionNotificationTitle"),
                        body: t("chat.mentionNotificationNativeBody", {
                          thread: selected.threadTitle || t("chat.title"),
                        }),
                      }
                    : {
                        title: t("chat.messageNotificationTitle", {
                          thread: selected.threadTitle || t("chat.title"),
                        }),
                        ...(selected.message.body.trim()
                          ? {
                              body: t("chat.messageNotificationBody", {
                                preview: selected.message.body
                                  .replace(/\s+/g, " ")
                                  .trim()
                                  .slice(0, 140),
                              }),
                            }
                          : {}),
                      };
              presentSystemNotification({
                title: copy.title,
                ...(copy.body ? { body: copy.body } : {}),
                tag: `intero-message-${selected.message.id}`,
                data: { threadId: selected.threadId },
                onOpen: () => {
                  window.focus();
                  window.location.assign(
                    `/communications/${selected.threadId}`,
                  );
                },
              });
            }
          })
          .catch(() => {
            setStatus(
              typeof navigator !== "undefined" && !navigator.onLine
                ? "offline"
                : "degraded",
            );
          });
      },
      onCallEvent: (event) => {
        const listeners =
          callEventListeners.current.get(event.threadId) ?? new Set();
        if (event.event.kind === "invite" && event.senderId !== identityId) {
          if (listeners.size === 0) {
            pendingCallInvites.current.set(event.threadId, event);
          } else {
            pendingCallInvites.current.delete(event.threadId);
          }
          const cached = queryClient.getQueryData<{
            items: Array<{
              thread: { id: string; title: string };
              principals: Array<{ id: string; displayName: string }>;
            }>;
          }>(["threads"]);
          const thread = cached?.items.find(
            (item) => item.thread.id === event.threadId,
          );
          const sender = thread?.principals.find(
            (principal) => principal.id === event.senderId,
          );
          const title = t("chat.incomingCallFrom", {
            name: sender?.displayName ?? t("chat.someone"),
          });
          if (listeners.size === 0) {
            notifications.info(thread?.thread.title ?? t("chat.title"), {
              title,
            });
          }
          if (
            typeof Notification !== "undefined" &&
            Notification.permission === "granted" &&
            document.visibilityState === "hidden"
          ) {
            try {
              const notification = new Notification(title, {
                body: thread?.thread.title ?? t("chat.title"),
                tag: `intero-call-${event.callId}`,
              });
              notification.onclick = () => {
                window.focus();
                window.location.assign(`/communications/${event.threadId}`);
              };
            } catch {
              // The in-app incoming-call state remains authoritative.
            }
          }
        } else if (
          (event.event.kind === "hangup" || event.event.kind === "decline") &&
          pendingCallInvites.current.get(event.threadId)?.callId ===
            event.callId
        ) {
          pendingCallInvites.current.delete(event.threadId);
        }
        for (const listener of listeners) {
          listener(event);
        }
      },
      onRecoveryGap: () => {
        void queryClient.invalidateQueries({ queryKey: ["threads"] });
      },
      isOnline: () =>
        typeof navigator === "undefined" ? true : navigator.onLine,
    });
    coordinatorRef.current = coordinator;
    const online = () => coordinator.networkChanged(true);
    const offline = () => coordinator.networkChanged(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    coordinator.start();
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      coordinator.stop();
      if (coordinatorRef.current === coordinator) {
        coordinatorRef.current = undefined;
      }
    };
  }, [enabled, identityId, notifications, queryClient, t]);

  useEffect(() => {
    if (!identityId) return;
    const markActivity = () => {
      lastActivityAt.current = Date.now();
    };
    window.addEventListener("pointerdown", markActivity);
    window.addEventListener("keydown", markActivity);
    const beat = () => {
      const visible =
        typeof document === "undefined" ||
        document.visibilityState === "visible";
      void sendPresenceHeartbeat({
        active: visible && Date.now() - lastActivityAt.current < 30_000,
      }).catch(() => undefined);
    };
    beat();
    const timer = window.setInterval(beat, 30_000);
    return () => {
      window.removeEventListener("pointerdown", markActivity);
      window.removeEventListener("keydown", markActivity);
      window.clearInterval(timer);
    };
  }, [identityId]);

  const watchThread = useCallback(async (threadId: string) => {
    const coordinator = coordinatorRef.current;
    if (!coordinator) return () => undefined;
    return coordinator.subscribeThread(threadId);
  }, []);

  const watchCallEvents = useCallback(
    async (threadId: string, listener: (event: CallEventEnvelope) => void) => {
      const listeners =
        callEventListeners.current.get(threadId) ??
        new Set<(event: CallEventEnvelope) => void>();
      listeners.add(listener);
      callEventListeners.current.set(threadId, listeners);
      let releaseThread: () => void = () => undefined;
      try {
        releaseThread = await watchThread(threadId);
      } catch (error) {
        listeners.delete(listener);
        if (listeners.size === 0) callEventListeners.current.delete(threadId);
        throw error;
      }
      const pending = pendingCallInvites.current.get(threadId);
      if (pending && Date.now() - Date.parse(pending.occurredAt) <= 45_000) {
        listener(pending);
      } else if (pending) {
        pendingCallInvites.current.delete(threadId);
      }
      return () => {
        releaseThread();
        listeners.delete(listener);
        if (listeners.size === 0) callEventListeners.current.delete(threadId);
      };
    },
    [watchThread],
  );

  const watchTyping = useCallback(
    async (threadId: string, listener: (event: TypingEvent) => void) => {
      const listeners =
        typingListeners.current.get(threadId) ??
        new Set<(event: TypingEvent) => void>();
      listeners.add(listener);
      typingListeners.current.set(threadId, listeners);
      let releaseThread: () => void = () => undefined;
      try {
        releaseThread = await watchThread(threadId);
      } catch (error) {
        listeners.delete(listener);
        if (listeners.size === 0) typingListeners.current.delete(threadId);
        throw error;
      }
      return () => {
        releaseThread();
        listeners.delete(listener);
        if (listeners.size === 0) typingListeners.current.delete(threadId);
      };
    },
    [watchThread],
  );

  const value = useMemo(
    () => ({ status, watchThread, watchCallEvents, watchTyping }),
    [status, watchCallEvents, watchThread, watchTyping],
  );
  return (
    <ConversationRealtimeContext.Provider value={value}>
      {children}
    </ConversationRealtimeContext.Provider>
  );
}

export function useConversationRealtime(): ConversationRealtimeContextValue {
  return useContext(ConversationRealtimeContext);
}
