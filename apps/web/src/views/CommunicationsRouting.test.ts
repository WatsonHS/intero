import { PrincipalId, type PilotProject } from "@intero/domain";
import { describe, expect, it } from "vitest";

import {
  applyPersonalStandInMention,
  canRenderCommunicationItems,
  mergeCommunicationItems,
  personalStandInMentionCandidates,
  personalStandInMentionQuery,
  resolvePilotCommunicationPrincipal,
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
      participatingTeamIds: [
        "019f9f20-0000-7000-8000-000000000020",
      ],
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
              id: PrincipalId.parse(
                "019f9f20-0000-7000-8000-000000000003",
              ),
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

    expect(
      merged.filter((item) => item.thread.kind === "stand_in"),
    ).toEqual([personal]);
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
