import { z } from "zod";

import { OperationId, OrganizationId, PrincipalId } from "./ids.js";

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
    resolvedAt: z.iso.datetime().optional(),
  })
  .strict();
export type ActionInboxItem = z.infer<typeof ActionInboxItem>;
