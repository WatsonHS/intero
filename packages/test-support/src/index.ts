import type { Claim, Workstream } from "@intero/domain";
import { uuidv7 } from "@intero/domain";

const NOW = "2026-07-24T10:00:00.000Z";

export function workstreamFixture(
  overrides: Partial<Workstream> = {},
): Workstream {
  return {
    id: uuidv7() as Workstream["id"],
    workspaceId: uuidv7() as Workstream["workspaceId"],
    ownerId: uuidv7() as Workstream["ownerId"],
    title: "Harden the shared authorization boundary",
    phase: "planning",
    scope: [],
    blockers: [],
    dependencies: [],
    decisions: [],
    artifactIds: [],
    freshnessAt: NOW,
    confidence: 0.7,
    evidenceClaimIds: [],
    contradictionClaimIds: [],
    version: 0,
    ...overrides,
  };
}

export function claimFixture(
  workstream: Workstream,
  overrides: Partial<Claim> = {},
): Claim {
  return {
    id: uuidv7() as Claim["id"],
    workstreamId: workstream.id,
    predicate: "phase",
    value: "implementing",
    sourceType: "coding_agent_report",
    sourceRef: "checkpoint:test",
    observedAt: NOW,
    confidence: 0.8,
    privacy: "P1_REPRESENTATIVE_PRIVATE",
    evidenceRefs: [],
    ...overrides,
  };
}
