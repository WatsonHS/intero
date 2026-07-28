import { describe, expect, it } from "vitest";

import { orderByAttention } from "../design/utils.js";
import {
  DETAIL_WINDOW_MS,
  PULSE_MAX_ITEMS,
  PULSE_PAGE_SIZE,
  classifyWorkVisibility,
  isInDetailWindow,
  isInPulseDay,
  pulseDetailOnlyCount,
  selectPulseWork,
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

  it("limits Pulse to two three-item pages before Detail", () => {
    expect(PULSE_PAGE_SIZE).toBe(3);
    expect(PULSE_MAX_ITEMS).toBe(6);
    expect(pulseDetailOnlyCount(8)).toBe(2);

    const sameProjectWork = Array.from({ length: 8 }, (_, index) => ({
      id: `work-${index + 1}`,
      projectId: "project-a",
    }));

    expect(selectPulseWork(sameProjectWork, false)).toMatchObject({
      visible: sameProjectWork.slice(0, 3),
      nextCount: 3,
      detailOnlyCount: 2,
    });
    expect(selectPulseWork(sameProjectWork, true)).toMatchObject({
      visible: sameProjectWork.slice(0, 6),
      nextCount: 3,
      detailOnlyCount: 2,
    });
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
