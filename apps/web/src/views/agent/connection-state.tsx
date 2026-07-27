import { CheckCircleIcon, PlugsIcon } from "@phosphor-icons/react";

import type { PilotSafeAgentBinding } from "../../pilot/api.js";

export type ProjectAgentConnectionSummary = {
  connected: PilotSafeAgentBinding[];
  pending: PilotSafeAgentBinding[];
  mineConnected: PilotSafeAgentBinding[];
  minePending: PilotSafeAgentBinding[];
};

export function summarizeProjectAgentConnections(
  bindings: PilotSafeAgentBinding[],
  identityId?: string,
): ProjectAgentConnectionSummary {
  const active = bindings.filter((binding) => !binding.disconnectedAt);
  const connected = active.filter((binding) => Boolean(binding.validatedAt));
  const pending = active.filter((binding) => !binding.validatedAt);
  return {
    connected,
    pending,
    mineConnected: connected.filter(
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
  const pending = summary.pending.length;
  const label =
    connected > 0
      ? `${connected} 个 Agent 已连接`
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
