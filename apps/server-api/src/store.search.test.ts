import type { PrincipalId, ThreadId } from "@intero/domain";
import { parseSearchQuery, uuidv7 } from "@intero/domain";
import { describe, expect, it } from "vitest";

import { InMemoryPlatformStore } from "./store.js";

const ALEX = "019b5ac0-7600-7000-8000-000000000002" as PrincipalId;
const PRIYA = "019b5ac0-7600-7000-8000-000000000004" as PrincipalId;

describe("in-memory message search", () => {
  it("parses filters, ranks by token hits, and shapes a highlighted snippet", () => {
    const store = new InMemoryPlatformStore();
    store.upsertPrincipal({
      id: ALEX,
      displayName: "Alex Rivera",
      kind: "human",
    });
    store.upsertPrincipal({
      id: PRIYA,
      displayName: "Priya Shah",
      kind: "human",
    });
    const threadId = uuidv7() as ThreadId;
    store.createThread(
      {
        id: threadId,
        kind: "room",
        title: "Launch room",
        participantIds: [ALEX, PRIYA],
        standInIds: [],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        sequence: 0,
        createdAt: "2026-09-01T00:00:00.000Z",
      },
      ALEX,
    );
    const first = store.appendMessage(threadId, {
      id: uuidv7() as never,
      senderId: ALEX,
      body: "Please deploy the auth fix tonight.",
      createdAt: "2026-09-01T10:00:00.000Z",
    });
    store.appendMessage(threadId, {
      id: uuidv7() as never,
      senderId: PRIYA,
      body: "The deploy window is tomorrow.",
      createdAt: "2026-09-02T10:00:00.000Z",
    });
    const withAttachment = store.appendMessage(threadId, {
      id: uuidv7() as never,
      senderId: ALEX,
      body: "Auth checklist attached.",
      createdAt: "2026-09-03T10:00:00.000Z",
    });
    store.messages.set(threadId, [
      ...(store.messages.get(threadId) ?? []).map((message) =>
        message.id === withAttachment.id
          ? {
              ...message,
              attachments: [
                {
                  id: uuidv7() as never,
                  fileName: "checklist.txt",
                  contentType: "text/plain",
                  byteSize: 12,
                },
              ],
            }
          : message,
      ),
    ]);

    const page = store.searchMessages(ALEX, {
      filters: parseSearchQuery(
        'auth from:"Alex Rivera" after:2026-09-01 has:attachment',
      ),
      limit: 20,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      type: "message",
      id: withAttachment.id,
      threadId,
      messageId: withAttachment.id,
      sequence: withAttachment.sequence,
      senderId: ALEX,
      title: "Launch room",
    });
    expect(page.items[0]?.snippet.toLocaleLowerCase()).toContain("<b>auth</b>");
    expect(page.items.some((item) => item.id === first.id)).toBe(false);
  });

  it("does not return messages from threads the principal cannot view", () => {
    const store = new InMemoryPlatformStore();
    const threadId = uuidv7() as ThreadId;
    store.createThread(
      {
        id: threadId,
        kind: "human_direct",
        title: "Private",
        participantIds: [ALEX],
        standInIds: [],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        sequence: 0,
        createdAt: "2026-09-01T00:00:00.000Z",
      },
      ALEX,
    );
    store.appendMessage(threadId, {
      id: uuidv7() as never,
      senderId: ALEX,
      body: "hidden deploy note",
      createdAt: "2026-09-01T10:00:00.000Z",
    });
    expect(
      store.searchMessages(PRIYA, {
        filters: parseSearchQuery("deploy"),
        limit: 20,
      }).items,
    ).toEqual([]);
  });
});
