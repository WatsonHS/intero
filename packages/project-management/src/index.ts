import type { ProjectId, WorkstreamId } from "@intero/domain";
import { z } from "zod";

export const ProjectTask = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1).max(240),
  status: z.enum(["backlog", "ready", "active", "done", "canceled"]),
  cycleId: z.string().uuid().optional(),
});
export type ProjectTask = z.infer<typeof ProjectTask>;

export interface ProjectManagementPort {
  enabled(projectId: ProjectId): Promise<boolean>;
  relatedTasks(workstreamId: WorkstreamId): Promise<ProjectTask[]>;
  relate(workstreamId: WorkstreamId, taskIds: string[]): Promise<void>;
}

export class DisabledProjectManagement implements ProjectManagementPort {
  async enabled(): Promise<boolean> {
    return false;
  }

  async relatedTasks(): Promise<ProjectTask[]> {
    return [];
  }

  async relate(): Promise<void> {
    return;
  }
}
