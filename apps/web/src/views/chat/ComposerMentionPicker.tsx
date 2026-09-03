import { RobotIcon } from "@phosphor-icons/react";
import type { MutableRefObject } from "react";

import { Avatar, cn } from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";
import { MENTION_LISTBOX_ID } from "./constants.js";
import type { ConversationMentionCandidate } from "./mentions.js";
import { mentionOptionId } from "./mentions.js";

export function ComposerMentionPicker({
  open,
  candidates,
  activeCandidate,
  mentionOptionRefs,
  onSelect,
  onHover,
}: {
  open: boolean;
  candidates: ConversationMentionCandidate[];
  activeCandidate: ConversationMentionCandidate | undefined;
  mentionOptionRefs: MutableRefObject<Map<string, HTMLButtonElement>>;
  onSelect(candidate: ConversationMentionCandidate): void;
  onHover(index: number): void;
}) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div
      id={MENTION_LISTBOX_ID}
      role="listbox"
      data-testid="communications-mention-picker"
      className="absolute bottom-[54px] left-[11px] right-[11px] z-20 grid max-h-[220px] gap-1 overflow-auto rounded-inset border border-line bg-panel p-1.5 shadow-[0_16px_42px_rgba(0,0,0,0.22)] sm:right-auto sm:w-[360px]"
    >
      {candidates.length > 0 ? (
        candidates.map((candidate, index) => (
          <button
            type="button"
            key={candidate.principalId}
            id={mentionOptionId(candidate.principalId)}
            role="option"
            aria-selected={
              candidate.principalId === activeCandidate?.principalId
            }
            ref={(element) => {
              if (element) {
                mentionOptionRefs.current.set(candidate.principalId, element);
              } else {
                mentionOptionRefs.current.delete(candidate.principalId);
              }
            }}
            data-testid={`communications-mention-option-${candidate.principalId}`}
            onClick={() => onSelect(candidate)}
            onMouseEnter={() => onHover(index)}
            className={cn(
              "grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded-btn border-0 px-2.5 py-2 text-left",
              candidate.principalId === activeCandidate?.principalId
                ? "bg-raise"
                : "bg-transparent hover:bg-raise",
            )}
          >
            {candidate.kind !== "human" ? (
              <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-accent-soft text-accent-strong">
                <RobotIcon size={14} />
              </span>
            ) : (
              <Avatar
                id={candidate.principalId}
                name={candidate.displayName}
                size="md"
              />
            )}
            <strong className="truncate text-[11.5px] font-[620] text-ink">
              {candidate.displayName}
            </strong>
            <small className="rounded-pill bg-raise px-2 py-0.5 text-[9.5px] text-faint">
              {t(
                candidate.kind === "stand_in"
                  ? "chat.mentionStandIn"
                  : candidate.kind === "service"
                    ? "chat.mentionIntero"
                    : "chat.mentionPerson",
              )}
            </small>
          </button>
        ))
      ) : (
        <span className="px-2.5 py-3 text-[11px] text-faint">
          {t("chat.noMentionCandidates")}
        </span>
      )}
    </div>
  );
}
