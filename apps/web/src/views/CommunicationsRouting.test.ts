import { PrincipalId, type PilotProject } from "@intero/domain";
import { describe, expect, it, vi } from "vitest";

import {
  applyConversationMention,
  applyPersonalStandInMention,
  canRenderCommunicationItems,
  conversationMentionCandidates,
  conversationMentionQuery,
  extractConversationMentionPrincipalIds,
  filterConversationMentionCandidates,
  mentionedStandIns,
  mergeCommunicationItems,
  moveMentionCandidateIndex,
  ownStandInControlState,
  personalStandInMentionCandidates,
  personalStandInMentionQuery,
  personalStandInPrincipalId,
  requestConversationStandInReplies,
  resolvePilotCommunicationPrincipal,
  sendCanonicalConversationMessage,
  shouldSubmitComposerKey,
  splitConversationMentions,
  standInsAddressedByMessage,
} from "./CommunicationsView.js";
import type { ThreadPayload } from "../api.js";

const SESSION_PRINCIPAL_ID = PrincipalId.parse(
  "019f9f20-0000-7000-8000-000000000001",
);
const DEV_PRINCIPAL_ID = PrincipalId.parse(
  "019f9f20-0000-7000-8000-000000000002",
);

describe("Communications personal Stand-in routing", () => {
  it("uses the signed-in principal when development identities are absent", () => {
    const principal = resolvePilotCommunicationPrincipal(SESSION_PRINCIPAL_ID, {
      identities: [],
      currentPrincipal: {
        id: SESSION_PRINCIPAL_ID,
        displayName: "Session Member",
        kind: "human",
      },
    });

    expect(principal).toMatchObject({
      id: SESSION_PRINCIPAL_ID,
      displayName: "Session Member",
    });
  });

  it("retains development-identity routing when that auth mode is active", () => {
    const principal = resolvePilotCommunicationPrincipal(DEV_PRINCIPAL_ID, {
      identities: [
        {
          id: DEV_PRINCIPAL_ID,
          displayName: "Development Member",
          kind: "human",
        },
      ],
    });

    expect(principal?.id).toBe(DEV_PRINCIPAL_ID);
  });

  it("does not let a canonical thread failure hide cloud conversations", () => {
    expect(
      canRenderCommunicationItems({
        itemCount: 1,
        canonicalPending: false,
        canonicalError: true,
      }),
    ).toBe(true);
    expect(
      canRenderCommunicationItems({
        itemCount: 0,
        canonicalPending: false,
        canonicalError: true,
      }),
    ).toBe(false);
  });

  it("offers the group control until this member's own Stand-in has joined", () => {
    const thread = payload("room", "Delivery", "9").thread;
    const ownStandInId = personalStandInPrincipalId(SESSION_PRINCIPAL_ID);
    const otherStandInId = personalStandInPrincipalId(DEV_PRINCIPAL_ID);

    expect(
      ownStandInControlState(
        { ...thread, standInIds: [otherStandInId] },
        ownStandInId,
      ),
    ).toBe("add");
    expect(
      ownStandInControlState(
        { ...thread, standInIds: [otherStandInId, ownStandInId] },
        ownStandInId,
      ),
    ).toBe("present");
    expect(
      ownStandInControlState({ ...thread, kind: "human_direct" }, ownStandInId),
    ).toBeUndefined();
  });

  it("lists only other members from the Project's current teams", () => {
    const project = {
      id: "019f9f20-0000-7000-8000-000000000010",
      participatingTeamIds: ["019f9f20-0000-7000-8000-000000000020"],
    } as PilotProject;
    const candidates = personalStandInMentionCandidates({
      project,
      currentPrincipalId: SESSION_PRINCIPAL_ID,
      teams: [
        {
          id: "019f9f20-0000-7000-8000-000000000020",
          name: "Current team",
          members: [
            {
              id: SESSION_PRINCIPAL_ID,
              displayName: "Session Member",
              kind: "human",
            },
            {
              id: DEV_PRINCIPAL_ID,
              displayName: "Development Member",
              kind: "human",
            },
          ],
        },
        {
          id: "019f9f20-0000-7000-8000-000000000030",
          name: "Outside team",
          members: [
            {
              id: PrincipalId.parse("019f9f20-0000-7000-8000-000000000003"),
              displayName: "Outside Member",
              kind: "human",
            },
          ],
        },
      ] as Parameters<typeof personalStandInMentionCandidates>[0]["teams"],
    });

    expect(candidates).toEqual([
      {
        principalId: DEV_PRINCIPAL_ID,
        displayName: "Development Member",
        teamName: "Current team",
      },
    ]);
  });

  it("turns the active @ fragment into a selected personal Stand-in", () => {
    const mention = personalStandInMentionQuery("Can you ask @Dev");
    expect(mention).toMatchObject({ query: "Dev" });
    expect(
      applyPersonalStandInMention("Can you ask @Dev", mention!, {
        principalId: DEV_PRINCIPAL_ID,
        displayName: "Development Member",
        teamName: "Current team",
      }),
    ).toBe("Can you ask @Development Member 的替身 ");
  });

  it("recognizes an @ fragment directly after Chinese text", () => {
    expect(personalStandInMentionQuery("请帮我问@开发")).toMatchObject({
      start: 4,
      query: "开发",
    });
  });

  it("does not submit while a Chinese input method is composing", () => {
    expect(
      shouldSubmitComposerKey({
        key: "Enter",
        shiftKey: false,
        isComposing: true,
      }),
    ).toBe(false);
    expect(
      shouldSubmitComposerKey({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(true);
    expect(
      shouldSubmitComposerKey({
        key: "Enter",
        shiftKey: true,
        isComposing: false,
      }),
    ).toBe(false);
  });

  it("builds one mention list from people and Stand-ins in the conversation", () => {
    const standInId = PrincipalId.parse("019f9f20-0000-5000-8000-000000000001");
    const candidates = conversationMentionCandidates({
      participantIds: [SESSION_PRINCIPAL_ID, DEV_PRINCIPAL_ID, standInId],
      standInIds: [standInId],
      principalNames: new Map([
        [SESSION_PRINCIPAL_ID, "Session Member"],
        [DEV_PRINCIPAL_ID, "Development Member"],
        [standInId, "Session Member 的替身"],
      ]),
    });

    expect(
      candidates.map(({ displayName, kind }) => ({ displayName, kind })),
    ).toEqual([
      { displayName: "Development Member", kind: "human" },
      { displayName: "Session Member", kind: "human" },
      { displayName: "Session Member 的替身", kind: "stand_in" },
    ]);
    expect(filterConversationMentionCandidates(candidates, "替身")).toEqual([
      expect.objectContaining({
        principalId: standInId,
        kind: "stand_in",
      }),
    ]);
  });

  it("moves through mention candidates with wrapping arrow navigation", () => {
    expect(
      moveMentionCandidateIndex({
        currentIndex: 0,
        direction: "next",
        candidateCount: 3,
      }),
    ).toBe(1);
    expect(
      moveMentionCandidateIndex({
        currentIndex: 2,
        direction: "next",
        candidateCount: 3,
      }),
    ).toBe(0);
    expect(
      moveMentionCandidateIndex({
        currentIndex: 0,
        direction: "previous",
        candidateCount: 3,
      }),
    ).toBe(2);
    expect(
      moveMentionCandidateIndex({
        currentIndex: 4,
        direction: "previous",
        candidateCount: 0,
      }),
    ).toBe(0);
  });

  it("replaces the active @ fragment at the cursor", () => {
    const candidate = {
      principalId: DEV_PRINCIPAL_ID,
      displayName: "Development Member",
      kind: "human" as const,
    };
    const draft = "请问@Dev 后面的内容";
    const cursor = "请问@Dev".length;
    const mention = conversationMentionQuery(draft, cursor);

    expect(mention).toMatchObject({ start: 2, end: cursor, query: "Dev" });
    expect(applyConversationMention(draft, cursor, candidate, mention)).toEqual(
      {
        draft: "请问@Development Member 后面的内容",
        cursor: "请问@Development Member".length,
      },
    );
  });

  it("highlights only complete mentions of conversation participants", () => {
    const candidates = [
      {
        principalId: DEV_PRINCIPAL_ID,
        displayName: "开发同学",
        kind: "human" as const,
      },
    ];
    const parts = splitConversationMentions(
      "请 @开发同学，检查 a@b.com；@陌生人 不应高亮。",
      candidates,
    );

    expect(parts.filter((part) => part.mention)).toEqual([
      {
        text: "@开发同学",
        mention: candidates[0],
      },
    ]);
    expect(
      extractConversationMentionPrincipalIds(
        "请 @开发同学，检查。",
        candidates,
        SESSION_PRINCIPAL_ID,
      ),
    ).toEqual([DEV_PRINCIPAL_ID]);
  });

  it("identifies each mentioned Stand-in once with its human owner", () => {
    const standInId = PrincipalId.parse("019f9f20-0000-5000-8000-000000000002");
    const candidates = conversationMentionCandidates({
      participantIds: [SESSION_PRINCIPAL_ID, standInId],
      standInIds: [standInId],
      principalNames: new Map([[standInId, "Development Member 的替身"]]),
      standInOwnerIds: new Map([[standInId, DEV_PRINCIPAL_ID]]),
    });

    expect(
      mentionedStandIns(
        "@Development Member 的替身 请同步，稍后再问 @Development Member 的替身。",
        candidates,
      ),
    ).toEqual([
      {
        principalId: standInId,
        ownerId: DEV_PRINCIPAL_ID,
      },
    ]);
  });

  it("routes a mention of the sender's own joined Stand-in back to that owner", () => {
    const standInId = personalStandInPrincipalId(SESSION_PRINCIPAL_ID);
    const candidates = conversationMentionCandidates({
      participantIds: [SESSION_PRINCIPAL_ID, standInId],
      standInIds: [standInId],
      principalNames: new Map([[standInId, "Session Member 的替身"]]),
      standInOwnerIds: new Map([[standInId, SESSION_PRINCIPAL_ID]]),
    });

    expect(
      mentionedStandIns(
        "@Session Member 的替身 我现在有什么进展？",
        candidates,
      ),
    ).toEqual([
      {
        principalId: standInId,
        ownerId: SESSION_PRINCIPAL_ID,
      },
    ]);
  });

  it("addresses the sole Stand-in implicitly in a direct Stand-in Thread", () => {
    const standInId = personalStandInPrincipalId(SESSION_PRINCIPAL_ID);
    const candidates = conversationMentionCandidates({
      participantIds: [SESSION_PRINCIPAL_ID, standInId],
      standInIds: [standInId],
      principalNames: new Map([[standInId, "Session Member 的替身"]]),
      standInOwnerIds: new Map([[standInId, SESSION_PRINCIPAL_ID]]),
    });

    expect(standInsAddressedByMessage("你好", candidates, "stand_in")).toEqual([
      {
        principalId: standInId,
        ownerId: SESSION_PRINCIPAL_ID,
      },
    ]);
    expect(standInsAddressedByMessage("你好", candidates, "room")).toEqual([]);
  });

  it("adds an unjoined Stand-in only when navigation supplies it explicitly", () => {
    const candidates = conversationMentionCandidates({
      participantIds: [SESSION_PRINCIPAL_ID, DEV_PRINCIPAL_ID],
      standInIds: [],
      principalNames: new Map([
        [SESSION_PRINCIPAL_ID, "Session Member"],
        [DEV_PRINCIPAL_ID, "Development Member"],
      ]),
      additionalStandIns: [
        {
          principalId: DEV_PRINCIPAL_ID,
          displayName: "Development Member",
          teamName: "Development",
        },
      ],
    });

    expect(
      mentionedStandIns("@Development Member 的替身 请同步。", candidates),
    ).toEqual([
      {
        principalId: PrincipalId.parse("019f9f20-0000-5000-8000-000000000002"),
        ownerId: DEV_PRINCIPAL_ID,
      },
    ]);
  });

  it("does not expose another member's unjoined Stand-in in a group mention list", () => {
    const candidates = conversationMentionCandidates({
      participantIds: [SESSION_PRINCIPAL_ID, DEV_PRINCIPAL_ID],
      standInIds: [],
      principalNames: new Map([
        [SESSION_PRINCIPAL_ID, "Session Member"],
        [DEV_PRINCIPAL_ID, "Development Member"],
      ]),
    });

    expect(
      candidates.filter((candidate) => candidate.kind === "stand_in"),
    ).toEqual([]);
  });

  it("never changes Stand-in membership while sending a group message", async () => {
    const threadId = "019f9f20-0000-7000-8000-000000000099";
    const standInId = PrincipalId.parse("019f9f20-0000-5000-8000-000000000002");
    const sendMessage = vi.fn(async () => {
      return { id: "019f9f20-0000-7000-8000-000000000098" } as never;
    });

    await sendCanonicalConversationMessage(
      {
        threadId,
        senderId: SESSION_PRINCIPAL_ID,
        body: "@Development Member 的替身 请同步。",
        mentionedStandIns: [
          {
            principalId: standInId,
            ownerId: DEV_PRINCIPAL_ID,
          },
        ],
      },
      {
        sendMessage,
      },
    );

    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("enqueues a group reply against the durable source message", async () => {
    const threadId = "019f9f20-0000-7000-8000-000000000099";
    const messageId = "019f9f20-0000-7000-8000-000000000098";
    const standInId = PrincipalId.parse("019f9f20-0000-5000-8000-000000000002");
    const enqueueReply = vi.fn(async () => undefined);

    await requestConversationStandInReplies(
      {
        threadId,
        messageId,
        senderId: SESSION_PRINCIPAL_ID,
        mentionedStandIns: [
          {
            principalId: standInId,
            ownerId: DEV_PRINCIPAL_ID,
          },
        ],
      },
      { enqueueReply },
    );

    expect(enqueueReply).toHaveBeenCalledWith(
      SESSION_PRINCIPAL_ID,
      threadId,
      messageId,
      DEV_PRINCIPAL_ID,
    );
  });

  it("continues with other addressed Stand-ins when one answer fails", async () => {
    const firstStandInId = PrincipalId.parse(
      "019f9f20-0000-5000-8000-000000000002",
    );
    const secondStandInId = PrincipalId.parse(
      "019f9f20-0000-5000-8000-000000000003",
    );
    const secondOwnerId = PrincipalId.parse(
      "019f9f20-0000-7000-8000-000000000003",
    );
    const enqueueReply = vi.fn(
      async (
        _identityId: PrincipalId,
        _threadId: string,
        _messageId: string,
        ownerId: PrincipalId,
      ) => {
        if (ownerId === DEV_PRINCIPAL_ID)
          throw new Error("provider_unavailable");
      },
    );

    await expect(
      requestConversationStandInReplies(
        {
          threadId: "019f9f20-0000-7000-8000-000000000099",
          messageId: "019f9f20-0000-7000-8000-000000000098",
          senderId: SESSION_PRINCIPAL_ID,
          mentionedStandIns: [
            {
              principalId: firstStandInId,
              ownerId: DEV_PRINCIPAL_ID,
            },
            {
              principalId: secondStandInId,
              ownerId: secondOwnerId,
            },
          ],
        },
        { enqueueReply },
      ),
    ).rejects.toThrow("provider_unavailable");

    expect(enqueueReply).toHaveBeenCalledTimes(2);
    expect(enqueueReply).toHaveBeenLastCalledWith(
      SESSION_PRINCIPAL_ID,
      "019f9f20-0000-7000-8000-000000000099",
      "019f9f20-0000-7000-8000-000000000098",
      secondOwnerId,
    );
  });

  it("renders one personal Stand-in and hides legacy canonical Stand-in rows", () => {
    const personal = payload("stand_in", "Session Member 的替身", "1");
    const legacy = payload("stand_in", "Legacy generic Stand-in", "2");
    const direct = payload("human_direct", "Development Member", "3");
    const merged = mergeCommunicationItems(
      personal,
      [legacy, direct],
      [],
      true,
    );

    expect(merged.filter((item) => item.thread.kind === "stand_in")).toEqual([
      personal,
    ]);
    expect(merged).toContain(direct);
  });
});

function payload(
  kind: ThreadPayload["thread"]["kind"],
  title: string,
  idSuffix: string,
): ThreadPayload {
  return {
    thread: {
      id: `019f9f20-0000-7000-8000-00000000000${idSuffix}`,
      kind,
      title,
      participantIds: [SESSION_PRINCIPAL_ID],
      standInIds: [],
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      sequence: 0,
      createdAt: "2026-07-27T00:00:00.000Z",
    },
    messages: [],
    principals: [],
    actions: [],
  } as unknown as ThreadPayload;
}
