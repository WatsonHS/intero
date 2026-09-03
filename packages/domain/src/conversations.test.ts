import { describe, expect, it } from "vitest";

import {
  ConversationChangedEvent,
  isSingleEmojiSequence,
  ReactionEmoji,
  ThreadMessage,
  TypingEvent,
  extractHttpUrls,
  LinkPreview,
  normalizePublicHttpUrl,
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

describe("extractHttpUrls", () => {
  it("returns the first two unique normalized http(s) URLs", () => {
    expect(
      extractHttpUrls(
        "See https://Example.com/a, then http://example.com/b and https://example.com/a again plus https://other.test/c.",
      ),
    ).toEqual(["https://example.com/a", "http://example.com/b"]);
  });

  it("strips credentials, fragments, and default ports", () => {
    expect(normalizePublicHttpUrl("https://user:pass@example.com/x")).toBe(
      undefined,
    );
    expect(normalizePublicHttpUrl("https://example.com:443/x#frag")).toBe(
      "https://example.com/x",
    );
    expect(normalizePublicHttpUrl("http://example.com:80/x")).toBe(
      "http://example.com/x",
    );
  });

  it("rejects a link preview without a fetched timestamp", () => {
    expect(
      LinkPreview.safeParse({
        url: "https://example.com",
        status: "ok",
      }).success,
    ).toBe(false);
  });
});
