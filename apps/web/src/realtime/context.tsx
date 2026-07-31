import type { ReactNode } from "react";
import type { PrincipalId } from "@intero/domain";
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
} from "../api.js";
import { useNotifications } from "../design/notifications.js";
import { useI18n } from "../i18n/index.js";
import { usePilotOptional } from "../pilot/context.js";
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
}

const ConversationRealtimeContext =
  createContext<ConversationRealtimeContextValue>({
    status: "disabled",
    watchThread: async () => () => undefined,
    watchCallEvents: async () => () => undefined,
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
  const pendingCallInvites = useRef(new Map<string, CallEventEnvelope>());
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
      onChange: (event) => {
        void repairConversationChange(queryClient, event, identityId)
          .then((messages) => {
            if (
              event.reason !== "message_updated" ||
              messages.some(
                (message) =>
                  message.streamState === "complete" ||
                  message.streamState === "failed",
              )
            ) {
              void queryClient.invalidateQueries({
                queryKey: ["pilot", "stand_in"],
              });
            }
            for (const message of messages) {
              if (
                message.senderId === identityId ||
                !message.mentionedPrincipalIds?.includes(
                  identityId as PrincipalId,
                ) ||
                notifiedMentionIds.current.has(message.id)
              ) {
                continue;
              }
              notifiedMentionIds.current.add(message.id);
              if (notifiedMentionIds.current.size > 500) {
                notifiedMentionIds.current = new Set([message.id]);
              }
              const cached = queryClient.getQueryData<{
                items: Array<{
                  thread: { id: string; title: string };
                  principals: Array<{ id: string; displayName: string }>;
                }>;
              }>(["threads"]);
              const thread = cached?.items.find(
                (item) => item.thread.id === message.threadId,
              );
              const sender = thread?.principals.find(
                (principal) => principal.id === message.senderId,
              );
              notifications.info(
                t("chat.mentionNotificationBody", {
                  sender: sender?.displayName ?? t("chat.someone"),
                  thread: thread?.thread.title ?? t("chat.title"),
                }),
                { title: t("chat.mentionNotificationTitle") },
              );
              if (
                typeof Notification !== "undefined" &&
                Notification.permission === "granted" &&
                document.visibilityState === "hidden"
              ) {
                try {
                  new Notification(t("chat.mentionNotificationTitle"), {
                    body: t("chat.mentionNotificationNativeBody", {
                      thread: thread?.thread.title ?? t("chat.title"),
                    }),
                    tag: `intero-mention-${message.id}`,
                  });
                } catch {
                  // The in-app reminder remains authoritative when the host
                  // declines a native notification despite granted permission.
                }
              }
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

  const value = useMemo(
    () => ({ status, watchThread, watchCallEvents }),
    [status, watchCallEvents, watchThread],
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
