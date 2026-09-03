import type { PrincipalId, ThreadMessage } from "@intero/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import {
  completeAttachmentUpload,
  createAttachmentUpload,
  sendThreadMessage,
  uploadAttachmentContent,
} from "../../../api.js";
import type { ThreadPayload } from "../../../api.js";
import { createClientUuid } from "../../../client-id.js";
import { useNotifications } from "../../../design/notifications.js";
import { useI18n } from "../../../i18n/index.js";
import {
  askPilotStandIn,
  enqueuePilotStandInReply,
  sendPilotDm,
} from "../../../pilot/api.js";
import {
  MAX_MESSAGE_IMAGE_BYTES,
  MAX_MESSAGE_IMAGES,
  MESSAGE_ATTACHMENT_TYPES,
  type ComposerImage,
} from "../constants.js";
import { insertEmojiAtCursor } from "../format.js";
import {
  requestConversationStandInReplies,
  sendCanonicalConversationMessage,
  sha256Hex,
  type MentionedStandIn,
} from "../helpers.js";
import {
  applyConversationMention,
  conversationMentionQuery,
  extractConversationMentionPrincipalIds,
  filterConversationMentionCandidates,
  standInsAddressedByMessage,
  type ConversationMentionCandidate,
} from "../mentions.js";

export function useComposer({
  current,
  currentSenderId,
  currentIsPilot,
  currentIsPilotStandIn,
  canAttachImages,
  conversationProjectId,
  activeStandInOwnerId,
  mentionCandidates,
  selectStandIn,
  initialThreadId,
}: {
  current: ThreadPayload | undefined;
  currentSenderId: string | undefined;
  currentIsPilot: boolean;
  currentIsPilotStandIn: boolean;
  canAttachImages: boolean;
  conversationProjectId?: string | undefined;
  activeStandInOwnerId: PrincipalId | undefined;
  mentionCandidates: ConversationMentionCandidate[];
  selectStandIn(ownerId: PrincipalId): void;
  initialThreadId?: string | undefined;
}) {
  const { t } = useI18n();
  const notifications = useNotifications();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerMirrorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Set<string>());
  const [markdownPreview, setMarkdownPreview] = useState(false);
  const [composerImages, setComposerImages] = useState<ComposerImage[]>([]);
  const reservedImageSlotsRef = useRef(0);
  const composerThreadIdRef = useRef<string | undefined>(initialThreadId);
  const retryableSendRef = useRef<
    { key: string; clientMessageId: string } | undefined
  >(undefined);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [replyingToMessageId, setReplyingToMessageId] = useState<
    string | undefined
  >();
  const [mentionCursor, setMentionCursor] = useState(0);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const mentionOptionRefs = useRef(new Map<string, HTMLButtonElement>());
  const pickedMentionIdsRef = useRef<string[]>([]);

  const activeMention = conversationMentionQuery(draft, mentionCursor);
  const visibleMentionCandidates = mentionPickerOpen
    ? filterConversationMentionCandidates(
        mentionCandidates,
        activeMention?.query ?? "",
      )
    : [];
  const activeMentionCandidate =
    visibleMentionCandidates[activeMentionIndex] ?? visibleMentionCandidates[0];
  const activeMentionCandidateId = activeMentionCandidate?.principalId;
  const replyingToMessage = current?.messages.find(
    (message) => message.id === replyingToMessageId,
  );

  useEffect(() => {
    if (!mentionPickerOpen || !activeMentionCandidateId) return;
    mentionOptionRefs.current
      .get(activeMentionCandidateId)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeMentionCandidateId, mentionPickerOpen]);

  useEffect(() => {
    setMentionPickerOpen(false);
    setEmojiPickerOpen(false);
    setReplyingToMessageId(undefined);
  }, [current?.thread.id]);

  useEffect(() => {
    if (
      composerThreadIdRef.current &&
      composerThreadIdRef.current !== current?.thread.id
    ) {
      setComposerImages((images) => {
        for (const image of images) {
          URL.revokeObjectURL(image.previewUrl);
          previewUrlsRef.current.delete(image.previewUrl);
        }
        return [];
      });
      reservedImageSlotsRef.current = 0;
      setMarkdownPreview(false);
    }
    composerThreadIdRef.current = current?.thread.id;
  }, [current?.thread.id]);

  useEffect(
    () => () => {
      for (const previewUrl of previewUrlsRef.current) {
        URL.revokeObjectURL(previewUrl);
      }
      previewUrlsRef.current.clear();
    },
    [],
  );

  const standInReplies = useMutation({
    mutationFn: (input: {
      threadId: string;
      messageId: string;
      senderId: string;
      mentionedStandIns: MentionedStandIn[];
    }) =>
      requestConversationStandInReplies(input, {
        enqueueReply: enqueuePilotStandInReply,
      }),
    onError: (error) => {
      notifications.error(
        error instanceof Error ? error.message : t("chat.standInReplyFailed"),
        { title: t("chat.standInReplyFailed") },
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  const send = useMutation({
    mutationFn: async (input: {
      threadId: string;
      senderId: string;
      body: string;
      mode: "canonical" | "pilot-dm" | "pilot-stand-in";
      projectId?: string;
      standInOwnerId?: PrincipalId;
      mentionedStandIns?: MentionedStandIn[];
      clientMessageId: string;
      mentionedPrincipalIds: string[];
      attachmentIds: string[];
      replyToMessageId?: string;
    }) => {
      if (input.mode === "pilot-dm") {
        await sendPilotDm(
          input.senderId as PrincipalId,
          input.threadId,
          input.body,
          input.clientMessageId,
        );
        return { ...input, messageId: undefined };
      }
      if (input.mode === "pilot-stand-in") {
        if (!input.standInOwnerId) {
          throw new Error("Choose a personal Stand-in.");
        }
        if (!input.projectId) {
          throw new Error(
            "The legacy project-backed Stand-in conversation is no longer available.",
          );
        }
        await askPilotStandIn(
          input.senderId as PrincipalId,
          input.projectId,
          input.standInOwnerId,
          input.body,
          input.clientMessageId,
        );
        return { ...input, messageId: undefined };
      }
      const message = await sendCanonicalConversationMessage(input, {
        sendMessage: sendThreadMessage,
      });
      return { ...input, messageId: message.id };
    },
    onSuccess: async (input) => {
      retryableSendRef.current = undefined;
      pickedMentionIdsRef.current = [];
      setDraft("");
      setReplyingToMessageId(undefined);
      setMarkdownPreview(false);
      setComposerImages((images) => {
        for (const image of images) {
          URL.revokeObjectURL(image.previewUrl);
          previewUrlsRef.current.delete(image.previewUrl);
        }
        return [];
      });
      reservedImageSlotsRef.current = 0;
      if (
        input.mode === "canonical" &&
        input.messageId &&
        (input.mentionedStandIns?.length ?? 0) > 0
      ) {
        standInReplies.mutate({
          threadId: input.threadId,
          messageId: input.messageId,
          senderId: input.senderId,
          mentionedStandIns: input.mentionedStandIns ?? [],
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["threads"] }),
        queryClient.invalidateQueries({ queryKey: ["pilot", "dms"] }),
        queryClient.invalidateQueries({
          queryKey: ["pilot", "stand_in"],
        }),
      ]);
    },
    onError: (error) => {
      notifications.error(
        error instanceof Error ? error.message : t("chat.sendFailed"),
        { title: t("chat.sendFailed") },
      );
    },
  });
  async function addComposerImages(files: File[]) {
    if (!canAttachImages || !current || !currentSenderId) return;
    for (const file of files) {
      if (reservedImageSlotsRef.current >= MAX_MESSAGE_IMAGES) break;
      if (!MESSAGE_ATTACHMENT_TYPES.has(file.type)) {
        notifications.warning(t("chat.imageTypeUnsupported"));
        continue;
      }
      if (file.size > MAX_MESSAGE_IMAGE_BYTES) {
        notifications.warning(t("chat.imageTooLarge"));
        continue;
      }
      reservedImageSlotsRef.current += 1;
      const id = createClientUuid();
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      const image: ComposerImage = {
        id,
        fileName: file.name || "image",
        contentType: file.type,
        byteSize: file.size,
        previewUrl,
        status: "uploading",
      };
      setComposerImages((currentImages) => [...currentImages, image]);
      try {
        const checksumSha256 = await sha256Hex(file);
        const upload = await createAttachmentUpload({
          id,
          threadId: current.thread.id,
          ownerId: currentSenderId,
          fileName: image.fileName,
          contentType: file.type,
          byteSize: file.size,
          checksumSha256,
          encryptionMode: "server_envelope",
        });
        await uploadAttachmentContent({
          uploadUrl: upload.uploadUrl,
          contentType: file.type,
          checksumSha256,
          requiredHeaders: upload.requiredHeaders,
          body: file,
        });
        const completed = await completeAttachmentUpload(id);
        if (completed.state !== "available") {
          throw new Error("attachment_scan_failed");
        }
        setComposerImages((currentImages) =>
          currentImages.map((candidate) =>
            candidate.id === id
              ? { ...candidate, status: "available" }
              : candidate,
          ),
        );
      } catch {
        setComposerImages((currentImages) =>
          currentImages.map((candidate) =>
            candidate.id === id
              ? { ...candidate, status: "failed" }
              : candidate,
          ),
        );
      }
    }
  }

  function removeComposerImage(id: string) {
    if (composerImages.some((image) => image.id === id)) {
      reservedImageSlotsRef.current = Math.max(
        0,
        reservedImageSlotsRef.current - 1,
      );
    }
    setComposerImages((images) => {
      const removed = images.find((image) => image.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
        previewUrlsRef.current.delete(removed.previewUrl);
      }
      return images.filter((image) => image.id !== id);
    });
  }

  function submit() {
    const availableImages = composerImages.filter(
      (image) => image.status === "available",
    );
    if (
      !current ||
      !currentSenderId ||
      (!draft.trim() && availableImages.length === 0) ||
      composerImages.some((image) => image.status !== "available") ||
      current.thread.accessMode === "human_only_e2ee" ||
      send.isPending
    ) {
      return;
    }
    setMentionPickerOpen(false);
    setEmojiPickerOpen(false);
    const body = draft.trim();
    const mode = currentIsPilot
      ? "pilot-dm"
      : currentIsPilotStandIn
        ? "pilot-stand-in"
        : "canonical";
    const sendKey = [
      current.thread.id,
      mode,
      activeStandInOwnerId ?? "",
      body,
      availableImages.map((image) => image.id).join(","),
      replyingToMessageId ?? "",
    ].join("\u0000");
    if (retryableSendRef.current?.key !== sendKey) {
      retryableSendRef.current = {
        key: sendKey,
        clientMessageId: createClientUuid(),
      };
    }
    const addressedStandIns = standInsAddressedByMessage(
      body,
      mentionCandidates,
      current.thread.kind,
    );
    send.mutate({
      threadId: current.thread.id,
      senderId: currentSenderId,
      body,
      ...(conversationProjectId ? { projectId: conversationProjectId } : {}),
      mentionedStandIns: addressedStandIns,
      clientMessageId: retryableSendRef.current.clientMessageId,
      mentionedPrincipalIds: [
        ...new Set([
          ...extractConversationMentionPrincipalIds(
            body,
            mentionCandidates,
            currentSenderId,
          ),
          ...pickedMentionIdsRef.current.filter(
            (principalId) => principalId !== currentSenderId,
          ),
          ...addressedStandIns.map((standIn) => standIn.principalId),
        ]),
      ],
      attachmentIds: availableImages.map((image) => image.id),
      ...(mode === "canonical" && replyingToMessageId
        ? { replyToMessageId: replyingToMessageId }
        : {}),
      ...(currentIsPilotStandIn && activeStandInOwnerId
        ? { standInOwnerId: activeStandInOwnerId }
        : {}),
      mode,
    });
  }

  function selectMention(candidate: ConversationMentionCandidate) {
    const result = applyConversationMention(
      draft,
      mentionCursor,
      candidate,
      activeMention,
    );
    setDraft(result.draft);
    setMentionCursor(result.cursor);
    setMentionPickerOpen(false);
    pickedMentionIdsRef.current = [
      ...new Set([...pickedMentionIdsRef.current, candidate.principalId]),
    ];
    if (currentIsPilotStandIn && candidate.standInOwnerId) {
      selectStandIn(candidate.standInOwnerId);
    }
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(result.cursor, result.cursor);
    });
  }

  function selectEmoji(emoji: string) {
    const result = insertEmojiAtCursor(draft, mentionCursor, emoji);
    setDraft(result.draft);
    setMentionCursor(result.cursor);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(result.cursor, result.cursor);
    });
  }

  function beginReply(message: ThreadMessage) {
    if (
      currentIsPilot ||
      currentIsPilotStandIn ||
      current?.thread.accessMode === "human_only_e2ee" ||
      message.kind !== "message"
    ) {
      return;
    }
    setMentionPickerOpen(false);
    setEmojiPickerOpen(false);
    setReplyingToMessageId(message.id);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  return {
    draft,
    setDraft,
    composerRef,
    composerMirrorRef,
    imageInputRef,
    markdownPreview,
    setMarkdownPreview,
    composerImages,
    mentionPickerOpen,
    setMentionPickerOpen,
    emojiPickerOpen,
    setEmojiPickerOpen,
    replyingToMessageId,
    setReplyingToMessageId,
    mentionCursor,
    setMentionCursor,
    activeMentionIndex,
    setActiveMentionIndex,
    mentionOptionRefs,
    visibleMentionCandidates,
    activeMentionCandidate,
    activeMention,
    replyingToMessage,
    send,
    addComposerImages,
    removeComposerImage,
    submit,
    selectMention,
    selectEmoji,
    beginReply,
  };
}
