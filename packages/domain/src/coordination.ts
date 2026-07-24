import { z } from "zod";

import {
  CapabilityGrantId,
  ClaimId,
  OperationId,
  OrganizationId,
  PrincipalId,
  ProjectId,
  ThreadId,
  WorkstreamId,
} from "./ids.js";

export const CoordinationActionType = z.enum([
  "status_query",
  "status_response",
  "ownership_declaration",
  "dependency_request",
  "conflict_notice",
  "coordination_request",
  "correction",
  "withdrawal",
  "human_escalation",
]);
export type CoordinationActionType = z.infer<typeof CoordinationActionType>;

export const CapabilityAction = z.enum([
  "read_public_state",
  "answer_status",
  "declare_ownership",
  "register_blocker",
  "register_dependency",
  "request_coordination",
  "arrange_review",
  "publish_state",
  "expand_scope",
  "promise_deadline",
  "approve_architecture",
  "irreversible_action",
]);
export type CapabilityAction = z.infer<typeof CapabilityAction>;

export const CapabilityGrant = z
  .object({
    id: CapabilityGrantId,
    principalId: PrincipalId,
    actions: z.array(CapabilityAction).min(1),
    organizationId: OrganizationId,
    projectIds: z.array(ProjectId),
    workstreamIds: z.array(WorkstreamId),
    resourceScopes: z.array(z.string().max(300)),
    requiresConfirmation: z.array(CapabilityAction),
    expiresAt: z.iso.datetime(),
    policyVersion: z.string().min(1).max(80),
    revokedAt: z.iso.datetime().optional(),
  })
  .strict();
export type CapabilityGrant = z.infer<typeof CapabilityGrant>;

export const ActionEnvelope = z
  .object({
    schemaVersion: z.literal(1),
    operationId: OperationId,
    action: CoordinationActionType,
    actorId: PrincipalId,
    authorityGrantId: CapabilityGrantId,
    policyVersion: z.string().min(1).max(80),
    threadId: ThreadId,
    workstreamId: WorkstreamId.optional(),
    humanMessage: z.string().min(1).max(4_000),
    resourceScope: z.array(z.string().max(300)).max(50),
    relatedClaimIds: z.array(ClaimId).max(100),
    evidenceRefs: z.array(z.string().max(300)).max(100),
    requestedActions: z.array(CapabilityAction).max(20),
    createdAt: z.iso.datetime(),
    correctionOf: OperationId.optional(),
    withdrawalOf: OperationId.optional(),
  })
  .strict();
export type ActionEnvelope = z.infer<typeof ActionEnvelope>;

export const CoordinationResult = z
  .object({
    threadId: ThreadId,
    status: z.enum(["resolved", "waiting", "needs_human", "rejected"]),
    summary: z.string().max(2_000),
    freshnessAt: z.iso.datetime(),
    stale: z.boolean(),
    actionOperationIds: z.array(OperationId),
    evidenceRefs: z.array(z.string().max(300)),
    suggestedAgentAction: z.enum(["continue", "narrow", "wait", "ask_human"]),
  })
  .strict();
export type CoordinationResult = z.infer<typeof CoordinationResult>;
