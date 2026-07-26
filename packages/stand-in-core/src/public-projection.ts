import type { PublicWorkProjection, Workstream } from "@intero/domain";

const PUBLIC_FIELDS = [
  "intent",
  "phase",
  "blockers",
  "dependencies",
  "ownership",
  "decisions",
  "artifacts",
  "paused",
  "completed",
] as const;

type PublicField = (typeof PUBLIC_FIELDS)[number];

function changed(previous: unknown, next: unknown): boolean {
  return JSON.stringify(previous) !== JSON.stringify(next);
}

export function buildPublicProjection(
  previous: Workstream | undefined,
  next: Workstream,
  now = new Date(),
): PublicWorkProjection | undefined {
  const changedFields: PublicField[] = [];

  if (!previous || previous.title !== next.title) changedFields.push("intent");
  if (!previous || previous.phase !== next.phase) {
    changedFields.push("phase");
    if (next.phase === "paused") changedFields.push("paused");
    if (next.phase === "completed") changedFields.push("completed");
  }
  if (!previous || changed(previous.blockers, next.blockers))
    changedFields.push("blockers");
  if (!previous || changed(previous.dependencies, next.dependencies))
    changedFields.push("dependencies");
  if (!previous || previous.ownerId !== next.ownerId)
    changedFields.push("ownership");
  if (!previous || changed(previous.decisions, next.decisions))
    changedFields.push("decisions");
  if (!previous || changed(previous.artifactIds, next.artifactIds))
    changedFields.push("artifacts");

  const uniqueChangedFields = [...new Set(changedFields)];
  if (previous && uniqueChangedFields.length === 0) return undefined;

  return {
    id: next.id,
    projectId: next.projectId,
    ownerId: next.ownerId,
    title: next.title,
    phase: next.phase,
    blockers: next.blockers,
    dependencies: next.dependencies,
    decisions: next.decisions,
    artifactIds: next.artifactIds,
    freshnessAt: next.freshnessAt,
    confidence: next.confidence,
    contradictionClaimIds: next.contradictionClaimIds,
    version: next.version,
    changedFields: uniqueChangedFields,
    projectedAt: now.toISOString(),
  };
}
