import { describe, expect, it } from "vitest";

import { orderByAttention } from "../design/utils.js";
import {
  DETAIL_WINDOW_MS,
  PULSE_PROJECT_LIMIT,
  classifyWorkVisibility,
  groupPulseWorkByProject,
  isInDetailWindow,
  isInPulseDay,
  selectPulseProjectWork,
} from "./work-visibility.js";

describe("work visibility", () => {
  const now = new Date(2026, 6, 28, 10, 0, 0);

  it("keeps work in person detail for a rolling 72 hours", () => {
    const recent = new Date(now.getTime() - DETAIL_WINDOW_MS + 1).toISOString();
    expect(classifyWorkVisibility(recent, now)).toBe("recent");
    expect(isInDetailWindow(recent, now)).toBe(true);
  });

  it("shows only the current local calendar day on Team Pulse", () => {
    expect(
      isInPulseDay(new Date(2026, 6, 28, 0, 0, 0).toISOString(), now),
    ).toBe(true);
    expect(
      isInPulseDay(new Date(2026, 6, 27, 23, 59, 59).toISOString(), now),
    ).toBe(false);
  });

  it("derives archive membership after 72 hours", () => {
    const archived = new Date(
      now.getTime() - DETAIL_WINDOW_MS - 1,
    ).toISOString();
    expect(classifyWorkVisibility(archived, now)).toBe("archived");
    expect(isInDetailWindow(archived, now)).toBe(false);
  });

  it("resurfaces an archived item when its semantic freshness advances", () => {
    const old = new Date(now.getTime() - DETAIL_WINDOW_MS - 1).toISOString();
    const updated = new Date(now.getTime() - 1_000).toISOString();
    expect(classifyWorkVisibility(old, now)).toBe("archived");
    expect(classifyWorkVisibility(updated, now)).toBe("recent");
  });

  it("shows every item from the three freshest projects before expanding", () => {
    expect(PULSE_PROJECT_LIMIT).toBe(3);
    const workstreams = [
      {
        id: "project-a-older",
        projectId: "project-a",
        freshnessAt: new Date(now.getTime() - 4_000).toISOString(),
      },
      {
        id: "project-a-newer",
        projectId: "project-a",
        freshnessAt: new Date(now.getTime() - 1_000).toISOString(),
      },
      {
        id: "project-b",
        projectId: "project-b",
        freshnessAt: new Date(now.getTime() - 2_000).toISOString(),
      },
      {
        id: "project-c",
        projectId: "project-c",
        freshnessAt: new Date(now.getTime() - 3_000).toISOString(),
      },
      {
        id: "project-d",
        projectId: "project-d",
        freshnessAt: new Date(now.getTime() - 5_000).toISOString(),
      },
    ];

    expect(
      groupPulseWorkByProject(workstreams).map((group) => group.projectId),
    ).toEqual(["project-a", "project-b", "project-c", "project-d"]);
    expect(selectPulseProjectWork(workstreams, false)).toMatchObject({
      visible: [
        { id: "project-a-older" },
        { id: "project-a-newer" },
        { id: "project-b" },
        { id: "project-c" },
      ],
      hiddenProjectCount: 1,
    });
    expect(selectPulseProjectWork(workstreams, true).visible).toHaveLength(5);
  });

  it("puts attention first and uses freshness to break phase ties", () => {
    const ordered = orderByAttention([
      {
        id: "implementing-new",
        phase: "implementing" as const,
        freshnessAt: new Date(now.getTime() - 1_000).toISOString(),
      },
      {
        id: "blocked-old",
        phase: "blocked" as const,
        freshnessAt: new Date(now.getTime() - 20_000).toISOString(),
      },
      {
        id: "reviewing-old",
        phase: "reviewing" as const,
        freshnessAt: new Date(now.getTime() - 30_000).toISOString(),
      },
      {
        id: "reviewing-new",
        phase: "reviewing" as const,
        freshnessAt: new Date(now.getTime() - 10_000).toISOString(),
      },
    ]);

    expect(ordered.map((item) => item.id)).toEqual([
      "blocked-old",
      "reviewing-new",
      "reviewing-old",
      "implementing-new",
    ]);
  });
});
