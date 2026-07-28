import {
  CheckCircleIcon,
  CircleIcon,
  MagnifyingGlassIcon,
  RobotIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

import { Avatar, Modal, SectionLabel, cn } from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";
import type { ConversationCandidate } from "./NewConversationModal.js";

export function GroupChatManagementModal({
  title: initialTitle,
  participantIds,
  standInIds,
  principalNames,
  candidates,
  busy,
  error,
  onClose,
  onSave,
}: {
  title: string;
  participantIds: string[];
  standInIds: string[];
  principalNames: Map<string, string>;
  candidates: ConversationCandidate[];
  busy: boolean;
  error?: string | undefined;
  onClose: () => void;
  onSave: (input: { title?: string; addParticipantIds: string[] }) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(initialTitle);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const existing = new Set(participantIds);
  const needle = query.trim().toLocaleLowerCase();
  const available = candidates
    .filter((candidate) => !existing.has(candidate.id))
    .filter(
      (candidate) =>
        !needle ||
        candidate.displayName.toLocaleLowerCase().includes(needle) ||
        candidate.teamName.toLocaleLowerCase().includes(needle),
    );
  const normalizedTitle = title.trim();
  const titleChanged =
    normalizedTitle.length > 0 && normalizedTitle !== initialTitle;
  const ready = titleChanged || picked.length > 0;

  function toggle(id: string) {
    setPicked((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
  }

  return (
    <Modal
      title={t("chat.manageTitle")}
      onClose={onClose}
      head={
        <>
          <div className="mt-[18px]">
            <SectionLabel>{t("chat.groupName")}</SectionLabel>
            <div className="mt-[9px] flex h-10 items-center gap-[9px] rounded-[11px] border border-line2 bg-raise px-3">
              <span className="font-mono text-[14px] text-faint">#</span>
              <input
                autoFocus
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("chat.namePlaceholder")}
                aria-label={t("chat.groupName")}
                className="min-w-0 flex-1 border-0 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-faint"
              />
            </div>
          </div>

          <div className="mt-[18px] flex items-baseline gap-2">
            <SectionLabel>{t("chat.currentMembers")}</SectionLabel>
            <span className="text-[10.5px] text-faint">
              {t("chat.memberCount", { count: participantIds.length })}
            </span>
          </div>
          <div className="mt-[9px] flex flex-wrap gap-1.5">
            {participantIds.map((id) => {
              const name = principalNames.get(id) ?? t("chat.someone");
              const isStandIn = standInIds.includes(id);
              return (
                <span
                  key={id}
                  className="inline-flex h-8 items-center gap-2 rounded-pill bg-raise px-2.5 text-[11px] text-ink"
                >
                  {isStandIn ? (
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-accent-soft text-accent-strong">
                      <RobotIcon size={11} />
                    </span>
                  ) : (
                    <Avatar id={id} name={name} size="sm" />
                  )}
                  {name}
                </span>
              );
            })}
          </div>

          <div className="mt-[18px] flex items-baseline gap-2">
            <SectionLabel>{t("chat.addMembers")}</SectionLabel>
            <span className="text-[10.5px] text-faint">
              {t("chat.picked", { count: picked.length })}
            </span>
          </div>
          <div className="mt-[9px] flex h-[34px] items-center gap-2 rounded-inset border border-line bg-raise px-[11px]">
            <MagnifyingGlassIcon size={13} className="text-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("chat.searchPeople")}
              aria-label={t("chat.searchPeople")}
              className="min-w-0 flex-1 border-0 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
            />
          </div>
        </>
      }
      footer={
        <>
          <button
            type="button"
            data-testid="group-chat-management-save"
            disabled={!ready || !normalizedTitle || busy}
            onClick={() =>
              onSave({
                ...(titleChanged ? { title: normalizedTitle } : {}),
                addParticipantIds: picked,
              })
            }
            className="h-8 cursor-pointer rounded-inset border-0 bg-accent-strong px-4 text-[12px] font-[620] text-on-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? t("chat.saving") : t("chat.saveChanges")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-8 cursor-pointer rounded-inset border-0 bg-transparent px-3 text-[12px] text-faint hover:text-ink"
          >
            {t("general.close")}
          </button>
          {error ? (
            <span role="alert" className="ml-auto text-[10.5px] text-danger">
              {error}
            </span>
          ) : (
            <span className="ml-auto text-[10.5px] text-faint">
              {t("chat.newMembersHistoryHint")}
            </span>
          )}
        </>
      }
    >
      {available.map((candidate) => {
        const on = picked.includes(candidate.id);
        return (
          <button
            key={candidate.id}
            type="button"
            data-testid={`group-chat-add-candidate-${candidate.id}`}
            onClick={() => toggle(candidate.id)}
            aria-pressed={on}
            className={cn(
              "mb-0.5 grid w-full cursor-pointer grid-cols-[28px_minmax(0,1fr)_16px] items-center gap-2.5 rounded-inset border-0 px-[9px] py-2 text-left text-ink",
              on ? "bg-sel" : "bg-transparent hover:bg-hover-wash",
            )}
          >
            <Avatar id={candidate.id} name={candidate.displayName} size="lg" />
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate text-[12.5px] font-[560]">
                {candidate.displayName}
              </span>
              <span className="truncate font-mono text-[9.5px] text-faint">
                {candidate.teamName}
              </span>
            </span>
            {on ? (
              <CheckCircleIcon
                size={15}
                weight="fill"
                className="text-accent-strong"
              />
            ) : (
              <CircleIcon size={15} className="text-faint" />
            )}
          </button>
        );
      })}
      {available.length === 0 ? (
        <div className="px-[9px] py-3.5 text-[11.5px] text-faint">
          {needle ? t("chat.noPeople") : t("chat.everyoneAlreadyJoined")}
        </div>
      ) : null}
    </Modal>
  );
}
