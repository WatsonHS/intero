import {
  ArrowRightIcon,
  CheckCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  FingerprintIcon,
  KeyIcon,
  SignOutIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type { PrincipalId } from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { PrincipalSummary } from "../api.js";
import { authClient } from "../auth-client.js";
import { initials } from "../design/utils.js";
import { Checkbox } from "../design/primitives.js";
import {
  activatePilotInvitation,
  acceptPilotInvitation,
  getPilotInvitation,
} from "../pilot/api.js";
import { usePilot } from "../pilot/context.js";

export function SignInView() {
  const passkeysAvailable =
    typeof window === "undefined" || window.isSecureContext;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const passwordSignIn = useMutation({
    mutationFn: async () => {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) throw new Error(result.error.message);
    },
    onSuccess: () => window.location.reload(),
  });
  const passkeySignIn = useMutation({
    mutationFn: async () => {
      const result = await authClient.signIn.passkey();
      if (result.error) throw new Error(result.error.message);
    },
    onSuccess: () => window.location.reload(),
  });

  return (
    <AccessShell eyebrow="INTERO · 登录" title="回到你的团队">
      <p className="text-[13px] leading-[1.75] text-ink-muted">
        使用已激活账号的邮箱和密码登录
        {passkeysAvailable ? "，也可以使用 Passkey" : ""}。Intero
        不开放公开注册。
      </p>
      <form
        className="mt-6"
        data-testid="password-sign-in-form"
        onSubmit={(event) => {
          event.preventDefault();
          passwordSignIn.mutate();
        }}
      >
        <label className="grid gap-2">
          <span className="text-[11px] font-[620] text-ink-muted">邮箱</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            data-testid="sign-in-email"
            onChange={(event) => setEmail(event.target.value)}
            className="h-10 rounded-btn border border-line2 bg-raise px-3 text-[12.5px] text-ink outline-none focus-visible:border-accent-strong focus-visible:ring-1 focus-visible:ring-accent-strong"
            placeholder="you@company.com"
          />
        </label>
        <PasswordField
          className="mt-3"
          label="密码"
          autoComplete="current-password"
          value={password}
          visible={passwordVisible}
          inputTestId="sign-in-password"
          toggleTestId="sign-in-password-toggle"
          onChange={setPassword}
          onToggle={() => setPasswordVisible((current) => !current)}
        />
        {passwordSignIn.isError || passkeySignIn.isError ? (
          <Notice tone="danger">
            登录失败。请检查凭据；如果账号尚未激活或需要恢复访问，请联系组织管理员。
          </Notice>
        ) : null}
        <button
          type="submit"
          data-testid="sign-in-password-submit"
          disabled={
            !email.trim() || password.length < 12 || passwordSignIn.isPending
          }
          className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-btn border-0 bg-accent-strong text-[12.5px] font-[620] text-on-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
        >
          <KeyIcon size={15} />
          {passwordSignIn.isPending ? "正在登录…" : "使用邮箱和密码登录"}
        </button>
      </form>
      {passkeysAvailable ? (
        <>
          <div className="my-5 flex items-center gap-3 text-[10px] text-faint">
            <span className="h-px flex-1 bg-line" />
            或使用 Passkey
            <span className="h-px flex-1 bg-line" />
          </div>
          <button
            type="button"
            data-testid="sign-in-passkey"
            disabled={passkeySignIn.isPending}
            onClick={() => passkeySignIn.mutate()}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-btn border border-line2 bg-transparent text-[12.5px] font-[620] text-ink disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
          >
            <FingerprintIcon size={17} />
            {passkeySignIn.isPending ? "正在验证…" : "使用 Passkey 登录"}
          </button>
        </>
      ) : null}
      <p className="mt-4 text-[10.5px] leading-[1.65] text-faint">
        当前不提供自助密码找回。管理员可以通过受控的人工恢复流程协助，系统不会发送虚假的找回邮件。
      </p>
    </AccessShell>
  );
}

export function AuthenticationLoadingView() {
  return (
    <AccessShell eyebrow="INTERO · 登录" title="正在确认登录状态">
      <p
        className="text-[13px] leading-[1.75] text-ink-muted"
        data-testid="authentication-loading"
      >
        正在连接 Intero，请稍候。
      </p>
    </AccessShell>
  );
}

export function NoTeamAccessView({
  onSignOut,
}: {
  onSignOut: () => Promise<void>;
}) {
  const signOut = useMutation({
    mutationFn: onSignOut,
    onSuccess: () => window.location.reload(),
  });
  return (
    <AccessShell eyebrow="INTERO · 访问范围" title="还没有可访问的团队">
      <p className="text-[13px] leading-[1.75] text-ink-muted">
        你的账号已经登录，但尚未加入任何
        Team。请联系组织管理员发送邀请或授予团队访问权限；普通成员不需要运行组织
        Setup。
      </p>
      <Notice tone="danger">
        这不是本地配置问题。获得 Team 权限后重新打开 Intero 即可直接进入 Team
        Pulse。
      </Notice>
      <button
        type="button"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
        className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-btn border border-line2 bg-transparent text-[12.5px] text-ink disabled:opacity-50"
      >
        <SignOutIcon size={15} />
        退出登录
      </button>
    </AccessShell>
  );
}

export function DevelopmentIdentityToolView({
  identities,
  onSelect,
}: {
  identities: PrincipalSummary[];
  onSelect: (identityId: PrincipalId) => void;
}) {
  return (
    <AccessShell eyebrow="INTERO · 开发工具" title="选择测试身份">
      <p className="text-[13px] leading-[1.75] text-ink-muted">
        此入口仅用于本地测试。选择本次浏览器会话模拟的成员身份。
      </p>
      <div
        className="mt-6 grid gap-2.5"
        data-testid="development-identity-entry"
      >
        {identities.map((identity) => (
          <button
            key={identity.id}
            type="button"
            data-testid={`development-identity-${identity.id}`}
            onClick={() => onSelect(identity.id as PrincipalId)}
            className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 rounded-card border border-line bg-panel2 p-[14px_16px] text-left hover:border-accent-strong"
          >
            <span className="grid h-9 w-9 place-items-center rounded-full bg-raise text-[11px] font-[650]">
              {initials(identity.displayName)}
            </span>
            <span className="grid">
              <strong className="text-[13px] font-[620]">
                {identity.displayName}
              </strong>
              <small className="mt-1 text-[10.5px] text-faint">开发身份</small>
            </span>
            <ArrowRightIcon size={15} className="text-accent-strong" />
          </button>
        ))}
      </div>
      {identities.length === 0 ? (
        <Notice tone="danger">
          当前部署没有可用的开发身份，请检查服务端身份配置。
        </Notice>
      ) : null}
    </AccessShell>
  );
}

export function AcceptInvitationView({
  token,
  onEnterPulse,
}: {
  token: string;
  onEnterPulse: (projectId?: string) => void;
}) {
  const passkeysAvailable =
    typeof window === "undefined" || window.isSecureContext;
  const queryClient = useQueryClient();
  const pilot = usePilot();
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [alsoAddPasskey, setAlsoAddPasskey] = useState(false);
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
  const accept = useMutation({
    mutationFn: () => acceptPilotInvitation(token, displayName.trim()),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pilot"] }),
        queryClient.invalidateQueries({ queryKey: ["threads"] }),
      ]);
    },
  });
  const activate = useMutation({
    mutationFn: async (input: {
      credential: "passkey" | "password" | "both";
      password?: string;
    }) => {
      await activatePilotInvitation(
        token,
        input.credential === "passkey"
          ? { displayName: displayName.trim(), credential: "passkey" }
          : {
              displayName: displayName.trim(),
              credential: input.credential,
              password: input.password!,
            },
      );
      if (input.credential === "passkey" || input.credential === "both") {
        const passkey = await authClient.passkey.addPasskey({
          name: "Intero Passkey",
        });
        if (passkey.error) throw new Error(passkey.error.message);
      }
      return acceptPilotInvitation(token, displayName.trim());
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pilot"] }),
        queryClient.invalidateQueries({ queryKey: ["threads"] }),
      ]);
    },
  });
  const signInExisting = useMutation({
    mutationFn: async (input: { mode: "passkey" | "password" }) => {
      const result =
        input.mode === "passkey"
          ? await authClient.signIn.passkey()
          : await authClient.signIn.email({
              email: invitation.data!.invitation.email,
              password,
            });
      if (result.error) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pilot"] });
    },
  });
  const logout = useMutation({
    mutationFn: pilot.signOutCurrentIdentity,
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
  const accepted = accept.data ?? activate.data;
  const status = detail.invitation.status;

  return (
    <AccessShell eyebrow="INTERO · 团队邀请" title={`加入 ${detail.team.name}`}>
      <div className="grid gap-3 rounded-[13px] border border-line bg-panel2 p-[16px_18px]">
        <InvitationRow label="组织" value={detail.organization.name} />
        <InvitationRow label="团队" value={detail.team.name} />
        <InvitationRow label="受邀邮箱" value={detail.invitation.email} mono />
      </div>

      {!accepted && status === "pending" ? (
        <label className="mt-5 grid gap-1.5">
          <span className="text-[11px] font-[620] text-ink-muted">
            你的姓名
          </span>
          <input
            type="text"
            value={displayName}
            autoComplete="name"
            data-testid="invitation-display-name"
            onChange={(event) => setDisplayName(event.target.value)}
            className="h-10 rounded-btn border border-line2 bg-panel2 px-3 text-[12.5px] text-ink outline-none focus:border-accent-strong"
          />
          <small className="text-[10.5px] leading-[1.55] text-faint">
            请填写你希望团队成员看到的姓名。
          </small>
        </label>
      ) : null}

      {accepted ? (
        <>
          <Notice tone="success">
            已加入 {accepted.team.name}
            。你的姓名已写入个人设置，并已获得团队关联项目的访问权限。
          </Notice>
          <div className="mt-5">
            <button
              type="button"
              onClick={() => onEnterPulse(accepted.projects[0]?.id)}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-btn border-0 bg-accent-strong text-[12px] font-[620] text-on-accent"
            >
              进入 Team Pulse
              <ArrowRightIcon size={14} />
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
      ) : !signedIn && detail.activationRequired ? (
        <>
          <p className="mt-5 text-[12px] leading-[1.7] text-ink-muted">
            这个一次性激活链接用于建立首个登录凭据。
            {passkeysAvailable
              ? "可以创建 Passkey，也可以先设置密码。"
              : "当前为内网 HTTP 试用地址，请先设置密码。"}
            激活完成后，链接不能用于再次登录。
          </p>
          {activate.isError ? (
            <Notice tone="danger">
              激活失败。请重试，或让组织管理员撤销并重新生成激活链接。
            </Notice>
          ) : null}
          <form
            className="mt-5"
            data-testid="activation-password-form"
            onSubmit={(event) => {
              event.preventDefault();
              activate.mutate({
                credential: alsoAddPasskey ? "both" : "password",
                password,
              });
            }}
          >
            <PasswordField
              label="新密码"
              autoComplete="new-password"
              value={password}
              visible={passwordVisible}
              inputTestId="activation-password"
              toggleTestId="activation-password-toggle"
              onChange={setPassword}
              onToggle={() => setPasswordVisible((current) => !current)}
            />
            {passkeysAvailable ? (
              <Checkbox
                className="mt-3"
                checked={alsoAddPasskey}
                onChange={setAlsoAddPasskey}
                label="激活后同时添加 Passkey"
              />
            ) : null}
            <button
              type="submit"
              data-testid="activation-password-submit"
              disabled={
                !displayName.trim() ||
                password.length < 12 ||
                activate.isPending
              }
              className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-btn border-0 bg-accent-strong text-[12px] font-[620] text-on-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
            >
              <KeyIcon size={15} />
              设置密码并激活
            </button>
          </form>
          {passkeysAvailable ? (
            <>
              <div className="my-5 flex items-center gap-3 text-[10px] text-faint">
                <span className="h-px flex-1 bg-line" />
                或使用 Passkey
                <span className="h-px flex-1 bg-line" />
              </div>
              <button
                type="button"
                data-testid="activation-passkey"
                disabled={!displayName.trim() || activate.isPending}
                onClick={() => activate.mutate({ credential: "passkey" })}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-btn border border-line2 bg-transparent text-[12.5px] font-[620] text-ink disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
              >
                <FingerprintIcon size={16} />
                {activate.isPending ? "正在激活…" : "使用 Passkey 激活"}
              </button>
            </>
          ) : null}
        </>
      ) : !signedIn ? (
        <>
          <p className="mt-5 text-[12px] leading-[1.7] text-ink-muted">
            这个账号已经激活。请用已有密码
            {passkeysAvailable ? "或 Passkey" : ""}登录，再确认加入团队。
          </p>
          {signInExisting.isError ? (
            <Notice tone="danger">
              登录失败，请检查凭据或联系组织管理员。
            </Notice>
          ) : null}
          <form
            className="mt-5"
            onSubmit={(event) => {
              event.preventDefault();
              signInExisting.mutate({ mode: "password" });
            }}
          >
            <PasswordField
              label="密码"
              autoComplete="current-password"
              value={password}
              visible={passwordVisible}
              inputTestId="invitation-sign-in-password"
              toggleTestId="invitation-sign-in-password-toggle"
              onChange={setPassword}
              onToggle={() => setPasswordVisible((current) => !current)}
            />
            <button
              type="submit"
              disabled={password.length < 12 || signInExisting.isPending}
              className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-btn border-0 bg-accent-strong text-[12px] font-[620] text-on-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
            >
              <KeyIcon size={15} />
              使用密码登录
            </button>
          </form>
          {passkeysAvailable ? (
            <>
              <div className="my-5 flex items-center gap-3 text-[10px] text-faint">
                <span className="h-px flex-1 bg-line" />
                或使用 Passkey
                <span className="h-px flex-1 bg-line" />
              </div>
              <button
                type="button"
                disabled={signInExisting.isPending}
                onClick={() => signInExisting.mutate({ mode: "passkey" })}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-btn border border-line2 bg-transparent text-[12.5px] font-[620] text-ink disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
              >
                <FingerprintIcon size={16} />
                使用 Passkey 登录
              </button>
            </>
          ) : null}
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
            disabled={!displayName.trim() || accept.isPending}
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

export function PasswordField({
  label,
  autoComplete,
  value,
  visible,
  onChange,
  onToggle,
  inputTestId,
  toggleTestId,
  className = "",
}: {
  label: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
  inputTestId: string;
  toggleTestId: string;
  className?: string;
}) {
  return (
    <label className={["grid gap-2", className].join(" ")}>
      <span className="text-[11px] font-[620] text-ink-muted">{label}</span>
      <span className="grid grid-cols-[minmax(0,1fr)_40px] overflow-hidden rounded-btn border border-line2 bg-raise focus-within:border-accent-strong focus-within:ring-1 focus-within:ring-accent-strong">
        <input
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          data-testid={inputTestId}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 min-w-0 border-0 bg-transparent px-3 text-[12.5px] text-ink outline-none"
          placeholder="至少 12 位"
        />
        <button
          type="button"
          data-testid={toggleTestId}
          aria-label={visible ? "隐藏密码" : "显示密码"}
          aria-pressed={visible}
          onClick={onToggle}
          className="grid h-10 w-10 place-items-center border-0 border-l border-line bg-transparent text-faint hover:bg-hover-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent-strong"
        >
          {visible ? <EyeSlashIcon size={15} /> : <EyeIcon size={15} />}
        </button>
      </span>
    </label>
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
