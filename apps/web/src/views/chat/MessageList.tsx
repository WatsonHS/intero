import { CircleNotchIcon } from "@phosphor-icons/react";
import type {
  PilotStandInExchange,
  PrincipalId,
  ThreadMessage,
} from "@intero/domain";
import type { RefObject } from "react";

import type { PrincipalSummary, ThreadPayload } from "../../api.js";
import { useI18n } from "../../i18n/index.js";
import { MessageItem } from "./MessageItem.js";
import type { ConversationMentionCandidate } from "./mentions.js";

export function MessageList({
  current,
  currentPilotStandInJoined,
  currentSenderId,
  currentIsPilot,
  currentIsPilotStandIn,
  currentIsCanonicalGroup,
  historyExhausted,
  loadOlderPending,
  loadOlderError,
  principalNames,
  principals,
  standInOwnerIds,
  mentionCandidates,
  expanded,
  reactionPickerMessageId,
  reactionPending,
  reactionPendingMessageId,
  pilotStandInExchanges,
  messagesEndRef,
  onLoadOlder,
  onToggleExpanded,
  onToggleReaction,
  onToggleReactionPicker,
  onCloseReactionPicker,
  onReply,
  onNavigateToMessage,
  onOpenProfile,
  onOpenCoordination,
  editingMessageId,
  editPending = false,
  onBeginEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  typingLabel,
}: {
  current: ThreadPayload;
  currentPilotStandInJoined: boolean;
  currentSenderId: PrincipalId | undefined;
  currentIsPilot: boolean;
  currentIsPilotStandIn: boolean;
  currentIsCanonicalGroup: boolean;
  historyExhausted: Set<string>;
  loadOlderPending: boolean;
  loadOlderError: boolean;
  principalNames: Map<string, string>;
  principals: PrincipalSummary[];
  standInOwnerIds: Map<PrincipalId, PrincipalId>;
  mentionCandidates: ConversationMentionCandidate[];
  expanded: Set<string>;
  reactionPickerMessageId: string | undefined;
  reactionPending: boolean;
  reactionPendingMessageId: string | undefined;
  pilotStandInExchanges: PilotStandInExchange[];
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onLoadOlder(): void;
  onToggleExpanded(messageId: string): void;
  onToggleReaction(message: ThreadMessage, emoji: string): void;
  onToggleReactionPicker(messageId: string): void;
  onCloseReactionPicker(): void;
  onReply(message: ThreadMessage): void;
  onNavigateToMessage(messageId: string): void;
  onOpenProfile(principalId: PrincipalId): void;
  onOpenCoordination?: ((threadId: string) => void) | undefined;
  editingMessageId?: string | undefined;
  editPending?: boolean;
  onBeginEdit?(message: ThreadMessage): void;
  onCancelEdit?(): void;
  onSaveEdit?(message: ThreadMessage, body: string): void;
  onDelete?(message: ThreadMessage): void;
  typingLabel?: string | undefined;
}) {
  const { t } = useI18n();
  return (
    <>
      <div
        id={`conversation-call-stage-${current.thread.id}`}
        data-testid="conversation-call-stage-slot"
        className="mx-auto w-full max-w-[1012px] flex-none px-[26px] pt-[18px] empty:hidden"
      />

      <div className="min-h-0 flex-1 overflow-auto p-[22px_26px_30px]">
        <div className="mx-auto flex max-w-[800px] flex-col gap-4">
          {!currentIsPilot &&
          !currentIsPilotStandIn &&
          (current.messages[0]?.sequence ?? 0) > 1 &&
          !historyExhausted.has(current.thread.id) ? (
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                disabled={loadOlderPending}
                onClick={onLoadOlder}
                className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-btn border border-line2 bg-transparent px-3 text-[11px] text-ink-muted hover:border-accent-strong hover:text-accent-strong disabled:cursor-wait disabled:opacity-50"
              >
                {loadOlderPending ? (
                  <CircleNotchIcon size={13} className="animate-spin" />
                ) : null}
                {t("chat.loadOlder")}
              </button>
              {loadOlderError ? (
                <span role="alert" className="text-[10.5px] text-danger">
                  {t("chat.loadOlderFailed")}
                </span>
              ) : null}
            </div>
          ) : null}
          {currentIsPilot && currentPilotStandInJoined ? (
            <p className="rounded-inset bg-raise p-[12px_16px] text-center text-[11.5px] leading-[1.7] text-ink-muted">
              替身只会看到加入后的消息，不会读取此前的私聊历史。
            </p>
          ) : null}
          {current.messages.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-10 text-center">
              <strong className="text-[13px] font-[620]">
                {t("chat.emptyThread")}
              </strong>
              <p className="text-[12px] text-ink-muted">
                {t("chat.emptyThreadDetail")}
              </p>
            </div>
          ) : (
            current.messages.map((message, index) => (
              <div
                key={message.id}
                className="animate-message-enter"
                style={{
                  animationDelay: `${Math.min(index * 40, 320)}ms`,
                }}
              >
                <MessageItem
                  message={message}
                  current={current}
                  currentSenderId={currentSenderId}
                  currentIsPilot={currentIsPilot}
                  currentIsPilotStandIn={currentIsPilotStandIn}
                  currentIsCanonicalGroup={currentIsCanonicalGroup}
                  principalNames={principalNames}
                  principals={principals}
                  standInOwnerIds={standInOwnerIds}
                  mentionCandidates={mentionCandidates}
                  expanded={expanded}
                  reactionPickerMessageId={reactionPickerMessageId}
                  reactionPending={reactionPending}
                  reactionPendingMessageId={reactionPendingMessageId}
                  pilotStandInExchanges={pilotStandInExchanges}
                  onToggleExpanded={onToggleExpanded}
                  onToggleReaction={onToggleReaction}
                  onToggleReactionPicker={onToggleReactionPicker}
                  onCloseReactionPicker={onCloseReactionPicker}
                  onReply={onReply}
                  onNavigateToMessage={onNavigateToMessage}
                  onOpenProfile={onOpenProfile}
                  onOpenCoordination={onOpenCoordination}
                  editing={editingMessageId === message.id}
                  editPending={editPending}
                  {...(onBeginEdit ? { onBeginEdit } : {})}
                  {...(onCancelEdit ? { onCancelEdit } : {})}
                  {...(onSaveEdit ? { onSaveEdit } : {})}
                  {...(onDelete ? { onDelete } : {})}
                />
              </div>
            ))
          )}
          {typingLabel ? (
            <p
              data-testid="typing-indicator"
              className="px-1 text-[11.5px] italic text-ink-muted"
            >
              {typingLabel}
            </p>
          ) : null}
          <div ref={messagesEndRef} aria-hidden="true" />
        </div>
      </div>
    </>
  );
}
