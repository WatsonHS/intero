import type {
  NotificationPreferences,
  PrincipalId,
  ThreadMessage,
} from "@intero/domain";
import { describe, expect, it } from "vitest";

import {
  selectNewMessageNotifications,
  withInferredMentions,
} from "./message-browser-notifications.js";

const viewer = "019f9a00-0000-7000-8000-000000000101" as PrincipalId;
const other = "019f9a00-0000-7000-8000-000000000102" as PrincipalId;
const threadId = "019f9a00-0000-7000-8000-000000000201";

function message(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: "019f9a00-0000-7000-8000-000000000301" as ThreadMessage["id"],
    threadId: threadId as ThreadMessage["threadId"],
    senderId: other,
    sequence: 4,
    kind: "message",
    body: "Hello there",
    createdAt: "2026-09-03T12:00:01.000Z",
    serverReadable: true,
    streamState: "complete",
    ...overrides,
  };
}

function preferences(
  messages: NotificationPreferences["messages"] = "mentions",
): NotificationPreferences {
  return {
    principalId: viewer,
    mutedKinds: [],
    messages,
    updatedAt: "2026-09-03T12:00:00.000Z",
  };
}

describe("message browser notifications", () => {
  const threadsById = new Map([
    [threadId, { title: "Room", accessMode: "agent_readable" as const }],
  ]);

  it("notifies mentions when the tab is focused on another thread", () => {
    const selected = selectNewMessageNotifications({
      messages: [message({ mentionedPrincipalIds: [viewer] })],
      viewerId: viewer,
      activeThreadId: "019f9a00-0000-7000-8000-000000000299",
      windowFocused: true,
      preferences: preferences("mentions"),
      threadsById,
      occurredAt: "2026-09-03T12:00:00.000Z",
      now: new Date("2026-09-03T12:00:02.000Z"),
    });
    expect(selected).toHaveLength(1);
    expect(selected[0]?.mentioned).toBe(true);
  });

  it("skips unmentioned messages when the preference is mentions", () => {
    expect(
      selectNewMessageNotifications({
        messages: [message()],
        viewerId: viewer,
        windowFocused: false,
        preferences: preferences("mentions"),
        threadsById,
        occurredAt: "2026-09-03T12:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("skips the active focused thread and honors all/none plus mute", () => {
    expect(
      selectNewMessageNotifications({
        messages: [message()],
        viewerId: viewer,
        activeThreadId: threadId,
        windowFocused: true,
        preferences: preferences("all"),
        threadsById,
        occurredAt: "2026-09-03T12:00:00.000Z",
      }),
    ).toEqual([]);
    expect(
      selectNewMessageNotifications({
        messages: [message({ mentionedPrincipalIds: [viewer] })],
        viewerId: viewer,
        windowFocused: false,
        preferences: preferences("none"),
        threadsById,
        occurredAt: "2026-09-03T12:00:00.000Z",
      }),
    ).toEqual([]);
    expect(
      selectNewMessageNotifications({
        messages: [message({ mentionedPrincipalIds: [viewer] })],
        viewerId: viewer,
        windowFocused: false,
        preferences: {
          ...preferences("all"),
          muteUntil: "2026-09-03T13:00:00.000Z",
        },
        threadsById,
        occurredAt: "2026-09-03T12:00:00.000Z",
        now: new Date("2026-09-03T12:00:02.000Z"),
      }),
    ).toEqual([]);
  });

  it("infers a mention from @displayName when mentionedPrincipalIds is missing", () => {
    const inferred = withInferredMentions(
      message({ body: "@Alex Rivera please look" }),
      viewer,
      [{ id: viewer, displayName: "Alex Rivera" }],
    );
    expect(inferred.mentionedPrincipalIds).toEqual([viewer]);
    expect(
      withInferredMentions(
        message({ body: "Alex Rivera please look" }),
        viewer,
        [{ id: viewer, displayName: "Alex Rivera" }],
      ).mentionedPrincipalIds,
    ).toBeUndefined();
  });

  it("hooks T1b mutedUntil when present and no-ops when absent", () => {
    expect(
      selectNewMessageNotifications({
        messages: [message({ mentionedPrincipalIds: [viewer] })],
        viewerId: viewer,
        windowFocused: false,
        preferences: preferences("all"),
        threadsById: new Map([
          [
            threadId,
            {
              title: "Room",
              accessMode: "agent_readable",
              mutedUntil: "2026-09-03T13:00:00.000Z",
            },
          ],
        ]),
        occurredAt: "2026-09-03T12:00:00.000Z",
        now: new Date("2026-09-03T12:00:02.000Z"),
      }),
    ).toEqual([]);
  });
});
