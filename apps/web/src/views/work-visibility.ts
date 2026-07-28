const HOUR_MS = 60 * 60 * 1_000;

export const DETAIL_WINDOW_MS = 72 * HOUR_MS;
export const PULSE_PAGE_SIZE = 3;
export const PULSE_MAX_ITEMS = PULSE_PAGE_SIZE * 2;

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

export function pulseDetailOnlyCount(total: number): number {
  return Math.max(total - PULSE_MAX_ITEMS, 0);
}

export function selectPulseWork<T>(
  workstreams: T[],
  expanded: boolean,
): {
  visible: T[];
  nextCount: number;
  detailOnlyCount: number;
} {
  return {
    visible: workstreams.slice(0, expanded ? PULSE_MAX_ITEMS : PULSE_PAGE_SIZE),
    nextCount: Math.min(
      PULSE_PAGE_SIZE,
      Math.max(workstreams.length - PULSE_PAGE_SIZE, 0),
    ),
    detailOnlyCount: pulseDetailOnlyCount(workstreams.length),
  };
}
