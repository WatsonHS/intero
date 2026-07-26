import {
  BuildingsIcon,
  CaretDownIcon,
  ClockCountdownIcon,
  EnvelopeSimpleIcon,
  KeyIcon,
  LockSimpleIcon,
  ScrollIcon,
  ShieldCheckIcon,
  UserIcon,
  UserPlusIcon,
  UsersThreeIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type {
  PilotOrganizationRole,
  PilotTeamRole,
  ProjectAutomationSignalKind,
} from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import {
  getGovernanceAudit,
  getProjectAutomation,
  updateProjectAutomation,
  type GovernanceAuditEntry,
} from "../api.js";
import {
  Avatar,
  EmptySlot,
  FilterChip,
  Meta,
  OptionCard,
  QueueCard,
  ScopeMark,
  SectionLabel,
  SelectMenu,
  StatCard,
  StatusPill,
  Switch,
  TableHead,
  Tabs,
  cn,
} from "../design/primitives.js";
import { useI18n } from "../i18n/index.js";
import type { Tone } from "../design/utils.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";
import {
  createPilotInvitation,
  getPilotInvitations,
  removePilotMember,
  revokePilotInvitation,
  updatePilotMember,
} from "../pilot/api.js";
import {
  projectInTeam,
  useGovernance,
  usePilotOptional,
} from "../pilot/context.js";
import { OrganizationServiceSettings } from "./settings/OrganizationServiceSettings.js";

type Tab = "members" | "policy" | "org" | "service" | "audit";

/** Escalation windows offered for the two automation SLAs. */
const SLA_HOURS = [8, 24, 48, 72];

/**
 * The presets plus whatever is actually stored. A policy set through the API to
 * a value outside the presets must still show as selected — otherwise the page
 * reads "nothing chosen" while a real window is in force.
 */
function slaOptions(current: number): number[] {
  return SLA_HOURS.includes(current)
    ? SLA_HOURS
    : [...SLA_HOURS, current].sort((left, right) => left - right);
}

const SIGNAL_KINDS: ProjectAutomationSignalKind[] = [
  "blocker",
  "dependency_change",
  "spec_review_stale",
  "coordination_unresolved",
  "project_work_risk",
];

/**
 * 团队管理 — the governance surface for a team leader or organization admin.
 *
 * Everything here is a real setting with a real writer behind it: team roles,
 * invitations, the project's automation policy, and the audit trail those
 * changes leave. Nothing on this page is illustrative.
 */
export function AdminView({ onOpenSpecs }: { onOpenSpecs: () => void }) {
  const { t, formatRelative } = useI18n();
  const pilot = usePilotOptional();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("members");

  const teams = pilot?.teams.data?.teams ?? [];
  const projects = pilot?.projects.data?.projects ?? [];
  const organizationName = pilot?.bootstrap.data?.organization?.name;
  const teamId = pilot?.selectedTeamId;
  const team = teams.find((candidate) => candidate.id === teamId);
  const projectId = pilot?.selectedProjectId;
  const { isOrgAdmin, isTeamLead, canGovern, pending } = useGovernance();
  // Leading a *different* team is enough to open this page, but not to edit the
  // team currently in scope — that still needs org admin or leading this one.
  const canManage = isOrgAdmin || isTeamLead;

  const invitations = useQuery({
    queryKey: ["pilot", "invitations", teamId],
    queryFn: ({ signal }) => getPilotInvitations(teamId!, signal),
    enabled: Boolean(teamId) && canManage,
  });
  const automation = useQuery({
    queryKey: ["project-automation", projectId],
    queryFn: ({ signal }) => getProjectAutomation(projectId!, signal),
    enabled: Boolean(projectId),
  });
  const governance = useQuery({
    queryKey: ["governance-audit"],
    queryFn: ({ signal }) => getGovernanceAudit(signal),
    enabled: canGovern,
  });

  const refreshTeams = async () => {
    await queryClient.invalidateQueries({ queryKey: ["pilot", "teams"] });
    // A role change is an audit event; the log must reflect it right away.
    await queryClient.invalidateQueries({ queryKey: ["governance-audit"] });
  };
  const refreshInvites = async () => {
    await queryClient.invalidateQueries({ queryKey: ["pilot", "invitations"] });
    await queryClient.invalidateQueries({ queryKey: ["governance-audit"] });
  };
  const refreshAutomation = () =>
    queryClient.invalidateQueries({ queryKey: ["project-automation"] });

  const changeMember = useMutation({
    mutationFn: (input: {
      memberId: string;
      teamRole?: PilotTeamRole;
      organizationRole?: PilotOrganizationRole;
    }) =>
      updatePilotMember(team!.id, input.memberId as never, {
        ...(input.teamRole ? { teamRole: input.teamRole } : {}),
        ...(input.organizationRole
          ? { organizationRole: input.organizationRole }
          : {}),
      }),
    onSuccess: refreshTeams,
  });
  const removeMember = useMutation({
    mutationFn: (memberId: string) =>
      removePilotMember(team!.id, memberId as never),
    onSuccess: refreshTeams,
  });
  const revoke = useMutation({
    mutationFn: revokePilotInvitation,
    onSuccess: refreshInvites,
  });
  const saveAutomation = useMutation({
    mutationFn: (input: {
      enabled: boolean;
      enabledSignals: ProjectAutomationSignalKind[];
      staleSpecReviewHours: number;
      unresolvedCoordinationHours: number;
    }) => updateProjectAutomation(projectId!, input),
    onSuccess: refreshAutomation,
  });

  if (!pilot?.enabled) {
    return (
      <div className="grid h-full place-items-center px-8 text-center text-[12px] text-faint">
        {t("admin.unavailable")}
      </div>
    );
  }
  if (pending) {
    return (
      <div className="grid h-full place-items-center text-[12px] text-faint">
        {t("admin.loading")}
      </div>
    );
  }
  if (!canGovern) {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <div className="max-w-[420px]">
          <LockSimpleIcon size={22} className="mx-auto text-faint" />
          <p className="mt-3 text-[12.5px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
            {t("admin.denied")}
          </p>
        </div>
      </div>
    );
  }

  const members = team?.members ?? [];
  const pendingInvites = (invitations.data?.invitations ?? []).filter(
    (invitation) => invitation.status === "pending",
  );
  const policy = automation.data?.policy;
  const openSignals = (automation.data?.signals ?? []).filter(
    (entry) => entry.signal.status === "opened",
  );
  // Someone with no team role beyond member and no organization role is not a
  // problem; someone the org has no admin for is. Surface only real gaps.
  const orgAdmins = members.filter(
    (member) => member.organizationRole === "admin",
  );

  const queue: Array<{
    id: string;
    tone: "accent" | "amber" | "danger";
    icon: typeof UserPlusIcon;
    title: string;
    detail: string;
    onClick: () => void;
  }> = [];
  if (pendingInvites.length > 0) {
    queue.push({
      id: "invites",
      tone: "accent",
      icon: UserPlusIcon,
      title: t("admin.queue.invites", { count: pendingInvites.length }),
      detail: t("admin.queue.invitesDetail"),
      onClick: () => setTab("members"),
    });
  }
  if (openSignals.length > 0) {
    queue.push({
      id: "signals",
      tone: "amber",
      icon: ClockCountdownIcon,
      title: t("admin.queue.signals", { count: openSignals.length }),
      detail: t("admin.queue.signalsDetail"),
      onClick: onOpenSpecs,
    });
  }
  if (orgAdmins.length === 0 && isOrgAdmin) {
    queue.push({
      id: "admins",
      tone: "danger",
      icon: WarningCircleIcon,
      title: t("admin.queue.noAdmin"),
      detail: t("admin.queue.noAdminDetail"),
      onClick: () => setTab("members"),
    });
  }

  return (
    <div className="animate-view-enter h-full overflow-auto px-[34px] pb-[70px] pt-[34px]">
      <div className="max-w-[980px]">
        {/* The heading names the surface; the scope it applies to belongs
            underneath it, not in place of it. */}
        <SectionLabel className="text-[11px] tracking-[0.1em] text-accent-strong">
          {t(isOrgAdmin ? "admin.kicker.org" : "admin.kicker.team")}
        </SectionLabel>
        <h1 className="mt-2.5 text-[28px] font-[540] tracking-[-0.035em]">
          {t("nav.admin")}
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {team ? (
            <>
              <ScopeMark id={team.id} label={team.name} size="sm" filled />
              <strong className="text-[13px] font-[620]">{team.name}</strong>
            </>
          ) : null}
          {organizationName ? (
            <Meta className="text-[11px]">· {organizationName}</Meta>
          ) : null}
        </div>
        <p className="mt-3 max-w-[620px] text-[13px] leading-[1.75] text-ink-muted [text-wrap:pretty]">
          {t(isOrgAdmin ? "admin.lead.org" : "admin.lead.team")}
        </p>

        {queue.length > 0 ? (
          <div className="mt-6 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(272px,1fr))]">
            {queue.map((entry) => {
              const Icon = entry.icon;
              return (
                <QueueCard
                  key={entry.id}
                  tone={entry.tone}
                  icon={<Icon size={16} />}
                  title={entry.title}
                  detail={entry.detail}
                  onClick={entry.onClick}
                />
              );
            })}
          </div>
        ) : null}

        <Tabs
          className="mt-7"
          value={tab}
          onChange={setTab}
          items={[
            {
              id: "members" as const,
              label: t("admin.tab.members"),
              icon: <UsersThreeIcon size={14} />,
            },
            {
              id: "policy" as const,
              label: t("admin.tab.policy"),
              icon: <ShieldCheckIcon size={14} />,
            },
            ...(isOrgAdmin
              ? [
                  {
                    id: "org" as const,
                    label: t("admin.tab.org"),
                    icon: <BuildingsIcon size={14} />,
                  },
                  {
                    id: "service" as const,
                    label: t("admin.tab.service"),
                    icon: <KeyIcon size={14} />,
                  },
                ]
              : []),
            {
              id: "audit" as const,
              label: t("admin.tab.audit"),
              icon: <ScrollIcon size={14} />,
            },
          ]}
        />

        {tab === "members" ? (
          <MembersTab
            teamId={team?.id}
            members={members}
            currentId={pilot.identityId}
            canSetOrgRole={Boolean(isOrgAdmin)}
            invitations={invitations.data?.invitations ?? []}
            onChangeRole={(input) => changeMember.mutate(input)}
            onRemove={(memberId) => removeMember.mutate(memberId)}
            onRevoke={(invitationId) => revoke.mutate(invitationId)}
            onInvited={refreshInvites}
          />
        ) : null}

        {tab === "policy" ? (
          <PolicyTab
            projectName={
              projects.find((project) => project.id === projectId)?.name
            }
            policy={policy}
            pending={automation.isPending}
            canManage={automation.data?.canManage ?? false}
            onSave={(input) => saveAutomation.mutate(input)}
          />
        ) : null}

        {tab === "service" && isOrgAdmin ? (
          <OrganizationServiceSettings canManage={isOrgAdmin} />
        ) : null}

        {tab === "org" && isOrgAdmin ? (
          <OrgTab
            teams={teams}
            projects={projects}
            currentTeamId={teamId}
            onOpenTeam={(id) => pilot.setSelectedTeamId(id)}
          />
        ) : null}

        {tab === "audit" ? (
          <AuditTab
            governance={governance.data?.entries ?? []}
            governancePrincipals={governance.data?.principals ?? []}
            automation={automation.data?.signals ?? []}
            members={members}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * One chronological log over both trails: governance changes (who changed
 * whose role, who was invited or removed) and how escalation signals were
 * handled. Both are events the system already emitted — neither is narrated
 * here, and neither carries prompts, model output or file contents.
 */
function AuditTab({
  governance,
  governancePrincipals,
  automation,
  members,
}: {
  governance: GovernanceAuditEntry[];
  governancePrincipals: Array<{ id: string; displayName: string }>;
  automation: Array<{
    signal: { kind: ProjectAutomationSignalKind; safeContext: string };
    audit: Array<{
      id: string;
      action: string;
      actorId?: string | undefined;
      createdAt: string;
    }>;
  }>;
  members: Array<{ id: string; displayName: string }>;
}) {
  const { t, formatRelative } = useI18n();
  const names = new Map(
    [...members, ...governancePrincipals].map((person) => [
      person.id,
      person.displayName,
    ]),
  );
  const nameOf = (id: string | undefined) =>
    id ? (names.get(id) ?? t("admin.audit.system")) : t("admin.audit.system");

  type Row = {
    id: string;
    at: string;
    title: string;
    tag: string;
    tone: Tone;
    body: string;
    actor: string;
  };

  const rows: Row[] = [
    ...governance.map((entry) => ({
      id: entry.id,
      at: entry.occurredAt,
      title: t(`admin.audit.event.${entry.eventType}` as TranslationKey),
      tag: t("admin.audit.tag.governance"),
      tone: "accent" as Tone,
      body: governanceLine(entry, nameOf, t),
      actor: nameOf(entry.actorId),
    })),
    ...automation.flatMap((entry) =>
      entry.audit.map((audit) => ({
        id: audit.id,
        at: audit.createdAt,
        title: t(`admin.audit.action.${audit.action}` as TranslationKey),
        tag: t(`admin.signal.${entry.signal.kind}` as TranslationKey),
        tone: "faint" as Tone,
        body: entry.signal.safeContext,
        actor: nameOf(audit.actorId),
      })),
    ),
  ]
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 60);

  return (
    <div className="mt-[26px]">
      <p className="m-0 max-w-[600px] text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
        {t("admin.audit.lede")}
      </p>
      <div className="mt-[18px] flex flex-col gap-1.5">
        {rows.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[26px_minmax(0,1fr)_auto] items-start gap-3.5 rounded-inset border border-line bg-panel2 px-4 py-3"
          >
            <span className="mt-px grid h-[26px] w-[26px] place-items-center rounded-quiet bg-raise text-ink-muted">
              <ScrollIcon size={13} />
            </span>
            <span className="grid min-w-0 gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <strong className="text-[12px] font-[620]">{row.title}</strong>
                <StatusPill tone={row.tone} size="sm">
                  {row.tag}
                </StatusPill>
              </span>
              {row.body ? (
                <span className="text-[11.5px] leading-[1.6] text-ink-muted [text-wrap:pretty]">
                  {row.body}
                </span>
              ) : null}
            </span>
            <span className="grid justify-items-end gap-1 whitespace-nowrap">
              <Meta className="text-[10px]">{formatRelative(row.at)}</Meta>
              <span className="text-[10.5px] text-faint">{row.actor}</span>
            </span>
          </div>
        ))}
        {rows.length === 0 ? (
          <EmptySlot>{t("admin.audit.empty")}</EmptySlot>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Renders a governance event from its structured detail, never free text.
 *
 * Returns an empty line when the event predates the detail being recorded —
 * the heading, actor and time are still true, and inventing a subject or a
 * role transition we never stored would not be.
 */
function governanceLine(
  entry: GovernanceAuditEntry,
  nameOf: (id: string | undefined) => string,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
): string {
  if (!entry.subjectId && !entry.detail.email) return "";
  const subject = nameOf(entry.subjectId);
  const roleLabel = (value: unknown, scope: "team" | "org") => {
    if (typeof value !== "string") return "—";
    if (scope === "team") {
      return t(value === "leader" ? "admin.role.leader" : "admin.role.member");
    }
    return t(
      value === "admin" ? "admin.role.orgAdmin" : "admin.role.orgMember",
    );
  };
  switch (entry.eventType) {
    case "pilot.team_member.role_changed":
      return t("admin.audit.line.teamRole", {
        name: subject,
        from: roleLabel(entry.detail.from, "team"),
        to: roleLabel(entry.detail.to, "team"),
      });
    case "pilot.organization_member.role_changed":
      return t("admin.audit.line.orgRole", {
        name: subject,
        from: roleLabel(entry.detail.from, "org"),
        to: roleLabel(entry.detail.to, "org"),
      });
    case "pilot.team_member.removed":
      return t("admin.audit.line.removed", { name: subject });
    case "pilot.team_invitation.created":
      return t("admin.audit.line.invited", {
        email: String(entry.detail.email),
      });
    case "pilot.team_invitation.revoked":
      return t("admin.audit.line.revoked", {
        email: String(entry.detail.email),
      });
    default:
      return entry.eventType;
  }
}

const MEMBER_COLUMNS = "minmax(0,1.4fr) 132px 120px minmax(0,1fr) 46px";
const TEAM_COLUMNS = "32px minmax(0,1fr) 88px 88px 72px";

function MembersTab({
  teamId,
  members,
  currentId,
  canSetOrgRole,
  invitations,
  onChangeRole,
  onRemove,
  onRevoke,
  onInvited,
}: {
  teamId: string | undefined;
  members: Array<{
    id: string;
    displayName: string;
    email: string;
    teamRole: PilotTeamRole;
    organizationRole?: PilotOrganizationRole | undefined;
  }>;
  currentId: string | undefined;
  canSetOrgRole: boolean;
  invitations: Array<{
    id: string;
    displayName: string;
    email: string;
    status: string;
    expiresAt: string;
  }>;
  onChangeRole: (input: {
    memberId: string;
    teamRole?: PilotTeamRole;
    organizationRole?: PilotOrganizationRole;
  }) => void;
  onRemove: (memberId: string) => void;
  onRevoke: (invitationId: string) => void;
  onInvited: () => void;
}) {
  const { t, formatRelative } = useI18n();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const invite = useMutation({
    mutationFn: () =>
      createPilotInvitation(teamId!, {
        displayName: displayName.trim(),
        email: email.trim(),
      }),
    onSuccess: () => {
      setDisplayName("");
      setEmail("");
      setInviteOpen(false);
      onInvited();
    },
  });

  // An accepted invitation is just a member now — it belongs in the table
  // above, not as a permanent row here. Only what still needs action shows.
  const open = invitations.filter(
    (invitation) => invitation.status !== "accepted",
  );
  const accepted = invitations.length - open.length;

  return (
    <div className="mt-[26px]">
      <div className="flex items-center gap-3">
        <strong className="text-[14px] font-[620]">
          {t("admin.members.title")}
        </strong>
        <Meta className="text-[10.5px]">
          {t("admin.members.count", { count: members.length })}
        </Meta>
        <button
          type="button"
          onClick={() => setInviteOpen((shown) => !shown)}
          className="ml-auto inline-flex h-8 cursor-pointer items-center gap-[7px] rounded-btn border-0 bg-accent-strong px-[13px] text-[12px] font-[560] text-on-accent"
        >
          <UserPlusIcon size={14} />
          {t("admin.members.invite")}
        </button>
      </div>

      {inviteOpen ? (
        <form
          className="mt-3.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2.5 rounded-[13px] border border-line bg-panel2 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (displayName.trim() && email.trim()) invite.mutate();
          }}
        >
          <label className="grid gap-1.5">
            <SectionLabel>{t("admin.members.inviteName")}</SectionLabel>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="h-8 rounded-btn border border-line bg-panel px-2.5 text-[12px] text-ink outline-none focus:border-accent-strong"
            />
          </label>
          <label className="grid gap-1.5">
            <SectionLabel>{t("admin.members.inviteEmail")}</SectionLabel>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-8 rounded-btn border border-line bg-panel px-2.5 font-mono text-[11.5px] text-ink outline-none focus:border-accent-strong"
            />
          </label>
          <button
            type="submit"
            disabled={!displayName.trim() || !email.trim() || invite.isPending}
            className="h-8 cursor-pointer rounded-btn border-0 bg-accent-strong px-3.5 text-[12px] font-[620] text-on-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            {t("admin.members.inviteSend")}
          </button>
          {invite.isError ? (
            <p
              className="col-span-full m-0 text-[11px] text-danger"
              role="alert"
            >
              {t("admin.members.inviteFailed")}
            </p>
          ) : null}
        </form>
      ) : null}

      <div className="mt-[18px]">
        <TableHead
          template={MEMBER_COLUMNS}
          columns={[
            t("admin.members.colMember"),
            t("admin.members.colTeamRole"),
            t("admin.members.colOrgRole"),
            t("admin.members.colEmail"),
            "",
          ]}
        />
      </div>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {members.map((member) => (
          <div
            key={member.id}
            className="grid items-center gap-3 rounded-[13px] border border-line bg-panel2 px-4 py-3"
            style={{ gridTemplateColumns: MEMBER_COLUMNS }}
          >
            <span className="grid min-w-0 grid-cols-[30px_minmax(0,1fr)] items-center gap-2.5">
              <Avatar id={member.id} name={member.displayName} size="lg" />
              <span className="grid min-w-0">
                <span className="flex min-w-0 items-center gap-1.5">
                  <strong className="truncate text-[12.5px] font-[600]">
                    {member.displayName}
                  </strong>
                  {member.id === currentId ? (
                    <span className="shrink-0 rounded-quiet bg-raise px-1.5 py-0.5 text-[9.5px] text-faint">
                      {t("admin.members.you")}
                    </span>
                  ) : null}
                </span>
              </span>
            </span>
            <SelectMenu
              label={t("admin.members.colTeamRole")}
              value={member.teamRole}
              onChange={(teamRole) =>
                onChangeRole({ memberId: member.id, teamRole })
              }
              options={[
                {
                  id: "member" as const,
                  label: t("admin.role.member"),
                  leading: <UserIcon size={13} />,
                },
                {
                  id: "leader" as const,
                  label: t("admin.role.leader"),
                  leading: <UsersThreeIcon size={13} />,
                },
              ]}
            >
              <RoleTrigger
                label={t(
                  member.teamRole === "leader"
                    ? "admin.role.leader"
                    : "admin.role.member",
                )}
                icon={
                  member.teamRole === "leader" ? (
                    <UsersThreeIcon size={13} />
                  ) : (
                    <UserIcon size={13} />
                  )
                }
                active={member.teamRole === "leader"}
              />
            </SelectMenu>
            <SelectMenu
              label={t("admin.members.colOrgRole")}
              disabled={!canSetOrgRole}
              value={member.organizationRole ?? "member"}
              onChange={(organizationRole) =>
                onChangeRole({ memberId: member.id, organizationRole })
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
              <RoleTrigger
                label={t(
                  member.organizationRole === "admin"
                    ? "admin.role.orgAdmin"
                    : "admin.role.orgMember",
                )}
                icon={
                  member.organizationRole === "admin" ? (
                    <ShieldCheckIcon size={13} />
                  ) : (
                    <UserIcon size={13} />
                  )
                }
                active={member.organizationRole === "admin"}
                disabled={!canSetOrgRole}
              />
            </SelectMenu>
            <Meta className="truncate text-[11px]">{member.email}</Meta>
            <button
              type="button"
              disabled={member.id === currentId}
              onClick={() => onRemove(member.id)}
              className="cursor-pointer justify-self-end border-0 bg-transparent p-0 text-[11px] text-ink-muted hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("admin.members.remove")}
            </button>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-faint [text-wrap:pretty]">
        {t("admin.members.roleFoot")}
      </p>

      <div className="mt-[30px]">
        <div className="flex items-center gap-2.5">
          <strong className="text-[14px] font-[620]">
            {t("admin.invites.title")}
          </strong>
          <span className="text-[11px] text-faint">
            {t("admin.invites.hint")}
          </span>
          {accepted > 0 ? (
            <Meta className="ml-auto text-[10.5px]">
              {t("admin.invites.acceptedHidden", { count: accepted })}
            </Meta>
          ) : null}
        </div>
        <div className="mt-3.5 flex flex-col gap-1.5">
          {open.map((invitation) => (
            <div
              key={invitation.id}
              className="grid grid-cols-[32px_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-[13px] border border-line bg-panel2 px-4 py-3"
            >
              <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-raise text-ink-muted">
                <EnvelopeSimpleIcon size={15} />
              </span>
              <span className="grid min-w-0">
                <strong className="truncate font-mono text-[11.5px] font-[500]">
                  {invitation.email}
                </strong>
                <small className="mt-1 text-[10.5px] text-faint">
                  {invitation.displayName} ·{" "}
                  {t("admin.invites.expires", {
                    when: formatRelative(invitation.expiresAt),
                  })}
                </small>
              </span>
              <StatusPill
                tone={
                  invitation.status === "pending"
                    ? "amber"
                    : invitation.status === "accepted"
                      ? "green"
                      : "faint"
                }
                size="sm"
              >
                {t(
                  `admin.invites.status.${invitation.status}` as TranslationKey,
                )}
              </StatusPill>
              {invitation.status === "pending" ? (
                <button
                  type="button"
                  onClick={() => onRevoke(invitation.id)}
                  className="h-7 cursor-pointer rounded-quiet border border-line2 bg-transparent px-[11px] text-[11.5px] text-ink-muted hover:border-danger hover:text-danger"
                >
                  {t("admin.invites.revoke")}
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
          {open.length === 0 ? (
            <EmptySlot>{t("admin.invites.empty")}</EmptySlot>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Trigger face for a role <SelectMenu>: current role plus an open affordance. */
function RoleTrigger({
  label,
  icon,
  active,
  disabled = false,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  disabled?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[27px] w-full items-center gap-[7px] rounded-quiet border px-2.5 text-[11px] font-[560]",
        active
          ? "border-accent-strong bg-sel text-ink"
          : "border-line bg-transparent text-ink-muted",
        disabled ? "opacity-45" : "hover:border-accent-strong",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
      {disabled ? null : (
        <CaretDownIcon size={9} className="ml-auto shrink-0 opacity-70" />
      )}
    </span>
  );
}

function PolicyTab({
  projectName,
  policy,
  pending,
  canManage,
  onSave,
}: {
  projectName: string | undefined;
  policy:
    | {
        enabled: boolean;
        enabledSignals: ProjectAutomationSignalKind[];
        staleSpecReviewHours: number;
        unresolvedCoordinationHours: number;
      }
    | undefined;
  pending: boolean;
  canManage: boolean;
  onSave: (input: {
    enabled: boolean;
    enabledSignals: ProjectAutomationSignalKind[];
    staleSpecReviewHours: number;
    unresolvedCoordinationHours: number;
  }) => void;
}) {
  const { t } = useI18n();

  if (pending) {
    return (
      <p className="mt-[26px] text-[12px] text-faint">{t("admin.loading")}</p>
    );
  }
  if (!policy) {
    return (
      <div className="mt-[26px]">
        <EmptySlot>{t("admin.policy.noProject")}</EmptySlot>
      </div>
    );
  }

  const write = (patch: Partial<typeof policy>) => {
    if (!canManage) return;
    onSave({ ...policy, ...patch });
  };

  return (
    <div className="mt-[26px] flex flex-col gap-[30px]">
      <div>
        <div className="flex items-center gap-2.5">
          <strong className="text-[14px] font-[620]">
            {t("admin.policy.escalation")}
          </strong>
          {projectName ? (
            <Meta className="text-[10.5px]">{projectName}</Meta>
          ) : null}
          {!canManage ? (
            <StatusPill tone="faint" size="sm">
              <LockSimpleIcon size={11} />
              {t("admin.policy.readOnly")}
            </StatusPill>
          ) : null}
        </div>
        <p className="mt-2 max-w-[580px] text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
          {t("admin.policy.escalationDetail")}
        </p>
        <div className="mt-3.5 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(212px,1fr))]">
          <OptionCard
            selected={policy.enabled}
            disabled={!canManage}
            title={t("admin.policy.autoOn")}
            detail={t("admin.policy.autoOnDetail")}
            onClick={() => write({ enabled: true })}
          />
          <OptionCard
            selected={!policy.enabled}
            disabled={!canManage}
            title={t("admin.policy.autoOff")}
            detail={t("admin.policy.autoOffDetail")}
            onClick={() => write({ enabled: false })}
          />
        </div>
      </div>

      <div>
        <strong className="text-[14px] font-[620]">
          {t("admin.policy.specSla")}
        </strong>
        <p className="mt-2 max-w-[580px] text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
          {t("admin.policy.specSlaDetail")}
        </p>
        <div className="mt-3.5 flex flex-wrap gap-2">
          {slaOptions(policy.staleSpecReviewHours).map((hours) => (
            <FilterChip
              key={hours}
              active={policy.staleSpecReviewHours === hours}
              onClick={() => write({ staleSpecReviewHours: hours })}
            >
              {t("admin.policy.hours", { count: hours })}
            </FilterChip>
          ))}
        </div>
      </div>

      <div>
        <strong className="text-[14px] font-[620]">
          {t("admin.policy.coordSla")}
        </strong>
        <p className="mt-2 max-w-[580px] text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
          {t("admin.policy.coordSlaDetail")}
        </p>
        <div className="mt-3.5 flex flex-wrap gap-2">
          {slaOptions(policy.unresolvedCoordinationHours).map((hours) => (
            <FilterChip
              key={hours}
              active={policy.unresolvedCoordinationHours === hours}
              onClick={() => write({ unresolvedCoordinationHours: hours })}
            >
              {t("admin.policy.hours", { count: hours })}
            </FilterChip>
          ))}
        </div>
      </div>

      <div>
        <strong className="text-[14px] font-[620]">
          {t("admin.policy.signals")}
        </strong>
        <p className="mt-2 max-w-[580px] text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
          {t("admin.policy.signalsDetail")}
        </p>
        <div className="mt-3.5 flex flex-col gap-2">
          {SIGNAL_KINDS.map((kind) => {
            const on = policy.enabledSignals.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                disabled={!canManage}
                onClick={() =>
                  write({
                    enabledSignals: on
                      ? policy.enabledSignals.filter((entry) => entry !== kind)
                      : [...policy.enabledSignals, kind],
                  })
                }
                className={cn(
                  "grid w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 rounded-[13px] border border-line bg-panel2 px-[17px] py-[15px] text-left text-ink",
                  canManage
                    ? "cursor-pointer hover:border-accent-strong"
                    : "cursor-not-allowed opacity-60",
                )}
              >
                <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-raise text-ink-muted">
                  <ShieldCheckIcon size={16} />
                </span>
                <span className="grid">
                  <strong className="text-[12.5px] font-[620]">
                    {t(`admin.signal.${kind}` as TranslationKey)}
                  </strong>
                  <small className="mt-1 text-[11px] leading-[1.6] text-ink-muted [text-wrap:pretty]">
                    {t(`admin.signalDetail.${kind}` as TranslationKey)}
                  </small>
                </span>
                <Switch on={on} />
              </button>
            );
          })}
        </div>
      </div>

      <p className="m-0 max-w-[660px] rounded-[13px] bg-raise px-[18px] py-4 text-[11.5px] leading-[1.75] text-faint [text-wrap:pretty]">
        {t("admin.policy.foot")}
      </p>
    </div>
  );
}

function OrgTab({
  teams,
  projects,
  currentTeamId,
  onOpenTeam,
}: {
  teams: Array<{
    id: string;
    name: string;
    members: Array<{
      id: string;
      displayName: string;
      teamRole: PilotTeamRole;
      organizationRole?: PilotOrganizationRole | undefined;
    }>;
  }>;
  projects: Array<{
    id: string;
    primaryTeamId: string;
    participatingTeamIds: string[];
  }>;
  currentTeamId: string | undefined;
  onOpenTeam: (teamId: string) => void;
}) {
  const { t } = useI18n();
  const people = new Set(
    teams.flatMap((team) => team.members.map((member) => member.id)),
  );
  const admins = new Set(
    teams.flatMap((team) =>
      team.members
        .filter((member) => member.organizationRole === "admin")
        .map((member) => member.id),
    ),
  );

  return (
    <div className="mt-[26px]">
      <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
        <StatCard
          title={t("admin.org.people")}
          value={people.size}
          detail={t("admin.org.peopleDetail", { count: admins.size })}
        />
        <StatCard
          title={t("admin.org.teams")}
          value={teams.length}
          detail={t("admin.org.teamsDetail")}
        />
        <StatCard
          title={t("admin.org.projects")}
          value={projects.length}
          detail={t("admin.org.projectsDetail")}
        />
      </div>

      <div className="mt-[30px]">
        <div className="flex items-center gap-2.5">
          <strong className="text-[14px] font-[620]">
            {t("admin.org.teamList")}
          </strong>
          <span className="text-[11px] text-faint">
            {t("admin.org.teamListHint")}
          </span>
        </div>
        <div className="mt-3.5">
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
                  <small className="mt-[3px] text-[10.5px] text-faint">
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
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
