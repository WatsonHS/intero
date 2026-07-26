import {
  ArrowClockwiseIcon,
  CopyIcon,
  IdentificationCardIcon,
  ShieldCheckIcon,
  TrashIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import type { PrincipalId } from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

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

export function OnboardingAdminSettings() {
  const pilot = usePilot();
  const queryClient = useQueryClient();
  const team = pilot.teams.data?.teams[0];
  const project =
    pilot.projects.data?.projects.find(
      (candidate) => candidate.id === pilot.selectedProjectId,
    ) ?? pilot.projects.data?.projects[0];
  const profile = useQuery({
    queryKey: ["pilot", "profile"],
    queryFn: ({ signal }) => getPilotProfile(signal),
    enabled: Boolean(pilot.identityId),
  });
  const currentMembership = team?.members.find(
    (member) => member.id === pilot.identityId,
  );
  const isAdmin = profile.data?.profile.organizationRole === "admin";
  const canManageMembers =
    isAdmin || currentMembership?.teamRole === "leader";
  const invitations = useQuery({
    queryKey: ["pilot", "invitations", team?.id],
    queryFn: ({ signal }) => getPilotInvitations(team!.id, signal),
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
    mutationFn: () => updatePilotProfile(displayName),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pilot"] });
    },
  });
  const createInvitation = useMutation({
    mutationFn: () =>
      createPilotInvitation(team!.id, {
        displayName: inviteName,
        email: inviteEmail,
      }),
    onSuccess: async (result) => {
      const link = absoluteInvitationLink(result.acceptPath);
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
      regeneratePilotInvitation(invitationId),
    onSuccess: async (result) => {
      const link = absoluteInvitationLink(result.acceptPath);
      setCopiedLink(link);
      await navigator.clipboard.writeText(link);
      await queryClient.invalidateQueries({
        queryKey: ["pilot", "invitations", team?.id],
      });
    },
  });
  const revokeInvitation = useMutation({
    mutationFn: revokePilotInvitation,
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
      updatePilotMember(team!.id, input.memberId, {
        ...(input.teamRole ? { teamRole: input.teamRole } : {}),
        ...(input.organizationRole
          ? { organizationRole: input.organizationRole }
          : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pilot"] });
    },
  });
  const removeMember = useMutation({
    mutationFn: (memberId: PrincipalId) =>
      removePilotMember(team!.id, memberId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pilot"] });
    },
  });

  return (
    <>
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

      <section className="mt-8" data-testid="team-member-management">
        <SettingsHeading
          icon={<UsersThreeIcon size={16} />}
          title="团队 · 成员管理"
          detail={
            team
              ? `${team.name} · Organization Admin 管理定向邀请，Admin 与 Team Leader 管理成员角色。`
              : "加入团队后可在这里查看成员。"
          }
        />

        {isAdmin && team ? (
          <div className="mt-3.5 rounded-[13px] border border-line bg-panel2 p-[16px_18px]">
            <strong className="text-[12.5px] font-[620]">邀请成员</strong>
            <p className="mt-1.5 text-[11px] leading-[1.65] text-ink-muted">
              邀请只绑定一个准确邮箱。Intero 不代发邮件；创建后链接会复制到剪贴板。
            </p>
            <div className="mt-3 grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto] gap-2">
              <input
                value={inviteName}
                onChange={(event) => setInviteName(event.target.value)}
                data-testid="invite-display-name"
                placeholder="姓名"
                className="h-9 rounded-btn border border-line2 bg-raise px-3 text-[12px] outline-none focus:border-accent-strong"
              />
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                data-testid="invite-email"
                placeholder="name@company.com"
                className="h-9 rounded-btn border border-line2 bg-raise px-3 font-mono text-[11.5px] outline-none focus:border-accent-strong"
              />
              <button
                type="button"
                data-testid="create-invitation"
                disabled={
                  !inviteName.trim() ||
                  !inviteEmail.trim() ||
                  createInvitation.isPending
                }
                onClick={() => createInvitation.mutate()}
                className="h-9 rounded-btn border-0 bg-accent-strong px-4 text-[12px] font-[620] text-on-accent disabled:opacity-45"
              >
                创建并复制链接
              </button>
            </div>
            {copiedLink ? (
              <div
                className="mt-3 flex items-center gap-2 rounded-[9px] bg-green-soft px-3 py-2 text-[10.5px] text-green"
                data-testid="copied-invitation-link"
              >
                <CopyIcon size={13} />
                <span className="min-w-0 flex-1 truncate font-mono">
                  {copiedLink}
                </span>
              </div>
            ) : null}
            {createInvitation.isError ? (
              <p className="mt-3 text-[11px] text-danger" role="alert">
                创建失败。请确认邮箱格式正确，且没有相同的待接受邀请。
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 grid gap-2">
          {(team?.members ?? []).map((member) => (
            <article
              key={member.id}
              className="grid grid-cols-[34px_minmax(0,1fr)_auto_auto_auto] items-center gap-3 rounded-[13px] border border-line bg-panel2 p-[13px_15px]"
            >
              <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-accent-soft text-[10px] font-[650] text-accent-strong">
                {initials(member.displayName)}
              </span>
              <span className="grid min-w-0">
                <strong className="truncate text-[12px] font-[620]">
                  {member.displayName}
                </strong>
                <small className="mt-0.5 truncate font-mono text-[10px] text-faint">
                  {member.email || "—"}
                </small>
              </span>
              <select
                aria-label={`${member.displayName} 的团队角色`}
                value={member.teamRole}
                disabled={!canManageMembers || changeMember.isPending}
                onChange={(event) =>
                  changeMember.mutate({
                    memberId: member.id,
                    teamRole: event.target.value as "member" | "leader",
                  })
                }
                className="h-8 rounded-btn border border-line2 bg-raise px-2 text-[11px] disabled:opacity-55"
              >
                <option value="member">Member</option>
                <option value="leader">Team Leader</option>
              </select>
              <select
                aria-label={`${member.displayName} 的组织角色`}
                value={member.organizationRole ?? "member"}
                disabled={!isAdmin || changeMember.isPending}
                onChange={(event) =>
                  changeMember.mutate({
                    memberId: member.id,
                    organizationRole: event.target.value as "member" | "admin",
                  })
                }
                className="h-8 rounded-btn border border-line2 bg-raise px-2 text-[11px] disabled:opacity-55"
              >
                <option value="member">Org Member</option>
                <option value="admin">Org Admin</option>
              </select>
              {canManageMembers && member.id !== pilot.identityId ? (
                <button
                  type="button"
                  title="移出团队"
                  disabled={removeMember.isPending}
                  onClick={() => removeMember.mutate(member.id)}
                  className="grid h-8 w-8 place-items-center rounded-btn border border-line2 bg-transparent text-faint hover:border-danger hover:text-danger"
                >
                  <TrashIcon size={13} />
                </button>
              ) : (
                <span className="w-8" />
              )}
            </article>
          ))}
          {changeMember.isError || removeMember.isError ? (
            <p className="text-[11px] text-danger" role="alert">
              成员操作未完成。最后一位 Organization Admin 不能被降级。
            </p>
          ) : null}
        </div>

        {isAdmin && (invitations.data?.invitations.length ?? 0) > 0 ? (
          <div className="mt-3 grid gap-2">
            <span className="text-[11px] font-[620] text-ink-muted">
              待处理邀请
            </span>
            {invitations.data?.invitations.map((invitation) => (
              <article
                key={invitation.id}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-[11px] border border-line bg-panel2 px-4 py-3"
              >
                <span className="grid min-w-0">
                  <strong className="truncate text-[11.5px] font-[600]">
                    {invitation.displayName} · {invitation.email}
                  </strong>
                  <small className="mt-0.5 text-[10px] text-faint">
                    {invitationStatusLabel(invitation.status)} ·{" "}
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </small>
                </span>
                {invitation.status !== "accepted" ? (
                  <button
                    type="button"
                    disabled={regenerateInvitation.isPending}
                    onClick={() =>
                      regenerateInvitation.mutate(invitation.id)
                    }
                    className="flex h-8 items-center gap-1.5 rounded-btn border border-line2 bg-transparent px-3 text-[10.5px] hover:border-accent-strong"
                  >
                    <ArrowClockwiseIcon size={12} />
                    重新生成并复制
                  </button>
                ) : null}
                {invitation.status === "pending" ? (
                  <button
                    type="button"
                    disabled={revokeInvitation.isPending}
                    onClick={() => revokeInvitation.mutate(invitation.id)}
                    className="h-8 rounded-btn border border-line2 bg-transparent px-3 text-[10.5px] hover:border-danger hover:text-danger"
                  >
                    撤销
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mt-8" data-testid="project-effective-settings">
        <SettingsHeading
          icon={<ShieldCheckIcon size={16} />}
          title="项目 · 有效设置"
          detail="项目参与范围、Review Policy 与 PI / Sprint 均在项目级生效。"
        />
        <div className="mt-3.5 grid grid-cols-3 gap-3 rounded-[13px] border border-line bg-panel2 p-[16px_18px]">
          <EffectiveValue label="当前项目" value={project?.name ?? "未选择"} />
          <EffectiveValue
            label="参与团队"
            value={
              project
                ? `${project.participatingTeamIds.length} 个团队`
                : "—"
            }
          />
          <EffectiveValue
            label="协作姿态"
            value={project?.posture ?? "—"}
          />
          <p className="col-span-3 border-t border-line pt-3 text-[10.5px] leading-[1.65] text-faint">
            组织管理员或 Team Leader 可在 Project 与 Spec Review
            中管理项目周期和评审规则；普通成员查看并遵循当前有效设置。
          </p>
        </div>
      </section>
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

function absoluteInvitationLink(path: string): string {
  return new URL(path, window.location.origin).toString();
}

function invitationStatusLabel(status: string): string {
  return {
    pending: "等待接受",
    accepted: "已接受",
    expired: "已过期",
    revoked: "已撤销",
  }[status] ?? status;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1
    ? `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`
    : name.slice(0, 2)
  ).toUpperCase();
}
