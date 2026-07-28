const HOUR_MS = 60 * 60 * 1_000;

export const DETAIL_WINDOW_MS = 72 * HOUR_MS;
export const PULSE_PROJECT_LIMIT = 3;

export type WorkVisibility = "recent" | "archived";

/**
 * Team Pulse and person detail share a rolling 72-hour window. Archive is
 * derived from the latest semantic freshness timestamp, so a new checkpoint
 * automatically resurfaces an item.
 */
export function classifyWorkVisibility(
  freshnessAt: string,
  now = new Date(),
): WorkVisibility {
  const freshness = Date.parse(freshnessAt);
  if (now.getTime() - freshness <= DETAIL_WINDOW_MS) return "recent";
  return "archived";
}

export function isInDetailWindow(
  freshnessAt: string,
  now = new Date(),
): boolean {
  return classifyWorkVisibility(freshnessAt, now) !== "archived";
}

export function isInPulseDay(freshnessAt: string, now = new Date()): boolean {
  const freshness = new Date(freshnessAt);
  return (
    Number.isFinite(freshness.getTime()) &&
    freshness.getFullYear() === now.getFullYear() &&
    freshness.getMonth() === now.getMonth() &&
    freshness.getDate() === now.getDate()
  );
}

export interface PulseProjectGroup<
  T extends { projectId?: string | undefined; freshnessAt: string },
> {
  key: string;
  projectId: string | undefined;
  freshnessAt: string;
  items: T[];
}

export function groupPulseWorkByProject<
  T extends { projectId?: string | undefined; freshnessAt: string },
>(workstreams: T[]): PulseProjectGroup<T>[] {
  const groups = new Map<string, PulseProjectGroup<T>>();
  for (const workstream of workstreams) {
    const key = workstream.projectId ?? "__unbound__";
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(workstream);
      if (
        Date.parse(workstream.freshnessAt) > Date.parse(existing.freshnessAt)
      ) {
        existing.freshnessAt = workstream.freshnessAt;
      }
    } else {
      groups.set(key, {
        key,
        projectId: workstream.projectId,
        freshnessAt: workstream.freshnessAt,
        items: [workstream],
      });
    }
  }
  return Array.from(groups.values()).toSorted(
    (left, right) =>
      Date.parse(right.freshnessAt) - Date.parse(left.freshnessAt),
  );
}

export function selectPulseProjectWork<
  T extends { projectId?: string | undefined; freshnessAt: string },
>(
  workstreams: T[],
  expanded: boolean,
  projectLimit = PULSE_PROJECT_LIMIT,
): {
  visible: T[];
  hiddenProjectCount: number;
} {
  const groups = groupPulseWorkByProject(workstreams);
  const visibleGroups = expanded ? groups : groups.slice(0, projectLimit);
  return {
    visible: visibleGroups.flatMap((group) => group.items),
    hiddenProjectCount: Math.max(groups.length - projectLimit, 0),
  };
}
