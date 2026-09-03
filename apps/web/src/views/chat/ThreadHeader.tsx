import {
  ArchiveIcon,
  ArrowBendDownRightIcon,
  BellSlashIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  DotsThreeIcon,
  GearSixIcon,
  GitBranchIcon,
  RobotIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { PresenceState, PrincipalId } from "@intero/domain";
import { isThreadMuted } from "@intero/domain";

import type { ThreadPayload } from "../../api.js";
import { ConversationCall } from "../../calls/ConversationCall.js";
import { initials } from "../../design/utils.js";
import { useI18n } from "../../i18n/index.js";
import { PresenceAvatar } from "./PresenceAvatar.js";

export function ThreadHeader({
  current,
  currentSenderId,
  currentIsPilot,
  currentIsPilotStandIn,
  currentIsCanonicalGroup,
  ownStandInState,
  callsEnabled,
  principalNames,
  addStandInPending,
  conversationIdentityStandInId,
  activeRelevance,
  currentCoordination,
  coordinationRelevancePending,
  legacyStandInRecord,
  concluding,
  conclusion,
  concludePending,
  concludeError,
  threadTitles,
  onAddStandIn,
  onOpenManage,
  onOpenCoordination,
  onCoordinationRelevance,
  onSelectThread,
  onBeginConclude,
  onCancelConclude,
  onConclusionChange,
  onConclude,
  onMute,
  onUnmute,
  onArchive,
  onUnarchive,
  canManageRoom,
  presence,
}: {
  current: ThreadPayload;
  currentSenderId: PrincipalId | undefined;
  currentIsPilot: boolean;
  currentIsPilotStandIn: boolean;
  currentIsCanonicalGroup: boolean;
  ownStandInState: "add" | "present" | undefined;
  callsEnabled: boolean;
  principalNames: Map<string, string>;
  addStandInPending: boolean;
  conversationIdentityStandInId: PrincipalId | undefined;
  activeRelevance: { reason: string } | undefined;
  currentCoordination:
    { id: string; conversationThreadId?: string | undefined } | undefined;
  coordinationRelevancePending: boolean;
  legacyStandInRecord: boolean;
  concluding: boolean;
  conclusion: string;
  concludePending: boolean;
  concludeError: boolean;
  threadTitles: Map<string, string>;
  onAddStandIn(): void;
  onOpenManage(): void;
  onOpenCoordination?: ((threadId: string) => void) | undefined;
  onCoordinationRelevance(input: {
    coordinationThreadId: string;
    action: "dismiss" | "mute" | "revisit";
  }): void;
  onSelectThread(threadId: string): void;
  onBeginConclude(): void;
  onCancelConclude(): void;
  onConclusionChange(value: string): void;
  onConclude(input: { threadId: string; conclusion: string }): void;
  onMute(input: {
    hours?: number;
    indefinitely?: boolean;
    includingMentions?: boolean;
  }): void;
  onUnmute(): void;
  onArchive(): void;
  onUnarchive(): void;
  canManageRoom: boolean;
  presence: Map<string, PresenceState>;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const muted = isThreadMuted(current.notificationPreference);
  const archived = Boolean(
    current.thread.archivedAt || current.viewerArchivedAt,
  );
  const canArchiveRoom = current.thread.kind === "room" && canManageRoom;
  const canArchivePersonal =
    current.thread.kind === "human_direct" ||
    current.thread.kind === "human_group";
  return (
    <>
      <header className="flex shrink-0 items-center gap-[13px] border-b border-line p-[18px_26px]">
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-accent-soft text-[12px] font-[650] text-accent-strong">
          {initials(current.thread.title)}
        </span>
        <span className="grid min-w-0">
          <strong className="truncate text-[14.5px] font-[620] tracking-[-0.015em]">
            {current.thread.title}
          </strong>
          <small className="mt-[3px] truncate text-[11px] text-ink-muted">
            {currentIsPilotStandIn
              ? "个人替身 · Work State 是可选上下文，没有也可以聊天"
              : currentIsPilot
                ? "同团队 · 仅参与者可见 · 持久化 1:1"
                : t("chat.subPeopleStandIns", {
                    people: current.thread.participantIds.length,
                    standIns: current.thread.standInIds.length,
                  })}
          </small>
          {!currentIsPilot && !currentIsPilotStandIn ? (
            <span className="mt-1.5 flex items-center">
              {current.thread.participantIds
                .filter((id) => !current.thread.standInIds.includes(id))
                .slice(0, 6)
                .map((id, index) => (
                  <PresenceAvatar
                    key={id}
                    id={id}
                    name={principalNames.get(id)}
                    state={presence.get(id) ?? "offline"}
                    size="xs"
                    className={index > 0 ? "-ml-[5px]" : ""}
                  />
                ))}
            </span>
          ) : null}
        </span>
        {currentSenderId &&
        current.thread.kind !== "stand_in" &&
        !currentIsPilotStandIn &&
        !current.thread.concludedAt &&
        !current.thread.archivedAt ? (
          <ConversationCall
            key={current.thread.id}
            enabled={callsEnabled}
            stageContainerId={`conversation-call-stage-${current.thread.id}`}
            threadId={current.thread.id}
            currentPrincipalId={currentSenderId}
            title={current.thread.title}
            principalNames={principalNames}
            humanParticipantCount={
              current.thread.participantIds.filter(
                (id) => !current.thread.standInIds.includes(id),
              ).length
            }
          />
        ) : null}
        {currentIsCanonicalGroup ? (
          <div className="flex items-center gap-2">
            {ownStandInState === "present" ? (
              <span
                data-testid="group-own-stand-in-present"
                className="inline-flex items-center gap-1.5 rounded-pill bg-accent-soft px-2.5 py-1 text-[10.5px] text-accent-strong"
              >
                <RobotIcon size={13} />
                {t("chat.ownStandInPresent")}
              </span>
            ) : (
              <button
                type="button"
                data-testid="group-add-own-stand-in"
                disabled={addStandInPending || !conversationIdentityStandInId}
                title={t("chat.addOwnStandInHint")}
                onClick={() => onAddStandIn()}
                className="inline-flex h-8 items-center gap-1.5 rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] hover:border-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
              >
                {addStandInPending ? (
                  <CircleNotchIcon size={14} className="animate-spin" />
                ) : (
                  <UserPlusIcon size={14} />
                )}
                {t("chat.addOwnStandIn")}
              </button>
            )}
            {current.thread.kind === "room" ? (
              <button
                type="button"
                data-testid="group-chat-management-trigger"
                aria-label={t("chat.manage")}
                onClick={() => onOpenManage()}
                className="inline-flex h-8 items-center gap-1.5 rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] text-ink-muted hover:border-accent-strong hover:text-accent-strong"
              >
                <GearSixIcon size={14} />
                {t("chat.manage")}
              </button>
            ) : null}
          </div>
        ) : current.thread.kind === "human_direct" &&
          current.thread.standInIds.length === 0 ? (
          <button
            type="button"
            data-testid="pilot-add-stand-in"
            disabled={addStandInPending}
            onClick={() => onAddStandIn()}
            className="inline-flex h-8 items-center gap-1.5 rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] hover:border-accent-strong"
          >
            {addStandInPending ? (
              <CircleNotchIcon size={14} className="animate-spin" />
            ) : (
              <UserPlusIcon size={14} />
            )}
            邀请替身
          </button>
        ) : current.thread.kind === "human_direct" &&
          current.thread.standInIds.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-accent-soft px-2.5 py-1 text-[10.5px] text-accent-strong">
            <RobotIcon size={13} />
            替身已加入
          </span>
        ) : null}
        {!currentIsPilot && !currentIsPilotStandIn ? (
          <div className="relative ml-auto">
            <button
              type="button"
              data-testid="thread-header-menu"
              aria-label={t("chat.mute")}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-btn border border-line2 bg-transparent text-ink-muted hover:border-accent-strong hover:text-accent-strong"
            >
              {muted ? (
                <BellSlashIcon size={14} />
              ) : (
                <DotsThreeIcon size={16} />
              )}
            </button>
            {menuOpen ? (
              <div className="absolute right-0 z-30 mt-1.5 min-w-[220px] rounded-[12px] border border-line bg-panel p-1.5 shadow-lg">
                {muted ? (
                  <button
                    type="button"
                    className="block w-full rounded-[8px] border-0 bg-transparent px-2.5 py-1.5 text-left text-[12px] hover:bg-hover-wash"
                    onClick={() => {
                      onUnmute();
                      setMenuOpen(false);
                    }}
                  >
                    {t("chat.unmute")}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="block w-full rounded-[8px] border-0 bg-transparent px-2.5 py-1.5 text-left text-[12px] hover:bg-hover-wash"
                      onClick={() => {
                        onMute({ hours: 1 });
                        setMenuOpen(false);
                      }}
                    >
                      {t("chat.mute1h")}
                    </button>
                    <button
                      type="button"
                      className="block w-full rounded-[8px] border-0 bg-transparent px-2.5 py-1.5 text-left text-[12px] hover:bg-hover-wash"
                      onClick={() => {
                        onMute({ hours: 8 });
                        setMenuOpen(false);
                      }}
                    >
                      {t("chat.mute8h")}
                    </button>
                    <button
                      type="button"
                      className="block w-full rounded-[8px] border-0 bg-transparent px-2.5 py-1.5 text-left text-[12px] hover:bg-hover-wash"
                      onClick={() => {
                        onMute({ indefinitely: true });
                        setMenuOpen(false);
                      }}
                    >
                      {t("chat.muteIndefinitely")}
                    </button>
                    <button
                      type="button"
                      className="block w-full rounded-[8px] border-0 bg-transparent px-2.5 py-1.5 text-left text-[12px] hover:bg-hover-wash"
                      onClick={() => {
                        onMute({ indefinitely: true, includingMentions: true });
                        setMenuOpen(false);
                      }}
                    >
                      {t("chat.muteIncludingMentions")}
                    </button>
                  </>
                )}
                {canArchiveRoom || canArchivePersonal ? (
                  <button
                    type="button"
                    className="mt-1 block w-full rounded-[8px] border-0 bg-transparent px-2.5 py-1.5 text-left text-[12px] hover:bg-hover-wash"
                    onClick={() => {
                      if (archived) onUnarchive();
                      else onArchive();
                      setMenuOpen(false);
                    }}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <ArchiveIcon size={12} />
                      {archived
                        ? t("chat.unarchive")
                        : canArchivePersonal
                          ? t("chat.hideForMe")
                          : t("chat.archive")}
                    </span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>
      {current.thread.archivedAt ? (
        <div className="border-b border-line px-[26px] py-2 text-[11px] text-ink-muted">
          {t("chat.archivedReadOnly")}
        </div>
      ) : null}
      {activeRelevance && currentCoordination ? (
        <div
          data-testid="coordination-relevance-prompt"
          className="relative z-20 shrink-0 border-b border-amber-soft bg-amber-soft px-[26px] py-3"
        >
          <div className="flex items-center gap-3">
            <GitBranchIcon size={15} className="shrink-0 text-amber" />
            <span className="min-w-0">
              <strong className="block text-[11.5px] font-[650] text-ink">
                {t("chat.coordination.relevanceTitle")}
              </strong>
              <small className="mt-0.5 block truncate text-[10.5px] text-ink-muted">
                {activeRelevance.reason}
              </small>
            </span>
            <button
              type="button"
              onClick={() =>
                onOpenCoordination?.(
                  currentCoordination.conversationThreadId ??
                    currentCoordination.id,
                )
              }
              className="ml-auto h-7 rounded-btn border border-amber px-2.5 text-[10.5px] text-amber"
            >
              {t("chat.coordination.open")}
            </button>
            <button
              type="button"
              disabled={coordinationRelevancePending}
              onClick={() =>
                onCoordinationRelevance({
                  coordinationThreadId: currentCoordination.id,
                  action: "dismiss",
                })
              }
              className="h-7 border-0 bg-transparent px-1.5 text-[10.5px] text-faint hover:text-ink"
            >
              {t("chat.coordination.dismiss")}
            </button>
            <button
              type="button"
              disabled={coordinationRelevancePending}
              onClick={() =>
                onCoordinationRelevance({
                  coordinationThreadId: currentCoordination.id,
                  action: "mute",
                })
              }
              className="h-7 border-0 bg-transparent px-1.5 text-[10.5px] text-faint hover:text-ink"
            >
              {t("chat.coordination.mute")}
            </button>
          </div>
        </div>
      ) : null}
      {legacyStandInRecord ? (
        <div
          className="border-b border-amber-soft bg-amber-soft px-[26px] py-3 text-[11px] leading-[1.65] text-amber"
          data-testid="stand-in-legacy-detail"
        >
          这是旧版 Project-backed Stand-in 记录。历史内容保留为只读；
          新提问请从个人替身入口继续。
          <span className="ml-1 font-mono">STAND_IN_LEGACY_RECORD</span>
        </div>
      ) : null}

      {/* A branched discussion is meant to end: its conclusion is posted
    back into the conversation it came from, then it closes. */}
      {current.thread.parentThreadId && !currentIsPilot ? (
        <div className="border-b border-line px-[26px] py-3">
          {current.thread.concludedAt ? (
            <div className="flex items-center gap-2 rounded-inset bg-green-soft px-3 py-2.5 text-[11.5px] text-green">
              <CheckCircleIcon size={14} weight="fill" />
              {t("chat.concludedInto", {
                title: threadTitles.get(current.thread.parentThreadId) ?? "—",
              })}
              <button
                type="button"
                onClick={() => onSelectThread(current.thread.parentThreadId!)}
                className="ml-auto cursor-pointer border-0 bg-transparent p-0 text-[11.5px] text-accent-strong hover:underline"
              >
                {t("chat.openOrigin")}
              </button>
            </div>
          ) : concluding ? (
            <div className="grid gap-2 rounded-inset border border-line2 bg-panel2 p-3">
              <span className="text-[11px] text-faint">
                {t("chat.concludeHint", {
                  title: threadTitles.get(current.thread.parentThreadId) ?? "—",
                })}
              </span>
              <textarea
                rows={2}
                autoFocus
                value={conclusion}
                onChange={(event) => onConclusionChange(event.target.value)}
                placeholder={t("chat.concludePlaceholder")}
                className="w-full resize-none rounded-btn border border-line bg-panel px-3 py-2 text-[12px] leading-[1.6] text-ink outline-none placeholder:text-faint focus:border-accent-strong"
              />
              <div className="flex items-center gap-2">
                {concludeError ? (
                  <span role="alert" className="text-[11px] text-danger">
                    {t("chat.concludeFailed")}
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={!conclusion.trim() || concludePending}
                  onClick={() =>
                    onConclude({
                      threadId: current.thread.id,
                      conclusion: conclusion.trim(),
                    })
                  }
                  className="ml-auto h-8 cursor-pointer rounded-btn border-0 bg-accent-strong px-3.5 text-[12px] font-[620] text-on-accent disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {t("chat.concludeSend")}
                </button>
                <button
                  type="button"
                  onClick={() => onCancelConclude()}
                  className="h-8 cursor-pointer border-0 bg-transparent px-2 text-[12px] text-faint hover:text-ink"
                >
                  {t("general.close")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onBeginConclude()}
              className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] text-ink-muted hover:border-accent-strong hover:text-accent-strong"
            >
              <ArrowBendDownRightIcon size={13} />
              {t("chat.conclude")}
            </button>
          )}
        </div>
      ) : null}
    </>
  );
}
