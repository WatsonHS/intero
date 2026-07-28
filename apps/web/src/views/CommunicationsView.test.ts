import { MessageId, PrincipalId, ProjectId } from "@intero/domain";
import { describe, expect, it } from "vitest";

import {
  buildGroupChatThreadInput,
  insertEmojiAtCursor,
  isBubblelessEmojiMessage,
  markCachedThreadRead,
  mergeCommunicationItems,
  personalStandInPrincipalId,
  replaceCachedThreadMessage,
  resolveConversationIdentity,
  resolveConversationProjectId,
  resolvePilotCommunicationPrincipal,
  resolveStandInAvatarIdentity,
  sha256Hex,
} from "./CommunicationsView.js";
import type { ThreadPayload } from "../api.js";

const sessionPrincipal = {
  id: PrincipalId.parse("019f9ba4-3108-7000-8000-000000000001"),
  displayName: "会话用户",
  kind: "human" as const,
  status: "online" as const,
  timezone: "Asia/Shanghai",
  capabilities: [],
};

describe("conversation emoji insertion", () => {
  it("inserts a multi-codepoint emoji at the active textarea cursor", () => {
    expect(insertEmojiAtCursor("准备发布", 2, "👩🏽‍💻")).toEqual({
      draft: "准备👩🏽‍💻发布",
      cursor: 2 + "👩🏽‍💻".length,
    });
  });

  it("clamps a stale cursor to the current draft", () => {
    expect(insertEmojiAtCursor("完成", 99, "✅")).toEqual({
      draft: "完成✅",
      cursor: "完成✅".length,
    });
  });
});

describe("emoji-only message bubbles", () => {
  it("removes the bubble only for readable emoji without attachments", () => {
    expect(
      isBubblelessEmojiMessage({
        body: "👋🏽  🎉",
        serverReadable: true,
      }),
    ).toBe(true);
    expect(
      isBubblelessEmojiMessage({
        body: "完成 👋🏽",
        serverReadable: true,
      }),
    ).toBe(false);
    expect(
      isBubblelessEmojiMessage({
        body: "👋🏽",
        serverReadable: true,
        attachments: [{} as never],
      }),
    ).toBe(false);
    expect(
      isBubblelessEmojiMessage({
        body: "👋🏽",
        serverReadable: true,
        replyToMessageId: MessageId.parse(crypto.randomUUID()),
      }),
    ).toBe(false);
    expect(
      isBubblelessEmojiMessage({
        body: "👋🏽",
        serverReadable: false,
      }),
    ).toBe(false);
  });
});

describe("conversation image hashing", () => {
  it("hashes images without Web Crypto on a LAN HTTP origin", async () => {
    await expect(sha256Hex(new Blob(["hello"]), null)).resolves.toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});

describe("CommunicationsView Pilot principal discovery", () => {
  it("uses the authenticated current principal when dev identities are absent", () => {
    expect(
      resolvePilotCommunicationPrincipal(sessionPrincipal.id, {
        currentPrincipal: sessionPrincipal,
        identities: [],
      }),
    ).toEqual(sessionPrincipal);
  });

  it("keeps development identity discovery as an explicit fallback", () => {
    expect(
      resolvePilotCommunicationPrincipal(sessionPrincipal.id, {
        identities: [sessionPrincipal],
      }),
    ).toEqual(sessionPrincipal);
  });

  it("does not substitute a different session principal", () => {
    expect(
      resolvePilotCommunicationPrincipal(sessionPrincipal.id, {
        currentPrincipal: {
          ...sessionPrincipal,
          id: PrincipalId.parse("019f9ba4-3108-7000-8000-000000000002"),
        },
        identities: [],
      }),
    ).toBeUndefined();
  });
});

describe("CommunicationsView conversation identity", () => {
  it("uses the canonical bootstrap identity when it is available", () => {
    const standInId = PrincipalId.parse("019f9ba4-3108-5000-8000-000000000001");
    expect(
      resolveConversationIdentity(
        {
          organization: { id: crypto.randomUUID(), name: "Intero" },
          currentPrincipal: sessionPrincipal,
          standInPrincipal: {
            id: standInId,
            displayName: "会话用户的替身",
            kind: "stand_in",
          },
        },
        undefined,
      ),
    ).toEqual({
      currentPrincipalId: sessionPrincipal.id,
      standInPrincipalId: standInId,
    });
  });

  it("derives the personal Stand-in from the authenticated Pilot identity", () => {
    expect(resolveConversationIdentity(undefined, sessionPrincipal.id)).toEqual(
      {
        currentPrincipalId: sessionPrincipal.id,
        standInPrincipalId: PrincipalId.parse(
          "019f9ba4-3108-5000-8000-000000000001",
        ),
      },
    );
  });

  it("does not reuse a stale bootstrap identity for a different Pilot user", () => {
    const pilotIdentityId = PrincipalId.parse(
      "019f9ba4-3108-7000-8000-000000000002",
    );
    expect(
      resolveConversationIdentity(
        {
          organization: { id: crypto.randomUUID(), name: "Intero" },
          currentPrincipal: sessionPrincipal,
          standInPrincipal: {
            id: PrincipalId.parse("019f9ba4-3108-5000-8000-000000000001"),
            displayName: "旧会话用户的替身",
            kind: "stand_in",
          },
        },
        pilotIdentityId,
      ),
    ).toEqual({
      currentPrincipalId: pilotIdentityId,
      standInPrincipalId: PrincipalId.parse(
        "019f9ba4-3108-5000-8000-000000000002",
      ),
    });
  });

  it("does not attempt to create a conversation without any identity", () => {
    expect(resolveConversationIdentity(undefined, undefined)).toBeUndefined();
  });
});

describe("personal Stand-in avatar identity", () => {
  it("uses the owner's id and name in group chats", () => {
    const standInId = personalStandInPrincipalId(sessionPrincipal.id);

    expect(
      resolveStandInAvatarIdentity({
        standInId,
        standInOwnerIds: new Map([[standInId, sessionPrincipal.id]]),
        principalNames: new Map([
          [sessionPrincipal.id, sessionPrincipal.displayName],
          [standInId, `${sessionPrincipal.displayName} 的替身`],
        ]),
        fallbackName: `${sessionPrincipal.displayName} 的替身`,
      }),
    ).toEqual({
      ownerId: sessionPrincipal.id,
      ownerName: sessionPrincipal.displayName,
    });
  });
});

describe("manual group chat creation", () => {
  it("always creates a durable room instead of a direct or discussion thread", () => {
    const peerId = PrincipalId.parse("019f9ba4-3108-7000-8000-000000000003");
    const standInId = PrincipalId.parse("019f9ba4-3108-5000-8000-000000000001");

    expect(
      buildGroupChatThreadInput({
        currentPrincipalId: sessionPrincipal.id,
        standInPrincipalId: standInId,
        title: "产品群",
        memberIds: [peerId],
        projectId: "019f9ba4-3108-7000-8000-000000000098",
        teamId: "019f9ba4-3108-7000-8000-000000000099",
      }),
    ).toEqual({
      kind: "room",
      title: "产品群",
      projectId: "019f9ba4-3108-7000-8000-000000000098",
      teamId: "019f9ba4-3108-7000-8000-000000000099",
      participantIds: [sessionPrincipal.id, standInId, peerId],
      standInIds: [standInId],
    });
  });

  it("uses the durable Thread project before the current shell fallback", () => {
    const durableProjectId = ProjectId.parse(
      "019f9ba4-3108-7000-8000-000000000098",
    );
    const selectedProjectId = "019f9ba4-3108-7000-8000-000000000099";

    expect(
      resolveConversationProjectId(
        { projectId: durableProjectId },
        selectedProjectId,
      ),
    ).toBe(durableProjectId);
    expect(resolveConversationProjectId({}, selectedProjectId)).toBe(
      selectedProjectId,
    );
  });
});

describe("conversation unread state", () => {
  it("clears unread and mention badges immediately for the opened thread", () => {
    const threadId = crypto.randomUUID();
    const otherThreadId = crypto.randomUUID();
    const item = {
      thread: { id: threadId },
      unreadCount: 4,
      mentionCount: 2,
    } as ThreadPayload;
    const other = {
      thread: { id: otherThreadId },
      unreadCount: 3,
      mentionCount: 1,
    } as ThreadPayload;

    expect(markCachedThreadRead({ items: [item, other] }, threadId)).toEqual({
      items: [{ ...item, unreadCount: 0, mentionCount: 0 }, other],
    });
  });
});

describe("conversation reaction cache", () => {
  it("replaces the revised message without disturbing adjacent history", () => {
    const threadId = crypto.randomUUID();
    const first = {
      id: crypto.randomUUID(),
      threadId,
      revision: 1,
    } as ThreadPayload["messages"][number];
    const second = {
      id: crypto.randomUUID(),
      threadId,
      revision: 1,
    } as ThreadPayload["messages"][number];
    const updated = {
      ...second,
      revision: 2,
      reactions: [
        {
          emoji: "👍",
          principalIds: [sessionPrincipal.id],
        },
      ],
    };
    const item = {
      thread: { id: threadId },
      messages: [first, second],
    } as ThreadPayload;

    expect(
      replaceCachedThreadMessage({ items: [item] }, updated)?.items[0]
        ?.messages,
    ).toEqual([first, updated]);
  });
});

describe("personal Stand-in canonical convergence", () => {
  it("shows a durably queued question before the async answer is available", () => {
    const threadId = crypto.randomUUID();
    const question = {
      id: crypto.randomUUID(),
      threadId,
      senderId: sessionPrincipal.id,
      sequence: 1,
      kind: "message" as const,
      body: "What changed?",
      serverReadable: true,
      createdAt: new Date().toISOString(),
    };
    const base = {
      thread: {
        id: threadId,
        kind: "stand_in" as const,
        title: "Stand-in",
        participantIds: [sessionPrincipal.id],
        standInIds: [],
        accessMode: "agent_readable" as const,
        priorHistoryGranted: false,
        sequence: 0,
        createdAt: question.createdAt,
      },
      messages: [],
      principals: [sessionPrincipal],
      actions: [],
    } as unknown as ThreadPayload;
    const canonical = {
      ...base,
      thread: { ...base.thread, sequence: 1 },
      messages: [question],
      unreadCount: 0,
    } as ThreadPayload;

    const [merged] = mergeCommunicationItems(base, [canonical], []);

    expect(merged?.messages).toEqual([question]);
    expect(merged?.thread.sequence).toBe(1);
  });
});
