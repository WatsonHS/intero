import { CheckCircleIcon, PlugsIcon } from "@phosphor-icons/react";

import type { PilotSafeAgentBinding } from "../../pilot/api.js";

export type ProjectAgentConnectionSummary = {
  connected: PilotSafeAgentBinding[];
  lifecyclePending: PilotSafeAgentBinding[];
  pending: PilotSafeAgentBinding[];
  mineConnected: PilotSafeAgentBinding[];
  mineLifecyclePending: PilotSafeAgentBinding[];
  minePending: PilotSafeAgentBinding[];
};

export function summarizeProjectAgentConnections(
  bindings: PilotSafeAgentBinding[],
  identityId?: string,
): ProjectAgentConnectionSummary {
  const active = bindings.filter(
    (binding) => !binding.disconnectedAt && binding.authMode !== "oauth",
  );
  const connected = active.filter((binding) =>
    Boolean(binding.validatedAt && binding.activityUpdatedAt),
  );
  const lifecyclePending = active.filter((binding) =>
    Boolean(binding.validatedAt && !binding.activityUpdatedAt),
  );
  const pending = active.filter((binding) => !binding.validatedAt);
  return {
    connected,
    lifecyclePending,
    pending,
    mineConnected: connected.filter(
      (binding) => binding.ownerId === identityId,
    ),
    mineLifecyclePending: lifecyclePending.filter(
      (binding) => binding.ownerId === identityId,
    ),
    minePending: pending.filter((binding) => binding.ownerId === identityId),
  };
}

export function ProjectAgentConnectionBadge({
  bindings,
  identityId,
  onOpen,
}: {
  bindings: PilotSafeAgentBinding[];
  identityId?: string | undefined;
  onOpen: () => void;
}) {
  const summary = summarizeProjectAgentConnections(bindings, identityId);
  const connected = summary.connected.length;
  const lifecyclePending = summary.lifecyclePending.length;
  const pending = summary.pending.length;
  const label =
    connected > 0
      ? `${connected} 个 Agent 已连接`
      : lifecyclePending > 0
        ? "MCP 已验证 · Hook 待确认"
        : pending > 0
          ? "Agent 正在连接"
          : "尚未连接 Agent";

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="project-agent-connection-badge"
      className={[
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-pill border px-3 text-[11px]",
        connected > 0
          ? "border-green-soft bg-green-soft text-green"
          : lifecyclePending > 0
            ? "border-amber-soft bg-amber-soft text-amber"
            : pending > 0
              ? "border-accent-soft bg-accent-soft text-accent-strong"
              : "border-amber-soft bg-amber-soft text-amber",
      ].join(" ")}
    >
      {connected > 0 ? (
        <CheckCircleIcon size={13} weight="fill" />
      ) : (
        <PlugsIcon size={13} />
      )}
      {label}
    </button>
  );
}
