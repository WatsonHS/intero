import {
  CheckIcon,
  GearSixIcon,
  PencilSimpleIcon,
  SignOutIcon,
  UserCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { initials } from "../design/utils.js";
import { getPilotProfile, signOut, updatePilotProfile } from "../pilot/api.js";
import { usePilotOptional } from "../pilot/context.js";

export type AvatarTone = "accent" | "green" | "amber" | "cool";

const AVATAR_TONES: Array<{
  id: AvatarTone;
  label: string;
  className: string;
}> = [
  {
    id: "accent",
    label: "强调色",
    className: "bg-accent-soft text-accent-strong",
  },
  { id: "green", label: "绿色", className: "bg-green-soft text-green" },
  { id: "amber", label: "琥珀色", className: "bg-amber-soft text-amber" },
  { id: "cool", label: "冷灰色", className: "bg-raise text-ink-muted" },
];

export function avatarToneClass(tone: AvatarTone | undefined): string {
  return (
    AVATAR_TONES.find((option) => option.id === tone)?.className ??
    AVATAR_TONES[0]!.className
  );
}

export function ProfileMenu({
  compact,
  fallbackName,
  organizationName,
  onOpenPersonal,
}: {
  compact: boolean;
  fallbackName?: string;
  organizationName?: string;
  onOpenPersonal: () => void;
}) {
  const queryClient = useQueryClient();
  const pilot = usePilotOptional();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const developmentIdentityId =
    pilot?.bootstrap.data?.authMode === "development_identity"
      ? pilot.identityId
      : undefined;
  const profile = useQuery({
    queryKey: ["pilot", "profile", pilot?.identityId],
    queryFn: ({ signal }) => getPilotProfile(developmentIdentityId, signal),
    enabled: !pilot?.enabled || Boolean(pilot.effectiveIdentity),
  });
  const identity = profile.data?.profile;
  const name = identity?.displayName ?? fallbackName ?? "—";
  const accountDetail = identity?.email
    ? identity.email
    : profile.isError
      ? "账号信息读取失败"
      : profile.isPending
        ? "正在读取账号…"
        : "未登录";

  useEffect(() => {
    if (identity?.displayName) setDisplayName(identity.displayName);
  }, [identity?.displayName]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() =>
        menuRef.current
          ?.querySelector<HTMLButtonElement>(
            "button:not([disabled]), input:not([disabled])",
          )
          ?.focus(),
      );
    }
  }, [open]);

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  const saveName = useMutation({
    mutationFn: () =>
      updatePilotProfile({ displayName }, developmentIdentityId),
    onSuccess: async () => {
      setEditingName(false);
      await queryClient.invalidateQueries({ queryKey: ["pilot"] });
    },
  });
  const saveAvatar = useMutation({
    mutationFn: (avatarTone: AvatarTone) =>
      updatePilotProfile({ avatarTone }, developmentIdentityId),
    onSuccess: async () => {
      setEditingAvatar(false);
      await queryClient.invalidateQueries({ queryKey: ["pilot"] });
    },
  });
  const logout = useMutation({
    mutationFn: () => pilot?.signOutCurrentIdentity() ?? signOut(),
    onSuccess: () => {
      closeMenu();
      if (pilot?.bootstrap.data?.authMode !== "development_identity") {
        window.location.reload();
      }
    },
  });

  function closeMenu(focusTrigger = false) {
    setOpen(false);
    setEditingName(false);
    setEditingAvatar(false);
    if (focusTrigger) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled])",
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? (current - 1 + focusable.length) % focusable.length
      : (current + 1) % focusable.length;
    event.preventDefault();
    focusable[next]?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid="profile-menu-trigger"
        title="账户与个人资料"
        onClick={() => setOpen((current) => !current)}
        className={[
          "grid items-center gap-[11px] rounded-[10px] border-0 bg-transparent p-0 text-left",
          "cursor-pointer outline-offset-2 hover:bg-hover-wash focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent-strong",
          compact
            ? "h-9 w-9 grid-cols-[30px] justify-center"
            : "min-h-11 w-full grid-cols-[30px_minmax(0,1fr)] px-[7px]",
        ].join(" ")}
      >
        <span
          className={[
            "grid h-[30px] w-[30px] place-items-center justify-self-center rounded-full text-[10px] font-[650]",
            avatarToneClass(identity?.avatarTone),
          ].join(" ")}
        >
          {initials(name)}
        </span>
        {!compact ? (
          <span className="min-w-0 animate-message-enter">
            <strong className="block truncate text-[11.5px] font-semibold text-ink">
              {name}
            </strong>
            <small className="mt-0.5 block truncate text-[9.5px] text-faint">
              账户与个人资料
            </small>
          </span>
        ) : null}
      </button>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="dialog"
              aria-label="账户与个人资料"
              data-testid="profile-menu"
              onKeyDown={handleMenuKeyDown}
              className="fixed bottom-4 left-[70px] z-50 w-[300px] rounded-[15px] border border-line2 bg-panel2 p-2 shadow-[0_18px_50px_rgba(0,0,0,0.18)] outline-none animate-message-enter"
            >
              <div className="grid grid-cols-[38px_minmax(0,1fr)_28px] items-center gap-3 rounded-[11px] bg-raise p-3">
                <span
                  className={[
                    "grid h-[38px] w-[38px] place-items-center rounded-full text-[11px] font-[680]",
                    avatarToneClass(identity?.avatarTone),
                  ].join(" ")}
                >
                  {initials(name)}
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-[12.5px] font-[650]">
                    {name}
                  </strong>
                  <small className="mt-0.5 block truncate font-mono text-[9.5px] text-faint">
                    {accountDetail}
                  </small>
                  <small className="mt-1 block truncate text-[9.5px] text-green">
                    已登录 · {organizationName ?? "Intero"}
                  </small>
                </span>
                <button
                  type="button"
                  aria-label="关闭账户菜单"
                  onClick={() => closeMenu(true)}
                  className="grid h-7 w-7 place-items-center rounded-[8px] border-0 bg-transparent text-faint hover:bg-hover-wash hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent-strong"
                >
                  <XIcon size={13} />
                </button>
              </div>

              {editingAvatar ? (
                <div
                  className="mt-2 rounded-[11px] border border-line bg-bg p-3"
                  data-testid="profile-avatar-editor"
                >
                  <span className="text-[10.5px] font-[620] text-ink-muted">
                    选择头像颜色
                  </span>
                  <div className="mt-2.5 flex gap-2">
                    {AVATAR_TONES.map((tone) => (
                      <button
                        key={tone.id}
                        type="button"
                        aria-label={tone.label}
                        aria-pressed={identity?.avatarTone === tone.id}
                        data-testid={`profile-avatar-tone-${tone.id}`}
                        disabled={saveAvatar.isPending}
                        onClick={() => saveAvatar.mutate(tone.id)}
                        className={[
                          "grid h-9 w-9 place-items-center rounded-full border-2 text-[10px] font-[650]",
                          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong",
                          tone.className,
                          identity?.avatarTone === tone.id
                            ? "border-ink"
                            : "border-transparent",
                        ].join(" ")}
                      >
                        {identity?.avatarTone === tone.id ? (
                          <CheckIcon size={12} weight="bold" />
                        ) : (
                          initials(name)
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {editingName ? (
                <form
                  className="mt-2 grid gap-2 rounded-[11px] border border-line bg-bg p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveName.mutate();
                  }}
                >
                  <label className="grid gap-1.5">
                    <span className="text-[10.5px] font-[620] text-ink-muted">
                      显示姓名
                    </span>
                    <input
                      ref={nameInputRef}
                      value={displayName}
                      data-testid="profile-display-name-input"
                      onChange={(event) => setDisplayName(event.target.value)}
                      className="h-9 rounded-btn border border-line2 bg-raise px-3 text-[12px] outline-none focus-visible:border-accent-strong focus-visible:ring-1 focus-visible:ring-accent-strong"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={
                        !displayName.trim() ||
                        displayName.trim() === identity?.displayName ||
                        saveName.isPending
                      }
                      className="h-8 rounded-btn border-0 bg-accent-strong px-3 text-[11px] font-[620] text-on-accent disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingName(false)}
                      className="h-8 rounded-btn border border-line2 bg-transparent px-3 text-[11px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent-strong"
                    >
                      取消
                    </button>
                  </div>
                </form>
              ) : null}

              <div className="mt-2 grid gap-1">
                <MenuAction
                  icon={<UserCircleIcon size={15} />}
                  label="编辑头像"
                  testId="profile-edit-avatar"
                  onClick={() => {
                    setEditingName(false);
                    setEditingAvatar((current) => !current);
                  }}
                />
                <MenuAction
                  icon={<PencilSimpleIcon size={15} />}
                  label="编辑显示姓名"
                  testId="profile-edit-name"
                  onClick={() => {
                    setEditingAvatar(false);
                    setEditingName(true);
                  }}
                />
                <MenuAction
                  icon={<GearSixIcon size={15} />}
                  label="打开个人设置"
                  testId="profile-open-personal"
                  onClick={() => {
                    closeMenu();
                    onOpenPersonal();
                  }}
                />
                <span className="my-1 h-px bg-line" />
                <MenuAction
                  icon={<SignOutIcon size={15} />}
                  label={logout.isPending ? "正在退出…" : "退出登录"}
                  testId="profile-sign-out"
                  danger
                  disabled={logout.isPending}
                  onClick={() => logout.mutate()}
                />
                {logout.isError ? (
                  <p
                    role="alert"
                    className="px-2.5 pb-1 text-[10px] text-danger"
                  >
                    退出失败，请重试。
                  </p>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function MenuAction({
  icon,
  label,
  onClick,
  testId,
  danger = false,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testId: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={[
        "flex h-9 w-full items-center gap-2.5 rounded-[9px] border-0 bg-transparent px-2.5 text-left text-[11.5px]",
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent-strong disabled:opacity-45",
        danger
          ? "text-danger hover:bg-danger-soft"
          : "text-ink-muted hover:bg-hover-wash hover:text-ink",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}
