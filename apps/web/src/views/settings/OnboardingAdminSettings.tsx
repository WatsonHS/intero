import {
  CaretDownIcon,
  IdentificationCardIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import type { PrincipalId } from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useNotifications } from "../../design/notifications.js";
import { SelectMenu } from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";
import {
  createPilotInvitation,
  getPilotInvitations,
  getPilotProfile,
  regeneratePilotInvitation,
  removePilotMember,
  revokePilotInvitation,
  updatePilotMember,
  updatePilotProfile,
} from "../../pilot/api.js";
import { usePilot } from "../../pilot/context.js";

export function OnboardingAdminSettings({
  section,
}: {
  section: "personal" | "project";
}) {
  const pilot = usePilot();
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const { t } = useI18n();
  const team = pilot.teams.data?.teams[0];
  const project =
    pilot.projects.data?.projects.find(
      (candidate) => candidate.id === pilot.selectedProjectId,
    ) ?? pilot.projects.data?.projects[0];
  const developmentIdentityId =
    pilot.bootstrap.data?.authMode === "development_identity"
      ? pilot.identityId
      : undefined;
  const profile = useQuery({
    queryKey: ["pilot", "profile", pilot.identityId],
    queryFn: ({ signal }) => getPilotProfile(developmentIdentityId, signal),
    enabled: Boolean(pilot.effectiveIdentity),
  });
  const currentMembership = team?.members.find(
    (member) => member.id === pilot.identityId,
  );
  const isAdmin = profile.data?.profile.organizationRole === "admin";
  const canManageMembers = isAdmin || currentMembership?.teamRole === "leader";
  const invitations = useQuery({
    queryKey: ["pilot", "invitations", team?.id],
    queryFn: ({ signal }) =>
      getPilotInvitations(team!.id, signal, developmentIdentityId),
    enabled: Boolean(team && isAdmin),
    refetchInterval: 10_000,
  });
  const [displayName, setDisplayName] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [copiedLink, setCopiedLink] = useState<string>();

  useEffect(() => {
    if (profile.data?.profile.displayName) {
      setDisplayName(profile.data.profile.displayName);
    }
  }, [profile.data?.profile.displayName]);

  const saveProfile = useMutation({
    mutationFn: () =>
      updatePilotProfile({ displayName }, developmentIdentityId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pilot"] });
    },
  });
  const createInvitation = useMutation({
    mutationFn: () =>
      createPilotInvitation(
        team!.id,
        { displayName: inviteName, email: inviteEmail },
        developmentIdentityId,
      ),
    onSuccess: async (result) => {
      const link = result.activationUrl;
      setCopiedLink(link);
      await navigator.clipboard.writeText(link);
      setInviteName("");
      setInviteEmail("");
      await queryClient.invalidateQueries({
        queryKey: ["pilot", "invitations", team?.id],
      });
    },
  });
  const regenerateInvitation = useMutation({
    mutationFn: (invitationId: string) =>
      regeneratePilotInvitation(invitationId, 7, developmentIdentityId),
    onSuccess: async (result) => {
      const link = result.activationUrl;
      setCopiedLink(link);
      await navigator.clipboard.writeText(link);
      await queryClient.invalidateQueries({
        queryKey: ["pilot", "invitations", team?.id],
      });
    },
  });
  const revokeInvitation = useMutation({
    mutationFn: (invitationId: string) =>
      revokePilotInvitation(invitationId, developmentIdentityId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["pilot", "invitations", team?.id],
      });
    },
  });
  const changeMember = useMutation({
    mutationFn: (input: {
      memberId: PrincipalId;
      teamRole?: "member" | "leader";
      organizationRole?: "member" | "admin";
    }) =>
      updatePilotMember(
        team!.id,
        input.memberId,
        {
          ...(input.teamRole ? { teamRole: input.teamRole } : {}),
          ...(input.organizationRole
            ? { organizationRole: input.organizationRole }
            : {}),
        },
        developmentIdentityId,
      ),
    onSuccess: async (_result, input) => {
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
      notifications.success(t("admin.members.roleChanged", { scope, role }));
      await queryClient.invalidateQueries({ queryKey: ["pilot"] });
    },
    onError: (_error, input) => {
      notifications.error(
        t("admin.members.roleFailed", {
          scope: t(
            input.teamRole
              ? "admin.members.colTeamRole"
              : "admin.members.colOrgRole",
          ),
          role: "",
        }),
      );
    },
  });
  const removeMember = useMutation({
    mutationFn: (memberId: PrincipalId) =>
      removePilotMember(team!.id, memberId, developmentIdentityId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pilot"] });
    },
  });

  return (
    <>
      {section === "personal" ? (
        <section className="mt-8" data-testid="personal-settings">
          <SettingsHeading
            icon={<IdentificationCardIcon size={16} />}
            title="个人设置"
            detail="管理团队成员看到的姓名。登录邮箱由认证账号提供，不能在这里替换。"
          />
          <div className="mt-3.5 grid grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)_auto] items-end gap-3 rounded-[13px] border border-line bg-panel2 p-[16px_18px]">
            <label className="grid gap-1.5">
              <span className="text-[11px] text-ink-muted">显示姓名</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                data-testid="personal-display-name"
                className="h-9 rounded-btn border border-line2 bg-raise px-3 text-[12px] text-ink outline-none focus:border-accent-strong"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[11px] text-ink-muted">登录邮箱</span>
              <input
                readOnly
                value={profile.data?.profile.email ?? ""}
                className="h-9 rounded-btn border border-line bg-bg px-3 font-mono text-[11px] text-faint outline-none"
              />
            </label>
            <button
              type="button"
              disabled={
                !displayName.trim() ||
                displayName.trim() === profile.data?.profile.displayName ||
                saveProfile.isPending
              }
              onClick={() => saveProfile.mutate()}
              className="h-9 rounded-btn border-0 bg-accent-strong px-4 text-[12px] font-[620] text-on-accent disabled:opacity-45"
            >
              保存
            </button>
          </div>
        </section>
      ) : null}

      {section === "project" ? (
        <section className="mt-8" data-testid="project-effective-settings">
          <SettingsHeading
            icon={<ShieldCheckIcon size={16} />}
            title="项目 · 有效设置"
            detail="项目参与范围、Review Policy 与 PI / Sprint 均在项目级生效。"
          />
          <div className="mt-3.5 grid grid-cols-3 gap-3 rounded-[13px] border border-line bg-panel2 p-[16px_18px]">
            <EffectiveValue
              label="当前项目"
              value={project?.name ?? "未选择"}
            />
            <EffectiveValue
              label="参与团队"
              value={
                project ? `${project.participatingTeamIds.length} 个团队` : "—"
              }
            />
            <EffectiveValue label="协作姿态" value={project?.posture ?? "—"} />
            <p className="col-span-3 border-t border-line pt-3 text-[10.5px] leading-[1.65] text-faint">
              组织管理员或 Team Leader 可在 Project 与 Spec Review
              中管理项目周期和评审规则；普通成员查看并遵循当前有效设置。
            </p>
          </div>
        </section>
      ) : null}
    </>
  );
}

function SettingsHeading({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-raise text-accent-strong">
        {icon}
      </span>
      <span>
        <strong className="text-[14px] font-[620]">{title}</strong>
        <p className="mt-1.5 max-w-[620px] text-[11.5px] leading-[1.65] text-ink-muted">
          {detail}
        </p>
      </span>
    </div>
  );
}

function EffectiveValue({ label, value }: { label: string; value: string }) {
  return (
    <span className="grid">
      <small className="text-[10px] text-faint">{label}</small>
      <strong className="mt-1 text-[12px] font-[600]">{value}</strong>
    </span>
  );
}
