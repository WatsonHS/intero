import type {
  PrincipalId,
  PresenceSnapshot,
  PresenceState,
} from "@intero/domain";

const HEARTBEAT_OFFLINE_AFTER_MS = 75_000;
const AWAY_AFTER_MS = 5 * 60_000;

interface PresenceEntry {
  lastHeartbeatAt: number;
  lastActivityAt: number;
}

export class InMemoryPresenceDirectory {
  readonly #entries = new Map<PrincipalId, PresenceEntry>();

  heartbeat(
    principalId: PrincipalId,
    input: { active?: boolean; now?: number } = {},
  ): PresenceSnapshot {
    const now = input.now ?? Date.now();
    const current = this.#entries.get(principalId);
    const lastActivityAt =
      input.active === false ? (current?.lastActivityAt ?? now) : now;
    this.#entries.set(principalId, {
      lastHeartbeatAt: now,
      lastActivityAt,
    });
    return snapshotFor(
      principalId,
      { lastHeartbeatAt: now, lastActivityAt },
      now,
    );
  }

  list(
    principalIds: readonly PrincipalId[],
    now = Date.now(),
  ): PresenceSnapshot[] {
    return principalIds.map((principalId) => {
      const entry = this.#entries.get(principalId);
      return entry
        ? snapshotFor(principalId, entry, now)
        : { principalId, state: "offline" as const };
    });
  }
}

function snapshotFor(
  principalId: PrincipalId,
  entry: PresenceEntry,
  now: number,
): PresenceSnapshot {
  const state = presenceState(entry, now);
  return {
    principalId,
    state,
    lastSeenAt: new Date(entry.lastHeartbeatAt).toISOString(),
  };
}

export function presenceState(
  entry: PresenceEntry,
  now: number,
): PresenceState {
  if (now - entry.lastHeartbeatAt > HEARTBEAT_OFFLINE_AFTER_MS) {
    return "offline";
  }
  if (now - entry.lastActivityAt >= AWAY_AFTER_MS) return "away";
  return "online";
}
