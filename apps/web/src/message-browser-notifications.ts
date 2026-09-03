import type {
  NotificationPreferences,
  ThreadAccessMode,
  ThreadMessage,
} from "@intero/domain";
import { shouldDeliverMessageNotification } from "@intero/domain";

export interface MessageNotificationThread {
  title: string;
  accessMode: ThreadAccessMode;
  /** HOOK(T1b): per-thread mute. Absent until T1b lands. */
  mutedUntil?: string;
}

export interface SelectableMessageNotification {
  message: ThreadMessage;
  threadId: string;
  threadTitle: string;
  accessMode: ThreadAccessMode;
  mentioned: boolean;
}

export function withInferredMentions(
  message: ThreadMessage,
  viewerId: string,
  principals: ReadonlyArray<{ id: string; displayName: string }>,
): ThreadMessage {
  const existing = message.mentionedPrincipalIds ?? [];
  if (existing.includes(viewerId as ThreadMessage["senderId"])) return message;
  const self = principals.find((principal) => principal.id === viewerId);
  if (!self?.displayName) return message;
  const matcher = new RegExp(
    `@${self.displayName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?=$|[\\s，。！？、,.!?:;；：）)\\]】])`,
    "u",
  );
  if (!matcher.test(message.body)) return message;
  return {
    ...message,
    mentionedPrincipalIds: [...existing, viewerId as ThreadMessage["senderId"]],
  };
}

export function selectNewMessageNotifications(input: {
  messages: ThreadMessage[];
  viewerId: string;
  activeThreadId?: string;
  windowFocused: boolean;
  preferences: NotificationPreferences;
  threadsById: Map<string, MessageNotificationThread>;
  occurredAt: string;
  now?: Date;
}): SelectableMessageNotification[] {
  const now = input.now ?? new Date();
  const eventThreshold = Date.parse(input.occurredAt) - 5_000;
  const selected: SelectableMessageNotification[] = [];
  for (const message of input.messages) {
    if (message.senderId === input.viewerId) continue;
    if (message.kind !== "message") continue;
    if (
      message.streamState === "pending" ||
      message.streamState === "streaming"
    ) {
      continue;
    }
    if (Date.parse(message.createdAt) < eventThreshold) continue;
    const thread = input.threadsById.get(message.threadId);
    if (!thread) continue;
    const focusedOnThread =
      input.windowFocused && input.activeThreadId === message.threadId;
    if (focusedOnThread) continue;
    const mentioned = Boolean(
      message.mentionedPrincipalIds?.includes(
        input.viewerId as ThreadMessage["senderId"],
      ),
    );
    if (
      !shouldDeliverMessageNotification({
        mode: input.preferences.messages,
        mentioned,
        isSelf: false,
        ...(input.preferences.muteUntil
          ? { muteUntil: input.preferences.muteUntil }
          : {}),
        ...(thread.mutedUntil ? { threadMutedUntil: thread.mutedUntil } : {}),
        now,
      })
    ) {
      continue;
    }
    selected.push({
      message,
      threadId: message.threadId,
      threadTitle: thread.title,
      accessMode: thread.accessMode,
      mentioned,
    });
  }
  return selected;
}
