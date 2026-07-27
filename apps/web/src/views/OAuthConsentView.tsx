import {
  CheckCircleIcon,
  PlugsConnectedIcon,
  ShieldCheckIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";

import { authClient } from "../auth-client.js";

export function OAuthConsentView() {
  const query =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const clientName = query.get("client_name") ?? "Codex";
  const scopes = (query.get("scope") ?? "intero:mcp")
    .split(/\s+/)
    .filter(Boolean);

  const consent = useMutation({
    mutationFn: async (accept: boolean) => {
      const result = await authClient.oauth2.consent({ accept });
      if (result.error) {
        throw new Error(
          result.error.message ?? "Unable to complete OAuth authorization.",
        );
      }
      const redirect = result.data as
        { redirect_uri?: string; url?: string } | undefined;
      const redirectUrl = redirect?.redirect_uri ?? redirect?.url;
      if (redirectUrl && typeof window !== "undefined") {
        window.location.assign(redirectUrl);
      }
      return result.data;
    },
  });

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-5 py-10 text-ink">
      <section className="w-full max-w-[460px] rounded-container border border-line bg-panel2 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.16)]">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-accent-soft text-accent-strong">
            <PlugsConnectedIcon size={21} weight="fill" />
          </span>
          <span>
            <p className="text-[10.5px] font-[650] tracking-[0.1em] text-accent-strong">
              CODING AGENT AUTHORIZATION
            </p>
            <h1 className="mt-1.5 text-[22px] font-[600] tracking-[-0.025em]">
              允许 {clientName} 连接 Intero
            </h1>
          </span>
        </div>

        <p className="mt-5 text-[12px] leading-[1.75] text-ink-muted">
          本次授权只会用于连接页面中选定的 Intero Project。Intero 会在收到带
          OAuth 身份的原生 MCP initialize 后，将该连接标记为已验证。
        </p>

        <div className="mt-5 rounded-card border border-line bg-bg p-4">
          <div className="flex items-center gap-2 text-[12px] font-[620]">
            <ShieldCheckIcon size={16} className="text-green" weight="fill" />
            授权范围
          </div>
          <ul className="mt-3 grid gap-2 text-[11px] text-ink-muted">
            {scopes.includes("intero:mcp") ? (
              <li className="flex items-center gap-2">
                <CheckCircleIcon size={13} className="text-green" />
                访问该连接对应 Project 的 Intero MCP 工具
              </li>
            ) : null}
            {scopes.includes("offline_access") ? (
              <li className="flex items-center gap-2">
                <CheckCircleIcon size={13} className="text-green" />在 Codex
                中安全续期登录，无需保存 Intero 静态凭证
              </li>
            ) : null}
            <li className="flex items-center gap-2">
              <CheckCircleIcon size={13} className="text-green" />
              以当前 Intero 账户执行项目成员权限检查
            </li>
          </ul>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            disabled={consent.isPending}
            onClick={() => consent.mutate(false)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-btn border border-line2 bg-transparent text-[11.5px] hover:border-danger hover:text-danger disabled:opacity-50"
          >
            <XIcon size={14} />
            取消
          </button>
          <button
            type="button"
            disabled={consent.isPending}
            onClick={() => consent.mutate(true)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-btn border-0 bg-accent-strong text-[11.5px] font-[630] text-on-accent disabled:opacity-50"
          >
            <CheckCircleIcon size={14} weight="fill" />
            {consent.isPending ? "正在授权…" : "允许连接"}
          </button>
        </div>

        {consent.isError ? (
          <p className="mt-4 rounded-card bg-danger-soft p-3 text-[11px] text-danger">
            {consent.error instanceof Error
              ? consent.error.message
              : "无法完成授权，请返回 Codex 后重试。"}
          </p>
        ) : null}
      </section>
    </main>
  );
}
