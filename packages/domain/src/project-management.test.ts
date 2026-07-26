import { describe, expect, it } from "vitest";

import {
  planningStatus,
  WorkItem,
  WorkItemStatus,
} from "./project-management.js";

const actor = {
  principalId: "019b5ac0-7600-7000-8000-000000000001",
  kind: "agent" as const,
  source: "direct_cloud_mcp" as const,
};

describe("Phase 5 project work contract", () => {
  it("keeps Backlog as scheduling state rather than a fifth workflow status", () => {
    expect(WorkItemStatus.options).toEqual([
      "todo",
      "in_progress",
      "ready_for_test",
      "done",
    ]);
    expect(() => WorkItemStatus.parse("backlog")).toThrow();
  });

  it("represents an unscheduled Backlog item with the same fixed flow", () => {
    expect(
      WorkItem.parse({
        id: "019b5ac0-7600-7000-8000-000000000002",
        projectId: "019b5ac0-7600-7000-8000-000000000003",
        title: "Validate invoice exports",
        description: "Verify the signed CSV contract.",
        status: "todo",
        priority: "P1",
        carryover: false,
        coordinationThreadIds: [],
        createdBy: actor,
        createdAt: "2026-07-26T00:00:00.000Z",
        updatedAt: "2026-07-26T00:00:00.000Z",
      }),
    ).not.toHaveProperty("sprintId");
  });

  it("derives PI and Sprint status in the Project timezone with early close", () => {
    expect(
      planningStatus(
        "2026-07-27",
        "2026-08-09",
        "Asia/Shanghai",
        new Date("2026-07-26T15:59:59.000Z"),
      ),
    ).toBe("planned");
    expect(
      planningStatus(
        "2026-07-27",
        "2026-08-09",
        "Asia/Shanghai",
        new Date("2026-07-26T16:00:00.000Z"),
      ),
    ).toBe("active");
    expect(
      planningStatus(
        "2026-07-27",
        "2026-08-09",
        "Asia/Shanghai",
        new Date("2026-07-28T00:00:00.000Z"),
        "2026-07-27T12:00:00.000Z",
      ),
    ).toBe("ended");
  });
});
