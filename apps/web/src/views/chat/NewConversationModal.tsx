import {
  CheckCircleIcon,
  CircleIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

import {
  Avatar,
  FilterChip,
  Modal,
  SectionLabel,
  cn,
} from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";

export interface ConversationCandidate {
  id: string;
  displayName: string;
  teamId: string;
  teamName: string;
}

/**
 * Creates a durable group chat. Discussion groups are created automatically
 * from a focused branch, while direct messages start from a person's profile.
 */
export function NewConversationModal({
  candidates,
  busy,
  onClose,
  onCreate,
}: {
  candidates: ConversationCandidate[];
  busy: boolean;
  onClose: () => void;
  onCreate: (input: {
    title: string;
    memberIds: string[];
    teamId?: string;
  }) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  // The optional owning team also narrows the member list.
  const [teamId, setTeamId] = useState<string>();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const teams = [
    ...new Map(
      candidates.map((candidate) => [
        candidate.teamId,
        { id: candidate.teamId, name: candidate.teamName },
      ]),
    ).values(),
  ];
  const needle = query.trim().toLocaleLowerCase();
  const people = candidates
    .filter((candidate) => !teamId || candidate.teamId === teamId)
    .filter(
      (candidate) =>
        !needle ||
        candidate.displayName.toLocaleLowerCase().includes(needle) ||
        candidate.teamName.toLocaleLowerCase().includes(needle),
    );

  const ready = Boolean(title.trim()) && picked.length > 0;

  function toggle(id: string) {
    setPicked((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
  }

  return (
    <Modal
      title={t("chat.newTitle")}
      onClose={onClose}
      head={
        <>
          <div className="mt-[18px] flex h-10 items-center gap-[9px] rounded-[11px] border border-line2 bg-raise px-3">
            <span className="font-mono text-[14px] text-faint">#</span>
            <input
              autoFocus
              data-testid="new-conversation-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("chat.namePlaceholder")}
              aria-label={t("chat.namePlaceholder")}
              className="min-w-0 flex-1 border-0 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-faint"
            />
          </div>

          {teams.length > 1 ? (
            <>
              <div className="mt-[18px] flex items-baseline gap-2">
                <SectionLabel>{t("chat.owningTeam")}</SectionLabel>
                <span className="text-[10.5px] text-faint">
                  {t("chat.owningTeamHint")}
                </span>
              </div>
              <div className="mt-[9px] flex flex-wrap gap-1.5">
                {teams.map((team) => (
                  <FilterChip
                    key={team.id}
                    testId={`owning-team-${team.id}`}
                    active={teamId === team.id}
                    onClick={() =>
                      setTeamId((current) =>
                        current === team.id ? undefined : team.id,
                      )
                    }
                  >
                    {team.name}
                  </FilterChip>
                ))}
              </div>
            </>
          ) : null}

          <div className="mt-[18px] flex items-baseline gap-2">
            <SectionLabel>{t("chat.members")}</SectionLabel>
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
            data-testid="new-conversation-create"
            disabled={!ready || busy}
            onClick={() =>
              onCreate({
                title: title.trim(),
                memberIds: picked,
                ...((teamId ?? teams[0]?.id)
                  ? { teamId: teamId ?? teams[0]!.id }
                  : {}),
              })
            }
            className="h-8 cursor-pointer rounded-inset border-0 bg-accent-strong px-4 text-[12px] font-[620] text-on-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            {t("chat.create")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-8 cursor-pointer rounded-inset border-0 bg-transparent px-3 text-[12px] text-faint hover:text-ink"
          >
            {t("general.close")}
          </button>
          <span className="ml-auto text-[10.5px] text-faint">
            {t("chat.roomHint")}
          </span>
        </>
      }
    >
      {people.map((candidate) => {
        const on = picked.includes(candidate.id);
        return (
          <button
            key={candidate.id}
            type="button"
            data-testid={`conversation-candidate-${candidate.id}`}
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
      {people.length === 0 ? (
        <div className="px-[9px] py-3.5 text-[11.5px] text-faint">
          {t("chat.noPeople")}
        </div>
      ) : null}
    </Modal>
  );
}
