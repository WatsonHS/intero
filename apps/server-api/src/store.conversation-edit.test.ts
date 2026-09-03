import type { PrincipalId, ThreadId, ThreadMessage } from "@intero/domain";
import { uuidv7 } from "@intero/domain";
import { describe, expect, it } from "vitest";

import { PilotStoreError } from "./pilot-store.js";
import { extractMentionIdsFromBody, InMemoryPlatformStore } from "./store.js";

const ALEX = "019b5ac0-7600-7000-8000-000000000002" as PrincipalId;
const PRIYA = "019b5ac0-7600-7000-8000-000000000004" as PrincipalId;

function createRoom(store: InMemoryPlatformStore) {
  const threadId = uuidv7() as ThreadId;
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
  store.createThread(
    {
      id: threadId,
      kind: "room",
      title: "Edit room",
      participantIds: [ALEX, PRIYA],
      standInIds: [],
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      sequence: 0,
      createdAt: new Date().toISOString(),
    },
    ALEX,
  );
  const message = store.appendMessage(threadId, {
    id: uuidv7() as ThreadMessage["id"],
    senderId: ALEX,
    body: "Original body",
    createdAt: new Date().toISOString(),
  });
  return { threadId, message };
}

describe("thread message edit and delete", () => {
  it("lets the sender edit and delete an ordinary message", () => {
    const store = new InMemoryPlatformStore();
    const { threadId, message } = createRoom(store);

    const edited = store.editThreadMessage({
      threadId,
      messageId: message.id,
      principalId: ALEX,
      body: "Hello @Priya Shah",
      mentionedPrincipalIds: extractMentionIdsFromBody(
        "Hello @Priya Shah",
        ALEX,
        store.listPrincipals([ALEX, PRIYA]),
      ),
    });
    expect(edited.body).toBe("Hello @Priya Shah");
    expect(edited.editedAt).toBeTruthy();
    expect(edited.mentionedPrincipalIds).toEqual([PRIYA]);
    expect(edited.sequence).toBe(message.sequence);
    expect(store.outbox.at(-1)?.payload).toMatchObject({
      reason: "message_edited",
      messageId: message.id,
    });

    store.deleteThreadMessage({
      threadId,
      messageId: message.id,
      principalId: ALEX,
    });
    const deleted = store.getThreadMessage(threadId, ALEX, message.id);
    expect(deleted).toMatchObject({
      body: "",
      sequence: message.sequence,
    });
    expect(deleted?.deletedAt).toBeTruthy();
    expect(deleted?.attachments).toBeUndefined();
    expect(deleted?.reactions).toBeUndefined();
    expect(store.outbox.at(-1)?.payload).toMatchObject({
      reason: "message_deleted",
      messageId: message.id,
    });
    const listed = store.getThread(threadId, PRIYA);
    expect(
      listed?.messages.some(
        (item) => item.id === message.id && Boolean(item.deletedAt),
      ),
    ).toBe(true);
  });

  it("rejects a non-sender, concluded thread, and non-message kind", () => {
    const store = new InMemoryPlatformStore();
    const { threadId, message } = createRoom(store);

    expect(() =>
      store.editThreadMessage({
        threadId,
        messageId: message.id,
        principalId: PRIYA,
        body: "Hijack",
      }),
    ).toThrow(PilotStoreError);
    try {
      store.deleteThreadMessage({
        threadId,
        messageId: message.id,
        principalId: PRIYA,
      });
      throw new Error("expected forbidden delete");
    } catch (error) {
      expect(error).toBeInstanceOf(PilotStoreError);
      expect((error as PilotStoreError).statusCode).toBe(403);
    }

    const thread = store.threads.get(threadId)!;
    store.threads.set(threadId, {
      ...thread,
      concludedAt: new Date().toISOString(),
      concludedBy: ALEX,
    });
    try {
      store.editThreadMessage({
        threadId,
        messageId: message.id,
        principalId: ALEX,
        body: "Too late",
      });
      throw new Error("expected concluded conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(PilotStoreError);
      expect((error as PilotStoreError).statusCode).toBe(409);
    }

    store.threads.set(threadId, thread);
    const systemId = uuidv7() as ThreadMessage["id"];
    store.messages.set(threadId, [
      ...(store.messages.get(threadId) ?? []),
      {
        id: systemId,
        threadId,
        senderId: ALEX,
        sequence: message.sequence + 1,
        kind: "system_access_change",
        body: "Access changed",
        createdAt: new Date().toISOString(),
        serverReadable: true,
      },
    ]);
    try {
      store.deleteThreadMessage({
        threadId,
        messageId: systemId,
        principalId: ALEX,
      });
      throw new Error("expected non-message conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(PilotStoreError);
      expect((error as PilotStoreError).statusCode).toBe(409);
    }
  });
});
