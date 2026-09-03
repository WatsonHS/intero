import type {
  PrincipalId,
  PresenceSnapshot,
  PresenceState,
} from "@intero/domain";

const HEARTBEAT_OFFLINE_AFTER_MS = 75_000;
const AWAY_AFTER_MS = 5 * 60_000;

export interface PresenceTimes {
  lastSeenAt: number;
  lastActiveAt: number;
}

export class InMemoryPresenceDirectory {
  readonly #entries = new Map<PrincipalId, PresenceTimes>();

  heartbeat(
    principalId: PrincipalId,
    input: { active?: boolean; now?: number } = {},
  ): PresenceSnapshot {
    const now = input.now ?? Date.now();
    const current = this.#entries.get(principalId);
    const lastActiveAt =
      input.active === false ? (current?.lastActiveAt ?? now) : now;
    const entry = { lastSeenAt: now, lastActiveAt };
    this.#entries.set(principalId, entry);
    return snapshotFor(principalId, entry, now);
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

export function presenceTimesFromRow(row: {
  last_seen_at: Date | string;
  last_active_at: Date | string;
}): PresenceTimes {
  return {
    lastSeenAt: new Date(row.last_seen_at).getTime(),
    lastActiveAt: new Date(row.last_active_at).getTime(),
  };
}

export function snapshotFor(
  principalId: PrincipalId,
  entry: PresenceTimes,
  now: number,
): PresenceSnapshot {
  return {
    principalId,
    state: presenceState(entry, now),
    lastSeenAt: new Date(entry.lastSeenAt).toISOString(),
  };
}

export function presenceState(
  entry: PresenceTimes,
  now: number,
): PresenceState {
  if (now - entry.lastSeenAt > HEARTBEAT_OFFLINE_AFTER_MS) {
    return "offline";
  }
  if (now - entry.lastActiveAt >= AWAY_AFTER_MS) return "away";
  return "online";
}
