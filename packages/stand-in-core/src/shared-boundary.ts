import type {
  PilotBoundaryMatch,
  PilotSharedBoundaryClaim,
} from "@intero/domain";

export const SHARED_BOUNDARY_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;
export const SHARED_BOUNDARY_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export function normalizeSharedBoundaryKey(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function normalizeSharedBoundaryStatement(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function activeSharedBoundaryClaims(
  claims: readonly PilotSharedBoundaryClaim[],
  now: string,
  staleAfterMs = SHARED_BOUNDARY_STALE_AFTER_MS,
): PilotSharedBoundaryClaim[] {
  const nowMs = Date.parse(now);
  return claims.filter((claim) => {
    if (claim.supersededAt || claim.withdrawnAt) return false;
    const observedAt = Date.parse(claim.observedAt);
    const ageMs = nowMs - observedAt;
    return (
      Number.isFinite(observedAt) &&
      Number.isFinite(nowMs) &&
      ageMs >= -SHARED_BOUNDARY_MAX_FUTURE_SKEW_MS &&
      ageMs <= staleAfterMs
    );
  });
}

export function matchSharedBoundaryClaims(
  left: PilotSharedBoundaryClaim,
  right: PilotSharedBoundaryClaim,
): PilotBoundaryMatch | undefined {
  if (
    left.projectId !== right.projectId ||
    normalizeSharedBoundaryKey(left.key) !==
      normalizeSharedBoundaryKey(right.key) ||
    left.ownerId === right.ownerId
  ) {
    return undefined;
  }
  return matchEligibleSharedBoundaryClaims(left, right);
}

/**
 * Cross-Project matching is a separate entry point: callers must provide the
 * complete, already-authorized Project set. The legacy matcher above remains
 * strictly single-Project.
 */
export function matchAuthorizedSharedBoundaryClaims(
  left: PilotSharedBoundaryClaim,
  right: PilotSharedBoundaryClaim,
  allowedProjectIds: readonly string[],
): PilotBoundaryMatch | undefined {
  const allowed = new Set(allowedProjectIds);
  if (
    !allowed.has(left.projectId) ||
    !allowed.has(right.projectId) ||
    normalizeSharedBoundaryKey(left.key) !==
      normalizeSharedBoundaryKey(right.key) ||
    left.ownerId === right.ownerId
  ) {
    return undefined;
  }

  return matchEligibleSharedBoundaryClaims(left, right);
}

function matchEligibleSharedBoundaryClaims(
  left: PilotSharedBoundaryClaim,
  right: PilotSharedBoundaryClaim,
): PilotBoundaryMatch {
  const producer =
    left.relation === "changing"
      ? left
      : right.relation === "changing"
        ? right
        : undefined;
  const consumer =
    left.relation !== "changing"
      ? left
      : right.relation !== "changing"
        ? right
        : undefined;
  if (!producer || !consumer) {
    return buildMatch(left, right, "insufficient_evidence", {
      producer: left,
      consumer: right,
      reason:
        "The shared boundary does not include one producer change and one consumer assumption.",
    });
  }

  const assumption = normalizeSharedBoundaryStatement(consumer.assumption);
  const preserved = producer.preserves.some(
    (item) => normalizeSharedBoundaryStatement(item) === assumption,
  );

  if (
    (producer.change === "compatible" || producer.change === "additive") &&
    preserved
  ) {
    return buildMatch(left, right, "compatible", {
      producer,
      consumer,
      reason: `The ${producer.change} change explicitly preserves "${consumer.assumption}".`,
    });
  }
  if (producer.change === "breaking" && !preserved) {
    return buildMatch(left, right, "potential_conflict", {
      producer,
      consumer,
      reason: `The breaking change does not preserve "${consumer.assumption}".`,
    });
  }
  return buildMatch(left, right, "insufficient_evidence", {
    producer,
    consumer,
    reason:
      producer.change === "unknown"
        ? "The producer marked the boundary change as unknown."
        : `The ${producer.change} change does not explicitly confirm whether "${consumer.assumption}" is preserved.`,
  });
}

export function evaluateSharedBoundaryClaims(
  claims: readonly PilotSharedBoundaryClaim[],
  now: string,
  staleAfterMs = SHARED_BOUNDARY_STALE_AFTER_MS,
): PilotBoundaryMatch[] {
  const active = activeSharedBoundaryClaims(claims, now, staleAfterMs);
  const matches: PilotBoundaryMatch[] = [];
  for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < active.length;
      rightIndex += 1
    ) {
      const match = matchSharedBoundaryClaims(
        active[leftIndex]!,
        active[rightIndex]!,
      );
      if (match) matches.push(match);
    }
  }
  return matches;
}

export function evaluateAuthorizedSharedBoundaryClaims(
  claims: readonly PilotSharedBoundaryClaim[],
  allowedProjectIds: readonly string[],
  now: string,
  staleAfterMs = SHARED_BOUNDARY_STALE_AFTER_MS,
): PilotBoundaryMatch[] {
  const active = activeSharedBoundaryClaims(claims, now, staleAfterMs);
  const matches: PilotBoundaryMatch[] = [];
  for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < active.length;
      rightIndex += 1
    ) {
      const match = matchAuthorizedSharedBoundaryClaims(
        active[leftIndex]!,
        active[rightIndex]!,
        allowedProjectIds,
      );
      if (match) matches.push(match);
    }
  }
  return matches;
}

function buildMatch(
  left: PilotSharedBoundaryClaim,
  right: PilotSharedBoundaryClaim,
  classification: PilotBoundaryMatch["classification"],
  input: {
    producer: PilotSharedBoundaryClaim;
    consumer: PilotSharedBoundaryClaim;
    reason: string;
  },
): PilotBoundaryMatch {
  return {
    boundaryKey: normalizeSharedBoundaryKey(left.key),
    classification,
    producerClaimId: input.producer.id,
    consumerClaimId: input.consumer.id,
    sourceWorkStateIds: [
      input.producer.workStateId,
      input.consumer.workStateId,
    ],
    reason: input.reason,
  };
}
