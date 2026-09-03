import {
  CheckCircleIcon,
  GitBranchIcon,
  HandTapIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import type {
  PilotStandInExchange,
  PrincipalId,
  ThreadMessage,
} from "@intero/domain";

import type { PrincipalSummary, ThreadPayload } from "../../api.js";
import { ChatMarkdown } from "../../components/ChatMarkdown.js";
import { cn } from "../../design/primitives.js";
import { initials, tintFor } from "../../design/utils.js";
import { useI18n } from "../../i18n/index.js";
import type { TranslationKey } from "../../i18n/locales/zh-CN.js";
import { CoordinationCard } from "./CoordinationCard.js";
import { isBubblelessEmojiMessage, shouldSubmitComposerKey } from "./format.js";
import { ownerNameFor, resolveStandInAvatarIdentity } from "./helpers.js";
import { MessageAttachments } from "./MessageAttachments.js";
import { MessageLinkPreviews } from "./MessageLinkPreviews.js";
import { MessageReactionBar } from "./MessageReactionBar.js";
import type { ConversationMentionCandidate } from "./mentions.js";
import { splitConversationMentions } from "./mentions.js";
import { QuotedMessagePreview } from "./QuotedMessagePreview.js";
import { StandInAnswerContent } from "./StandInAnswerContent.js";
import { StandInAvatar } from "./StandInAvatar.js";

export function MessageItem({
  message,
  highlighted = false,
  current,
  currentSenderId,
  currentIsPilot,
  currentIsPilotStandIn,
  currentIsCanonicalGroup,
  principalNames,
  principals,
  standInOwnerIds,
  mentionCandidates,
  expanded,
  reactionPickerMessageId,
  reactionPending,
  reactionPendingMessageId,
  pilotStandInExchanges,
  onToggleExpanded,
  onToggleReaction,
  onToggleReactionPicker,
  onCloseReactionPicker,
  onReply,
  onNavigateToMessage,
  onOpenProfile,
  onOpenCoordination,
  editing = false,
  editPending = false,
  onBeginEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  message: ThreadMessage;
  highlighted?: boolean;
  current: ThreadPayload;
  currentSenderId: PrincipalId | undefined;
  currentIsPilot: boolean;
  currentIsPilotStandIn: boolean;
  currentIsCanonicalGroup: boolean;
  principalNames: Map<string, string>;
  principals: PrincipalSummary[];
  standInOwnerIds: Map<PrincipalId, PrincipalId>;
  mentionCandidates: ConversationMentionCandidate[];
  expanded: Set<string>;
  reactionPickerMessageId: string | undefined;
  reactionPending: boolean;
  reactionPendingMessageId: string | undefined;
  pilotStandInExchanges: PilotStandInExchange[];
  onToggleExpanded(messageId: string): void;
  onToggleReaction(message: ThreadMessage, emoji: string): void;
  onToggleReactionPicker(messageId: string): void;
  onCloseReactionPicker(): void;
  onReply(message: ThreadMessage): void;
  onNavigateToMessage(messageId: string): void;
  onOpenProfile(principalId: PrincipalId): void;
  onOpenCoordination?: ((threadId: string) => void) | undefined;
  editing?: boolean;
  editPending?: boolean;
  onBeginEdit?(message: ThreadMessage): void;
  onCancelEdit?(): void;
  onSaveEdit?(message: ThreadMessage, body: string): void;
  onDelete?(message: ThreadMessage): void;
}) {
  const { formatDate, formatRelative, formatTime, t } = useI18n();
  const thread = current.thread;
  const isOwn = message.senderId === currentSenderId;
  const canReply =
    Boolean(currentSenderId) &&
    !currentIsPilot &&
    !currentIsPilotStandIn &&
    thread.accessMode !== "human_only_e2ee" &&
    !message.deletedAt &&
    !thread.archivedAt;
  const canMutateOwnMessage =
    Boolean(onBeginEdit && onDelete) &&
    isOwn &&
    message.kind === "message" &&
    !message.deletedAt &&
    !thread.concludedAt &&
    !thread.archivedAt &&
    !currentIsPilot &&
    !currentIsPilotStandIn &&
    message.serverReadable &&
    !thread.standInIds.includes(message.senderId);

  if (message.kind === "system_access_change") {
    return (
      <p className="rounded-inset bg-raise p-[12px_16px] text-center text-[11.5px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
        {message.body || t("chat.accessChanged")}
      </p>
    );
  }

  if (message.kind === "coordination_action") {
    const action = current.actions.find(
      (item) => item.envelope.operationId === message.operationId,
    );
    if (action?.envelope.action === "human_escalation") {
      return (
        <div className="rounded-card border border-danger-soft bg-danger-soft p-[18px_20px]">
          <div className="flex items-center gap-[9px]">
            <HandTapIcon size={17} className="text-danger" />
            <strong className="text-[12.5px] font-[620] text-danger">
              {t("chat.needsHuman")}
            </strong>
          </div>
          <p className="mt-2.5 text-[13px] leading-[1.7] text-ink [text-wrap:pretty]">
            {message.body}
          </p>
          <div className="mt-[14px] inline-flex items-center gap-2 rounded-[9px] bg-green-soft px-[13px] py-[9px] text-[12px] text-green">
            <CheckCircleIcon size={14} weight="fill" />
            {t("chat.resolved")}
          </div>
        </div>
      );
    }
    const name = action
      ? t(`coord.action.${action.envelope.action}` as TranslationKey)
      : t("coord.action.coordination_request");
    return (
      <div className="flex items-center gap-3 rounded-card border border-green-soft bg-green-soft p-[14px_17px]">
        <GitBranchIcon size={17} className="text-green" />
        <span className="grid min-w-0">
          <strong className="text-[12px] font-[620]">{name}</strong>
          <small className="mt-1 text-[11.5px] leading-[1.55] text-ink-muted">
            {message.body}
          </small>
        </span>
        <span className="ml-auto shrink-0 font-mono text-[9.5px] text-faint">
          seq {message.sequence}
        </span>
      </div>
    );
  }

  if (message.kind === "coordination_summary" && message.coordinationSummary) {
    return (
      <CoordinationCard
        message={message}
        principalNames={principalNames}
        onOpenCoordination={onOpenCoordination}
      />
    );
  }

  const isStandIn = thread.standInIds.includes(message.senderId);
  const senderName =
    principalNames.get(message.senderId) ?? message.senderId.slice(0, 8);

  if (isStandIn) {
    const avatarIdentity = resolveStandInAvatarIdentity({
      standInId: message.senderId,
      standInOwnerIds,
      principalNames,
      fallbackName: senderName,
    });
    const ownerName = standInOwnerIds.has(message.senderId)
      ? avatarIdentity.ownerName
      : ownerNameFor(thread, principalNames);
    const isOpen = expanded.has(message.id);
    const groundedExchange = currentIsPilotStandIn
      ? pilotStandInExchanges.find(
          (exchange) => exchange.answerMessageId === message.id,
        )
      : undefined;
    return (
      <div
        data-message-id={message.id}
        className={cn(
          "group/message grid grid-cols-[30px_minmax(0,1fr)] gap-3 rounded-[10px]",
          highlighted ? "ring-2 ring-accent-strong/70" : "",
        )}
      >
        <StandInAvatar
          ownerId={avatarIdentity.ownerId}
          ownerName={avatarIdentity.ownerName}
        />
        <div className="min-w-0 max-w-[620px]">
          <div className="rounded-card border border-line2 bg-panel2 p-[15px_17px]">
            <div className="mb-[9px] flex items-center gap-[9px]">
              <strong className="text-[12px] font-[620]">{senderName}</strong>
              <span className="rounded-pill bg-accent-soft px-[7px] py-0.5 text-[9.5px] font-[620] text-accent-strong">
                {t("chat.agentOf", { name: ownerName })}
              </span>
              <time className="ml-auto font-mono text-[9.5px] text-faint">
                {formatTime(message.createdAt)}
              </time>
            </div>
            {message.replyToMessageId ? (
              <QuotedMessagePreview
                message={current.messages.find(
                  (candidate) => candidate.id === message.replyToMessageId,
                )}
                principalNames={principalNames}
                onNavigate={onNavigateToMessage}
              />
            ) : null}
            {message.deletedAt ? (
              <p
                data-testid="message-deleted"
                className="text-[13px] italic text-ink-muted"
              >
                {t("chat.messageDeleted")}
              </p>
            ) : message.streamState === "pending" && !message.body ? (
              <div
                data-testid={`stand-in-stream-${message.id}`}
                className="flex items-center gap-2 py-1 text-[12px] text-ink-muted"
              >
                <span className="inline-flex gap-1" aria-hidden="true">
                  <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-strong" />
                  <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-strong [animation-delay:140ms]" />
                  <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-strong [animation-delay:280ms]" />
                </span>
                {t("chat.standInThinking")}
              </div>
            ) : message.serverReadable ? (
              <div className="relative">
                <ChatMarkdown
                  markdown={message.body}
                  enlargeEmojiOnly={(message.attachments?.length ?? 0) === 0}
                  renderText={(text) => (
                    <MentionText body={text} candidates={mentionCandidates} />
                  )}
                />
                {message.streamState === "streaming" ? (
                  <span
                    aria-hidden="true"
                    className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-accent-strong align-[-0.15em]"
                  />
                ) : null}
              </div>
            ) : (
              <p className="text-[13px] text-ink">
                {t("chat.encryptedMessage")}
              </p>
            )}
            {message.streamState === "failed" ? (
              <p className="mt-2 text-[11px] text-danger">
                {t("chat.standInStreamFailed")}
              </p>
            ) : null}
            {message.deletedAt ? null : (
              <>
                <MessageAttachments attachments={message.attachments ?? []} />
                <MessageLinkPreviews
                  message={message}
                  canHide={message.senderId === currentSenderId}
                />
              </>
            )}
            {groundedExchange?.structuredAnswer ? (
              <StandInAnswerContent
                answer={groundedExchange.structuredAnswer}
                testId={`pilot-stand-in-answer-${message.id}`}
              />
            ) : null}
            <button
              type="button"
              className="mt-[13px] flex w-full items-center gap-2 border-0 border-t border-line bg-transparent pt-[11px] text-[10.5px] text-green cursor-pointer"
              onClick={() => onToggleExpanded(message.id)}
            >
              <CheckCircleIcon size={13} weight="fill" />
              <span>
                {t("chat.durableSequence", {
                  sequence: message.sequence,
                })}{" "}
                ·{" "}
                {message.serverReadable
                  ? t("chat.agentReadable")
                  : t("chat.encrypted")}
              </span>
              <span className="ml-auto text-faint">
                {isOpen ? t("chat.collapseBasis") : t("chat.expandBasis")}
              </span>
            </button>
            {isOpen ? (
              <div className="mt-[11px] grid gap-2 rounded-[10px] bg-raise p-[12px_14px]">
                {groundedExchange?.sources.map((source) => (
                  <div
                    key={source.workStateId}
                    data-testid={`pilot-stand-in-source-${source.workStateId}`}
                    className="grid gap-1 text-[10.5px] leading-[1.55] text-ink-muted"
                  >
                    <strong className="font-[620] text-ink">
                      来源 · {source.title}
                    </strong>
                    <span>
                      {source.provenance.client} /{" "}
                      {source.provenance.connectionName} · 新鲜度{" "}
                      {formatRelative(source.freshnessAt)}
                    </span>
                    <span className="font-mono text-[9.5px] text-faint">
                      Work State {source.workStateId.slice(0, 8)} ·{" "}
                      {source.eventType}
                    </span>
                  </div>
                ))}
                <p className="font-mono text-[10px] leading-[1.6] text-faint">
                  seq {message.sequence} · {thread.accessMode}
                </p>
              </div>
            ) : null}
          </div>
          {message.deletedAt ? null : (
            <MessageReactionBar
              message={message}
              currentPrincipalId={currentSenderId}
              principalNames={principalNames}
              canReact={
                Boolean(currentSenderId) &&
                !currentIsPilot &&
                !currentIsPilotStandIn
              }
              canReply={canReply}
              pickerOpen={reactionPickerMessageId === message.id}
              pending={
                reactionPending && reactionPendingMessageId === message.id
              }
              align="left"
              onToggle={(emoji) => onToggleReaction(message, emoji)}
              onTogglePicker={() => onToggleReactionPicker(message.id)}
              onClosePicker={() => onCloseReactionPicker()}
              onReply={() => onReply(message)}
            />
          )}
        </div>
      </div>
    );
  }

  const bubblelessEmoji = isBubblelessEmojiMessage(message);
  const canOpenProfile =
    currentIsCanonicalGroup &&
    !isOwn &&
    principals.some(
      (principal) =>
        principal.id === message.senderId && principal.kind === "human",
    );
  const avatarFace = (
    <span
      className="grid h-[30px] w-[30px] place-items-center rounded-full text-[9.5px] font-[650] text-on-tint"
      style={{ background: tintFor(message.senderId) }}
    >
      {initials(senderName)}
    </span>
  );
  const avatar = canOpenProfile ? (
    <button
      type="button"
      data-testid={`conversation-profile-trigger-${message.senderId}`}
      aria-label={t("person.openProfile", { name: senderName })}
      title={t("person.openProfile", { name: senderName })}
      onClick={() => onOpenProfile(message.senderId as PrincipalId)}
      className="h-[30px] w-[30px] cursor-pointer rounded-full border-0 bg-transparent p-0 outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-accent-strong"
    >
      {avatarFace}
    </button>
  ) : (
    avatarFace
  );
  const content = (
    <div
      className={cn(
        "min-w-0",
        isOwn ? "flex flex-col items-end text-right" : undefined,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-[9px]",
          isOwn ? "justify-end" : undefined,
        )}
      >
        <strong className="text-[12px] font-[620]">{senderName}</strong>
        <time className="font-mono text-[9.5px] text-faint">
          {formatTime(message.createdAt)}
        </time>
        {message.editedAt && !message.deletedAt ? (
          <span
            data-testid="message-edited"
            title={`${formatDate(message.editedAt)} ${formatTime(message.editedAt)}`}
            className="font-mono text-[9.5px] text-faint"
          >
            {t("chat.edited")}
          </span>
        ) : null}
      </div>
      <div
        data-emoji-bubbleless={
          bubblelessEmoji && !message.deletedAt && !editing ? "true" : undefined
        }
        className={cn(
          "mt-[7px] w-fit max-w-[560px] text-left",
          bubblelessEmoji && !message.deletedAt && !editing
            ? "bg-transparent p-0"
            : cn(
                "rounded-card p-[12px_15px]",
                isOwn ? "bg-accent-soft" : "bg-bubble",
              ),
        )}
      >
        {message.replyToMessageId ? (
          <QuotedMessagePreview
            message={current.messages.find(
              (candidate) => candidate.id === message.replyToMessageId,
            )}
            principalNames={principalNames}
            onNavigate={onNavigateToMessage}
          />
        ) : null}
        {message.deletedAt ? (
          <p
            data-testid="message-deleted"
            className="text-[13px] italic text-ink-muted"
          >
            {t("chat.messageDeleted")}
          </p>
        ) : editing ? (
          <MessageEditForm
            body={message.body}
            pending={editPending}
            onCancel={() => onCancelEdit?.()}
            onSave={(body) => onSaveEdit?.(message, body)}
          />
        ) : message.serverReadable ? (
          <ChatMarkdown
            markdown={message.body}
            enlargeEmojiOnly={(message.attachments?.length ?? 0) === 0}
            renderText={(text) => (
              <MentionText body={text} candidates={mentionCandidates} />
            )}
          />
        ) : (
          <p className="text-[13px] leading-[1.7] text-ink">
            {t("chat.encryptedMessage")}
          </p>
        )}
        {message.deletedAt ? null : (
          <>
            <MessageAttachments attachments={message.attachments ?? []} />
            <MessageLinkPreviews message={message} canHide={isOwn} />
          </>
        )}
      </div>
      {message.deletedAt ? null : (
        <div
          className={cn(
            "flex items-center gap-1",
            isOwn ? "flex-row-reverse" : undefined,
          )}
        >
          <MessageReactionBar
            message={message}
            currentPrincipalId={currentSenderId}
            principalNames={principalNames}
            canReact={
              Boolean(currentSenderId) &&
              !currentIsPilot &&
              !currentIsPilotStandIn
            }
            canReply={canReply}
            pickerOpen={reactionPickerMessageId === message.id}
            pending={reactionPending && reactionPendingMessageId === message.id}
            align={isOwn ? "right" : "left"}
            onToggle={(emoji) => onToggleReaction(message, emoji)}
            onTogglePicker={() => onToggleReactionPicker(message.id)}
            onClosePicker={() => onCloseReactionPicker()}
            onReply={() => onReply(message)}
          />
          {canMutateOwnMessage && !editing ? (
            <MessageOwnActions
              onEdit={() => onBeginEdit?.(message)}
              onDelete={() => onDelete?.(message)}
            />
          ) : null}
        </div>
      )}
    </div>
  );
  return (
    <div
      className={cn(
        "group/message grid gap-3 rounded-[10px]",
        isOwn
          ? "grid-cols-[minmax(0,1fr)_30px]"
          : "grid-cols-[30px_minmax(0,1fr)]",
        highlighted ? "ring-2 ring-accent-strong/70" : "",
      )}
      data-message-side={isOwn ? "right" : "left"}
      data-message-id={message.id}
      data-highlighted={highlighted ? "true" : undefined}
      onTouchStart={
        canMutateOwnMessage
          ? (event) => pinActionsOnLongPress(event.currentTarget)
          : undefined
      }
      onTouchEnd={() => cancelLongPress()}
      onTouchCancel={() => cancelLongPress()}
      data-testid={
        currentIsPilot
          ? `pilot-dm-message-${message.sequence}`
          : `conversation-message-${message.id}`
      }
    >
      {isOwn ? (
        <>
          {content}
          {avatar}
        </>
      ) : (
        <>
          {avatar}
          {content}
        </>
      )}
    </div>
  );
}

function MessageOwnActions({
  onEdit,
  onDelete,
}: {
  onEdit(): void;
  onDelete(): void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 group-focus-within/message:opacity-100 group-data-[actions=open]/message:opacity-100">
      <button
        type="button"
        data-testid="message-edit"
        aria-label={t("chat.edit")}
        title={t("chat.edit")}
        onClick={onEdit}
        className="grid h-6 w-6 cursor-pointer place-items-center rounded-full border border-line2 bg-transparent text-ink-muted hover:border-accent-strong hover:text-accent-strong"
      >
        <PencilSimpleIcon size={13} />
      </button>
      <button
        type="button"
        data-testid="message-delete"
        aria-label={t("chat.delete")}
        title={t("chat.delete")}
        onClick={onDelete}
        className="grid h-6 w-6 cursor-pointer place-items-center rounded-full border border-line2 bg-transparent text-ink-muted hover:border-danger hover:text-danger"
      >
        <TrashIcon size={13} />
      </button>
    </div>
  );
}

function MessageEditForm({
  body,
  pending,
  onCancel,
  onSave,
}: {
  body: string;
  pending: boolean;
  onCancel(): void;
  onSave(body: string): void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(body);
  return (
    <textarea
      data-testid="message-edit-input"
      autoFocus
      rows={3}
      disabled={pending}
      value={draft}
      aria-label={t("chat.edit")}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
          return;
        }
        if (
          shouldSubmitComposerKey({
            key: event.key,
            shiftKey: event.shiftKey,
            isComposing: event.nativeEvent.isComposing,
          })
        ) {
          event.preventDefault();
          const next = draft.trim();
          if (next) onSave(next);
        }
      }}
      className="w-full min-w-[220px] resize-y rounded-[8px] border border-line2 bg-panel px-2.5 py-2 text-[13px] leading-[1.6] text-ink outline-none"
    />
  );
}

let longPressTimer: ReturnType<typeof setTimeout> | undefined;

function pinActionsOnLongPress(target: HTMLElement) {
  cancelLongPress();
  longPressTimer = setTimeout(() => {
    target.dataset.actions = "open";
  }, 500);
}

function cancelLongPress() {
  if (longPressTimer) clearTimeout(longPressTimer);
  longPressTimer = undefined;
}

export function MentionText({
  body,
  candidates,
}: {
  body: string;
  candidates: ConversationMentionCandidate[];
}) {
  return splitConversationMentions(body, candidates).map((part, index) =>
    part.mention ? (
      <span
        key={`${part.mention.principalId}-${index}`}
        data-mention-id={part.mention.principalId}
        className="inline-flex rounded-[5px] bg-accent-soft px-1 font-[620] text-accent-strong"
      >
        {part.text}
      </span>
    ) : (
      part.text
    ),
  );
}
