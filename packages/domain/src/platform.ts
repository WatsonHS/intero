import { z } from "zod";

import { OperationId, OrganizationId, PrincipalId, ProjectId } from "./ids.js";

export const PreferredLanguage = z.enum(["zh-CN", "en-US"]);
export type PreferredLanguage = z.infer<typeof PreferredLanguage>;

export const ActivityEvent = z
  .object({
    sequence: z.number().int().positive(),
    organizationId: OrganizationId,
    operationId: OperationId,
    actorId: PrincipalId,
    aggregateType: z.string().min(1).max(80),
    aggregateId: z.string().uuid(),
    eventType: z.string().min(1).max(120),
    metadata: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ),
    occurredAt: z.iso.datetime(),
  })
  .strict();
export type ActivityEvent = z.infer<typeof ActivityEvent>;

export const OutboxEntry = z
  .object({
    operationId: OperationId,
    topic: z.string().min(1).max(120),
    payload: z.record(z.string(), z.unknown()),
    attempts: z.number().int().nonnegative(),
    availableAt: z.iso.datetime(),
    completedAt: z.iso.datetime().optional(),
  })
  .strict();
export type OutboxEntry = z.infer<typeof OutboxEntry>;

export const DomainEventVisibility = z.enum([
  "private",
  "project",
  "organization",
]);
export type DomainEventVisibility = z.infer<typeof DomainEventVisibility>;

/**
 * Adapter-neutral event carried by the server outbox.
 *
 * Only identifiers and allowlisted scalar metadata belong here. User content,
 * prompts, files, diffs, logs, tool payloads, provider secrets, and private
 * Claims are intentionally not representable in this envelope.
 */
export const DomainEventEnvelope = z
  .object({
    schemaVersion: z.literal(1),
    operationId: OperationId,
    organizationId: OrganizationId,
    actorId: PrincipalId,
    aggregateType: z.string().min(1).max(80),
    aggregateId: z.uuid(),
    eventType: z.string().min(1).max(120),
    visibility: DomainEventVisibility,
    projectId: z.uuid().optional(),
    sequence: z.number().int().positive(),
    occurredAt: z.iso.datetime(),
    metadata: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ),
  })
  .strict();
export type DomainEventEnvelope = z.infer<typeof DomainEventEnvelope>;

export const ActionInboxItem = z
  .object({
    id: z.string().uuid(),
    principalId: PrincipalId,
    projectId: z.string().uuid().optional(),
    kind: z.enum([
      "human_decision",
      "scope_expansion",
      "consequential_commitment",
      "high_impact_contradiction",
      "review_request",
      "imminent_blocker",
    ]),
    title: z.string().min(1).max(240),
    detail: z.string().max(2_000),
    sourceRef: z.string().max(300),
    createdAt: z.iso.datetime(),
    readAt: z.iso.datetime().optional(),
    dismissedAt: z.iso.datetime().optional(),
    resolvedAt: z.iso.datetime().optional(),
  })
  .strict();
export type ActionInboxItem = z.infer<typeof ActionInboxItem>;

export const MessageNotificationMode = z.enum(["all", "mentions", "none"]);
export type MessageNotificationMode = z.infer<typeof MessageNotificationMode>;

export const NotificationPreferences = z
  .object({
    principalId: PrincipalId,
    mutedKinds: z.array(ActionInboxItem.shape.kind),
    muteUntil: z.iso.datetime().optional(),
    messages: MessageNotificationMode.default("mentions"),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;

export const ProjectAutomationSignalKind = z.enum([
  "blocker",
  "dependency_change",
  "spec_review_stale",
  "coordination_unresolved",
  "project_work_risk",
  "work_state_conflict",
]);
export type ProjectAutomationSignalKind = z.infer<
  typeof ProjectAutomationSignalKind
>;

export const ProjectAutomationPolicy = z
  .object({
    projectId: ProjectId,
    enabled: z.boolean(),
    enabledSignals: z.array(ProjectAutomationSignalKind),
    staleSpecReviewHours: z.number().int().min(1).max(720),
    unresolvedCoordinationHours: z.number().int().min(1).max(720),
    quietUntil: z.iso.datetime().optional(),
    updatedBy: PrincipalId.optional(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ProjectAutomationPolicy = z.infer<typeof ProjectAutomationPolicy>;

export const ProjectAutomationSignal = z
  .object({
    id: z.uuid(),
    projectId: ProjectId,
    kind: ProjectAutomationSignalKind,
    status: z.enum([
      "pending",
      "processing",
      "opened",
      "confirmed",
      "reverted",
      "dismissed",
      "failed",
    ]),
    sourceRef: z.string().min(1).max(400),
    safeContext: z.string().min(1).max(2_000),
    candidateNextSteps: z.array(z.string().min(1).max(500)).max(3),
    participantIds: z.array(PrincipalId).max(50),
    coordinationThreadId: z.uuid().optional(),
    detectedAt: z.iso.datetime(),
    processedAt: z.iso.datetime().optional(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ProjectAutomationSignal = z.infer<typeof ProjectAutomationSignal>;

export const ProjectAutomationAudit = z
  .object({
    id: z.uuid(),
    projectId: ProjectId,
    signalId: z.uuid(),
    action: z.enum([
      "detected",
      "coordination_opened",
      "confirmed",
      "reverted",
      "dismissed",
      "quieted",
    ]),
    actorId: PrincipalId.optional(),
    detail: z.string().max(1_000),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type ProjectAutomationAudit = z.infer<typeof ProjectAutomationAudit>;
