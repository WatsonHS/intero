import {
  ArrowRightIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  PlugsIcon,
  SignOutIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  acceptPilotInvitation,
  getPilotInvitation,
  requestMagicLink,
  signOut,
} from "../pilot/api.js";
import { usePilot } from "../pilot/context.js";

export function SignInView() {
  const [email, setEmail] = useState("");
  const signIn = useMutation({
    mutationFn: () => requestMagicLink(email, window.location.href),
  });

  return (
    <AccessShell eyebrow="INTERO · 登录" title="回到你的团队">
      <p className="text-[13px] leading-[1.75] text-ink-muted">
        输入团队已邀请的邮箱。Intero 会发送一次性登录链接；未加入任何团队的账号无法进入工作区。
      </p>
      <label className="mt-6 grid gap-2">
        <span className="text-[11px] font-[620] text-ink-muted">邮箱</span>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-10 rounded-btn border border-line2 bg-raise px-3 text-[12.5px] text-ink outline-none focus:border-accent-strong"
          placeholder="you@company.com"
        />
      </label>
      {signIn.isSuccess ? (
        <Notice tone="success">
          登录链接已发送。请在同一浏览器中打开邮件里的链接。
        </Notice>
      ) : null}
      {signIn.isError ? (
        <Notice tone="danger">
          无法发送登录链接。请确认该邮箱已接受团队邀请，或联系组织管理员。
        </Notice>
      ) : null}
      <button
        type="button"
        disabled={!email.trim() || signIn.isPending}
        onClick={() => signIn.mutate()}
        className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-btn border-0 bg-accent-strong text-[12.5px] font-[620] text-on-accent disabled:opacity-50"
      >
        <EnvelopeSimpleIcon size={15} />
        {signIn.isPending ? "正在发送…" : "发送一次性登录链接"}
      </button>
    </AccessShell>
  );
}

export function AcceptInvitationView({
  token,
  onEnterPulse,
  onConnectAgent,
}: {
  token: string;
  onEnterPulse: (projectId?: string) => void;
  onConnectAgent: (projectId?: string) => void;
}) {
  const queryClient = useQueryClient();
  const pilot = usePilot();
  const [linkSent, setLinkSent] = useState(false);
  const invitation = useQuery({
    queryKey: ["pilot", "invitation", token],
    queryFn: ({ signal }) => getPilotInvitation(token, signal),
  });
  const signedIn = pilot.bootstrap.data?.currentPrincipal;
  const emailMatches =
    signedIn && invitation.data
      ? signedIn.email.toLowerCase() ===
        invitation.data.invitation.email.toLowerCase()
      : false;
  const sendLink = useMutation({
    mutationFn: async () => {
      if (!invitation.data) return;
      await requestMagicLink(
        invitation.data.invitation.email,
        window.location.href,
        invitation.data.invitation.displayName,
        token,
      );
      setLinkSent(true);
    },
  });
  const accept = useMutation({
    mutationFn: () => acceptPilotInvitation(token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pilot"] });
    },
  });
  const logout = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pilot"] });
    },
  });

  if (invitation.isLoading) {
    return (
      <AccessShell eyebrow="INTERO · 团队邀请" title="正在读取邀请">
        <p className="text-[13px] text-ink-muted">正在确认组织与团队信息…</p>
      </AccessShell>
    );
  }

  if (invitation.isError || !invitation.data) {
    return (
      <AccessShell eyebrow="INTERO · 团队邀请" title="这个邀请不可用">
        <Notice tone="danger">
          邀请链接无效或已不可访问。请让组织管理员重新生成邀请。
        </Notice>
      </AccessShell>
    );
  }

  const detail = invitation.data;
  const accepted = accept.data;
  const status = detail.invitation.status;

  return (
    <AccessShell eyebrow="INTERO · 团队邀请" title={`加入 ${detail.team.name}`}>
      <div className="grid gap-3 rounded-[13px] border border-line bg-panel2 p-[16px_18px]">
        <InvitationRow label="组织" value={detail.organization.name} />
        <InvitationRow label="团队" value={detail.team.name} />
        <InvitationRow label="你的姓名" value={detail.invitation.displayName} />
        <InvitationRow label="受邀邮箱" value={detail.invitation.email} mono />
      </div>

      {accepted ? (
        <>
          <Notice tone="success">
            已加入 {accepted.team.name}。你的姓名已写入个人设置，并已获得团队关联项目的访问权限。
          </Notice>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onEnterPulse(accepted.projects[0]?.id)}
              className="flex h-10 items-center justify-center gap-2 rounded-btn border-0 bg-accent-strong text-[12px] font-[620] text-on-accent"
            >
              进入 Team Pulse
              <ArrowRightIcon size={14} />
            </button>
            <button
              type="button"
              onClick={() => onConnectAgent(accepted.projects[0]?.id)}
              className="flex h-10 items-center justify-center gap-2 rounded-btn border border-line2 bg-transparent text-[12px] text-ink hover:border-accent-strong"
            >
              <PlugsIcon size={14} />
              连接 Coding Agent（可选）
            </button>
          </div>
        </>
      ) : status !== "pending" ? (
        <Notice tone={status === "accepted" ? "success" : "danger"}>
          {status === "accepted"
            ? "这个邀请已经被接受。请使用受邀邮箱登录。"
            : status === "expired"
              ? "这个邀请已过期。请让组织管理员重新生成。"
              : "这个邀请已被撤销。请联系组织管理员。"}
        </Notice>
      ) : !signedIn ? (
        <>
          <p className="mt-5 text-[12px] leading-[1.7] text-ink-muted">
            请先使用上面的受邀邮箱完成登录。姓名会在接受后写入个人设置，之后可以自行修改。
          </p>
          {linkSent ? (
            <Notice tone="success">
              登录链接已发送到 {detail.invitation.email}。
            </Notice>
          ) : null}
          {sendLink.isError ? (
            <Notice tone="danger">登录链接发送失败，请稍后重试。</Notice>
          ) : null}
          <button
            type="button"
            disabled={sendLink.isPending}
            onClick={() => sendLink.mutate()}
            className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-btn border-0 bg-accent-strong text-[12.5px] font-[620] text-on-accent disabled:opacity-50"
          >
            <EnvelopeSimpleIcon size={15} />
            {sendLink.isPending
              ? "正在发送…"
              : `使用 ${detail.invitation.email} 登录`}
          </button>
        </>
      ) : !emailMatches ? (
        <>
          <Notice tone="danger">
            当前登录邮箱 {signedIn.email} 与受邀邮箱不一致，不能接受这个邀请。
          </Notice>
          <button
            type="button"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
            className="mt-4 flex h-9 items-center gap-2 rounded-btn border border-line2 bg-transparent px-4 text-[12px] text-ink hover:border-accent-strong"
          >
            <SignOutIcon size={14} />
            退出当前账号
          </button>
        </>
      ) : (
        <>
          {accept.isError ? (
            <Notice tone="danger">
              接受邀请失败。邀请可能刚刚过期或被管理员撤销。
            </Notice>
          ) : null}
          <button
            type="button"
            disabled={accept.isPending}
            onClick={() => accept.mutate()}
            className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-btn border-0 bg-accent-strong text-[12.5px] font-[620] text-on-accent disabled:opacity-50"
          >
            <CheckCircleIcon size={15} />
            {accept.isPending ? "正在加入…" : "确认加入团队"}
          </button>
        </>
      )}
    </AccessShell>
  );
}

function AccessShell({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-bg p-8 text-ink">
      <main className="w-full max-w-[520px] rounded-[18px] border border-line bg-panel p-[30px_32px]">
        <p className="text-[10.5px] font-[650] tracking-[0.12em] text-accent-strong">
          {eyebrow}
        </p>
        <h1 className="mb-5 mt-2.5 text-[26px] font-[560] tracking-[-0.035em]">
          {title}
        </h1>
        {children}
      </main>
    </div>
  );
}

function InvitationRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-3">
      <span className="text-[11px] text-faint">{label}</span>
      <strong
        className={[
          "min-w-0 truncate text-[12px] font-[560] text-ink",
          mono ? "font-mono" : "",
        ].join(" ")}
      >
        {value}
      </strong>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "success" | "danger";
  children: React.ReactNode;
}) {
  const Icon = tone === "success" ? CheckCircleIcon : WarningCircleIcon;
  return (
    <div
      className={[
        "mt-5 flex items-start gap-2.5 rounded-[11px] px-3.5 py-3 text-[11.5px] leading-[1.65]",
        tone === "success"
          ? "bg-green-soft text-green"
          : "bg-danger-soft text-danger",
      ].join(" ")}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon size={15} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
