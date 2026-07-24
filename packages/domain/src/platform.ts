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
