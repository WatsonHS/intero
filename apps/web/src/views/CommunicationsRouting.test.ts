import { PrincipalId, type PilotProject } from "@intero/domain";
import { describe, expect, it, vi } from "vitest";

import {
  applyConversationMention,
  applyPersonalStandInMention,
  canRenderCommunicationItems,
  conversationMentionCandidates,
  conversationMentionQuery,
  filterConversationMentionCandidates,
  mentionedStandIns,
  mergeCommunicationItems,
  personalStandInMentionCandidates,
  personalStandInMentionQuery,
  prepareConversationStandIns,
  requestConversationStandInReplies,
  resolvePilotCommunicationPrincipal,
  sendCanonicalConversationMessage,
  shouldSubmitComposerKey,
  splitConversationMentions,
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
        needsJoin: false,
      },
    ]);
  });

  it("marks a participant's not-yet-joined Stand-in for an access transition", () => {
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
        needsJoin: true,
      },
    ]);
  });

  it("adds an addressed Stand-in before the triggering group message", async () => {
    const threadId = "019f9f20-0000-7000-8000-000000000099";
    const standInId = PrincipalId.parse("019f9f20-0000-5000-8000-000000000002");
    const addStandIn = vi.fn(async () => undefined);

    await prepareConversationStandIns(
      {
        threadId,
        senderId: SESSION_PRINCIPAL_ID,
        mentionedStandIns: [
          {
            principalId: standInId,
            ownerId: DEV_PRINCIPAL_ID,
            needsJoin: true,
          },
        ],
      },
      { addStandIn },
    );

    expect(addStandIn).toHaveBeenCalledWith({
      threadId,
      standInId,
      actorId: SESSION_PRINCIPAL_ID,
    });
  });

  it("persists the access transition before the message that addresses a new Stand-in", async () => {
    const threadId = "019f9f20-0000-7000-8000-000000000099";
    const standInId = PrincipalId.parse("019f9f20-0000-5000-8000-000000000002");
    const calls: string[] = [];

    await sendCanonicalConversationMessage(
      {
        threadId,
        senderId: SESSION_PRINCIPAL_ID,
        body: "@Development Member 的替身 请同步。",
        mentionedStandIns: [
          {
            principalId: standInId,
            ownerId: DEV_PRINCIPAL_ID,
            needsJoin: true,
          },
        ],
      },
      {
        addStandIn: async () => {
          calls.push("join");
        },
        sendMessage: async () => {
          calls.push("send");
        },
      },
    );

    expect(calls).toEqual(["join", "send"]);
  });

  it("answers a group mention separately and writes only the reply back", async () => {
    const threadId = "019f9f20-0000-7000-8000-000000000099";
    const standInId = PrincipalId.parse("019f9f20-0000-5000-8000-000000000002");
    const calls: string[] = [];
    const sendMessage = vi.fn(
      async (input: { senderId: string; body: string }) => {
        calls.push(`send:${input.senderId}:${input.body}`);
      },
    );
    const answerStandIn = vi.fn(async () => {
      calls.push("answer");
      return {
        answer: "当前状态已同步。",
        standIn: { id: standInId },
      };
    });

    await requestConversationStandInReplies(
      {
        threadId,
        senderId: SESSION_PRINCIPAL_ID,
        body: "@Development Member 的替身 当前进度如何？",
        projectId: "019f9f20-0000-7000-8000-000000000088",
        mentionedStandIns: [
          {
            principalId: standInId,
            ownerId: DEV_PRINCIPAL_ID,
            needsJoin: false,
          },
        ],
      },
      { sendMessage, answerStandIn },
    );

    expect(calls).toEqual(["answer", `send:${standInId}:当前状态已同步。`]);
    expect(answerStandIn).toHaveBeenCalledWith(
      SESSION_PRINCIPAL_ID,
      "019f9f20-0000-7000-8000-000000000088",
      DEV_PRINCIPAL_ID,
      "@Development Member 的替身 当前进度如何？",
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
    const sendMessage = vi.fn(async () => undefined);
    const answerStandIn = vi.fn(
      async (
        _identityId: PrincipalId,
        _projectId: string,
        ownerId: PrincipalId,
      ) => {
        if (ownerId === DEV_PRINCIPAL_ID)
          throw new Error("provider_unavailable");
        return {
          answer: "第二个替身已回复。",
          standIn: { id: secondStandInId },
        };
      },
    );

    await expect(
      requestConversationStandInReplies(
        {
          threadId: "019f9f20-0000-7000-8000-000000000099",
          senderId: SESSION_PRINCIPAL_ID,
          body: "请两个替身分别同步。",
          projectId: "019f9f20-0000-7000-8000-000000000088",
          mentionedStandIns: [
            {
              principalId: firstStandInId,
              ownerId: DEV_PRINCIPAL_ID,
              needsJoin: false,
            },
            {
              principalId: secondStandInId,
              ownerId: secondOwnerId,
              needsJoin: false,
            },
          ],
        },
        { sendMessage, answerStandIn },
      ),
    ).rejects.toThrow("provider_unavailable");

    expect(answerStandIn).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledWith({
      threadId: "019f9f20-0000-7000-8000-000000000099",
      senderId: secondStandInId,
      body: "第二个替身已回复。",
    });
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
