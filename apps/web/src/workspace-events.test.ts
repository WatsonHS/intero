import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  invalidateWorkspaceEvent,
  repairWorkspaceAfterReconnect,
} from "./workspace-events.js";

describe("workspace event invalidation", () => {
  it("invalidates only the affected Project work and Spec keys", async () => {
    const queryClient = new QueryClient();
    const projectA = "019fa900-0000-7000-8000-000000000001";
    const projectB = "019fa900-0000-7000-8000-000000000002";
    queryClient.setQueryData(["project-work", projectA], {});
    queryClient.setQueryData(["project-work", projectB], {});
    queryClient.setQueryData(["project-specs", projectA], {});

    await invalidateWorkspaceEvent(queryClient, {
      reason: "workspace_change",
      eventType: "project.work_item.updated",
      aggregateType: "work_item",
      aggregateId: "019fa900-0000-7000-8000-000000000003",
      projectId: projectA,
      occurredAt: "2026-07-29T00:00:00.000Z",
    });

    expect(
      queryClient.getQueryState(["project-work", projectA])?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["project-work", projectB])?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(["project-specs", projectA])?.isInvalidated,
    ).toBe(false);
  });

  it("performs one bounded truth repair after reconnect", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await repairWorkspaceAfterReconnect(queryClient);
    expect(invalidate).toHaveBeenCalledTimes(6);
  });
});
