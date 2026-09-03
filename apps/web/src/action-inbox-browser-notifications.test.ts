import type {
  ActionInboxItem,
  NotificationPreferences,
  PrincipalId,
} from "@intero/domain";
import { describe, expect, it } from "vitest";

import { selectNewBrowserNotifiableItems } from "./action-inbox-browser-notifications.js";

const principalId = "019f9a00-0000-7000-8000-000000000101" as PrincipalId;

function item(
  id: string,
  kind: ActionInboxItem["kind"] = "review_request",
): ActionInboxItem {
  return {
    id,
    principalId,
    kind,
    title: `Action ${id}`,
    detail: "Needs attention",
    sourceRef: `spec:${id}`,
    createdAt: "2026-07-29T01:00:01.000Z",
  };
}

function preferences(
  mutedKinds: ActionInboxItem["kind"][] = [],
): NotificationPreferences {
  return {
    principalId,
    mutedKinds,
    messages: "mentions",
    updatedAt: "2026-07-29T01:00:00.000Z",
  };
}

describe("Action Inbox browser notifications", () => {
  it("selects only newly arrived, actionable, unmuted items", () => {
    const existing = item("019fa900-0000-7000-8000-000000000001");
    const fresh = item("019fa900-0000-7000-8000-000000000002");
    const muted = item(
      "019fa900-0000-7000-8000-000000000003",
      "imminent_blocker",
    );
    const resolved = {
      ...item("019fa900-0000-7000-8000-000000000004"),
      resolvedAt: "2026-07-29T01:00:02.000Z",
    };

    expect(
      selectNewBrowserNotifiableItems({
        previous: {
          items: [existing],
          preferences: preferences(),
        },
        current: {
          items: [existing, fresh, muted, resolved],
          preferences: preferences(["imminent_blocker"]),
        },
        occurredAt: "2026-07-29T01:00:00.000Z",
        now: new Date("2026-07-29T01:00:03.000Z"),
      }),
    ).toEqual([fresh]);
  });

  it("does not notify on initial history load or during a global mute", () => {
    const fresh = item("019fa900-0000-7000-8000-000000000005");
    const current = {
      items: [fresh],
      preferences: {
        ...preferences(),
        muteUntil: "2026-07-29T02:00:00.000Z",
      },
    };

    expect(
      selectNewBrowserNotifiableItems({
        previous: undefined,
        current,
        occurredAt: "2026-07-29T01:00:00.000Z",
      }),
    ).toEqual([]);
    expect(
      selectNewBrowserNotifiableItems({
        previous: { items: [], preferences: preferences() },
        current,
        occurredAt: "2026-07-29T01:00:00.000Z",
        now: new Date("2026-07-29T01:30:00.000Z"),
      }),
    ).toEqual([]);
  });
});
