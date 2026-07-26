import type { PilotWorkNarrative, PublicWorkProjection } from "@intero/domain";

/**
 * The five things a Representative reports about one workstream, flattened to
 * plain strings so every surface (pulse card, person detail) renders the same
 * facts at a different density. Fields are absent when nothing was reported —
 * views must fall back, never invent.
 */
export interface WorkLine {
  focus?: string;
  done?: string;
  evidence?: string;
  next?: string;
  collaboration?: string;
}

export function workLineFromNarrative(narrative: PilotWorkNarrative): WorkLine {
  const collaboration = narrative.collaboration.needed
    ? [
        narrative.collaboration.request,
        narrative.collaboration.requestedFrom
          ? `负责人：${narrative.collaboration.requestedFrom}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  return {
    ...(narrative.currentFocus ? { focus: narrative.currentFocus } : {}),
    ...(narrative.completedOutcome ? { done: narrative.completedOutcome } : {}),
    ...(narrative.evidence.length > 0
      ? { evidence: narrative.evidence.join("；") }
      : {}),
    ...(narrative.nextStep ? { next: narrative.nextStep } : {}),
    ...(collaboration ? { collaboration } : {}),
  };
}

/**
 * Bare projections carry no narrative — only the bounded lists in the public
 * Work State contract. Map those onto the same slots so the row shape never
 * changes shape between data sources.
 */
export function workLineFromProjection(
  projection: PublicWorkProjection,
): WorkLine {
  return {
    ...(projection.decisions[0] ? { done: projection.decisions[0] } : {}),
    ...(projection.artifactIds.length > 0
      ? { evidence: projection.artifactIds.join("、") }
      : {}),
    ...(projection.blockers[0] ? { next: projection.blockers[0] } : {}),
    ...(projection.dependencies[0]
      ? { collaboration: projection.dependencies[0] }
      : {}),
  };
}

export function mergeWorkLines(
  ...lines: Array<WorkLine | undefined>
): WorkLine {
  return lines.reduce<WorkLine>(
    (merged, line) => ({ ...merged, ...(line ?? {}) }),
    {},
  );
}
