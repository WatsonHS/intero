import { describe, expect, it } from "vitest";

import {
  groupByOwner,
  resolvePersonPulseEmptyState,
  scopeTeamProjections,
} from "./TeamPulseView.js";

describe("Team Pulse roster and visibility", () => {
  it("keeps every current Team member even when they have no work", () => {
    const people = groupByOwner(
      [
        { ownerId: "member-a", title: "Visible work" },
        { ownerId: "project-collaborator", title: "Shared Project work" },
      ],
      ["member-a", "member-b"],
    );

    expect(people).toEqual([
      {
        ownerId: "member-a",
        workstreams: [{ ownerId: "member-a", title: "Visible work" }],
      },
      { ownerId: "member-b", workstreams: [] },
      {
        ownerId: "project-collaborator",
        workstreams: [
          {
            ownerId: "project-collaborator",
            title: "Shared Project work",
          },
        ],
      },
    ]);
  });

  it("shows only work from Projects reachable through the selected Team", () => {
    const work = [
      { projectId: "team-a-project", title: "Visible" },
      { projectId: "team-b-project", title: "Hidden" },
      { title: "Private and unbound" },
    ];

    expect(scopeTeamProjections(work, new Set(["team-a-project"]))).toEqual([
      { projectId: "team-a-project", title: "Visible" },
    ]);
    expect(scopeTeamProjections(work, undefined)).toEqual(work);
  });

  it("describes why an otherwise empty member card has no work", () => {
    expect(
      resolvePersonPulseEmptyState({
        todayCount: 1,
        recentCount: 1,
        connected: true,
      }),
    ).toBeUndefined();
    expect(
      resolvePersonPulseEmptyState({
        todayCount: 0,
        recentCount: 1,
        connected: true,
      }),
    ).toBe("noUpdatesToday");
    expect(
      resolvePersonPulseEmptyState({
        todayCount: 0,
        recentCount: 0,
        connected: true,
      }),
    ).toBe("noSharedProgress");
    expect(
      resolvePersonPulseEmptyState({
        todayCount: 0,
        recentCount: 0,
        connected: false,
      }),
    ).toBe("noActivity");
  });
});
