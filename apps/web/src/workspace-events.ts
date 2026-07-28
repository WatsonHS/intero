import type { Query, QueryClient } from "@tanstack/react-query";

export interface WorkspaceChangedEvent {
  reason:
    | "action_inbox"
    | "notification_preferences"
    | "automation_summary"
    | "workspace_change";
  occurredAt: string;
  eventType?: string;
  aggregateType?: string;
  aggregateId?: string;
  projectId?: string;
}

function projectQuery(
  prefix: string,
  projectId: string | undefined,
  projectIndex: number,
) {
  return (query: Query) =>
    query.queryKey[0] === prefix &&
    (!projectId || query.queryKey[projectIndex] === projectId);
}

export async function invalidateWorkspaceEvent(
  queryClient: QueryClient,
  event: WorkspaceChangedEvent,
): Promise<void> {
  if (
    event.reason === "action_inbox" ||
    event.reason === "notification_preferences"
  ) {
    await queryClient.invalidateQueries({ queryKey: ["action-inbox"] });
    return;
  }
  if (event.reason === "automation_summary") {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["action-inbox"] }),
      queryClient.invalidateQueries({
        predicate: projectQuery("project-automation", event.projectId, 1),
      }),
    ]);
    return;
  }

  const type = `${event.aggregateType ?? ""} ${event.eventType ?? ""}`;
  const invalidations: Array<Promise<unknown>> = [];
  if (/thread|message|conversation|coordination/.test(type)) {
    invalidations.push(
      queryClient.invalidateQueries({ queryKey: ["threads"] }),
    );
  }
  if (
    /work_item|feature|epic|sprint|program_increment|project\.work/.test(type)
  ) {
    invalidations.push(
      queryClient.invalidateQueries({
        predicate: projectQuery("project-work", event.projectId, 1),
      }),
    );
  }
  if (/spec|review|confirmation/.test(type)) {
    invalidations.push(
      queryClient.invalidateQueries({
        predicate: projectQuery("project-specs", event.projectId, 1),
      }),
    );
  }
  if (/automation/.test(type)) {
    invalidations.push(
      queryClient.invalidateQueries({
        predicate: projectQuery("project-automation", event.projectId, 1),
      }),
      queryClient.invalidateQueries({ queryKey: ["action-inbox"] }),
    );
  }
  if (/agent|checkpoint|work_state|pulse|coordination/.test(type)) {
    invalidations.push(
      queryClient.invalidateQueries({
        predicate: projectQuery("pilot", event.projectId, 3),
      }),
      queryClient.invalidateQueries({ queryKey: ["team-pulse"] }),
    );
  }
  if (
    /organization|team|membership|invitation|project|provider|profile/.test(
      type,
    )
  ) {
    invalidations.push(
      queryClient.invalidateQueries({ queryKey: ["pilot", "bootstrap"] }),
      queryClient.invalidateQueries({ queryKey: ["pilot", "teams"] }),
      queryClient.invalidateQueries({ queryKey: ["pilot", "projects"] }),
    );
  }
  if (invalidations.length === 0) {
    invalidations.push(
      queryClient.invalidateQueries({ queryKey: ["pilot"] }),
      queryClient.invalidateQueries({ queryKey: ["threads"] }),
    );
  }
  await Promise.all(invalidations);
}

export async function repairWorkspaceAfterReconnect(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["pilot"] }),
    queryClient.invalidateQueries({ queryKey: ["threads"] }),
    queryClient.invalidateQueries({ queryKey: ["project-work"] }),
    queryClient.invalidateQueries({ queryKey: ["project-specs"] }),
    queryClient.invalidateQueries({ queryKey: ["project-automation"] }),
    queryClient.invalidateQueries({ queryKey: ["action-inbox"] }),
  ]);
}
