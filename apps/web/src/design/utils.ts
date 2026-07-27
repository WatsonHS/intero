import type { WorkstreamPhase } from "@intero/domain";

export type Tone = "green" | "amber" | "danger" | "faint" | "accent" | "cool";

// Fixed person tints from the design; assignment is deterministic per principal.
const TINTS = [
  "#e8a765",
  "#8fb3d9",
  "#b79ad6",
  "#8ec79a",
  "#e0a2a2",
  "#d9c188",
];

export function tintFor(principalId: string): string {
  let hash = 0;
  for (let index = 0; index < principalId.length; index += 1) {
    hash = (hash * 31 + principalId.charCodeAt(index)) >>> 0;
  }
  return TINTS[hash % TINTS.length]!;
}

export function initials(name: string | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts.at(-1)![0] ?? ""}`.toUpperCase();
}

// Domain phase → design phase chip. Labels follow the design's PH map, which
// keeps the phase vocabulary in English in both locales.
export const PHASE_META: Record<
  WorkstreamPhase,
  { label: string; tone: Tone }
> = {
  exploring: { label: "Exploring", tone: "faint" },
  planning: { label: "Planning", tone: "faint" },
  implementing: { label: "Building", tone: "green" },
  validating: { label: "Validating", tone: "amber" },
  reviewing: { label: "Reviewing", tone: "amber" },
  blocked: { label: "Blocked", tone: "danger" },
  paused: { label: "Paused", tone: "faint" },
  completed: { label: "Done", tone: "faint" },
};

export function toneClass(tone: Tone): string {
  return `tone-${tone}`;
}

// How much attention a phase deserves. Parallel work is ordered by this, not
// by priority: what is stuck comes first, what is finished sinks. Ties break
// on freshness so the most recently observed workstream leads.
const ATTENTION_RANK: Record<WorkstreamPhase, number> = {
  blocked: 0,
  reviewing: 1,
  validating: 2,
  implementing: 3,
  planning: 4,
  exploring: 5,
  paused: 6,
  completed: 7,
};

export function orderByAttention<
  T extends { phase: WorkstreamPhase; freshnessAt: string },
>(workstreams: readonly T[]): T[] {
  return workstreams.toSorted(
    (left, right) =>
      ATTENTION_RANK[left.phase] - ATTENTION_RANK[right.phase] ||
      Date.parse(right.freshnessAt) - Date.parse(left.freshnessAt),
  );
}

export function isLivePhase(phase: WorkstreamPhase): boolean {
  return phase !== "completed" && phase !== "paused";
}

/** Counts behind the "N 条并行 · M 条卡住" load label. */
export function loadSummary<T extends { phase: WorkstreamPhase }>(
  workstreams: readonly T[],
): { total: number; live: number; blocked: number } {
  return {
    total: workstreams.length,
    live: workstreams.filter((item) => isLivePhase(item.phase)).length,
    blocked: workstreams.filter((item) => item.phase === "blocked").length,
  };
}

export function freshest<T extends { freshnessAt: string }>(
  workstreams: readonly T[],
): T | undefined {
  return workstreams.toSorted(
    (left, right) =>
      Date.parse(right.freshnessAt) - Date.parse(left.freshnessAt),
  )[0];
}

// Fluent-style reveal: the hover halo follows the pointer. The handler only
// writes CSS variables on the hovered card; the overlay's radial gradient
// reads them, and group-hover controls its opacity — no React state involved.
export function revealMove(event: {
  currentTarget: EventTarget & HTMLElement;
  clientX: number;
  clientY: number;
}): void {
  const target = event.currentTarget;
  const rect = target.getBoundingClientRect();
  target.style.setProperty("--rx", `${event.clientX - rect.left}px`);
  target.style.setProperty("--ry", `${event.clientY - rect.top}px`);
}

// The reveal is light, not tint. Color AND transparency are theme-aware
// tokens (see --intero-reveal-light / -wash / -ring in tokens.css); only
// the geometry lives here.
export const REVEAL_GRADIENT =
  "radial-gradient(560px circle at var(--rx, 50%) var(--ry, 50%), var(--intero-reveal-wash), transparent 85%)";

// Border light: tighter and brighter, clipped to the card's 1px edge ring.
export const REVEAL_RING_GRADIENT =
  "radial-gradient(280px circle at var(--rx, 50%) var(--ry, 50%), var(--intero-reveal-ring), transparent 78%)";

export function confidencePercent(confidence: number): number {
  return Math.round(confidence * 100);
}

export function staleAfterMinutes(
  staleAfterSeconds: number | undefined,
): number {
  return Math.round((staleAfterSeconds ?? 1_800) / 60);
}

export function isStale(
  freshnessAt: string,
  staleAfterSeconds: number | undefined,
  now = Date.now(),
): boolean {
  return now - Date.parse(freshnessAt) > (staleAfterSeconds ?? 1_800) * 1_000;
}
