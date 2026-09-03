import { describe, expect, it } from "vitest";

import {
  ConversationChangedEvent,
  ConversationThread,
  isSingleEmojiSequence,
  isThreadMuted,
  MUTED_INDEFINITELY_UNTIL,
  ReactionEmoji,
  shouldNotifyForThreadMessage,
  ThreadMessage,
  ThreadNotificationPreference,
  TypingEvent,
} from "./conversations.js";

describe("message reaction emoji", () => {
  it("accepts complete emoji graphemes", () => {
    for (const emoji of ["👍", "👩🏽‍💻", "❤️", "1️⃣", "🇨🇳", "🏴󠁧󠁢󠁥󠁮󠁧󠁿"]) {
      expect(isSingleEmojiSequence(emoji)).toBe(true);
      expect(ReactionEmoji.safeParse(emoji).success).toBe(true);
    }
  });

  it("rejects text and multiple emoji", () => {
    for (const value of ["", "好", "👍👍", "👍 好", "©"]) {
      expect(isSingleEmojiSequence(value)).toBe(false);
      expect(ReactionEmoji.safeParse(value).success).toBe(false);
    }
  });
});

describe("message edit and delete fields", () => {
  const base = {
    id: "019b5ac0-7600-7000-8000-000000000010",
    threadId: "019b5ac0-7600-7000-8000-000000000011",
    senderId: "019b5ac0-7600-7000-8000-000000000002",
    sequence: 1,
    kind: "message" as const,
    body: "hello",
    createdAt: "2026-09-03T12:00:00.000Z",
    serverReadable: true,
  };

  it("accepts optional editedAt and deletedAt timestamps", () => {
    expect(
      ThreadMessage.parse({
        ...base,
        editedAt: "2026-09-03T12:01:00.000Z",
      }).editedAt,
    ).toBe("2026-09-03T12:01:00.000Z");
    expect(
      ThreadMessage.parse({
        ...base,
        body: "",
        deletedAt: "2026-09-03T12:02:00.000Z",
      }).deletedAt,
    ).toBe("2026-09-03T12:02:00.000Z");
  });

  it("requires a messageId pointer for edit and delete events", () => {
    const event = {
      schemaVersion: 1 as const,
      eventId: "019b5ac0-7600-7000-8000-000000000012",
      type: "conversation.changed" as const,
      threadId: "019b5ac0-7600-7000-8000-000000000011",
      headSequence: 1,
      accessVersion: 1,
      occurredAt: "2026-09-03T12:00:00.000Z",
    };
    expect(
      ConversationChangedEvent.safeParse({
        ...event,
        reason: "message_edited",
      }).success,
    ).toBe(false);
    expect(
      ConversationChangedEvent.parse({
        ...event,
        reason: "message_deleted",
        messageId: "019b5ac0-7600-7000-8000-000000000010",
      }).reason,
    ).toBe("message_deleted");
  });

  it("accepts ephemeral typing events without message content", () => {
    expect(
      TypingEvent.parse({
        type: "typing",
        threadId: "019b5ac0-7600-7000-8000-000000000011",
        principalId: "019b5ac0-7600-7000-8000-000000000002",
        at: "2026-09-03T12:00:00.000Z",
      }).type,
    ).toBe("typing");
  });
});

describe("thread visibility, mute, and archive fields", () => {
  const thread = {
    id: "019b5ac0-7600-7000-8000-000000000011",
    kind: "room" as const,
    title: "#engineering",
    participantIds: ["019b5ac0-7600-7000-8000-000000000002"],
    standInIds: [],
    accessMode: "agent_readable" as const,
    priorHistoryGranted: false,
    sequence: 0,
    createdAt: "2026-09-03T12:00:00.000Z",
  };

  it("defaults omitted visibility to private and accepts team Rooms", () => {
    expect(ConversationThread.parse(thread).visibility).toBeUndefined();
    expect(
      ConversationThread.parse({
        ...thread,
        teamId: "019b5ac0-7600-7000-8000-000000000021",
        visibility: "team",
        createdBy: "019b5ac0-7600-7000-8000-000000000002",
        archivedAt: "2026-09-03T13:00:00.000Z",
        archivedBy: "019b5ac0-7600-7000-8000-000000000002",
      }),
    ).toMatchObject({
      visibility: "team",
      archivedAt: "2026-09-03T13:00:00.000Z",
    });
  });

  it("parses team visibility on a Room with a teamId", () => {
    expect(
      ConversationThread.parse({
        ...thread,
        teamId: "019b5ac0-7600-7000-8000-000000000021",
        visibility: "team",
      }).visibility,
    ).toBe("team");
  });

  it("treats a far-future mutedUntil as indefinitely muted", () => {
    const preference = ThreadNotificationPreference.parse({
      threadId: thread.id,
      principalId: "019b5ac0-7600-7000-8000-000000000002",
      mutedUntil: MUTED_INDEFINITELY_UNTIL,
      muteIncludingMentions: false,
      updatedAt: "2026-09-03T12:00:00.000Z",
    });
    const now = new Date("2026-09-03T12:00:00.000Z");
    expect(isThreadMuted(preference, now)).toBe(true);
    expect(
      shouldNotifyForThreadMessage({
        preference,
        mentioned: true,
        now,
      }),
    ).toBe(true);
    expect(
      shouldNotifyForThreadMessage({
        preference: { ...preference, muteIncludingMentions: true },
        mentioned: true,
        now,
      }),
    ).toBe(false);
  });
});
