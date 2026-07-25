import { z } from "zod";

import { KanbanCardId, PrincipalId, ProjectId, WorkstreamId } from "./ids.js";

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
