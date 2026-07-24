import {
  type Claim,
  type ClaimPredicate,
  type Workstream,
  WorkstreamPhase,
  type WorkstreamPhase as WorkstreamPhaseValue,
} from "@intero/domain";

const SOURCE_WEIGHT: Record<Claim["sourceType"], number> = {
  human_correction: 1,
  direct_observation: 0.92,
  human_statement: 0.9,
  project_system: 0.8,
  coding_agent_report: 0.7,
  representative_inference: 0.45,
};

const PHASE_ORDER: WorkstreamPhaseValue[] = [
  "exploring",
  "planning",
  "implementing",
  "validating",
  "reviewing",
  "blocked",
  "paused",
  "completed",
];

function claimScore(claim: Claim): number {
  return SOURCE_WEIGHT[claim.sourceType] * claim.confidence;
}

function isActive(claim: Claim, now: Date): boolean {
  return (
    claim.withdrawnAt === undefined &&
    (claim.validUntil === undefined ||
      new Date(claim.validUntil).getTime() > now.getTime())
  );
}

function selectClaim(
  claims: Claim[],
  predicate: ClaimPredicate,
  now: Date,
): Claim | undefined {
  const candidates = claims.filter(
    (claim) => claim.predicate === predicate && isActive(claim, now),
  );
  return candidates.toSorted((left, right) => {
    const scoreDelta = claimScore(right) - claimScore(left);
    if (scoreDelta !== 0) return scoreDelta;
    return Date.parse(right.observedAt) - Date.parse(left.observedAt);
  })[0];
}

function collectValues(
  claims: Claim[],
  predicate: ClaimPredicate,
  now: Date,
): string[] {
  const values = new Set(
    claims
      .filter((claim) => claim.predicate === predicate && isActive(claim, now))
      .toSorted((left, right) => claimScore(right) - claimScore(left))
      .map((claim) => claim.value),
  );
  return [...values];
}

function resolvedPhase(
  claims: Claim[],
  previous: WorkstreamPhaseValue,
  now: Date,
): WorkstreamPhaseValue {
  const phaseClaim = selectClaim(claims, "phase", now);
  if (phaseClaim && WorkstreamPhase.safeParse(phaseClaim.value).success) {
    return WorkstreamPhase.parse(phaseClaim.value);
  }
  if (collectValues(claims, "blocker", now).length > 0) return "blocked";
  if (selectClaim(claims, "completed", now)?.value === "true")
    return "completed";
  const paused = selectClaim(claims, "paused", now)?.value;
  if (paused === "true") return "paused";
  if (paused === "false" && previous === "paused") return "implementing";
  return previous;
}

function materialContradictions(claims: Claim[], now: Date): Claim[] {
  const grouped = new Map<ClaimPredicate, Claim[]>();
  for (const claim of claims) {
    if (!isActive(claim, now)) continue;
    const group = grouped.get(claim.predicate) ?? [];
    group.push(claim);
    grouped.set(claim.predicate, group);
  }

  return [...grouped.values()].flatMap((group) => {
    const credible = group.filter((claim) => claimScore(claim) >= 0.55);
    if (new Set(credible.map((claim) => claim.value)).size <= 1) return [];
    return credible;
  });
}

export interface ResolveWorkstreamInput {
  workstream: Workstream;
  claims: Claim[];
  now?: Date;
}

export function resolveWorkstream({
  workstream,
  claims,
  now = new Date(),
}: ResolveWorkstreamInput): Workstream {
  const relevantClaims = claims.filter(
    (claim) => claim.workstreamId === workstream.id,
  );
  const evidenceClaimIds = relevantClaims
    .filter((claim) => isActive(claim, now))
    .map((claim) => claim.id);
  const contradictionClaimIds = materialContradictions(relevantClaims, now).map(
    (claim) => claim.id,
  );
  const intent = selectClaim(relevantClaims, "intent", now);
  const ownership = selectClaim(relevantClaims, "ownership", now);
  const confidence =
    evidenceClaimIds.length === 0
      ? workstream.confidence
      : relevantClaims.reduce((sum, claim) => sum + claimScore(claim), 0) /
        relevantClaims.length;

  return {
    ...workstream,
    title: intent?.value ?? workstream.title,
    ownerId:
      ownership?.value && ownership.value.match(/^[0-9a-f-]{36}$/)
        ? (ownership.value as Workstream["ownerId"])
        : workstream.ownerId,
    phase: resolvedPhase(relevantClaims, workstream.phase, now),
    scope: collectValues(relevantClaims, "scope", now),
    blockers: collectValues(relevantClaims, "blocker", now),
    dependencies: collectValues(relevantClaims, "dependency", now),
    decisions: collectValues(relevantClaims, "decision", now),
    freshnessAt:
      relevantClaims
        .map((claim) => claim.observedAt)
        .toSorted()
        .at(-1) ?? workstream.freshnessAt,
    confidence: Math.round(Math.min(1, confidence) * 100) / 100,
    evidenceClaimIds,
    contradictionClaimIds,
    version: workstream.version + 1,
  };
}

export function phaseProgress(phase: WorkstreamPhaseValue): {
  current: number;
  total: number;
} {
  return { current: PHASE_ORDER.indexOf(phase) + 1, total: PHASE_ORDER.length };
}
