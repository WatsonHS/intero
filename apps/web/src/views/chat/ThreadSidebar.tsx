import {
  CircleNotchIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  RobotIcon,
  ArrowBendDownRightIcon,
} from "@phosphor-icons/react";
import type { ConversationThread, PrincipalId } from "@intero/domain";

import type { ThreadPayload } from "../../api.js";
import { Avatar, cn } from "../../design/primitives.js";
import { initials, tintFor } from "../../design/utils.js";
import { useI18n } from "../../i18n/index.js";
import type { TranslationKey } from "../../i18n/locales/zh-CN.js";
import type { ConversationRealtimeStatus } from "../../realtime/coordinator.js";
import {
  NewConversationModal,
  type ConversationCandidate,
} from "./NewConversationModal.js";
import { THREAD_GROUPS } from "./constants.js";
import {
  canRenderCommunicationItems,
  resolveStandInAvatarIdentity,
} from "./helpers.js";
import { RealtimeDeliveryStatus } from "./RealtimeDeliveryStatus.js";
import { StandInAvatar } from "./StandInAvatar.js";

export function ThreadSidebar({
  realtimeStatus,
  search,
  showSearch,
  showCreate,
  items,
  visibleItems,
  currentThreadId,
  principalNames,
  standInOwnerIds,
  teamNames,
  threadTitles,
  conversationCandidates,
  conversationIdentity,
  createPending,
  createStandInPending,
  threadsPending,
  threadsError,
  itemsLength,
  pilotStandInThreadId,
  activeStandInOwnerId,
  onToggleSearch,
  onSearchChange,
  onToggleCreate,
  onCloseCreate,
  onCreate,
  onRetryThreads,
  onSelectThread,
  onSelectStandIn,
  onCreateStandIn,
}: {
  realtimeStatus: ConversationRealtimeStatus;
  search: string;
  showSearch: boolean;
  showCreate: boolean;
  items: ThreadPayload[];
  visibleItems: ThreadPayload[];
  currentThreadId: string | undefined;
  principalNames: Map<string, string>;
  standInOwnerIds: Map<PrincipalId, PrincipalId>;
  teamNames: Map<string, string>;
  threadTitles: Map<string, string>;
  conversationCandidates: ConversationCandidate[];
  conversationIdentity:
    | { currentPrincipalId: PrincipalId; standInPrincipalId: PrincipalId }
    | undefined;
  createPending: boolean;
  createStandInPending: boolean;
  threadsPending: boolean;
  threadsError: boolean;
  itemsLength: number;
  pilotStandInThreadId: string | undefined;
  activeStandInOwnerId: PrincipalId | undefined;
  onToggleSearch(): void;
  onSearchChange(value: string): void;
  onToggleCreate(): void;
  onCloseCreate(): void;
  onCreate(input: {
    title: string;
    memberIds: string[];
    teamId?: string;
  }): void;
  onRetryThreads(): void;
  onSelectThread(threadId: string): void;
  onSelectStandIn(ownerId: PrincipalId): void;
  onCreateStandIn(): void;
}) {
  const { formatRelative, t } = useI18n();
  return (
    <aside className="flex min-w-0 flex-col border-r border-line bg-panel">
      <div className="p-[18px_18px_14px]">
        <div className="flex items-center gap-[10px]">
          <strong className="text-[15px] font-[620] tracking-[-0.02em]">
            {t("chat.title")}
          </strong>
          <RealtimeDeliveryStatus status={realtimeStatus} />
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              aria-label={t("general.search")}
              className="grid h-[26px] w-[26px] cursor-pointer place-items-center rounded-quiet border-0 bg-raise text-ink-muted"
              onClick={onToggleSearch}
            >
              <MagnifyingGlassIcon size={14} />
            </button>
            <button
              type="button"
              aria-label={t("chat.new")}
              className="grid h-[26px] w-[26px] cursor-pointer place-items-center rounded-quiet border-0 bg-raise text-ink-muted"
              onClick={onToggleCreate}
            >
              <PlusIcon size={14} />
            </button>
          </div>
        </div>
        {showSearch ? (
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t("general.search")}
            aria-label={t("general.search")}
            className="mt-2.5 h-8 w-full rounded-[9px] border border-line2 bg-transparent px-2.5 text-[12px] outline-none placeholder:text-faint"
          />
        ) : null}
      </div>

      {showCreate ? (
        <NewConversationModal
          candidates={conversationCandidates}
          busy={createPending}
          onClose={onCloseCreate}
          onCreate={onCreate}
        />
      ) : null}

      {threadsPending && itemsLength === 0 ? (
        <div className="flex items-center gap-2 px-2.5 py-4 text-[12px] text-ink-muted">
          <CircleNotchIcon size={18} className="animate-spin" />
          <span>{t("chat.loading")}</span>
        </div>
      ) : null}
      {threadsError && itemsLength === 0 ? (
        <div className="flex flex-col items-start gap-2 px-2.5 py-4 text-[12px] text-ink-muted">
          <span>{t("chat.unavailable")}</span>
          <button
            type="button"
            onClick={onRetryThreads}
            className="h-8 cursor-pointer rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] text-ink hover:border-accent-strong"
          >
            {t("general.retry")}
          </button>
        </div>
      ) : null}

      {threadsError && itemsLength > 0 ? (
        <div className="px-2.5 py-2 text-[11px] text-ink-muted">
          部分常规会话暂不可用；个人替身与云端会话仍可使用。
        </div>
      ) : null}

      {canRenderCommunicationItems({
        itemCount: itemsLength,
        canonicalPending: threadsPending,
        canonicalError: threadsError,
      }) ? (
        <div className="min-h-0 flex-1 overflow-auto px-2.5 pb-4">
          {THREAD_GROUPS.map((group) => {
            const grouped = (
              group.kind === "stand_in" ? items : visibleItems
            ).filter((item) => item.thread.kind === group.kind);
            if (grouped.length === 0 && group.kind !== "stand_in") return null;
            return (
              <div key={group.kind}>
                <div className="px-2.5 py-2 text-[10.5px] font-[650] tracking-[0.1em] text-faint">
                  {t(group.label)}
                </div>
                <div className="flex flex-col gap-0.5">
                  {grouped.length > 0 ? (
                    grouped.map((item) => (
                      <SidebarThreadItem
                        key={item.thread.id}
                        item={item}
                        active={currentThreadId === item.thread.id}
                        principalNames={principalNames}
                        standInOwnerIds={standInOwnerIds}
                        teamNames={teamNames}
                        threadTitles={threadTitles}
                        formatRelative={formatRelative}
                        t={t}
                        onSelect={() => {
                          if (
                            item.thread.id === pilotStandInThreadId &&
                            activeStandInOwnerId
                          ) {
                            onSelectStandIn(activeStandInOwnerId);
                          } else {
                            onSelectThread(item.thread.id);
                          }
                        }}
                      />
                    ))
                  ) : (
                    <StandInThreadStarter
                      title={
                        (conversationIdentity
                          ? principalNames.get(
                              conversationIdentity.standInPrincipalId,
                            )
                          : undefined) ?? t("chat.group.standIn")
                      }
                      busy={createStandInPending}
                      disabled={!conversationIdentity}
                      label={t("chat.empty.start")}
                      ownerId={
                        conversationIdentity?.currentPrincipalId ??
                        "personal-stand-in"
                      }
                      ownerName={
                        (conversationIdentity
                          ? principalNames.get(
                              conversationIdentity.currentPrincipalId,
                            )
                          : undefined) ?? t("chat.group.standIn")
                      }
                      onSelect={onCreateStandIn}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </aside>
  );
}

function SidebarThreadItem({
  item,
  active,
  principalNames,
  standInOwnerIds,
  teamNames,
  threadTitles,
  formatRelative,
  t,
  onSelect,
}: {
  item: ThreadPayload;
  active: boolean;
  principalNames: Map<string, string>;
  standInOwnerIds: Map<PrincipalId, PrincipalId>;
  teamNames: Map<string, string>;
  threadTitles: Map<string, string>;
  formatRelative: (value: string) => string;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  onSelect: () => void;
}) {
  const lastMessage = item.messages.at(-1);
  const preview = lastMessage
    ? lastMessage.serverReadable
      ? lastMessage.body ||
        lastMessage.attachments?.[0]?.fileName ||
        (lastMessage.streamState === "pending"
          ? t("chat.standInThinking")
          : "—")
      : t("chat.encryptedMessage")
    : "—";
  const time = formatRelative(lastMessage?.createdAt ?? item.thread.createdAt);
  const humanParticipants = item.thread.participantIds.filter(
    (id) => !item.thread.standInIds.includes(id),
  );
  const unread = item.unreadCount ?? 0;
  const mentions = item.mentionCount ?? 0;
  const teamName = item.thread.teamId
    ? teamNames.get(item.thread.teamId)
    : undefined;
  const origin = item.thread.parentThreadId
    ? threadTitles.get(item.thread.parentThreadId)
    : undefined;

  return (
    <button
      type="button"
      data-testid={
        item.thread.kind === "stand_in"
          ? "personal-stand-in-conversation"
          : undefined
      }
      onClick={onSelect}
      className={
        active
          ? "grid w-full grid-cols-[30px_minmax(0,1fr)_auto] items-start gap-[11px] rounded-[11px] border-0 bg-sel p-[10px_11px] text-left cursor-pointer"
          : "grid w-full grid-cols-[30px_minmax(0,1fr)_auto] items-start gap-[11px] rounded-[11px] border-0 bg-transparent p-[10px_11px] text-left cursor-pointer hover:bg-hover-wash"
      }
    >
      <ThreadGlyph
        thread={item.thread}
        principalNames={principalNames}
        standInOwnerIds={standInOwnerIds}
      />
      <span className="grid min-w-0 gap-[3px]">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "truncate text-[12.5px]",
              unread > 0 ? "font-[650] text-ink" : "font-[570]",
            )}
          >
            {item.thread.title}
          </span>
          {teamName ? (
            <span
              title={teamName}
              className="shrink-0 rounded-[6px] bg-raise px-1.5 py-0.5 font-mono text-[8.5px] font-[650] tracking-[0.04em] text-ink-muted"
            >
              {teamName}
            </span>
          ) : null}
          {item.thread.standInIds.length > 0 ? (
            <RobotIcon
              size={11}
              className="shrink-0 text-accent-strong"
              aria-label={t("chat.standInPresent")}
            />
          ) : null}
        </span>
        {origin ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[10px] text-faint">
            <ArrowBendDownRightIcon size={11} className="shrink-0" />
            <span className="truncate">
              {t("chat.branchedFrom", { title: origin })}
            </span>
          </span>
        ) : null}
        <span className="truncate text-[11px] text-ink-muted">{preview}</span>
        {item.thread.concludedAt ? (
          <span className="justify-self-start rounded-pill bg-green-soft px-2 py-[3px] text-[9.5px] font-[620] text-green">
            {t("chat.concluded")}
          </span>
        ) : null}
        {humanParticipants.length > 1 ? (
          <span className="mt-0.5 flex items-center">
            {humanParticipants.slice(0, 4).map((id, index) => (
              <Avatar
                key={id}
                id={id}
                name={principalNames.get(id)}
                size="xs"
                className={index > 0 ? "-ml-[5px] ring-1 ring-panel" : ""}
              />
            ))}
            {humanParticipants.length > 4 ? (
              <span className="ml-1.5 font-mono text-[9px] text-faint">
                +{humanParticipants.length - 4}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className="grid justify-items-end gap-1.5">
        <time className="font-mono text-[9.5px] text-faint">{time}</time>
        {mentions > 0 ? (
          <span
            className="animate-badge-bounce grid h-[17px] min-w-[22px] place-items-center rounded-[9px] bg-amber px-[5px] font-mono text-[9px] font-[700] text-white"
            title={t("chat.mentionNotificationTitle")}
          >
            @{mentions > 9 ? "9+" : mentions}
          </span>
        ) : null}
        {unread > 0 ? (
          <span className="animate-badge-bounce grid h-[17px] min-w-[17px] place-items-center rounded-[9px] bg-accent-strong px-[5px] font-mono text-[9.5px] text-on-accent">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function StandInThreadStarter({
  title,
  label,
  busy,
  disabled,
  ownerId,
  ownerName,
  onSelect,
}: {
  title: string;
  label: string;
  busy: boolean;
  disabled: boolean;
  ownerId: string;
  ownerName: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="personal-stand-in-conversation"
      disabled={disabled || busy}
      onClick={onSelect}
      className="grid w-full cursor-pointer grid-cols-[30px_minmax(0,1fr)_auto] items-start gap-[11px] rounded-[11px] border-0 bg-transparent p-[10px_11px] text-left hover:bg-hover-wash disabled:cursor-not-allowed disabled:opacity-55"
    >
      <StandInAvatar ownerId={ownerId} ownerName={ownerName} busy={busy} />
      <span className="grid min-w-0 gap-[3px]">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[12.5px] font-[570]">{title}</span>
          <RobotIcon
            size={11}
            className="shrink-0 text-accent-strong"
            aria-hidden="true"
          />
        </span>
        <span className="truncate text-[11px] text-ink-muted">{label}</span>
      </span>
    </button>
  );
}

function ThreadGlyph({
  thread,
  principalNames,
  standInOwnerIds,
}: {
  thread: ConversationThread;
  principalNames: Map<string, string>;
  standInOwnerIds: Map<PrincipalId, PrincipalId>;
}) {
  if (thread.kind === "stand_in") {
    const standInId = thread.standInIds[0];
    const avatarIdentity = standInId
      ? resolveStandInAvatarIdentity({
          standInId,
          standInOwnerIds,
          principalNames,
          fallbackName: thread.title,
        })
      : { ownerId: thread.id, ownerName: thread.title };
    return (
      <StandInAvatar
        ownerId={avatarIdentity.ownerId}
        ownerName={avatarIdentity.ownerName}
      />
    );
  }
  if (thread.kind === "room") {
    return (
      <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-raise text-[10px] font-[650] text-ink-muted">
        #
      </span>
    );
  }
  if (thread.kind === "human_group") {
    return (
      <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-raise text-[10px] font-[650] text-ink-muted">
        ◇
      </span>
    );
  }
  const humanId = thread.participantIds.find(
    (id) => !thread.standInIds.includes(id),
  );
  const name = humanId ? principalNames.get(humanId) : undefined;
  return (
    <span
      className={
        humanId
          ? "grid h-[30px] w-[30px] place-items-center rounded-full text-[10px] font-[650] text-on-tint"
          : "grid h-[30px] w-[30px] place-items-center rounded-full bg-raise text-[10px] font-[650] text-ink-muted"
      }
      style={humanId ? { background: tintFor(humanId) } : undefined}
    >
      {initials(name)}
    </span>
  );
}
