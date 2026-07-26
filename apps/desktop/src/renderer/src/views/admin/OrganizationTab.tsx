import {
  BuildingsIcon,
  CaretDownIcon,
  ShieldCheckIcon,
  UserIcon,
} from "@phosphor-icons/react";
import type {
  PilotOrganization,
  PilotOrganizationRole,
  PilotProject,
  PrincipalId,
} from "@intero/domain";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import {
  Avatar,
  EmptySlot,
  Meta,
  ScopeMark,
  SelectMenu,
  StatCard,
  StatusPill,
  TableHead,
  cn,
} from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";
import {
  renamePilotOrganization,
  updatePilotOrganizationMember,
  type PilotOrganizationDirectoryPayload,
  type PilotTeamPayload,
} from "../../pilot/api.js";

const PERSON_COLUMNS = "minmax(0,1.3fr) minmax(0,1fr) 128px minmax(0,1fr)";

type DirectoryMember = PilotOrganizationDirectoryPayload["members"][number];

/**
 * 组织 — the organization itself: what it is called, how big it is, and who
 * holds administrator rights across every team.
 *
 * The people table is org-wide on purpose. Team roles are edited where the
 * team is (成员与权限); what belongs here is the one role that is not scoped
 * to a team at all.
 */
export function OrganizationTab({
  organization,
  teams,
  projects,
  members,
  identityId,
  canManage,
  onOpenService,
  onChanged,
}: {
  organization: PilotOrganization | undefined;
  teams: PilotTeamPayload[];
  projects: PilotProject[];
  members: DirectoryMember[];
  identityId: PrincipalId;
  canManage: boolean;
  onOpenService: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const rename = useMutation({
    mutationFn: () => renamePilotOrganization(identityId, name.trim()),
    onSuccess: async () => {
      setEditingName(false);
      await onChanged();
    },
  });
  const changeRole = useMutation({
    mutationFn: (input: {
      memberId: PrincipalId;
      organizationRole: PilotOrganizationRole;
    }) =>
      updatePilotOrganizationMember(
        identityId,
        input.memberId,
        input.organizationRole,
      ),
    onSuccess: onChanged,
  });

  const admins = members.filter(
    (member) => member.organizationRole === "admin",
  );
  const teamName = (teamId: string) =>
    teams.find((team) => team.id === teamId)?.name;

  return (
    <div className="mt-[26px] flex flex-col gap-[30px]">
      <div>
        <strong className="text-[14px] font-[620]">
          {t("admin.org.profile")}
        </strong>
        <p className="mt-2 max-w-[580px] text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
          {t("admin.org.profileDetail")}
        </p>
        <div className="mt-3.5 rounded-[13px] border border-line bg-panel2 px-4 py-[15px]">
          <div className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-[13px]">
            {organization ? (
              <ScopeMark
                id={organization.id}
                label={organization.name}
                size="lg"
                filled
              />
            ) : (
              <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-raise text-ink-muted">
                <BuildingsIcon size={16} />
              </span>
            )}
            <span className="grid min-w-0">
              <strong className="truncate text-[12.5px] font-[620]">
                {organization?.name ?? t("general.unavailable")}
              </strong>
              <small className="mt-1 truncate font-mono text-[11px] text-ink-muted">
                {organization?.deploymentBaseUrl ?? t("general.unavailable")}
              </small>
            </span>
            {canManage ? (
              <button
                type="button"
                data-testid="admin-org-rename"
                onClick={() => {
                  setName(organization?.name ?? "");
                  setEditingName(true);
                }}
                className="h-8 cursor-pointer rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] text-ink hover:border-accent-strong"
              >
                {t("admin.org.rename")}
              </button>
            ) : (
              <StatusPill tone="faint" size="sm">
                {t("admin.policy.readOnly")}
              </StatusPill>
            )}
          </div>
          {editingName ? (
            <div className="mt-4 flex gap-2 border-t border-line pt-4">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                data-testid="admin-org-name-input"
                aria-label={t("admin.org.name")}
                className="h-9 min-w-0 flex-1 rounded-btn border border-line2 bg-raise px-3 text-[12px] text-ink outline-none focus:border-accent-strong"
              />
              <button
                type="button"
                disabled={!name.trim() || rename.isPending}
                onClick={() => rename.mutate()}
                className="h-9 cursor-pointer rounded-btn border-0 bg-accent-strong px-4 text-[12px] font-[620] text-on-accent disabled:cursor-not-allowed disabled:opacity-45"
              >
                {t("admin.form.save")}
              </button>
              <button
                type="button"
                onClick={() => setEditingName(false)}
                className="h-9 cursor-pointer rounded-btn border border-line2 bg-transparent px-3.5 text-[12px] text-ink-muted hover:border-accent-strong hover:text-ink"
              >
                {t("admin.form.cancel")}
              </button>
            </div>
          ) : null}
          <p className="mt-3 text-[11px] leading-[1.6] text-faint [text-wrap:pretty]">
            {t("admin.org.deploymentHint")}{" "}
            <button
              type="button"
              onClick={onOpenService}
              className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-accent-strong"
            >
              {t("admin.tab.service")}
            </button>
          </p>
          {rename.isError ? (
            <p className="mt-2 text-[11px] text-danger" role="alert">
              {t("admin.org.renameFailed")}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
        <StatCard
          title={t("admin.org.people")}
          value={members.length}
          detail={t("admin.org.peopleDetail", { count: admins.length })}
        />
        <StatCard
          title={t("admin.org.teams")}
          value={teams.length}
          detail={t("admin.org.teamsDetail")}
        />
        <StatCard
          title={t("admin.org.projects")}
          value={projects.length}
          detail={t("admin.org.projectsDetailAll")}
        />
      </div>

      <div>
        <div className="flex items-center gap-2.5">
          <strong className="text-[14px] font-[620]">
            {t("admin.org.directory")}
          </strong>
          <span className="text-[11px] text-faint">
            {t("admin.org.directoryHint")}
          </span>
        </div>
        <div className="mt-3.5">
          <TableHead
            template={PERSON_COLUMNS}
            columns={[
              t("admin.members.colMember"),
              t("admin.members.colEmail"),
              t("admin.members.colOrgRole"),
              t("admin.org.colTeams"),
            ]}
          />
        </div>
        <div className="mt-1.5 flex flex-col gap-1.5">
          {members.map((member) => (
            <div
              key={member.id}
              className="grid items-center gap-3 rounded-[13px] border border-line bg-panel2 px-4 py-3"
              style={{ gridTemplateColumns: PERSON_COLUMNS }}
            >
              <span className="grid min-w-0 grid-cols-[30px_minmax(0,1fr)] items-center gap-2.5">
                <Avatar id={member.id} name={member.displayName} size="lg" />
                <span className="flex min-w-0 items-center gap-1.5">
                  <strong className="truncate text-[12.5px] font-[600]">
                    {member.displayName}
                  </strong>
                  {member.id === identityId ? (
                    <span className="shrink-0 rounded-quiet bg-raise px-1.5 py-0.5 text-[9.5px] text-faint">
                      {t("admin.members.you")}
                    </span>
                  ) : null}
                </span>
              </span>
              <Meta className="truncate text-[11px]">{member.email}</Meta>
              <SelectMenu
                label={t("admin.members.colOrgRole")}
                disabled={!canManage}
                value={member.organizationRole}
                onChange={(organizationRole) =>
                  changeRole.mutate({
                    memberId: member.id,
                    organizationRole,
                  })
                }
                options={[
                  {
                    id: "member" as const,
                    label: t("admin.role.orgMember"),
                    leading: <UserIcon size={13} />,
                  },
                  {
                    id: "admin" as const,
                    label: t("admin.role.orgAdmin"),
                    leading: <ShieldCheckIcon size={13} />,
                  },
                ]}
              >
                <span
                  className={cn(
                    "inline-flex h-[27px] w-full items-center gap-[7px] rounded-quiet border px-2.5 text-[11px] font-[560]",
                    member.organizationRole === "admin"
                      ? "border-accent-strong bg-sel text-ink"
                      : "border-line bg-transparent text-ink-muted",
                    canManage ? "hover:border-accent-strong" : "opacity-45",
                  )}
                >
                  {member.organizationRole === "admin" ? (
                    <ShieldCheckIcon size={13} />
                  ) : (
                    <UserIcon size={13} />
                  )}
                  <span className="truncate">
                    {t(
                      member.organizationRole === "admin"
                        ? "admin.role.orgAdmin"
                        : "admin.role.orgMember",
                    )}
                  </span>
                  {canManage ? (
                    <CaretDownIcon
                      size={9}
                      className="ml-auto shrink-0 opacity-70"
                    />
                  ) : null}
                </span>
              </SelectMenu>
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {member.teamIds.flatMap((teamId) => {
                  const label = teamName(teamId);
                  return label
                    ? [
                        <span
                          key={teamId}
                          className="inline-flex max-w-full items-center gap-1.5 rounded-pill bg-raise px-2 py-[3px] text-[10.5px] text-ink-muted"
                        >
                          <ScopeMark
                            id={teamId}
                            label={label}
                            size="sm"
                            className="h-[14px] w-[14px] text-[7px]"
                          />
                          <span className="truncate">{label}</span>
                        </span>,
                      ]
                    : [];
                })}
                {member.teamIds.length === 0 ? (
                  <Meta className="text-[10.5px]">{t("admin.org.noTeam")}</Meta>
                ) : null}
              </span>
            </div>
          ))}
          {members.length === 0 ? (
            <EmptySlot>{t("admin.org.directoryEmpty")}</EmptySlot>
          ) : null}
        </div>
        {changeRole.isError ? (
          <p className="mt-3 text-[11px] text-danger" role="alert">
            {t(
              (changeRole.error as { code?: string })?.code ===
                "LAST_ORGANIZATION_ADMIN"
                ? "admin.org.lastAdmin"
                : "admin.org.roleFailed",
            )}
          </p>
        ) : null}
        <p className="mt-3 text-[11px] text-faint [text-wrap:pretty]">
          {t("admin.org.directoryFoot")}
        </p>
      </div>
    </div>
  );
}
