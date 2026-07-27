import { UserPlusIcon } from "@phosphor-icons/react";
import type { PrincipalId } from "@intero/domain";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { Avatar, Checkbox, EmptySlot, Modal } from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";
import {
  addPilotTeamMember,
  type PilotOrganizationDirectoryPayload,
} from "../../pilot/api.js";

type DirectoryMember = PilotOrganizationDirectoryPayload["members"][number];

/**
 * Adds people the organization already knows about to a team.
 *
 * Anyone without an account is deliberately absent: they join through an
 * invitation, which is what creates their account in the first place. People
 * are added one at a time and the list shrinks as they join, so a mistaken
 * click is visible immediately rather than at the end of a batch.
 */
export function AddMemberModal({
  teamId,
  teamName,
  existingMemberIds,
  candidates,
  identityId,
  onClose,
  onChanged,
}: {
  teamId: string;
  teamName: string;
  existingMemberIds: string[];
  /** Organization-wide people. Only an admin can read this list. */
  candidates: DirectoryMember[];
  identityId: PrincipalId;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [asLeader, setAsLeader] = useState(false);
  const inTeam = new Set(existingMemberIds);
  const available = candidates.filter((member) => !inTeam.has(member.id));
  const add = useMutation({
    mutationFn: (memberId: PrincipalId) =>
      addPilotTeamMember(identityId, teamId, {
        memberId,
        role: asLeader ? "leader" : "member",
      }),
    onSuccess: onChanged,
  });

  return (
    <Modal
      title={t("admin.teams.addMemberTitle", { team: teamName })}
      width={470}
      onClose={onClose}
      head={
        <div className="mt-2.5 grid gap-2.5">
          <p className="m-0 text-[11.5px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
            {t("admin.teams.addMemberHint")}
          </p>
          <Checkbox
            checked={asLeader}
            onChange={setAsLeader}
            label={t("admin.teams.asLeader")}
          />
        </div>
      }
    >
      <div className="flex flex-col gap-1.5 pt-1">
        {available.map((member) => (
          <div
            key={member.id}
            className="grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-inset border border-line bg-panel2 px-3 py-2.5"
          >
            <Avatar id={member.id} name={member.displayName} size="lg" />
            <span className="grid min-w-0">
              <strong className="truncate text-[12px] font-[600]">
                {member.displayName}
              </strong>
              <small className="mt-px truncate font-mono text-[10.5px] text-faint">
                {member.email}
              </small>
            </span>
            <button
              type="button"
              disabled={add.isPending}
              onClick={() => add.mutate(member.id)}
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-quiet border border-line2 bg-transparent px-2.5 text-[11.5px] text-ink-muted hover:border-accent-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
            >
              <UserPlusIcon size={13} />
              {t("admin.teams.addMemberSubmit")}
            </button>
          </div>
        ))}
        {available.length === 0 ? (
          <EmptySlot>{t("admin.teams.addMemberEmpty")}</EmptySlot>
        ) : null}
        {add.isError ? (
          <p className="m-0 text-[11px] text-danger" role="alert">
            {t("admin.teams.failed")}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
