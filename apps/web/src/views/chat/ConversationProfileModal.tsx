import { ChatCircleDotsIcon, UserIcon } from "@phosphor-icons/react";

import { Avatar, Modal } from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";

export function ConversationProfileModal({
  principalId,
  displayName,
  teamName,
  groupTitle,
  busy,
  onClose,
  onOpenDirectMessage,
  onOpenFullProfile,
}: {
  principalId: string;
  displayName: string;
  teamName?: string;
  groupTitle: string;
  busy: boolean;
  onClose: () => void;
  onOpenDirectMessage: () => void;
  onOpenFullProfile?: () => void;
}) {
  const { t } = useI18n();

  return (
    <Modal
      title={t("person.profileTitle")}
      width={390}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            data-testid="conversation-profile-start-dm"
            disabled={busy}
            onClick={onOpenDirectMessage}
            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-btn border-0 bg-accent-strong px-4 text-[12px] font-[620] text-on-accent disabled:cursor-wait disabled:opacity-50"
          >
            <ChatCircleDotsIcon size={15} />
            {busy ? t("person.dmStarting") : t("person.dm")}
          </button>
          {onOpenFullProfile ? (
            <button
              type="button"
              data-testid="conversation-profile-open-full"
              onClick={onOpenFullProfile}
              className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-btn border border-line2 bg-transparent px-4 text-[12px] text-ink hover:border-accent-strong hover:text-accent-strong"
            >
              <UserIcon size={14} />
              {t("person.viewFullProfile")}
            </button>
          ) : null}
        </>
      }
    >
      <div
        data-testid="conversation-profile"
        className="grid justify-items-center px-3 pb-5 pt-4 text-center"
      >
        <Avatar id={principalId} name={displayName} size="xl" />
        <strong className="mt-3 text-[18px] font-[620] tracking-[-0.02em]">
          {displayName}
        </strong>
        <span className="mt-1.5 text-[11.5px] text-ink-muted">
          {teamName ?? t("person.organizationMember")}
        </span>
        <span className="mt-4 rounded-pill bg-raise px-3 py-1.5 text-[10.5px] text-faint">
          {t("person.sharedGroup", { group: groupTitle })}
        </span>
      </div>
    </Modal>
  );
}
