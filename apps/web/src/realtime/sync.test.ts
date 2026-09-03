import type { ConversationChangedEvent, ThreadMessage } from "@intero/domain";
import { uuidv7 } from "@intero/domain";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getThreadMessage: vi.fn(),
  getThreadMessages: vi.fn(),
}));

vi.mock("../api.js", () => ({
  getThreadMessage: api.getThreadMessage,
  getThreadMessages: api.getThreadMessages,
}));

import { mergeThreadMessages, repairConversationChange } from "./sync.js";

describe("conversation cursor repair", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    api.getThreadMessages.mockReset();
    api.getThreadMessage.mockReset();
  });

  it("fills a sequence gap and merges duplicate messages deterministically", async () => {
    const threadId = uuidv7();
    const first = message(threadId, 1);
    const viewerId = "019b5ac0-7600-7000-8000-000000000009";
    queryClient.setQueryData(["threads"], {
      items: [
        {
          thread: {
            id: threadId,
            kind: "room",
            title: "Realtime",
            participantIds: [first.senderId],
            standInIds: [],
            accessMode: "agent_readable",
            priorHistoryGranted: false,
            sequence: 1,
            accessVersion: 1,
            createdAt: first.createdAt,
          },
          messages: [first],
          unreadCount: 0,
          principals: [],
          actions: [],
        },
      ],
    });
    api.getThreadMessages.mockResolvedValue({
      items: [message(threadId, 2), message(threadId, 3)],
      headSequence: 3,
      accessVersion: 2,
      hasMore: false,
    });

    await repairConversationChange(
      queryClient,
      change(threadId, 3, "message_appended"),
      viewerId,
    );
    mergeThreadMessages(
      queryClient,
      threadId,
      [message(threadId, 3)],
      3,
      2,
      viewerId,
    );

    expect(api.getThreadMessages).toHaveBeenCalledWith(threadId, {
      afterSequence: 1,
      limit: 200,
    });
    const cached = queryClient.getQueryData<{
      items: Array<{
        thread: { sequence: number; accessVersion: number };
        messages: ThreadMessage[];
        unreadCount: number;
      }>;
    }>(["threads"]);
    expect(cached?.items[0]?.thread).toMatchObject({
      sequence: 3,
      accessVersion: 2,
    });
    expect(cached?.items[0]?.messages.map((item) => item.sequence)).toEqual([
      1, 2, 3,
    ]);
    expect(cached?.items[0]?.unreadCount).toBe(2);
  });

  it("invalidates the list for membership and lifecycle changes", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await repairConversationChange(
      queryClient,
      change(uuidv7(), 0, "thread_created"),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["threads"] });
    expect(api.getThreadMessages).not.toHaveBeenCalled();
  });

  it("repairs an in-place Stand-in stream revision by message pointer", async () => {
    const threadId = uuidv7();
    const first = message(threadId, 1);
    queryClient.setQueryData(["threads"], {
      items: [
        {
          thread: {
            id: threadId,
            kind: "stand_in",
            title: "Stand-in",
            participantIds: [first.senderId],
            standInIds: [first.senderId],
            accessMode: "agent_readable",
            priorHistoryGranted: false,
            sequence: 1,
            accessVersion: 1,
            createdAt: first.createdAt,
          },
          messages: [{ ...first, body: "", streamState: "pending" }],
          principals: [],
          actions: [],
        },
      ],
    });
    const streamed = {
      ...first,
      body: "A durable partial answer",
      streamState: "streaming" as const,
      revision: 3,
    };
    api.getThreadMessage.mockResolvedValue(streamed);

    const repaired = await repairConversationChange(queryClient, {
      ...change(threadId, 1, "message_updated"),
      messageId: first.id,
    });

    expect(repaired).toEqual([streamed]);
    expect(api.getThreadMessage).toHaveBeenCalledWith(threadId, first.id);
    expect(
      queryClient.getQueryData<{
        items: Array<{ messages: ThreadMessage[] }>;
      }>(["threads"])?.items[0]?.messages[0],
    ).toMatchObject({ body: streamed.body, revision: 3 });
  });

  it("patches an edited message in place from the message pointer", async () => {
    const threadId = uuidv7();
    const first = message(threadId, 1);
    queryClient.setQueryData(["threads"], {
      items: [
        {
          thread: {
            id: threadId,
            kind: "room",
            title: "Edit",
            participantIds: [first.senderId],
            standInIds: [],
            accessMode: "agent_readable",
            priorHistoryGranted: false,
            sequence: 1,
            accessVersion: 1,
            createdAt: first.createdAt,
          },
          messages: [first],
          principals: [],
          actions: [],
        },
      ],
    });
    const edited = {
      ...first,
      body: "Edited in place",
      editedAt: "2026-09-03T12:01:00.000Z",
      revision: 2,
    };
    api.getThreadMessage.mockResolvedValue(edited);

    const repaired = await repairConversationChange(queryClient, {
      ...change(threadId, 1, "message_edited"),
      messageId: first.id,
    });

    expect(repaired).toEqual([edited]);
    expect(api.getThreadMessages).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<{
        items: Array<{ messages: ThreadMessage[] }>;
      }>(["threads"])?.items[0]?.messages[0],
    ).toMatchObject({ body: "Edited in place", editedAt: edited.editedAt });
  });
});

function message(threadId: string, sequence: number): ThreadMessage {
  return {
    id: uuidv7(),
    threadId,
    senderId: "019b5ac0-7600-7000-8000-000000000002",
    sequence,
    kind: "message",
    body: `message ${sequence}`,
    serverReadable: true,
    createdAt: new Date(1_700_000_000_000 + sequence * 1_000).toISOString(),
  } as ThreadMessage;
}

function change(
  threadId: string,
  headSequence: number,
  reason: ConversationChangedEvent["reason"],
): ConversationChangedEvent {
  return {
    schemaVersion: 1,
    eventId: uuidv7(),
    type: "conversation.changed",
    threadId,
    headSequence,
    accessVersion: 1,
    reason,
    occurredAt: new Date().toISOString(),
  } as ConversationChangedEvent;
}
