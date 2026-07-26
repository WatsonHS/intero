import { PlusIcon } from "@phosphor-icons/react";
import type { PilotProject, PrincipalId } from "@intero/domain";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import {
  EmptySlot,
  Meta,
  Modal,
  ScopeMark,
  TableHead,
  TextField,
} from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";
import {
  createPilotTeam,
  renamePilotTeam,
  type PilotTeamPayload,
} from "../../pilot/api.js";
import { projectInTeam } from "../../pilot/context.js";

const TEAM_COLUMNS = "32px minmax(0,1fr) 84px 84px minmax(0,168px)";

/**
 * 团队 — creating teams, naming them, and reaching each one's roster.
 *
 * An organization admin sees every team here, including the ones they are not
 * a member of; a Team Lead sees the teams they belong to and can rename the
 * ones they lead. Managing a roster happens on 成员与权限 for the team named
 * there, so a row's 成员 action opens that tab on this team rather than
 * quietly moving the shell's scope underneath the reader.
 */
export function TeamsTab({
  teams,
  projects,
  currentTeamId,
  identityId,
  canCreate,
  canManage,
  scopedToOwnTeams,
  onOpenMembers,
  onOpenTeam,
  onChanged,
}: {
  teams: PilotTeamPayload[];
  projects: PilotProject[];
  currentTeamId: string | undefined;
  identityId: PrincipalId;
  canCreate: boolean;
  canManage: (teamId: string) => boolean;
  /** True when the list only holds the teams the viewer belongs to. */
  scopedToOwnTeams: boolean;
  onOpenMembers: (teamId: string) => void;
  onOpenTeam: (teamId: string) => void;
  onChanged: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<PilotTeamPayload>();

  return (
    <div className="mt-[26px]">
      <div className="flex items-center gap-3">
        <strong className="text-[14px] font-[620]">
          {t("admin.teams.title")}
        </strong>
        <Meta className="text-[10.5px]">
          {t("admin.teams.count", { count: teams.length })}
        </Meta>
        {canCreate ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            data-testid="admin-create-team"
            className="ml-auto inline-flex h-8 cursor-pointer items-center gap-[7px] rounded-btn border-0 bg-accent-strong px-[13px] text-[12px] font-[560] text-on-accent"
          >
            <PlusIcon size={14} />
            {t("admin.teams.create")}
          </button>
        ) : null}
      </div>
      <p className="mt-2 max-w-[620px] text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
        {t(scopedToOwnTeams ? "admin.teams.ledeTeam" : "admin.teams.ledeOrg")}
      </p>

      <div className="mt-[18px]">
        <TableHead
          template={TEAM_COLUMNS}
          columns={[
            "",
            t("admin.org.teamList"),
            t("admin.org.people"),
            t("admin.org.projects"),
            "",
          ]}
        />
      </div>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {teams.map((team) => {
          const leader = team.members.find(
            (member) => member.teamRole === "leader",
          );
          const owned = projects.filter((project) =>
            projectInTeam(project, team.id),
          ).length;
          const manageable = canManage(team.id);
          return (
            <div
              key={team.id}
              className="grid items-center gap-3 rounded-[13px] border border-line bg-panel2 px-4 py-3"
              style={{ gridTemplateColumns: TEAM_COLUMNS }}
            >
              <ScopeMark id={team.id} label={team.name} size="lg" filled />
              <span className="grid min-w-0">
                <strong className="truncate text-[12.5px] font-[600]">
                  {team.name}
                </strong>
                <small className="mt-[3px] truncate text-[10.5px] text-faint">
                  {leader
                    ? t("admin.org.ledBy", { name: leader.displayName })
                    : t("scope.teamNoLeader")}
                </small>
              </span>
              <Meta className="text-[11px]" tone="muted">
                {t("admin.org.memberCount", { count: team.members.length })}
              </Meta>
              <span className="text-[11px] text-ink-muted">
                {t("admin.org.projectCount", { count: owned })}
              </span>
              <span className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => onOpenMembers(team.id)}
                  className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-ink-muted hover:text-accent-strong"
                >
                  {t("admin.teams.members")}
                </button>
                {manageable ? (
                  <button
                    type="button"
                    onClick={() => setRenaming(team)}
                    className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-ink-muted hover:text-accent-strong"
                  >
                    {t("admin.teams.rename")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onOpenTeam(team.id)}
                  disabled={team.id === currentTeamId}
                  className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-ink-muted hover:text-accent-strong disabled:cursor-default disabled:text-faint"
                >
                  {t(
                    team.id === currentTeamId
                      ? "admin.org.current"
                      : "admin.org.open",
                  )}
                </button>
              </span>
            </div>
          );
        })}
        {teams.length === 0 ? (
          <EmptySlot>{t("admin.teams.empty")}</EmptySlot>
        ) : null}
      </div>

      {creating ? (
        <TeamNameModal
          title={t("admin.teams.createTitle")}
          submitLabel={t("admin.teams.createSubmit")}
          hint={t("admin.teams.createHint")}
          initialName=""
          onClose={() => setCreating(false)}
          onSubmit={(name) => createPilotTeam(identityId, name)}
          onDone={async () => {
            setCreating(false);
            await onChanged();
          }}
        />
      ) : null}

      {renaming ? (
        <TeamNameModal
          title={t("admin.teams.renameTitle")}
          submitLabel={t("admin.teams.renameSubmit")}
          hint={t("admin.teams.renameHint")}
          initialName={renaming.name}
          onClose={() => setRenaming(undefined)}
          onSubmit={(name) => renamePilotTeam(identityId, renaming.id, name)}
          onDone={async () => {
            setRenaming(undefined);
            await onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

/** Create and rename share one form: a single name, validated the same way. */
function TeamNameModal({
  title,
  submitLabel,
  hint,
  initialName,
  onClose,
  onSubmit,
  onDone,
}: {
  title: string;
  submitLabel: string;
  hint: string;
  initialName: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<unknown>;
  onDone: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const save = useMutation({
    mutationFn: () => onSubmit(name.trim()),
    onSuccess: onDone,
  });
  const submit = () => {
    if (name.trim() && !save.isPending) save.mutate();
  };

  return (
    <Modal
      title={title}
      width={420}
      onClose={onClose}
      footer={
        <>
          <span className="flex-1 text-[11px] text-faint">
            {save.isError
              ? t(
                  (save.error as { code?: string })?.code === "TEAM_NAME_TAKEN"
                    ? "admin.teams.nameTaken"
                    : "admin.teams.failed",
                )
              : null}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-8 cursor-pointer rounded-btn border border-line2 bg-transparent px-3.5 text-[12px] text-ink-muted hover:border-accent-strong hover:text-ink"
          >
            {t("admin.form.cancel")}
          </button>
          <button
            type="button"
            disabled={!name.trim() || save.isPending}
            onClick={submit}
            data-testid="admin-team-name-submit"
            className="h-8 cursor-pointer rounded-btn border-0 bg-accent-strong px-3.5 text-[12px] font-[620] text-on-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            {submitLabel}
          </button>
        </>
      }
    >
      <TextField
        label={t("admin.teams.nameLabel")}
        value={name}
        onChange={setName}
        onEnter={submit}
        placeholder={t("admin.teams.namePlaceholder")}
        testId="admin-team-name-input"
      />
      <p className="mt-3 text-[11px] leading-[1.7] text-faint [text-wrap:pretty]">
        {hint}
      </p>
    </Modal>
  );
}
