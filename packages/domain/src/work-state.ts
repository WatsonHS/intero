import { z } from "zod";

import {
  ArtifactId,
  ClaimId,
  PrincipalId,
  ProjectId,
  WorkspaceId,
  WorkstreamId,
} from "./ids.js";
import { PrivacyLevel } from "./events.js";

export const ClaimSourceType = z.enum([
  "human_statement",
  "human_correction",
  "direct_observation",
  "coding_agent_report",
  "project_system",
  "representative_inference",
]);
export type ClaimSourceType = z.infer<typeof ClaimSourceType>;

export const ClaimPredicate = z.enum([
  "intent",
  "phase",
  "scope",
  "ownership",
  "blocker",
  "dependency",
  "decision",
  "artifact",
  "validation",
  "paused",
  "completed",
]);
export type ClaimPredicate = z.infer<typeof ClaimPredicate>;

export const Claim = z
  .object({
    id: ClaimId,
    workstreamId: WorkstreamId,
    predicate: ClaimPredicate,
    value: z.string().max(2_000),
    sourceType: ClaimSourceType,
    sourceRef: z.string().max(300),
    observedAt: z.iso.datetime(),
    validUntil: z.iso.datetime().optional(),
    confidence: z.number().min(0).max(1),
    privacy: PrivacyLevel,
    evidenceRefs: z.array(z.string().max(300)).max(20).default([]),
    supersedes: ClaimId.optional(),
    withdrawnAt: z.iso.datetime().optional(),
  })
  .strict();
export type Claim = z.infer<typeof Claim>;

export const WorkstreamPhase = z.enum([
  "exploring",
  "planning",
  "implementing",
  "validating",
  "reviewing",
  "blocked",
  "paused",
  "completed",
]);
export type WorkstreamPhase = z.infer<typeof WorkstreamPhase>;

export const Workstream = z
  .object({
    id: WorkstreamId,
    workspaceId: WorkspaceId,
    projectId: ProjectId.optional(),
    ownerId: PrincipalId,
    title: z.string().min(1).max(160),
    phase: WorkstreamPhase,
    scope: z.array(z.string().max(300)).max(50),
    blockers: z.array(z.string().max(600)).max(20),
    dependencies: z.array(z.string().max(600)).max(20),
    decisions: z.array(z.string().max(1_000)).max(50),
    artifactIds: z.array(ArtifactId).max(100),
    freshnessAt: z.iso.datetime(),
    confidence: z.number().min(0).max(1),
    evidenceClaimIds: z.array(ClaimId),
    contradictionClaimIds: z.array(ClaimId),
    version: z.number().int().nonnegative(),
  })
  .strict();
export type Workstream = z.infer<typeof Workstream>;

export const PublicWorkProjection = Workstream.pick({
  id: true,
  projectId: true,
  ownerId: true,
  title: true,
  phase: true,
  blockers: true,
  dependencies: true,
  decisions: true,
  artifactIds: true,
  freshnessAt: true,
  confidence: true,
  contradictionClaimIds: true,
  version: true,
}).extend({
  changedFields: z.array(
    z.enum([
      "intent",
      "phase",
      "blockers",
      "dependencies",
      "ownership",
      "decisions",
      "artifacts",
      "paused",
      "completed",
    ]),
  ),
  projectedAt: z.iso.datetime(),
});
export type PublicWorkProjection = z.infer<typeof PublicWorkProjection>;
