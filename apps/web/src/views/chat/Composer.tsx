import {
  ArrowBendUpLeftIcon,
  ArrowUpIcon,
  CircleNotchIcon,
  EyeIcon,
  LockSimpleIcon,
  PaperclipIcon,
  PencilSimpleIcon,
  SmileyIcon,
  XIcon,
} from "@phosphor-icons/react";
import { ChatMarkdown } from "../../components/ChatMarkdown.js";
import { FluentEmojiText } from "../../components/FluentEmoji.js";
import { cn } from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";
import { ComposerMentionPicker } from "./ComposerMentionPicker.js";
import type { ComposerProps } from "./composer-props.js";
import { MAX_MESSAGE_IMAGES, MENTION_LISTBOX_ID } from "./constants.js";
import { EmojiPicker } from "./EmojiPicker.js";
import { replyMessageSummary, shouldSubmitComposerKey } from "./format.js";
import { MentionText } from "./MessageItem.js";
import {
  conversationMentionQuery,
  mentionOptionId,
  moveMentionCandidateIndex,
} from "./mentions.js";

export function Composer({
  currentAccessMode,
  currentSenderId,
  currentIsPilot,
  currentIsPilotStandIn,
  legacyStandInRecord,
  canAttachImages,
  mentionPickerOpen,
  emojiPickerOpen,
  markdownPreview,
  draft,
  visibleMentionCandidates,
  activeMentionCandidate,
  mentionOptionRefs,
  composerRef,
  composerMirrorRef,
  imageInputRef,
  composerImages,
  replyingToMessageId,
  replyingToMessage,
  principalNames,
  mentionCandidates,
  sendPending,
  onAddImages,
  onToggleMention,
  onToggleEmoji,
  onCloseEmoji,
  onSelectEmoji,
  onImageInputChange,
  onPickImages,
  onToggleMarkdown,
  onSelectMention,
  onHoverMention,
  onCancelReply,
  onRemoveImage,
  onDraftChange,
  onTyping,
  onSetMentionCursor,
  onResetMentionIndex,
  onSetMentionPickerOpen,
  onCloseMention,
  onMoveMentionIndex,
  onSubmit,
}: ComposerProps) {
  const { t } = useI18n();
  return (
    <div className="shrink-0 p-[0_26px_22px]">
      <div className="mx-auto max-w-[800px]">
        <div
          className="relative rounded-card border border-line2 bg-panel2 p-[11px_13px]"
          onDragOver={(event) => {
            if (canAttachImages) event.preventDefault();
          }}
          onDrop={(event) => {
            if (!canAttachImages) return;
            event.preventDefault();
            void onAddImages([...event.dataTransfer.files]);
          }}
        >
          <div className="mb-[9px] flex items-center gap-[7px]">
            <button
              type="button"
              aria-label={t("chat.mention")}
              aria-expanded={mentionPickerOpen}
              data-testid="communications-mention-trigger"
              onClick={() => {
                const cursor =
                  composerRef.current?.selectionStart ?? draft.length;
                onSetMentionCursor(cursor);
                onResetMentionIndex();
                onCloseEmoji();
                onToggleMention();
              }}
              className={cn(
                "grid h-6 w-6 cursor-pointer place-items-center rounded-[8px] border text-[13px] font-[650]",
                mentionPickerOpen
                  ? "border-accent-strong bg-accent-soft text-accent-strong"
                  : "border-line2 bg-transparent text-ink-muted hover:border-accent-strong hover:text-accent-strong",
              )}
            >
              @
            </button>
            <div className="relative" data-emoji-picker-container="true">
              <button
                type="button"
                aria-label={t("chat.emoji")}
                title={t("chat.emoji")}
                aria-haspopup="dialog"
                aria-expanded={emojiPickerOpen}
                data-testid="communications-emoji-trigger"
                disabled={
                  !currentSenderId || currentAccessMode === "human_only_e2ee"
                }
                onClick={() => {
                  const cursor =
                    composerRef.current?.selectionStart ?? draft.length;
                  onSetMentionCursor(cursor);
                  onCloseMention();
                  onToggleEmoji();
                }}
                className={cn(
                  "grid h-6 w-6 cursor-pointer place-items-center rounded-[8px] border disabled:cursor-not-allowed disabled:opacity-35",
                  emojiPickerOpen
                    ? "border-accent-strong bg-accent-soft text-accent-strong"
                    : "border-line2 bg-transparent text-ink-muted hover:border-accent-strong hover:text-accent-strong",
                )}
              >
                <SmileyIcon size={13} />
              </button>
              {emojiPickerOpen ? (
                <EmojiPicker onClose={onCloseEmoji} onSelect={onSelectEmoji} />
              ) : null}
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
              multiple
              className="hidden"
              onChange={onImageInputChange}
            />
            <button
              type="button"
              aria-label={t("chat.attachImage")}
              title={t("chat.attachImage")}
              disabled={
                !canAttachImages || composerImages.length >= MAX_MESSAGE_IMAGES
              }
              onClick={onPickImages}
              className="grid h-6 w-6 cursor-pointer place-items-center rounded-[8px] border border-line2 bg-transparent text-ink-muted hover:border-accent-strong hover:text-accent-strong disabled:cursor-not-allowed disabled:opacity-35"
            >
              <PaperclipIcon size={13} />
            </button>
            <button
              type="button"
              aria-label={
                markdownPreview
                  ? t("chat.markdownWrite")
                  : t("chat.markdownPreview")
              }
              title={
                markdownPreview
                  ? t("chat.markdownWrite")
                  : t("chat.markdownPreview")
              }
              disabled={!draft.trim()}
              onClick={() => onToggleMarkdown()}
              className={cn(
                "grid h-6 w-6 cursor-pointer place-items-center rounded-[8px] border disabled:cursor-not-allowed disabled:opacity-35",
                markdownPreview
                  ? "border-accent-strong bg-accent-soft text-accent-strong"
                  : "border-line2 bg-transparent text-ink-muted hover:border-accent-strong hover:text-accent-strong",
              )}
            >
              {markdownPreview ? (
                <PencilSimpleIcon size={13} />
              ) : (
                <EyeIcon size={13} />
              )}
            </button>
            <span className="ml-auto inline-flex items-center gap-[5px] text-[10px] text-faint">
              <LockSimpleIcon size={12} />
              {currentIsPilot
                ? "仅两位参与者可见 · 暂不支持附件"
                : currentIsPilotStandIn
                  ? "不读取私聊历史、私有 Work State 或原始数据"
                  : currentAccessMode === "human_only_e2ee"
                    ? t("chat.e2ee")
                    : t("chat.markdownHint")}
            </span>
          </div>
          <ComposerMentionPicker
            open={mentionPickerOpen}
            candidates={visibleMentionCandidates}
            activeCandidate={activeMentionCandidate}
            mentionOptionRefs={mentionOptionRefs}
            onSelect={onSelectMention}
            onHover={onHoverMention}
          />
          {replyingToMessageId ? (
            <div
              data-testid="communications-reply-preview"
              className="mb-2.5 flex items-center gap-2 rounded-[9px] border-l-2 border-accent-strong bg-raise px-3 py-2"
            >
              <ArrowBendUpLeftIcon
                size={14}
                className="shrink-0 text-accent-strong"
              />
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-[10.5px] font-[620] text-accent-strong">
                  {t("chat.replyingTo", {
                    name: replyingToMessage
                      ? (principalNames.get(replyingToMessage.senderId) ??
                        replyingToMessage.senderId.slice(0, 8))
                      : t("chat.replyUnavailable"),
                  })}
                </strong>
                <span className="block truncate text-[11px] text-ink-muted">
                  {replyMessageSummary(replyingToMessage, {
                    attachment: t("chat.replyAttachment"),
                    encrypted: t("chat.encryptedMessage"),
                    unavailable: t("chat.replyUnavailable"),
                    deleted: t("chat.messageDeleted"),
                  })}
                </span>
              </div>
              <button
                type="button"
                aria-label={t("chat.cancelReply")}
                title={t("chat.cancelReply")}
                onClick={onCancelReply}
                className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-ink-muted hover:bg-panel hover:text-ink"
              >
                <XIcon size={12} />
              </button>
            </div>
          ) : null}
          {composerImages.length > 0 ? (
            <div className="mb-2.5 flex gap-2 overflow-x-auto pb-1">
              {composerImages.map((image) => (
                <div
                  key={image.id}
                  className="relative h-[72px] w-[88px] shrink-0 overflow-hidden rounded-[9px] bg-raise"
                >
                  <img
                    src={image.previewUrl}
                    alt={image.fileName}
                    className={cn(
                      "h-full w-full object-cover",
                      image.status === "available" ? "" : "opacity-45",
                    )}
                  />
                  {image.status === "uploading" ? (
                    <span
                      className="absolute inset-0 grid place-items-center"
                      title={t("chat.imageUploading")}
                    >
                      <CircleNotchIcon
                        size={17}
                        className="animate-spin text-on-tint"
                      />
                    </span>
                  ) : null}
                  {image.status === "failed" ? (
                    <span
                      className="absolute inset-x-1 bottom-1 rounded bg-danger/85 px-1 py-0.5 text-center text-[8px] text-white"
                      title={t("chat.imageUploadFailed")}
                    >
                      {t("chat.imageUploadFailed")}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    aria-label={t("chat.removeImage")}
                    onClick={() => onRemoveImage(image.id)}
                    className="absolute right-1 top-1 grid h-5 w-5 cursor-pointer place-items-center rounded-full border-0 bg-black/65 text-white"
                  >
                    <XIcon size={10} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-[1fr_34px] items-end gap-[9px]">
            {markdownPreview ? (
              <div
                data-testid="communications-markdown-preview"
                className="min-h-[42px] max-h-[180px] overflow-auto rounded-[9px] bg-raise px-3 py-2"
              >
                <ChatMarkdown
                  markdown={draft}
                  renderText={(text) => (
                    <MentionText body={text} candidates={mentionCandidates} />
                  )}
                />
              </div>
            ) : (
              <div className="relative min-h-[34px] max-h-[110px]">
                <div
                  ref={composerMirrorRef}
                  aria-hidden="true"
                  data-testid="communications-composer-fluent-layer"
                  className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap px-1 py-2 text-[12.5px] leading-[1.55] text-ink [overflow-wrap:anywhere]"
                >
                  <FluentEmojiText text={draft} renderText={undefined} />
                </div>
                <textarea
                  ref={composerRef}
                  data-testid="communications-composer"
                  rows={1}
                  value={draft}
                  onChange={(event) => {
                    const cursor =
                      event.currentTarget.selectionStart ??
                      event.currentTarget.value.length;
                    onDraftChange(event.currentTarget.value);
                    if (event.currentTarget.value.trim()) onTyping?.();
                    onSetMentionCursor(cursor);
                    onResetMentionIndex();
                    onCloseEmoji();
                    onSetMentionPickerOpen(
                      Boolean(
                        conversationMentionQuery(
                          event.currentTarget.value,
                          cursor,
                        ),
                      ),
                    );
                  }}
                  onScroll={(event) => {
                    if (!composerMirrorRef.current) return;
                    composerMirrorRef.current.scrollTop =
                      event.currentTarget.scrollTop;
                    composerMirrorRef.current.scrollLeft =
                      event.currentTarget.scrollLeft;
                  }}
                  onSelect={(event) => {
                    onSetMentionCursor(
                      event.currentTarget.selectionStart ?? draft.length,
                    );
                  }}
                  onPaste={(event) => {
                    const files = [...event.clipboardData.files].filter(
                      (file) => file.type.startsWith("image/"),
                    );
                    if (files.length > 0 && canAttachImages) {
                      event.preventDefault();
                      void onAddImages(files);
                    }
                  }}
                  onKeyDown={(event) => {
                    const isComposing =
                      event.nativeEvent.isComposing ||
                      event.nativeEvent.keyCode === 229;
                    if (
                      mentionPickerOpen &&
                      visibleMentionCandidates.length > 0 &&
                      !isComposing &&
                      (event.key === "ArrowDown" || event.key === "ArrowUp")
                    ) {
                      event.preventDefault();
                      onMoveMentionIndex((currentIndex) =>
                        moveMentionCandidateIndex({
                          currentIndex,
                          direction:
                            event.key === "ArrowDown" ? "next" : "previous",
                          candidateCount: visibleMentionCandidates.length,
                        }),
                      );
                      return;
                    }
                    if (
                      event.key === "Escape" &&
                      (mentionPickerOpen || emojiPickerOpen)
                    ) {
                      event.preventDefault();
                      onCloseMention();
                      onCloseEmoji();
                      return;
                    }
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !isComposing &&
                      mentionPickerOpen &&
                      activeMentionCandidate
                    ) {
                      event.preventDefault();
                      onSelectMention(activeMentionCandidate);
                      return;
                    }
                    if (
                      shouldSubmitComposerKey({
                        key: event.key,
                        shiftKey: event.shiftKey,
                        isComposing,
                      })
                    ) {
                      event.preventDefault();
                      onSubmit();
                    }
                  }}
                  placeholder={t("chat.placeholder")}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={mentionPickerOpen}
                  aria-controls={
                    mentionPickerOpen ? MENTION_LISTBOX_ID : undefined
                  }
                  aria-activedescendant={
                    mentionPickerOpen && activeMentionCandidate
                      ? mentionOptionId(activeMentionCandidate.principalId)
                      : undefined
                  }
                  disabled={
                    !currentSenderId || currentAccessMode === "human_only_e2ee"
                  }
                  className="relative z-10 min-h-[34px] max-h-[110px] w-full resize-none border-0 bg-transparent px-1 py-2 text-[12.5px] leading-[1.55] text-transparent caret-accent-strong outline-none selection:text-transparent placeholder:text-faint"
                />
              </div>
            )}
            <button
              type="button"
              disabled={
                (!draft.trim() &&
                  !composerImages.some(
                    (image) => image.status === "available",
                  )) ||
                composerImages.some((image) => image.status !== "available") ||
                !currentSenderId ||
                legacyStandInRecord ||
                currentAccessMode === "human_only_e2ee" ||
                sendPending
              }
              onClick={onSubmit}
              className="grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-[10px] border-0 bg-accent-strong text-on-accent disabled:opacity-55"
            >
              {sendPending ? (
                <CircleNotchIcon size={16} className="animate-spin" />
              ) : (
                <ArrowUpIcon size={16} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
