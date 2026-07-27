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

export type NewConversationKind = "human_group" | "room" | "human_direct";

export interface ConversationCandidate {
  id: string;
  displayName: string;
  teamId: string;
  teamName: string;
}

/**
 * Starting a conversation, with the people in it chosen up front.
 *
 * The team chips narrow who is offered, not who the thread belongs to — a
 * conversation thread has no team of its own, so claiming one would be a lie.
 */
export function NewConversationModal({
  kinds,
  candidates,
  busy,
  error,
  onClose,
  onCreate,
}: {
  kinds: NewConversationKind[];
  candidates: ConversationCandidate[];
  busy: boolean;
  error: boolean;
  onClose: () => void;
  onCreate: (input: {
    kind: NewConversationKind;
    title: string;
    memberIds: string[];
    teamId?: string;
  }) => void;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<NewConversationKind>(
    kinds[0] ?? "human_group",
  );
  const [title, setTitle] = useState("");
  // One control, two meanings by design: the team owns the conversation and
  // narrows the member list. Leaving it unset is a real choice, not a default.
  const [teamId, setTeamId] = useState<string>();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const single = kind === "human_direct";
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

  const ready = single ? picked.length === 1 : Boolean(title.trim());

  function toggle(id: string) {
    setPicked((current) =>
      single
        ? current[0] === id
          ? []
          : [id]
        : current.includes(id)
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
          {kinds.length > 1 ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {kinds.map((option) => (
                <FilterChip
                  key={option}
                  active={kind === option}
                  {...(option === "human_direct"
                    ? { testId: "pilot-new-direct-message" }
                    : {})}
                  onClick={() => {
                    setKind(option);
                    setPicked([]);
                  }}
                >
                  {t(
                    option === "room"
                      ? "chat.room"
                      : option === "human_direct"
                        ? "chat.direct"
                        : "chat.temporaryGroup",
                  )}
                </FilterChip>
              ))}
            </div>
          ) : null}

          {single ? null : (
            <div className="mt-[18px] flex h-10 items-center gap-[9px] rounded-[11px] border border-line2 bg-raise px-3">
              <span className="font-mono text-[14px] text-faint">#</span>
              <input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("chat.namePlaceholder")}
                aria-label={t("chat.namePlaceholder")}
                className="min-w-0 flex-1 border-0 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-faint"
              />
            </div>
          )}

          {teams.length > 1 ? (
            <>
              <div className="mt-[18px] flex items-baseline gap-2">
                <SectionLabel>{t("chat.owningTeam")}</SectionLabel>
                <span className="text-[10.5px] text-faint">
                  {t(single ? "chat.filterByTeamHint" : "chat.owningTeamHint")}
                </span>
              </div>
              <div className="mt-[9px] flex flex-wrap gap-1.5">
                {teams.map((team) => (
                  <FilterChip
                    key={team.id}
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
              {single
                ? t("chat.pickOne")
                : t("chat.picked", { count: picked.length })}
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
            disabled={!ready || busy}
            {...(single ? { "data-testid": "pilot-create-dm" } : {})}
            onClick={() =>
              onCreate({
                kind,
                title: title.trim(),
                memberIds: picked,
                ...(teamId && !single ? { teamId } : {}),
              })
            }
            className="h-8 cursor-pointer rounded-inset border-0 bg-accent-strong px-4 text-[12px] font-[620] text-on-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            {t(single ? "chat.startDirect" : "chat.create")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-8 cursor-pointer rounded-inset border-0 bg-transparent px-3 text-[12px] text-faint hover:text-ink"
          >
            {t("general.close")}
          </button>
          <span className="ml-auto text-[10.5px] text-faint">
            {error
              ? t("chat.createFailed")
              : single
                ? t("chat.directHint")
                : t("chat.groupHint")}
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
