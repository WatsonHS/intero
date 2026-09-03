import type { PresenceState } from "@intero/domain";
import type { ReactNode } from "react";

import { Avatar, cn } from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";
import type { TranslationKey } from "../../i18n/locales/zh-CN.js";

const PRESENCE_DOT: Record<PresenceState, string> = {
  online: "bg-green",
  away: "bg-amber",
  offline: "bg-faint",
};

const PRESENCE_LABEL: Record<PresenceState, TranslationKey> = {
  online: "chat.presence.online",
  away: "chat.presence.away",
  offline: "chat.presence.offline",
};

export function PresenceDot({
  state,
  className,
}: {
  state: PresenceState;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <span
      data-testid="presence-dot"
      data-presence={state}
      title={t(PRESENCE_LABEL[state])}
      aria-label={t(PRESENCE_LABEL[state])}
      className={cn(
        "absolute right-[-1px] bottom-[-1px] h-[9px] w-[9px] rounded-full ring-[1.5px] ring-panel",
        PRESENCE_DOT[state],
        className,
      )}
    />
  );
}

export function PresenceAvatar({
  id,
  name,
  state,
  size = "md",
  className,
}: {
  id: string;
  name?: string | undefined;
  state: PresenceState;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  return (
    <span
      data-presence-principal={id}
      className={cn("relative inline-grid shrink-0", className)}
    >
      <Avatar id={id} name={name} size={size} />
      <PresenceDot state={state} />
    </span>
  );
}

export function PresenceBadge({
  state,
  children,
}: {
  state: PresenceState;
  children: ReactNode;
}) {
  return (
    <span className="relative inline-grid shrink-0">
      {children}
      <PresenceDot state={state} />
    </span>
  );
}
