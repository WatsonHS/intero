import type {
  ConversationThread,
  PrincipalId,
  ThreadMessage,
} from "@intero/domain";
import { uuidv7 } from "@intero/domain";
import { describe, expect, it } from "vitest";

import {
  addStandIn,
  canStandInRead,
} from "./conversation-policy.js";

describe("conversation privacy boundary", () => {
  it("withholds earlier history when a Stand-in is added", () => {
    const human = uuidv7() as PrincipalId;
    const teammate = uuidv7() as PrincipalId;
    const standIn = uuidv7() as PrincipalId;
    const thread: ConversationThread = {
      id: uuidv7() as ConversationThread["id"],
      kind: "human_group",
      title: "Authorization design",
      participantIds: [human, teammate],
      standInIds: [],
      accessMode: "human_only_e2ee",
      priorHistoryGranted: false,
      sequence: 4,
      createdAt: "2026-07-24T09:00:00.000Z",
    };
    const earlier: ThreadMessage = {
      id: uuidv7() as ThreadMessage["id"],
      threadId: thread.id,
      senderId: human,
      sequence: 4,
      kind: "message",
      body: "",
      encryptedBody: "ciphertext",
      createdAt: "2026-07-24T09:30:00.000Z",
      serverReadable: false,
    };

    const transition = addStandIn(thread, standIn, human);
    expect(transition.thread.accessMode).toBe("agent_readable");
    expect(transition.event.sequence).toBe(5);
    expect(canStandInRead(transition.thread, earlier)).toBe(false);
    expect(canStandInRead(transition.thread, transition.event)).toBe(
      true,
    );
  });
});
