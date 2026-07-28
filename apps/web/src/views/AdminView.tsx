import {
  BuildingsIcon,
  CaretDownIcon,
  ClockCountdownIcon,
  EnvelopeSimpleIcon,
  KanbanIcon,
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
  PilotProject,
  PilotTeamRole,
  PrincipalId,
  ProjectAutomationSignalKind,
} from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

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
  StatusPill,
  Switch,
  TableHead,
  Tabs,
  cn,
} from "../design/primitives.js";
import { useNotifications } from "../design/notifications.js";
import { useI18n } from "../i18n/index.js";
import type { Tone } from "../design/utils.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";
import {
  createPilotInvitation,
  getPilotInvitations,
  getPilotOrganizationDirectory,
  regeneratePilotInvitation,
  removePilotMember,
  revokePilotInvitation,
  updatePilotMember,
  type PilotOrganizationDirectoryPayload,
  type PilotTeamPayload,
} from "../pilot/api.js";
import {
  projectInTeam,
  useGovernance,
  usePilotOptional,
} from "../pilot/context.js";
import { AddMemberModal } from "./admin/AddMemberModal.js";
import { OrganizationTab } from "./admin/OrganizationTab.js";
import { ProjectsTab } from "./admin/ProjectsTab.js";
import { refreshGovernanceMembers } from "./admin/query-cache.js";
import { TeamPicker } from "./admin/TeamPicker.js";
import { TeamsTab } from "./admin/TeamsTab.js";
import { OrganizationServiceSettings } from "./settings/OrganizationServiceSettings.js";

export type AdminTab =
  "members" | "teams" | "projects" | "policy" | "org" | "service" | "audit";

type MemberRoleChange = {
  memberId: string;
  teamRole?: PilotTeamRole;
  organizationRole?: PilotOrganizationRole;
};

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
export function AdminView({
  initialTab = "members",
  onTabChange,
  onOpenSpecs,
}: {
  initialTab?: AdminTab;
  onTabChange?: (tab: AdminTab) => void;
  onOpenSpecs: () => void;
}) {
  const { t, formatRelative } = useI18n();
  const pilot = usePilotOptional();
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const [tab, setTab] = useState<AdminTab>(initialTab);
  const [rosterTeamId, setRosterTeamId] = useState<string>();

  const teams = pilot?.teams.data?.teams ?? [];
  const projects = pilot?.projects.data?.projects ?? [];
  const organization = pilot?.bootstrap.data?.organization;
  const teamId = pilot?.selectedTeamId;
  const team = teams.find((candidate) => candidate.id === teamId);
  const projectId = pilot?.selectedProjectId;
  const identityId = pilot?.identityId;
  // Under development identity there is no session cookie behind the request,
  // so the governing calls have to carry the identity header explicitly.
  const developmentIdentityId =
    pilot?.bootstrap.data?.authMode === "development_identity"
      ? identityId
      : undefined;
  const { isOrgAdmin, canGovern, pending } = useGovernance();

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  function selectTab(next: AdminTab) {
    setTab(next);
    onTabChange?.(next);
  }

  // Organization-wide teams, projects and people. Only an admin may read it,
  // and only an admin has anything to do with the teams they are not in.
  const directory = useQuery({
    queryKey: ["pilot", "organization-directory", identityId],
    queryFn: ({ signal }) => getPilotOrganizationDirectory(identityId!, signal),
    enabled: Boolean(identityId) && isOrgAdmin,
  });
  // An admin governs the whole organization, including the teams and projects
  // they are not part of; a Team Lead governs what they belong to. The own-team
  // fallback keeps the tables populated while the directory is still loading.
  const governedTeams: PilotTeamPayload[] = isOrgAdmin
    ? (directory.data?.teams ?? teams)
    : teams;
  // Which team the roster surface is acting on. It starts at the shell's scope
  // but is chosen on the surface itself, so reading one team's members never
  // depends on a selection made somewhere else — nor moves it.
  const governedTeam =
    governedTeams.find((candidate) => candidate.id === rosterTeamId) ??
    governedTeams.find((candidate) => candidate.id === teamId) ??
    governedTeams[0];
  const invitations = useQuery({
    queryKey: ["pilot", "invitations", governedTeam?.id],
    queryFn: ({ signal }) =>
      getPilotInvitations(governedTeam!.id, signal, developmentIdentityId),
    // Only an organization admin may read or write invitations, so a Team Lead
    // asking for them would earn nothing but a 403.
    enabled: Boolean(governedTeam) && isOrgAdmin,
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

  const refreshInvites = async () => {
    await queryClient.invalidateQueries({ queryKey: ["pilot", "invitations"] });
    await queryClient.invalidateQueries({ queryKey: ["governance-audit"] });
  };
  const refreshAutomation = () =>
    queryClient.invalidateQueries({ queryKey: ["project-automation"] });
  /** Teams, projects, the organization directory and the trail they leave. */
  const refreshScope = async () => {
    await queryClient.invalidateQueries({ queryKey: ["pilot"] });
    await queryClient.invalidateQueries({ queryKey: ["governance-audit"] });
  };

  const showRoleNotice = (
    tone: "success" | "danger",
    input: MemberRoleChange,
  ) => {
    const teamRole = input.teamRole;
    const scope = t(
      teamRole ? "admin.members.colTeamRole" : "admin.members.colOrgRole",
    );
    const role = teamRole
      ? t(teamRole === "leader" ? "admin.role.leader" : "admin.role.member")
      : t(
          input.organizationRole === "admin"
            ? "admin.role.orgAdmin"
            : "admin.role.orgMember",
        );
    const message = t(
      tone === "success"
        ? "admin.members.roleChanged"
        : "admin.members.roleFailed",
      { scope, role },
    );
    if (tone === "success") notifications.success(message);
    else notifications.error(message);
  };

  const changeMember = useMutation({
    mutationFn: (input: MemberRoleChange) =>
      updatePilotMember(
        governedTeam!.id,
        input.memberId as never,
        {
          ...(input.teamRole ? { teamRole: input.teamRole } : {}),
          ...(input.organizationRole
            ? { organizationRole: input.organizationRole }
            : {}),
        },
        developmentIdentityId,
      ),
    onSuccess: async (_result, input) => {
      showRoleNotice("success", input);
      await refreshGovernanceMembers(queryClient);
    },
    onError: (_error, input) => showRoleNotice("danger", input),
  });
  const removeMember = useMutation({
    mutationFn: (memberId: string) =>
      removePilotMember(
        governedTeam!.id,
        memberId as never,
        developmentIdentityId,
      ),
    onSuccess: () => refreshGovernanceMembers(queryClient),
  });
  const revoke = useMutation({
    mutationFn: (invitationId: string) =>
      revokePilotInvitation(invitationId, developmentIdentityId),
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

  const members = governedTeam?.members ?? [];
  const governedProjects: PilotProject[] = isOrgAdmin
    ? (directory.data?.projects ?? projects)
    : projects.filter((project) =>
        teams.some((candidate) => projectInTeam(project, candidate.id)),
      );
  const directoryMembers = directory.data?.members ?? [];
  const displayNames = new Map<string, string>([
    ...governedTeams.flatMap((candidate) =>
      candidate.members.map(
        (member) => [member.id, member.displayName] as const,
      ),
    ),
    ...directoryMembers.map(
      (member) => [member.id, member.displayName] as const,
    ),
  ]);
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
      onClick: () => selectTab("members"),
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
      onClick: () => selectTab("members"),
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
          {organization ? (
            <>
              <ScopeMark
                id={organization.id}
                label={organization.name}
                size="sm"
                filled
              />
              <strong className="text-[13px] font-[620]">
                {organization.name}
              </strong>
            </>
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
          onChange={selectTab}
          items={[
            {
              id: "members" as const,
              label: t("admin.tab.members"),
              icon: <UserIcon size={14} />,
            },
            {
              id: "teams" as const,
              label: t("admin.tab.teams"),
              icon: <UsersThreeIcon size={14} />,
            },
            {
              id: "projects" as const,
              label: t("admin.tab.projects"),
              icon: <KanbanIcon size={14} />,
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
            team={governedTeam}
            teams={governedTeams}
            onSelectTeam={setRosterTeamId}
            members={members}
            currentId={pilot.identityId}
            identityId={identityId}
            canSetOrgRole={Boolean(isOrgAdmin)}
            canInvite={Boolean(isOrgAdmin)}
            orgMembers={directoryMembers}
            invitations={invitations.data?.invitations ?? []}
            onChangeRole={(input) => changeMember.mutate(input)}
            onRemove={(memberId) => removeMember.mutate(memberId)}
            onRevoke={(invitationId) => revoke.mutate(invitationId)}
            onInvited={refreshInvites}
            onChanged={refreshScope}
            developmentIdentityId={developmentIdentityId}
          />
        ) : null}

        {tab === "teams" && identityId ? (
          <TeamsTab
            teams={governedTeams}
            projects={governedProjects}
            identityId={identityId}
            canCreate={Boolean(isOrgAdmin)}
            canManage={(candidateId) =>
              Boolean(
                isOrgAdmin ||
                teams
                  .find((candidate) => candidate.id === candidateId)
                  ?.members.some(
                    (member) =>
                      member.id === identityId && member.teamRole === "leader",
                  ),
              )
            }
            canDelete={Boolean(isOrgAdmin)}
            scopedToOwnTeams={!isOrgAdmin}
            onOpenMembers={(nextTeamId) => {
              setRosterTeamId(nextTeamId);
              selectTab("members");
            }}
            onChanged={refreshScope}
          />
        ) : null}

        {tab === "projects" && identityId ? (
          <ProjectsTab
            projects={governedProjects}
            teams={governedTeams}
            ownTeamIds={teams.map((candidate) => candidate.id)}
            names={displayNames}
            identityId={identityId}
            canManage={(project) =>
              Boolean(isOrgAdmin) || project.ownerId === identityId
            }
            onChanged={refreshScope}
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

        {tab === "org" && isOrgAdmin && identityId ? (
          <OrganizationTab
            organization={organization}
            teams={governedTeams}
            projects={governedProjects}
            members={directoryMembers}
            identityId={identityId}
            canManage={isOrgAdmin}
            onOpenService={() => selectTab("service")}
            onChanged={refreshScope}
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
  const renamed = () =>
    entry.detail.from === undefined || entry.detail.to === undefined
      ? ""
      : t("admin.audit.line.renamed", {
          from: String(entry.detail.from),
          to: String(entry.detail.to),
        });
  switch (entry.eventType) {
    case "pilot.team.created":
    case "pilot.project.created":
      return entry.detail.name
        ? t("admin.audit.line.created", { name: String(entry.detail.name) })
        : "";
    case "pilot.team.deleted":
      return entry.detail.name
        ? t("admin.audit.line.deleted", { name: String(entry.detail.name) })
        : "";
    case "pilot.team.renamed":
    case "pilot.organization.renamed":
      return renamed();
    case "pilot.team_member.added":
      return entry.subjectId
        ? t("admin.audit.line.added", {
            name: subject,
            role: roleLabel(entry.detail.to, "team"),
          })
        : "";
    case "pilot.project.updated": {
      // Only what actually changed was recorded, so only that is stated.
      const parts = [
        renamed(),
        entry.detail.primaryTeamId ? t("admin.audit.line.primaryTeam") : "",
        entry.detail.ownerId ? t("admin.audit.line.owner") : "",
        entry.detail.teams
          ? t("admin.audit.line.teams", { count: String(entry.detail.teams) })
          : "",
        entry.detail.posture
          ? t("admin.audit.line.posture", {
              posture: t(
                `admin.projects.posture.${entry.detail.posture}` as TranslationKey,
              ),
            })
          : "",
      ].filter(Boolean);
      return parts.join(" ");
    }
    case "pilot.team_member.role_changed":
      return entry.subjectId
        ? t("admin.audit.line.teamRole", {
            name: subject,
            from: roleLabel(entry.detail.from, "team"),
            to: roleLabel(entry.detail.to, "team"),
          })
        : "";
    case "pilot.organization_member.role_changed":
      return entry.subjectId
        ? t("admin.audit.line.orgRole", {
            name: subject,
            from: roleLabel(entry.detail.from, "org"),
            to: roleLabel(entry.detail.to, "org"),
          })
        : "";
    case "pilot.team_member.removed":
      return entry.subjectId
        ? t("admin.audit.line.removed", { name: subject })
        : "";
    case "pilot.team_invitation.created":
      return entry.detail.email
        ? t("admin.audit.line.invited", { email: String(entry.detail.email) })
        : "";
    case "pilot.team_invitation.revoked":
      return entry.detail.email
        ? t("admin.audit.line.revoked", { email: String(entry.detail.email) })
        : "";
    default:
      return entry.eventType;
  }
}

const MEMBER_COLUMNS = "minmax(0,1.4fr) 132px 120px minmax(0,1fr) 46px";

/**
 * 成员与权限 — one team's roster, named by the picker in its own header.
 *
 * The team is chosen here rather than inherited from the shell's scope: which
 * roster you are editing has to be visible on the surface that edits it, and
 * changing it must not drag every other view along.
 */
function MembersTab({
  team,
  teams,
  onSelectTeam,
  members,
  currentId,
  identityId,
  canSetOrgRole,
  canInvite,
  orgMembers,
  invitations,
  onChangeRole,
  onRemove,
  onRevoke,
  onInvited,
  onChanged,
  developmentIdentityId,
}: {
  team: PilotTeamPayload | undefined;
  teams: PilotTeamPayload[];
  onSelectTeam: (teamId: string) => void;
  members: Array<{
    id: string;
    displayName: string;
    email: string;
    teamRole: PilotTeamRole;
    organizationRole?: PilotOrganizationRole | undefined;
  }>;
  currentId: string | undefined;
  identityId: PrincipalId | undefined;
  canSetOrgRole: boolean;
  /** Only an organization admin may invite or add people to a team. */
  canInvite: boolean;
  orgMembers: PilotOrganizationDirectoryPayload["members"];
  invitations: Array<{
    id: string;
    email: string;
    status: string;
    expiresAt: string;
  }>;
  onChangeRole: (input: MemberRoleChange) => void;
  onRemove: (memberId: string) => void;
  onRevoke: (invitationId: string) => void;
  onInvited: () => Promise<void> | void;
  onChanged: () => Promise<void> | void;
  developmentIdentityId: PrincipalId | undefined;
}) {
  const { t, formatRelative } = useI18n();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [invitationLinks, setInvitationLinks] = useState<
    Record<string, string>
  >({});
  const [copiedInvitationId, setCopiedInvitationId] = useState<string>();
  const [copyFailedInvitationId, setCopyFailedInvitationId] =
    useState<string>();
  const invite = useMutation({
    mutationFn: () =>
      createPilotInvitation(
        team!.id,
        { email: email.trim() },
        developmentIdentityId,
      ),
    onSuccess: async (result) => {
      const link = result.activationUrl;
      setInvitationLinks((current) => ({
        ...current,
        [result.invitation.id]: link,
      }));
      setEmail("");
      setInviteOpen(false);
      try {
        await copyTextToClipboard(link);
        setCopiedInvitationId(result.invitation.id);
        setCopyFailedInvitationId(undefined);
      } catch {
        setCopiedInvitationId(undefined);
        setCopyFailedInvitationId(result.invitation.id);
      }
      await onInvited();
    },
  });
  const copyInvitation = useMutation({
    mutationFn: async (invitationId: string) => {
      let link = invitationLinks[invitationId];
      let regenerated = false;
      if (!link) {
        const result = await regeneratePilotInvitation(
          invitationId,
          7,
          developmentIdentityId,
        );
        link = result.activationUrl;
        regenerated = true;
      }
      return { invitationId, link, regenerated };
    },
    onMutate: () => {
      setCopiedInvitationId(undefined);
      setCopyFailedInvitationId(undefined);
    },
    onSuccess: async ({ invitationId, link, regenerated }) => {
      setInvitationLinks((current) => ({ ...current, [invitationId]: link }));
      try {
        await copyTextToClipboard(link);
        setCopiedInvitationId(invitationId);
        setCopyFailedInvitationId(undefined);
      } catch {
        setCopiedInvitationId(undefined);
        setCopyFailedInvitationId(invitationId);
      }
      if (regenerated) await onInvited();
    },
    onError: (_error, invitationId) => {
      setCopyFailedInvitationId(invitationId);
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
      <div className="flex flex-wrap items-center gap-3">
        <strong className="shrink-0 text-[14px] font-[620]">
          {t("admin.members.title")}
        </strong>
        <TeamPicker teams={teams} value={team} onChange={onSelectTeam} />
        <Meta className="text-[10.5px]">
          {t("admin.members.count", { count: members.length })}
        </Meta>
        {canInvite && team ? (
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              data-testid="admin-add-existing-member"
              className="inline-flex h-8 cursor-pointer items-center gap-[7px] rounded-btn border border-line2 bg-transparent px-[13px] text-[12px] text-ink-muted hover:border-accent-strong hover:text-ink"
            >
              <UserPlusIcon size={14} />
              {t("admin.members.addExisting")}
            </button>
            <button
              type="button"
              onClick={() => setInviteOpen((shown) => !shown)}
              className="inline-flex h-8 cursor-pointer items-center gap-[7px] rounded-btn border-0 bg-accent-strong px-[13px] text-[12px] font-[560] text-on-accent"
            >
              <EnvelopeSimpleIcon size={14} />
              {t("admin.members.invite")}
            </button>
          </span>
        ) : null}
      </div>
      <p className="mt-2 max-w-[620px] text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
        {t(canInvite ? "admin.members.ledeAdmin" : "admin.members.ledeLead")}
      </p>

      {inviteOpen ? (
        <form
          className="mt-3.5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2.5 rounded-[13px] border border-line bg-panel2 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (email.trim()) invite.mutate();
          }}
        >
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
            disabled={!email.trim() || invite.isPending}
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

      {canInvite ? (
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
                  <span className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={
                        copyInvitation.isPending &&
                        copyInvitation.variables === invitation.id
                      }
                      onClick={() => copyInvitation.mutate(invitation.id)}
                      className="h-7 cursor-pointer rounded-quiet border border-line2 bg-transparent px-[11px] text-[11.5px] text-ink-muted hover:border-accent-strong hover:text-ink disabled:cursor-wait disabled:opacity-45"
                    >
                      {copyFailedInvitationId === invitation.id
                        ? t("admin.invites.copyFailed")
                        : copiedInvitationId === invitation.id
                          ? t("admin.invites.copied")
                          : invitationLinks[invitation.id]
                            ? t("admin.invites.copy")
                            : t("admin.invites.regenerateAndCopy")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRevoke(invitation.id)}
                      className="h-7 cursor-pointer rounded-quiet border border-line2 bg-transparent px-[11px] text-[11.5px] text-ink-muted hover:border-danger hover:text-danger"
                    >
                      {t("admin.invites.revoke")}
                    </button>
                  </span>
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
      ) : null}

      {addOpen && team && identityId ? (
        <AddMemberModal
          teamId={team.id}
          teamName={team.name}
          existingMemberIds={members.map((member) => member.id)}
          candidates={orgMembers}
          identityId={identityId}
          onClose={() => setAddOpen(false)}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Browsers can deny the async API outside a secure context. The
      // selection fallback below still works from the explicit copy action.
    }
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  try {
    if (!document.execCommand("copy")) {
      throw new Error("Clipboard copy was rejected.");
    }
  } finally {
    input.remove();
  }
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
