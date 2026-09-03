import { CircleNotchIcon } from "@phosphor-icons/react";
import type { PrincipalId, ThreadMessage } from "@intero/domain";
import { Modal } from "../design/primitives.js";
import { useEffect, useState } from "react";

import { useI18n } from "../i18n/index.js";
import { usePresence } from "../realtime/usePresence.js";
import { ConversationProfileModal } from "./chat/ConversationProfileModal.js";
import { Composer } from "./chat/Composer.js";
import { GroupChatManagementModal } from "./chat/GroupChatManagementModal.js";
import { useComposer } from "./chat/hooks/useComposer.js";
import { useConversationDirectory } from "./chat/hooks/useConversationDirectory.js";
import { useThreadActions } from "./chat/hooks/useThreadActions.js";
import { useThreadMessages } from "./chat/hooks/useThreadMessages.js";
import { useThreadRealtime } from "./chat/hooks/useThreadRealtime.js";
import { typingLabelFor } from "./chat/helpers.js";
import { useThreadTyping } from "./chat/hooks/useThreadTyping.js";
import { MessageList } from "./chat/MessageList.js";
import { ChannelDirectoryPanel } from "./chat/ChannelDirectoryPanel.js";
import { ThreadHeader } from "./chat/ThreadHeader.js";
import { ThreadSearch } from "./chat/ThreadSearch.js";
import { ThreadSidebar } from "./chat/ThreadSidebar.js";

export function CommunicationsView({
  initialThreadId,
  initialStandInOwnerId,
  initialMessageId,
  initialSequence,
  selectedProjectId,
  onOpenThread,
  onOpenStandIn,
  onOpenCoordination,
  onOpenPerson,
}: {
  initialThreadId?: string;
  initialStandInOwnerId?: string;
  initialMessageId?: string;
  initialSequence?: number;
  selectedProjectId?: string;
  onOpenThread?: (threadId: string) => void;
  onOpenStandIn?: (ownerId: string) => void;
  onOpenCoordination?: (threadId: string) => void;
  onOpenPerson?: (personId: string) => void;
} = {}) {
  const { t } = useI18n();
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [focusMessage, setFocusMessage] = useState<{
    messageId: string;
    sequence: number;
  } | null>(
    initialMessageId && initialSequence
      ? { messageId: initialMessageId, sequence: initialSequence }
      : null,
  );
  useEffect(() => {
    if (initialMessageId && initialSequence) {
      setFocusMessage({
        messageId: initialMessageId,
        sequence: initialSequence,
      });
    }
  }, [initialThreadId, initialMessageId, initialSequence]);
  const directory = useConversationDirectory({
    initialThreadId,
    initialStandInOwnerId,
    selectedProjectId,
    onOpenThread,
    onOpenStandIn,
  });
  const messages = useThreadMessages({
    current: directory.current,
    conversationIdentity: directory.conversationIdentity,
    currentIsPilot: directory.currentIsPilot,
    currentIsPilotStandIn: directory.currentIsPilotStandIn,
    currentSenderId: directory.currentSenderId,
    ...(focusMessage
      ? {
          focusMessageId: focusMessage.messageId,
          focusSequence: focusMessage.sequence,
        }
      : {}),
  });
  const actions = useThreadActions({
    conversationIdentity: directory.conversationIdentity,
    selectedProjectId,
    currentIsPilot: directory.currentIsPilot,
    current: directory.current,
    allItems: directory.allItems,
    principalNames: directory.principalNames,
    profilePrincipal: undefined,
    selectThread: (threadId) => {
      messages.onThreadSelected(threadId);
      directory.selectThread(threadId);
    },
    pilot: directory.pilot,
    onUnarchiveSuccess: () => directory.setListFilter("active"),
  });
  const composer = useComposer({
    current: directory.current,
    currentSenderId: directory.currentSenderId,
    currentIsPilot: directory.currentIsPilot,
    currentIsPilotStandIn: directory.currentIsPilotStandIn,
    canAttachImages: directory.canAttachImages,
    conversationProjectId: directory.conversationProjectId,
    activeStandInOwnerId: directory.activeStandInOwnerId,
    mentionCandidates: directory.mentionCandidates,
    selectStandIn: directory.selectStandIn,
    initialThreadId,
  });
  const realtime = useThreadRealtime({
    threadId: directory.current?.thread.id,
    currentIsPilot: directory.currentIsPilot,
    currentIsPilotStandIn: directory.currentIsPilotStandIn,
  });
  const typing = useThreadTyping({
    threadId: directory.current?.thread.id,
    currentPrincipalId: directory.currentSenderId,
    enabled:
      Boolean(directory.current) &&
      !directory.currentIsPilot &&
      !directory.currentIsPilotStandIn,
  });
  const presenceIds = [
    ...new Set(
      directory.items.flatMap((item) =>
        item.thread.participantIds.filter(
          (id) => !item.thread.standInIds.includes(id),
        ),
      ),
    ),
  ];
  const presence = usePresence(presenceIds);

  const current = directory.current;
  const currentPrincipalId = directory.conversationIdentity?.currentPrincipalId;
  const canManageRoom = Boolean(
    current?.thread.kind === "room" &&
    currentPrincipalId &&
    (current.thread.createdBy === currentPrincipalId ||
      directory.pilot?.bootstrap.data?.organizationRole === "admin" ||
      (directory.pilot?.teams.data?.teams ?? []).some(
        (team) =>
          team.id === current?.thread.teamId &&
          team.members.some(
            (member) =>
              member.id === currentPrincipalId && member.teamRole === "leader",
          ),
      )),
  );
  const profilePrincipal = actions.profilePrincipalId
    ? directory.principals.find(
        (principal) =>
          principal.id === actions.profilePrincipalId &&
          principal.kind === "human",
      )
    : undefined;
  const profileTeam = actions.profilePrincipalId
    ? ((directory.pilot?.teams.data?.teams ?? []).find(
        (team) =>
          team.id === current?.thread.teamId &&
          team.members.some(
            (member) => member.id === actions.profilePrincipalId,
          ),
      ) ??
      (directory.pilot?.teams.data?.teams ?? []).find((team) =>
        team.members.some((member) => member.id === actions.profilePrincipalId),
      ))
    : undefined;

  function selectThread(threadId: string) {
    messages.onThreadSelected(threadId);
    directory.selectThread(threadId);
    setThreadSearchOpen(false);
    if (focusMessage && current?.thread.id !== threadId) {
      setFocusMessage(null);
    }
  }

  function toggleReactionPicker(messageId: string) {
    composer.setMentionPickerOpen(false);
    composer.setEmojiPickerOpen(false);
    messages.toggleReactionPicker(messageId);
  }

  function beginReply(message: ThreadMessage) {
    messages.setReactionPickerMessageId(undefined);
    composer.beginReply(message);
  }

  const typingLabel = typingLabelFor(
    typing.typists,
    directory.principalNames,
    t,
  );

  return (
    <div className="grid h-full grid-cols-[292px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] animate-view-enter">
      <ThreadSidebar
        realtimeStatus={realtime.status}
        search={directory.search}
        showSearch={directory.showSearch}
        showCreate={actions.showCreate}
        items={directory.items}
        visibleItems={directory.visibleItems}
        currentThreadId={current?.thread.id}
        principalNames={directory.principalNames}
        standInOwnerIds={directory.standInOwnerIds}
        teamNames={directory.teamNames}
        threadTitles={directory.threadTitles}
        conversationCandidates={directory.conversationCandidates}
        conversationIdentity={directory.conversationIdentity}
        createPending={actions.create.isPending}
        createStandInPending={actions.createStandIn.isPending}
        threadsPending={directory.threads.isPending}
        threadsError={directory.threads.isError}
        itemsLength={directory.items.length}
        pilotStandInThreadId={directory.pilotStandInItem?.thread.id}
        activeStandInOwnerId={directory.activeStandInOwnerId}
        onToggleSearch={() =>
          directory.setShowSearch((prev) => {
            const next = !prev;
            if (!next) directory.setSearch("");
            return next;
          })
        }
        onSearchChange={directory.setSearch}
        onToggleCreate={() => actions.setShowCreate((prev) => !prev)}
        onCloseCreate={() => actions.setShowCreate(false)}
        onCreate={(input) => actions.create.mutate(input)}
        onRetryThreads={() => void directory.threads.refetch()}
        presence={presence}
        onSelectThread={selectThread}
        onSelectStandIn={directory.selectStandIn}
        onCreateStandIn={() => actions.createStandIn.mutate()}
        onBrowseChannels={() => directory.setShowChannelDirectory(true)}
        listFilter={directory.listFilter}
        onListFilterChange={directory.setListFilter}
        canBrowseChannels={
          (directory.pilot?.teams.data?.teams ?? []).length > 0
        }
      />

      {current ? (
        <div className="flex h-full min-w-0 flex-col">
          {profilePrincipal && actions.profilePrincipalId ? (
            <ConversationProfileModal
              principalId={actions.profilePrincipalId}
              displayName={profilePrincipal.displayName}
              {...(profileTeam ? { teamName: profileTeam.name } : {})}
              groupTitle={current.thread.title}
              busy={actions.startProfileDirectMessage.isPending}
              onClose={() => actions.setProfilePrincipalId(undefined)}
              onOpenDirectMessage={() =>
                actions.startProfileDirectMessage.mutate(
                  actions.profilePrincipalId!,
                )
              }
              {...(onOpenPerson
                ? {
                    onOpenFullProfile: () => {
                      actions.setProfilePrincipalId(undefined);
                      onOpenPerson(actions.profilePrincipalId!);
                    },
                  }
                : {})}
            />
          ) : null}
          {directory.showChannelDirectory ? (
            <ChannelDirectoryPanel
              teams={(directory.pilot?.teams.data?.teams ?? []).map((team) => ({
                id: team.id,
                name: team.name,
              }))}
              onClose={() => directory.setShowChannelDirectory(false)}
              onJoined={(threadId) => {
                directory.setShowChannelDirectory(false);
                selectThread(threadId);
              }}
              onLeft={(threadId) => {
                if (current?.thread.id === threadId) {
                  const next = directory.items.find(
                    (item) => item.thread.id !== threadId,
                  );
                  if (next) selectThread(next.thread.id);
                }
              }}
            />
          ) : null}
          {actions.showManage && current.thread.kind === "room" ? (
            <GroupChatManagementModal
              title={current.thread.title}
              participantIds={current.thread.participantIds}
              standInIds={current.thread.standInIds}
              principalNames={directory.principalNames}
              presence={presence}
              candidates={directory.conversationCandidates}
              protectedParticipantId={directory.currentSenderId}
              busy={actions.updateGroupChat.isPending}
              visibility={current.thread.visibility ?? "private"}
              canChangeVisibility={canManageRoom}
              error={
                actions.updateGroupChat.error instanceof Error
                  ? actions.updateGroupChat.error.message
                  : undefined
              }
              onClose={() => actions.setShowManage(false)}
              onSave={(input) =>
                actions.updateGroupChat.mutate({
                  threadId: current.thread.id,
                  ...input,
                })
              }
            />
          ) : null}
          <ThreadHeader
            current={current}
            currentSenderId={directory.currentSenderId}
            currentIsPilot={directory.currentIsPilot}
            currentIsPilotStandIn={directory.currentIsPilotStandIn}
            currentIsCanonicalGroup={directory.currentIsCanonicalGroup}
            ownStandInState={directory.ownStandInState}
            callsEnabled={
              realtime.status === "live" &&
              directory.bootstrap.data?.adapters?.calls === "livekit"
            }
            principalNames={directory.principalNames}
            addStandInPending={actions.addStandIn.isPending}
            conversationIdentityStandInId={
              directory.conversationIdentity?.standInPrincipalId
            }
            activeRelevance={directory.activeRelevance}
            currentCoordination={directory.currentCoordination}
            coordinationRelevancePending={
              actions.coordinationRelevance.isPending
            }
            legacyStandInRecord={directory.legacyStandInRecord}
            concluding={actions.concluding}
            conclusion={actions.conclusion}
            concludePending={actions.conclude.isPending}
            concludeError={actions.conclude.isError}
            threadTitles={directory.threadTitles}
            onAddStandIn={() => actions.addStandIn.mutate(current.thread.id)}
            onOpenManage={() => actions.setShowManage(true)}
            onOpenCoordination={onOpenCoordination}
            onCoordinationRelevance={(input) =>
              actions.coordinationRelevance.mutate(input)
            }
            onSelectThread={selectThread}
            onBeginConclude={() => actions.setConcluding(true)}
            onCancelConclude={() => actions.setConcluding(false)}
            onConclusionChange={actions.setConclusion}
            onConclude={(input) => actions.conclude.mutate(input)}
            onMute={(input) => actions.mute.mutate(input)}
            onUnmute={() => actions.unmute.mutate()}
            onArchive={() => actions.archive.mutate()}
            onUnarchive={() => actions.unarchive.mutate()}
            canManageRoom={canManageRoom}
            presence={presence}
            onToggleSearch={() => setThreadSearchOpen((open) => !open)}
          />
          {threadSearchOpen && current ? (
            <ThreadSearch
              threadId={current.thread.id}
              onClose={() => setThreadSearchOpen(false)}
              onSelectHit={(hit) => setFocusMessage(hit)}
            />
          ) : null}
          <MessageList
            current={current}
            currentPilotStandInJoined={Boolean(
              directory.currentPilotItem?.thread.standInId,
            )}
            currentSenderId={directory.currentSenderId}
            currentIsPilot={directory.currentIsPilot}
            currentIsPilotStandIn={directory.currentIsPilotStandIn}
            currentIsCanonicalGroup={directory.currentIsCanonicalGroup}
            historyExhausted={messages.historyExhausted}
            loadOlderPending={messages.loadOlder.isPending}
            loadOlderError={messages.loadOlder.isError}
            principalNames={directory.principalNames}
            principals={directory.principals}
            standInOwnerIds={directory.standInOwnerIds}
            mentionCandidates={directory.mentionCandidates}
            expanded={messages.expanded}
            highlightedMessageId={messages.highlightedMessageId}
            reactionPickerMessageId={messages.reactionPickerMessageId}
            reactionPending={messages.reaction.isPending}
            reactionPendingMessageId={messages.reaction.variables?.messageId}
            pilotStandInExchanges={directory.pilotStandIn.data?.exchanges ?? []}
            messagesEndRef={messages.messagesEndRef}
            onLoadOlder={() =>
              messages.loadOlder.mutate({
                threadId: current.thread.id,
                beforeSequence: current.messages[0]!.sequence,
              })
            }
            onToggleExpanded={messages.toggleExpanded}
            onToggleReaction={messages.toggleMessageReaction}
            onToggleReactionPicker={toggleReactionPicker}
            onCloseReactionPicker={() =>
              messages.setReactionPickerMessageId(undefined)
            }
            onReply={beginReply}
            onNavigateToMessage={messages.navigateToMessage}
            onOpenProfile={actions.setProfilePrincipalId}
            onOpenCoordination={onOpenCoordination}
            editingMessageId={messages.editingMessageId}
            editPending={messages.edit.isPending}
            onBeginEdit={(message) => messages.setEditingMessageId(message.id)}
            onCancelEdit={() => messages.setEditingMessageId(undefined)}
            onSaveEdit={(message, body) =>
              messages.edit.mutate({
                threadId: message.threadId,
                messageId: message.id,
                body,
              })
            }
            onDelete={(message) => messages.setDeletingMessage(message)}
            typingLabel={typingLabel}
          />
          {current.thread.archivedAt ? null : (
            <Composer
              currentAccessMode={current.thread.accessMode}
              currentSenderId={directory.currentSenderId}
              currentIsPilot={directory.currentIsPilot}
              currentIsPilotStandIn={directory.currentIsPilotStandIn}
              legacyStandInRecord={directory.legacyStandInRecord}
              canAttachImages={directory.canAttachImages}
              mentionPickerOpen={composer.mentionPickerOpen}
              emojiPickerOpen={composer.emojiPickerOpen}
              markdownPreview={composer.markdownPreview}
              draft={composer.draft}
              visibleMentionCandidates={composer.visibleMentionCandidates}
              activeMentionCandidate={composer.activeMentionCandidate}
              mentionOptionRefs={composer.mentionOptionRefs}
              composerRef={composer.composerRef}
              composerMirrorRef={composer.composerMirrorRef}
              imageInputRef={composer.imageInputRef}
              composerImages={composer.composerImages}
              replyingToMessageId={composer.replyingToMessageId}
              replyingToMessage={composer.replyingToMessage}
              principalNames={directory.principalNames}
              mentionCandidates={directory.mentionCandidates}
              sendPending={composer.send.isPending}
              onAddImages={composer.addComposerImages}
              onToggleMention={() =>
                composer.setMentionPickerOpen((open) => !open)
              }
              onToggleEmoji={() => composer.setEmojiPickerOpen((open) => !open)}
              onCloseEmoji={() => composer.setEmojiPickerOpen(false)}
              onSelectEmoji={composer.selectEmoji}
              onImageInputChange={(event) => {
                void composer.addComposerImages([
                  ...(event.currentTarget.files ?? []),
                ]);
                event.currentTarget.value = "";
              }}
              onPickImages={() => composer.imageInputRef.current?.click()}
              onToggleMarkdown={() =>
                composer.setMarkdownPreview((visible) => !visible)
              }
              onSelectMention={composer.selectMention}
              onHoverMention={composer.setActiveMentionIndex}
              onCancelReply={() => composer.setReplyingToMessageId(undefined)}
              onRemoveImage={composer.removeComposerImage}
              onDraftChange={composer.setDraft}
              onTyping={typing.notifyTyping}
              onSetMentionCursor={composer.setMentionCursor}
              onResetMentionIndex={() => composer.setActiveMentionIndex(0)}
              onSetMentionPickerOpen={composer.setMentionPickerOpen}
              onCloseMention={() => composer.setMentionPickerOpen(false)}
              onMoveMentionIndex={composer.setActiveMentionIndex}
              onSubmit={composer.submit}
            />
          )}
          {messages.deletingMessage ? (
            <Modal
              title={t("chat.deleteConfirmTitle")}
              onClose={() => messages.setDeletingMessage(undefined)}
              width={420}
              footer={
                <>
                  <button
                    type="button"
                    className="ml-auto h-8 cursor-pointer rounded-btn border border-line2 bg-transparent px-3 text-[12px]"
                    onClick={() => messages.setDeletingMessage(undefined)}
                  >
                    {t("general.close")}
                  </button>
                  <button
                    type="button"
                    data-testid="message-delete-confirm"
                    disabled={messages.remove.isPending}
                    className="h-8 cursor-pointer rounded-btn border-0 bg-danger px-3 text-[12px] font-[620] text-white disabled:opacity-55"
                    onClick={() =>
                      messages.remove.mutate({
                        threadId: messages.deletingMessage!.threadId,
                        messageId: messages.deletingMessage!.id,
                      })
                    }
                  >
                    {t("chat.deleteConfirm")}
                  </button>
                </>
              }
            >
              <p className="py-2 text-[13px] leading-[1.6] text-ink-muted">
                {t("chat.deleteConfirmBody")}
              </p>
            </Modal>
          ) : null}
        </div>
      ) : directory.selectedRecordMissing ? (
        <div
          className="grid h-full min-w-0 place-items-center p-8"
          data-testid="communications-degraded-record"
        >
          <div className="max-w-[480px] rounded-container border border-amber-soft bg-amber-soft p-6 text-center">
            <strong className="text-[16px] font-[630] text-amber">
              {t("chat.recordUnavailable")}
            </strong>
            <p className="mt-2 text-[12px] leading-[1.7] text-ink-muted">
              {t("chat.recordUnavailableBody")}
            </p>
            <p className="mt-2 font-mono text-[10px] text-amber">
              COMMUNICATION_RECORD_UNAVAILABLE · {directory.selectedThreadId}
            </p>
          </div>
        </div>
      ) : !directory.threads.isPending &&
        !directory.threads.isError &&
        directory.items.length === 0 ? (
        <div className="grid h-full min-w-0 place-items-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid h-9 w-9 place-items-center rounded-[11px_15px_11px_11px] bg-accent-strong text-[12px] font-[700] text-on-accent">
              IR
            </span>
            <strong className="text-[19px] font-[600]">
              {t("chat.empty.title")}
            </strong>
            <p className="max-w-[320px] text-[13px] text-ink-muted">
              {t("chat.empty.body")}
            </p>
            <button
              type="button"
              disabled={
                !directory.conversationIdentity ||
                actions.createStandIn.isPending
              }
              onClick={() => actions.createStandIn.mutate()}
              className="mt-1 inline-flex h-[34px] cursor-pointer items-center justify-center gap-1.5 rounded-btn border-0 bg-accent-strong px-3.5 text-[12.5px] font-[620] text-on-accent disabled:opacity-55"
            >
              {actions.createStandIn.isPending ? (
                <CircleNotchIcon size={14} className="animate-spin" />
              ) : null}
              {t("chat.empty.start")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export {
  applyConversationMention,
  applyPersonalStandInMention,
  conversationMentionCandidates,
  conversationMentionQuery,
  extractConversationMentionPrincipalIds,
  filterConversationMentionCandidates,
  mentionedStandIns,
  moveMentionCandidateIndex,
  personalStandInMentionCandidates,
  personalStandInMentionQuery,
  splitConversationMentions,
  standInsAddressedByMessage,
} from "./chat/mentions.js";
export type {
  ConversationMention,
  ConversationMentionCandidate,
  ConversationMessagePart,
  MentionedStandIn,
  PersonalStandInMention,
  PersonalStandInMentionCandidate,
} from "./chat/mentions.js";
export {
  buildGroupChatThreadInput,
  canRenderCommunicationItems,
  findExistingDirectMessageThread,
  markCachedThreadRead,
  mergeCommunicationItems,
  ownStandInControlState,
  personalStandInPrincipalId,
  replaceCachedThreadMessage,
  requestConversationStandInReplies,
  resolveConversationIdentity,
  resolveConversationProjectId,
  resolvePilotCommunicationPrincipal,
  resolveStandInAvatarIdentity,
  sendCanonicalConversationMessage,
  sha256Hex,
  StandInReplyError,
} from "./chat/helpers.js";
export {
  insertEmojiAtCursor,
  isBubblelessEmojiMessage,
  replyMessageSummary,
  shouldSubmitComposerKey,
} from "./chat/format.js";
export { MessageReactionBar } from "./chat/MessageReactionBar.js";
export { QuotedMessagePreview } from "./chat/QuotedMessagePreview.js";
export { RealtimeDeliveryStatus } from "./chat/RealtimeDeliveryStatus.js";
export { StandInAnswerContent } from "./chat/StandInAnswerContent.js";
export { StandInThreadStarter } from "./chat/ThreadSidebar.js";
