import { describe, expect, it } from "vitest";

import type { PrincipalId } from "./ids.js";
import {
  classifyMessageNotification,
  defaultNotificationPreferences,
  shapeMessageNotificationPayload,
  shouldDeliverMessageNotification,
} from "./notifications.js";
import { NotificationPreferences } from "./platform.js";

const principalId = "019f9a00-0000-7000-8000-000000000101" as PrincipalId;

describe("message notification preference resolution", () => {
  const now = new Date("2026-09-03T12:00:00.000Z");

  it.each([
    {
      mode: "all" as const,
      mentioned: false,
      expected: true,
    },
    {
      mode: "all" as const,
      mentioned: true,
      expected: true,
    },
    {
      mode: "mentions" as const,
      mentioned: false,
      expected: false,
    },
    {
      mode: "mentions" as const,
      mentioned: true,
      expected: true,
    },
    {
      mode: "none" as const,
      mentioned: true,
      expected: false,
    },
  ])(
    "mode=$mode mentioned=$mentioned → $expected",
    ({ mode, mentioned, expected }) => {
      expect(
        shouldDeliverMessageNotification({
          mode,
          mentioned,
          isSelf: false,
          now,
        }),
      ).toBe(expected);
    },
  );

  it("never notifies the sender", () => {
    expect(
      shouldDeliverMessageNotification({
        mode: "all",
        mentioned: true,
        isSelf: true,
        now,
      }),
    ).toBe(false);
  });

  it("honors a global muteUntil that is still in the future", () => {
    expect(
      shouldDeliverMessageNotification({
        mode: "all",
        mentioned: true,
        isSelf: false,
        muteUntil: "2026-09-03T13:00:00.000Z",
        now,
      }),
    ).toBe(false);
    expect(
      shouldDeliverMessageNotification({
        mode: "all",
        mentioned: true,
        isSelf: false,
        muteUntil: "2026-09-03T11:00:00.000Z",
        now,
      }),
    ).toBe(true);
  });

  it("honors per-thread mutedUntil when T1b supplies it, and no-ops when absent", () => {
    expect(
      shouldDeliverMessageNotification({
        mode: "all",
        mentioned: true,
        isSelf: false,
        now,
      }),
    ).toBe(true);
    expect(
      shouldDeliverMessageNotification({
        mode: "all",
        mentioned: true,
        isSelf: false,
        threadMutedUntil: "2026-09-03T13:00:00.000Z",
        now,
      }),
    ).toBe(false);
    expect(
      shouldDeliverMessageNotification({
        mode: "all",
        mentioned: true,
        isSelf: false,
        threadMutedUntil: "2026-09-03T11:00:00.000Z",
        now,
      }),
    ).toBe(true);
  });

  it("defaults missing preferences to mentions", () => {
    const parsed = NotificationPreferences.parse({
      principalId,
      mutedKinds: [],
      updatedAt: "2026-09-03T12:00:00.000Z",
    });
    expect(parsed.messages).toBe("mentions");
    expect(defaultNotificationPreferences(principalId).messages).toBe(
      "mentions",
    );
  });
});

describe("message notification payload shaping", () => {
  it("omits body and uses a content-free title for human_only_e2ee", () => {
    expect(
      shapeMessageNotificationPayload({
        threadTitle: "Secret DM",
        accessMode: "human_only_e2ee",
        mentioned: true,
        body: "plaintext that must not leak",
      }),
    ).toEqual({
      title: "New message in Secret DM",
      threadTitle: "Secret DM",
    });
    expect(
      classifyMessageNotification({
        accessMode: "human_only_e2ee",
        mentioned: true,
        body: "plaintext that must not leak",
      }),
    ).toEqual({ kind: "encrypted", threadTitle: "" });
  });

  it("includes a preview for agent-readable messages", () => {
    expect(
      shapeMessageNotificationPayload({
        threadTitle: "Room",
        accessMode: "agent_readable",
        mentioned: false,
        body: "Ship the cursor repair",
      }),
    ).toMatchObject({
      title: "New message in Room",
      body: "Ship the cursor repair",
    });
    expect(
      shapeMessageNotificationPayload({
        threadTitle: "Room",
        accessMode: "agent_readable",
        mentioned: true,
        body: "Please review",
        locale: "zh-CN",
      }),
    ).toMatchObject({
      title: "有人提到了你",
      body: "Please review",
    });
  });
});
