import {
  type PilotCoordinationThread,
  PrincipalId,
  ProjectId,
} from "@intero/domain";
import { describe, expect, it } from "vitest";

import {
  confirmedCoordinationContext,
  normalizeStandInQuestion,
} from "./stand-in-question-context.js";

describe("Stand-in question context", () => {
  it("separates a leading UI address from the semantic question", () => {
    expect(
      normalizeStandInQuestion({
        question: "@盛 的替身 hi",
        standInOwnerDisplayName: "盛",
        preferredLanguage: "zh-CN",
      }),
    ).toBe("hi");
  });

  it("turns an inline address into a second-person reference", () => {
    expect(
      normalizeStandInQuestion({
        question: "请问 @盛 的替身，你下一步准备做什么？",
        standInOwnerDisplayName: "盛",
        preferredLanguage: "zh-CN",
      }),
    ).toBe("请问 你，你下一步准备做什么？");
  });

  it("treats a bare address as a greeting", () => {
    expect(
      normalizeStandInQuestion({
        question: "@Alex's Stand-in",
        standInOwnerDisplayName: "Alex",
        preferredLanguage: "en-US",
      }),
    ).toBe("Hello");
  });

  it("exposes only human-confirmed decisions to an affected Stand-in", () => {
    const ownerId = PrincipalId.parse("019fc100-0000-7000-8000-000000000001");
    const projectId = ProjectId.parse("019fc100-0000-7000-8000-000000000002");
    const resolved = coordination({ ownerId, projectId });
    expect(confirmedCoordinationContext([resolved], ownerId)).toEqual([
      {
        coordinationThreadId: resolved.id,
        decisionId: resolved.decisionId,
        projectIds: [projectId],
        boundaryKey: "api:accounts.v1",
        outcome: "Keep account_id during the compatibility window.",
        decidedBy: [ownerId],
        confirmedAt: "2026-08-01T08:05:00.000Z",
      },
    ]);
    expect(
      confirmedCoordinationContext(
        [{ ...resolved, status: "needs_confirmation" }],
        ownerId,
      ),
    ).toEqual([]);
    expect(
      confirmedCoordinationContext(
        [resolved],
        PrincipalId.parse("019fc100-0000-7000-8000-000000000003"),
      ),
    ).toEqual([]);
  });
});

function coordination(input: {
  ownerId: PrincipalId;
  projectId: ProjectId;
}): PilotCoordinationThread {
  return {
    id: "019fc100-0000-7000-8000-000000000004",
    projectId: input.projectId,
    projectIds: [input.projectId],
    trigger: "work_state_conflict",
    boundaryKey: "api:accounts.v1",
    participantIds: [input.ownerId],
    safeContext: "The active Claims conflict.",
    candidateNextSteps: [],
    status: "resolved",
    conclusion: "Keep account_id during the compatibility window.",
    decisionId: "019fc100-0000-7000-8000-000000000005",
    confirmedAt: "2026-08-01T08:05:00.000Z",
    brief: {
      headline: "Accounts boundary conflict",
      whatChanged: "The producer removes account_id.",
      whyItMatters: "The consumer still requires account_id.",
      needsFromYou: "",
      scope: { kind: "single_project", projectIds: [input.projectId] },
      facts: [],
      interpretations: [],
      options: [],
      humanDecision: {
        outcome: "Keep account_id during the compatibility window.",
        decidedBy: [input.ownerId],
        confirmedAt: "2026-08-01T08:05:00.000Z",
      },
      freshnessAt: "2026-08-01T08:05:00.000Z",
    },
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T08:05:00.000Z",
  };
}
