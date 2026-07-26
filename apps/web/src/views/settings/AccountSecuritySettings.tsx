import { FingerprintIcon, SignOutIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";

import { authClient } from "../../auth-client.js";
import { signOut } from "../../pilot/api.js";
import { usePilotOptional } from "../../pilot/context.js";

export function AccountSecuritySettings() {
  const pilot = usePilotOptional();
  const addPasskey = useMutation({
    mutationFn: async () => {
      const result = await authClient.passkey.addPasskey({
        name: "Intero Passkey",
      });
      if (result.error) throw new Error(result.error.message);
    },
  });
  const logout = useMutation({
    mutationFn: () => pilot?.signOutCurrentIdentity() ?? signOut(),
    onSuccess: () => {
      if (pilot?.bootstrap.data?.authMode !== "development_identity") {
        window.location.reload();
      }
    },
  });

  return (
    <section className="mt-8" data-testid="account-security-settings">
      <div className="flex items-center gap-2">
        <FingerprintIcon size={16} className="text-ink-muted" />
        <strong className="text-[14px] font-[620]">账号与登录</strong>
      </div>
      <p className="mt-2 max-w-[560px] text-[12px] leading-[1.7] text-ink-muted">
        Passkey
        是推荐的登录方式，密码用于备用登录。激活链接不能再次登录；当前不提供自助密码找回。
      </p>
      <div className="mt-3.5 flex items-center gap-3 rounded-[13px] border border-line bg-panel2 p-[16px_18px]">
        <button
          type="button"
          disabled={addPasskey.isPending}
          onClick={() => addPasskey.mutate()}
          className="flex h-9 items-center gap-2 rounded-btn border border-line2 bg-raise px-4 text-[11.5px] text-ink hover:border-accent-strong disabled:opacity-50"
        >
          <FingerprintIcon size={15} />
          {addPasskey.isPending ? "正在添加…" : "添加 Passkey"}
        </button>
        <button
          type="button"
          disabled={logout.isPending}
          onClick={() => logout.mutate()}
          className="ml-auto flex h-9 items-center gap-2 rounded-btn border border-line2 bg-transparent px-4 text-[11.5px] text-ink-muted hover:border-danger hover:text-danger disabled:opacity-50"
        >
          <SignOutIcon size={15} />
          退出当前账号
        </button>
      </div>
      {addPasskey.isSuccess ? (
        <p className="mt-2 text-[10.5px] text-green">
          Passkey 已添加，可以在下一次登录时直接使用。
        </p>
      ) : null}
      {addPasskey.isError ? (
        <p className="mt-2 text-[10.5px] text-danger">
          未能添加 Passkey。请确认浏览器或系统凭据管理器可用后重试。
        </p>
      ) : null}
      {logout.isError ? (
        <p role="alert" className="mt-2 text-[10.5px] text-danger">
          退出失败，请重试。
        </p>
      ) : null}
    </section>
  );
}
