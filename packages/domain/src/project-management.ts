import { z } from "zod";

import {
  EpicId,
  FeatureId,
  KanbanCardId,
  PrincipalId,
  ProgramIncrementId,
  ProjectId,
  SpecId,
  SpecRevisionId,
  SprintId,
  ThreadId,
  WorkCommentId,
  WorkItemId,
  WorkstreamId,
} from "./ids.js";

export const Project = z
  .object({
    id: ProjectId,
    name: z.string().min(1).max(200),
    projectManagementEnabled: z.boolean(),
  })
  .strict();
export type Project = z.infer<typeof Project>;

export const KanbanColumn = z.enum([
  "backlog",
  "planned",
  "in_progress",
  "review",
  "done",
]);
export type KanbanColumn = z.infer<typeof KanbanColumn>;

export const KanbanWorkstreamLinks = z
  .array(WorkstreamId)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Workstream links must be unique.",
  });

export const KanbanCard = z
  .object({
    id: KanbanCardId,
    projectId: ProjectId,
    title: z.string().min(1).max(240),
    description: z.string().max(4_000),
    column: KanbanColumn,
    position: z.number().int().nonnegative(),
    ownerId: PrincipalId.optional(),
    estimatePoints: z.number().int().min(0).max(100).optional(),
    relatedWorkstreamIds: KanbanWorkstreamLinks,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type KanbanCard = z.infer<typeof KanbanCard>;

export const WorkActor = z
  .object({
    principalId: PrincipalId,
    kind: z.enum(["human", "agent"]),
    source: z.enum(["web", "direct_cloud_mcp"]),
  })
  .strict();
export type WorkActor = z.infer<typeof WorkActor>;

export const Epic = z
  .object({
    id: EpicId,
    projectId: ProjectId,
    title: z.string().min(1).max(240),
    description: z.string().max(8_000),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type Epic = z.infer<typeof Epic>;

export const FeatureStage = z.enum(["planned", "in_development", "released"]);
export type FeatureStage = z.infer<typeof FeatureStage>;

export const Feature = z
  .object({
    id: FeatureId,
    projectId: ProjectId,
    epicId: EpicId.optional(),
    specId: SpecId.optional(),
    sourceSpecRevisionId: SpecRevisionId.optional(),
    sourceReferences: z.array(z.string().min(1).max(500)).max(50).optional(),
    automationPolicyVersion: z.string().min(1).max(120).optional(),
    title: z.string().min(1).max(240),
    description: z.string().max(8_000),
    stage: FeatureStage,
    ownerId: PrincipalId.optional(),
    piId: ProgramIncrementId.optional(),
    sprintId: SprintId.optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().optional(),
  })
  .strict();
export type Feature = z.infer<typeof Feature>;

export const WorkItemStatus = z.enum([
  "todo",
  "in_progress",
  "ready_for_test",
  "done",
]);
export type WorkItemStatus = z.infer<typeof WorkItemStatus>;

export const WorkPriority = z.enum(["unset", "P0", "P1", "P2", "P3"]);
export type WorkPriority = z.infer<typeof WorkPriority>;

export const WorkRelationKind = z.enum([
  "blocks",
  "blocked_by",
  "related",
  "duplicate",
  "duplicated_by",
]);
export type WorkRelationKind = z.infer<typeof WorkRelationKind>;

export const WorkRelation = z
  .object({
    sourceId: WorkItemId,
    targetId: WorkItemId,
    kind: WorkRelationKind,
    specId: SpecId.optional(),
    sourceSpecRevisionId: SpecRevisionId.optional(),
    sourceReferences: z.array(z.string().min(1).max(500)).max(50).optional(),
    automationPolicyVersion: z.string().min(1).max(120).optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
    createdBy: WorkActor,
    createdAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().optional(),
  })
  .strict();
export type WorkRelation = z.infer<typeof WorkRelation>;

export const CodeReferenceKind = z.enum(["pull_request", "commit", "branch"]);
export type CodeReferenceKind = z.infer<typeof CodeReferenceKind>;

export const WorkCodeReference = z
  .object({
    id: z.string().uuid(),
    workItemId: WorkItemId,
    kind: CodeReferenceKind,
    label: z.string().min(1).max(240),
    url: z.url().optional(),
    repository: z.string().max(240).optional(),
    value: z.string().min(1).max(500),
    reportedBy: WorkActor,
    createdAt: z.iso.datetime(),
  })
  .strict();
export type WorkCodeReference = z.infer<typeof WorkCodeReference>;

export const WorkComment = z
  .object({
    id: WorkCommentId,
    workItemId: WorkItemId,
    parentId: WorkCommentId.optional(),
    body: z.string().min(1).max(16_000),
    specId: SpecId.optional(),
    sourceSpecRevisionId: SpecRevisionId.optional(),
    sourceReferences: z.array(z.string().min(1).max(500)).max(50).optional(),
    automationPolicyVersion: z.string().min(1).max(120).optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
    author: WorkActor,
    createdAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().optional(),
  })
  .strict();
export type WorkComment = z.infer<typeof WorkComment>;

export const WorkHistoryEntry = z
  .object({
    id: z.string().uuid(),
    workItemId: WorkItemId,
    action: z.string().min(1).max(120),
    snapshot: z.record(z.string(), z.unknown()),
    actor: WorkActor,
    occurredAt: z.iso.datetime(),
    idempotencyKey: z.string().min(1).max(200).optional(),
    revertedEntryId: z.string().uuid().optional(),
  })
  .strict();
export type WorkHistoryEntry = z.infer<typeof WorkHistoryEntry>;

export const FeatureHistoryEntry = z
  .object({
    id: z.string().uuid(),
    featureId: FeatureId,
    action: z.string().min(1).max(120),
    snapshot: z.record(z.string(), z.unknown()),
    actor: WorkActor,
    occurredAt: z.iso.datetime(),
    idempotencyKey: z.string().min(1).max(200).optional(),
    revertedEntryId: z.string().uuid().optional(),
  })
  .strict();
export type FeatureHistoryEntry = z.infer<typeof FeatureHistoryEntry>;

export const WorkItem = z
  .object({
    id: WorkItemId,
    projectId: ProjectId,
    featureId: FeatureId.optional(),
    title: z.string().min(1).max(240),
    description: z.string().max(16_000),
    status: WorkItemStatus,
    ownerId: PrincipalId.optional(),
    specId: SpecId.optional(),
    sourceSpecRevisionId: SpecRevisionId.optional(),
    sourceReferences: z.array(z.string().min(1).max(500)).max(50).optional(),
    automationPolicyVersion: z.string().min(1).max(120).optional(),
    priority: WorkPriority,
    points: z.number().finite().nonnegative().optional(),
    piId: ProgramIncrementId.optional(),
    sprintId: SprintId.optional(),
    sourceSprintId: SprintId.optional(),
    carryover: z.boolean(),
    completionEvidence: z.string().max(4_000).optional(),
    completedBy: WorkActor.optional(),
    completedAt: z.iso.datetime().optional(),
    coordinationThreadIds: z.array(ThreadId),
    createdBy: WorkActor,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().optional(),
  })
  .strict();
export type WorkItem = z.infer<typeof WorkItem>;

export const PlanningStatus = z.enum(["planned", "active", "ended"]);
export type PlanningStatus = z.infer<typeof PlanningStatus>;

export const ProgramIncrement = z
  .object({
    id: ProgramIncrementId,
    projectId: ProjectId,
    number: z.number().int().positive(),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    timezone: z.string().min(1).max(80),
    closedAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type ProgramIncrement = z.infer<typeof ProgramIncrement>;

export const Sprint = z
  .object({
    id: SprintId,
    projectId: ProjectId,
    piId: ProgramIncrementId,
    number: z.number().int().positive(),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    closedAt: z.iso.datetime().optional(),
  })
  .strict();
export type Sprint = z.infer<typeof Sprint>;

export function planningStatus(
  startDate: string,
  endDate: string,
  timezone: string,
  at = new Date(),
  closedAt?: string,
): PlanningStatus {
  if (closedAt) return "ended";
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  if (day < startDate) return "planned";
  return day > endDate ? "ended" : "active";
}
