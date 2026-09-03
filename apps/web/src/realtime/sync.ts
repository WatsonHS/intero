import type { ConversationChangedEvent, ThreadMessage } from "@intero/domain";
import type { QueryClient } from "@tanstack/react-query";

import {
  getThreadMessage,
  getThreadMessages,
  type ThreadPayload,
} from "../api.js";

interface ThreadListPayload {
  items: ThreadPayload[];
}

export async function repairConversationChange(
  queryClient: QueryClient,
  event: ConversationChangedEvent,
  viewerId?: string,
): Promise<ThreadMessage[]> {
  if (
    event.reason === "thread_created" ||
    event.reason === "thread_updated" ||
    event.reason === "access_changed" ||
    event.reason === "thread_concluded"
  ) {
    await queryClient.invalidateQueries({ queryKey: ["threads"] });
    return [];
  }

  const cached = queryClient.getQueryData<ThreadListPayload>(["threads"]);
  const item = cached?.items.find(
    (candidate) => candidate.thread.id === event.threadId,
  );
  if (
    (event.reason === "message_updated" ||
      event.reason === "message_edited" ||
      event.reason === "message_deleted" ||
      event.reason === "message_appended") &&
    event.messageId
  ) {
    try {
      const message = await getThreadMessage(event.threadId, event.messageId);
      if (item) {
        mergeThreadMessages(
          queryClient,
          event.threadId,
          [message],
          event.headSequence,
          event.accessVersion,
          viewerId,
        );
      } else {
        await queryClient.invalidateQueries({ queryKey: ["threads"] });
      }
      return [message];
    } catch {
      // Fall through to sequence repair when the pointer is stale.
    }
  }
  if (!item) {
    if (event.reason === "message_appended") {
      const page = await getThreadMessages(event.threadId, {
        afterSequence: Math.max(0, event.headSequence - 1),
        limit: 200,
      });
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
      return page.items.filter(
        (message) => message.sequence === event.headSequence,
      );
    }
    await queryClient.invalidateQueries({ queryKey: ["threads"] });
    return [];
  }
  let afterSequence = Math.max(
    item.thread.sequence,
    item.messages.at(-1)?.sequence ?? 0,
  );
  if (afterSequence >= event.headSequence) {
    if (event.reason === "read_cursor_changed") {
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
    }
    if (event.reason === "message_appended") {
      const cachedMessage = item.messages.filter(
        (message) => message.sequence === event.headSequence,
      );
      if (cachedMessage.length > 0) return cachedMessage;
      const page = await getThreadMessages(event.threadId, {
        afterSequence: Math.max(0, event.headSequence - 1),
        limit: 200,
      });
      mergeThreadMessages(
        queryClient,
        event.threadId,
        page.items,
        page.headSequence,
        page.accessVersion,
        viewerId,
      );
      return page.items.filter(
        (message) => message.sequence === event.headSequence,
      );
    }
    return [];
  }

  const repaired: ThreadMessage[] = [];
  while (afterSequence < event.headSequence) {
    const page = await getThreadMessages(event.threadId, {
      afterSequence,
      limit: 200,
    });
    if (page.items.length === 0) {
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
      return repaired;
    }
    mergeThreadMessages(
      queryClient,
      event.threadId,
      page.items,
      page.headSequence,
      page.accessVersion,
      viewerId,
    );
    repaired.push(...page.items);
    const nextSequence = page.items.at(-1)!.sequence;
    if (nextSequence <= afterSequence) {
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
      return repaired;
    }
    afterSequence = nextSequence;
    if (!page.hasMore && afterSequence >= page.headSequence) break;
  }
  return repaired;
}

export function mergeThreadMessages(
  queryClient: QueryClient,
  threadId: string,
  incoming: ThreadMessage[],
  headSequence: number,
  accessVersion: number,
  viewerId?: string,
): void {
  queryClient.setQueryData<ThreadListPayload>(["threads"], (current) => {
    if (!current) return current;
    return {
      ...current,
      items: current.items.map((item) => {
        if (item.thread.id !== threadId) return item;
        const existingSequences = new Set(
          item.messages.map((message) => message.sequence),
        );
        const newlyUnread = viewerId
          ? incoming.filter(
              (message) =>
                !existingSequences.has(message.sequence) &&
                message.senderId !== viewerId,
            ).length
          : 0;
        const newlyMentioned = viewerId
          ? incoming.filter(
              (message) =>
                !existingSequences.has(message.sequence) &&
                message.senderId !== viewerId &&
                message.mentionedPrincipalIds?.includes(
                  viewerId as ThreadMessage["senderId"],
                ),
            ).length
          : 0;
        const messages = new Map(
          item.messages.map((message) => [message.sequence, message]),
        );
        for (const message of incoming) messages.set(message.sequence, message);
        const orderedMessages = [...messages.values()].sort(
          (left, right) => left.sequence - right.sequence,
        );
        return {
          ...item,
          thread: {
            ...item.thread,
            sequence: Math.max(item.thread.sequence, headSequence),
            accessVersion,
            ...(incoming.at(-1)?.createdAt
              ? { latestMessageAt: incoming.at(-1)!.createdAt }
              : {}),
          },
          messages: item.historyExpanded
            ? orderedMessages
            : orderedMessages.slice(-200),
          ...(viewerId
            ? { unreadCount: (item.unreadCount ?? 0) + newlyUnread }
            : {}),
          ...(viewerId
            ? { mentionCount: (item.mentionCount ?? 0) + newlyMentioned }
            : {}),
        };
      }),
    };
  });
}
