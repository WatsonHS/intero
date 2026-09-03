import type { PrincipalId, ThreadMessage } from "@intero/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import {
  deleteThreadMessage,
  editThreadMessage,
  getThreadMessages,
  markThreadRead,
  setThreadMessageReaction,
} from "../../../api.js";
import { useNotifications } from "../../../design/notifications.js";
import { useI18n } from "../../../i18n/index.js";
import type { ThreadPayload } from "../../../api.js";
import {
  markCachedThreadRead,
  replaceCachedThreadMessage,
  type ThreadListCache,
} from "../helpers.js";

export function useThreadMessages({
  current,
  conversationIdentity,
  currentIsPilot,
  currentIsPilotStandIn,
  currentSenderId,
  focusMessageId,
  focusSequence,
}: {
  current: ThreadPayload | undefined;
  conversationIdentity:
    { currentPrincipalId: string; standInPrincipalId: string } | undefined;
  currentIsPilot: boolean;
  currentIsPilotStandIn: boolean;
  currentSenderId: PrincipalId | undefined;
  focusMessageId?: string | undefined;
  focusSequence?: number | undefined;
}) {
  const { t } = useI18n();
  const notifications = useNotifications();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [failedReadKey, setFailedReadKey] = useState<string | undefined>();
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<
    string | undefined
  >();
  const [editingMessageId, setEditingMessageId] = useState<
    string | undefined
  >();
  const [deletingMessage, setDeletingMessage] = useState<
    ThreadMessage | undefined
  >();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [historyExhausted, setHistoryExhausted] = useState<Set<string>>(
    () => new Set(),
  );
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | undefined
  >();
  const loadedFocusRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    setReactionPickerMessageId(undefined);
    setEditingMessageId(undefined);
    setDeletingMessage(undefined);
  }, [current?.thread.id]);

  const markRead = useMutation({
    mutationFn: (input: { threadId: string; sequence: number }) =>
      conversationIdentity
        ? markThreadRead({
            threadId: input.threadId,
            sequence: input.sequence,
          })
        : Promise.reject(new Error(t("chat.identityUnavailable"))),
    onMutate: (input) => {
      const previous = queryClient.getQueryData<ThreadListCache>(["threads"]);
      const previousItem = previous?.items.find(
        (item) => item.thread.id === input.threadId,
      );
      void queryClient.cancelQueries({ queryKey: ["threads"] });
      queryClient.setQueryData<ThreadListCache>(["threads"], (cached) =>
        markCachedThreadRead(cached, input.threadId),
      );
      return {
        previousUnread: previousItem?.unreadCount ?? 0,
        previousMentions: previousItem?.mentionCount ?? 0,
      };
    },
    onSuccess: (_result, input) => {
      setFailedReadKey((key) =>
        key === `${input.threadId}:${input.sequence}` ? undefined : key,
      );
    },
    onError: (_error, input, context) => {
      setFailedReadKey(`${input.threadId}:${input.sequence}`);
      queryClient.setQueryData<ThreadListCache>(["threads"], (cached) => {
        if (!cached) return cached;
        return {
          ...cached,
          items: cached.items.map((item) =>
            item.thread.id === input.threadId
              ? {
                  ...item,
                  unreadCount: Math.max(
                    item.unreadCount ?? 0,
                    context?.previousUnread ?? 0,
                  ),
                  mentionCount: Math.max(
                    item.mentionCount ?? 0,
                    context?.previousMentions ?? 0,
                  ),
                }
              : item,
          ),
        };
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["threads"] }),
  });
  const mergeMessagePage = (
    threadId: string,
    page: { items: ThreadMessage[]; hasMore: boolean },
  ) => {
    if (!page.hasMore) {
      setHistoryExhausted((currentHistory) => {
        const next = new Set(currentHistory);
        next.add(threadId);
        return next;
      });
    }
    queryClient.setQueryData<{ items: ThreadPayload[] }>(
      ["threads"],
      (cached) => {
        if (!cached) return cached;
        return {
          ...cached,
          items: cached.items.map((item) => {
            if (item.thread.id !== threadId) return item;
            const messages = new Map(
              [...page.items, ...item.messages].map((message) => [
                message.sequence,
                message,
              ]),
            );
            return {
              ...item,
              historyExpanded: true,
              messages: [...messages.values()].sort(
                (left, right) => left.sequence - right.sequence,
              ),
            };
          }),
        };
      },
    );
  };
  const loadOlder = useMutation({
    mutationFn: (input: { threadId: string; beforeSequence: number }) =>
      getThreadMessages(input.threadId, {
        beforeSequence: input.beforeSequence,
        limit: 100,
      }),
    onSuccess: (page, input) => mergeMessagePage(input.threadId, page),
  });
  const loadAround = useMutation({
    mutationFn: (input: { threadId: string; aroundSequence: number }) =>
      getThreadMessages(input.threadId, {
        aroundSequence: input.aroundSequence,
        limit: 100,
      }),
    onSuccess: (page, input) => mergeMessagePage(input.threadId, page),
  });
  const reaction = useMutation({
    mutationFn: setThreadMessageReaction,
    onSuccess: (updated) => {
      queryClient.setQueryData<ThreadListCache>(["threads"], (cached) =>
        replaceCachedThreadMessage(cached, updated),
      );
      setReactionPickerMessageId(undefined);
    },
    onError: (error) => {
      notifications.error(
        error instanceof Error ? error.message : t("chat.reactionFailed"),
        { title: t("chat.reactionFailed") },
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });
  const edit = useMutation({
    mutationFn: editThreadMessage,
    onSuccess: (updated) => {
      queryClient.setQueryData<ThreadListCache>(["threads"], (cached) =>
        replaceCachedThreadMessage(cached, updated),
      );
      setEditingMessageId(undefined);
    },
    onError: (error) => {
      notifications.error(
        error instanceof Error ? error.message : t("chat.editFailed"),
        { title: t("chat.editFailed") },
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });
  const remove = useMutation({
    mutationFn: deleteThreadMessage,
    onSuccess: (_result, input) => {
      queryClient.setQueryData<ThreadListCache>(["threads"], (cached) => {
        if (!cached) return cached;
        const current = cached.items
          .find((item) => item.thread.id === input.threadId)
          ?.messages.find((message) => message.id === input.messageId);
        if (!current) return cached;
        const {
          attachments: _attachments,
          reactions: _reactions,
          encryptedBody: _encryptedBody,
          mentionedPrincipalIds: _mentions,
          ...rest
        } = current;
        return replaceCachedThreadMessage(cached, {
          ...rest,
          body: "",
          deletedAt: new Date().toISOString(),
          revision: (current.revision ?? 1) + 1,
        });
      });
      setDeletingMessage(undefined);
    },
    onError: (error) => {
      notifications.error(
        error instanceof Error ? error.message : t("chat.deleteFailed"),
        { title: t("chat.deleteFailed") },
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });
  // Opening a thread is what marks it read; nothing else moves the marker.
  const currentUnread = current?.unreadCount ?? 0;
  const currentHeadSequence = current?.thread.sequence ?? 0;
  const currentLastSequence = current?.messages.at(-1)?.sequence ?? 0;
  const currentLastRevision = current?.messages.at(-1)?.revision ?? 1;
  useEffect(() => {
    if (
      !current ||
      currentIsPilot ||
      currentIsPilotStandIn ||
      currentUnread === 0 ||
      !conversationIdentity?.currentPrincipalId ||
      failedReadKey === `${current.thread.id}:${currentHeadSequence}`
    ) {
      return;
    }
    markRead.mutate({
      threadId: current.thread.id,
      sequence: currentHeadSequence,
    });
  }, [current?.thread.id, currentHeadSequence, currentUnread, failedReadKey]);

  useEffect(() => {
    if (focusMessageId) return;
    const node = messagesEndRef.current;
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({
        block: "end",
        behavior: currentLastRevision > 1 ? "auto" : "smooth",
      });
    }
  }, [
    current?.thread.id,
    currentLastRevision,
    currentLastSequence,
    focusMessageId,
  ]);

  useEffect(() => {
    if (!current || !focusMessageId) return;
    setHighlightedMessageId(focusMessageId);
    if (current.messages.some((message) => message.id === focusMessageId)) {
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(`[data-message-id="${focusMessageId}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      );
      return;
    }
    if (!focusSequence) return;
    const key = `${current.thread.id}:${focusMessageId}:${focusSequence}`;
    if (loadedFocusRef.current === key) return;
    loadedFocusRef.current = key;
    loadAround.mutate({
      threadId: current.thread.id,
      aroundSequence: focusSequence,
    });
  }, [
    current?.thread.id,
    current?.messages.length,
    focusMessageId,
    focusSequence,
  ]);

  function toggleMessageReaction(message: ThreadMessage, emoji: string) {
    if (
      !currentSenderId ||
      currentIsPilot ||
      currentIsPilotStandIn ||
      reaction.isPending
    ) {
      return;
    }
    const reacted = !message.reactions?.some(
      (candidate) =>
        candidate.emoji === emoji &&
        candidate.principalIds.includes(currentSenderId),
    );
    reaction.mutate({
      threadId: message.threadId,
      messageId: message.id,
      emoji,
      reacted,
    });
  }

  function toggleReactionPicker(messageId: string) {
    setReactionPickerMessageId((current) =>
      current === messageId ? undefined : messageId,
    );
  }

  function navigateToMessage(messageId: string) {
    document
      .querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function toggleExpanded(messageId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  function onThreadSelected(threadId: string) {
    setFailedReadKey((key) =>
      key?.startsWith(`${threadId}:`) ? undefined : key,
    );
  }

  return {
    messagesEndRef,
    failedReadKey,
    reactionPickerMessageId,
    setReactionPickerMessageId,
    editingMessageId,
    setEditingMessageId,
    deletingMessage,
    setDeletingMessage,
    edit,
    remove,
    expanded,
    historyExhausted,
    highlightedMessageId,
    setHighlightedMessageId,
    markRead,
    loadOlder,
    loadAround,
    reaction,
    toggleMessageReaction,
    toggleReactionPicker,
    navigateToMessage,
    toggleExpanded,
    onThreadSelected,
  };
}
