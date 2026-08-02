import {
  interoResponseMessageId,
  ProjectId,
  type ThreadId,
} from "@intero/domain";
import { describe, expect, it, vi } from "vitest";

import {
  createGoldenCaseFixture,
  GOLDEN_CASE_IDS,
} from "./test-fixtures/golden-case.js";
import { CoordinationKernel } from "./coordination-kernel.js";
import type { InteroProseInput } from "./pilot-ports.js";
import { InMemoryPlatformStore } from "./store.js";

describe("Golden Case Intero request", () => {
  it("keeps the compatible control to one explicit answer and no coordination artifacts", async () => {
    const fixture = await createGoldenCaseFixture({
      classification: "compatible",
    });
    await fixture.sendSourceMessage(
      "@Intero compare Auth Platform and Mobile App on retryDelayMs.",
    );
    const request = await fixture.pilotStore.getInteroRequestBySourceMessage(
      GOLDEN_CASE_IDS.sourceMessage,
    );
    expect(request).toMatchObject({
      status: "answered",
      scopeResolution: {
        kind: "cross_project",
        projectIds: [
          GOLDEN_CASE_IDS.authProject,
          GOLDEN_CASE_IDS.mobileProject,
        ],
      },
    });
    expect(
      await fixture.pilotStore.listCoordination(
        GOLDEN_CASE_IDS.authProject,
        GOLDEN_CASE_IDS.alex,
      ),
    ).toEqual([]);
    expect(
      fixture.conversations.listThreads("coordination", GOLDEN_CASE_IDS.alex),
    ).toEqual([]);
    const room = fixture.conversations.getThread(
      GOLDEN_CASE_IDS.room,
      GOLDEN_CASE_IDS.alex,
    )!;
    expect(
      room.messages.filter((message) => message.senderId === fixture.interoId),
    ).toHaveLength(1);
  });

  it("materializes one cross-Project case, child discussion, and layered Intero entry", async () => {
    const fixture = await createGoldenCaseFixture();
    const source = await fixture.sendSourceMessage(
      "@Intero coordinate Auth Platform and Mobile App on retryDelayMs.",
    );
    const request = await fixture.pilotStore.getInteroRequestBySourceMessage(
      source.id,
    );
    expect(request).toMatchObject({
      status: "answered",
      scopeResolution: { kind: "cross_project" },
    });
    const coordination = (
      await fixture.pilotStore.listCoordination(
        GOLDEN_CASE_IDS.authProject,
        GOLDEN_CASE_IDS.alex,
      )
    )[0]!;
    expect(coordination).toMatchObject({
      teamId: GOLDEN_CASE_IDS.team,
      scopeKind: "cross_project",
      projectIds: [GOLDEN_CASE_IDS.authProject, GOLDEN_CASE_IDS.mobileProject],
      sourceRoomThreadId: GOLDEN_CASE_IDS.room,
      sourceMessageId: GOLDEN_CASE_IDS.sourceMessage,
      interoRequestId: request!.id,
      interoPrincipalId: fixture.interoId,
      brief: {
        scope: { kind: "cross_project" },
        facts: expect.arrayContaining([
          expect.objectContaining({ value: "retryDelayMs" }),
        ]),
      },
    });
    const child = fixture.conversations.getThread(
      coordination.conversationThreadId! as ThreadId,
      GOLDEN_CASE_IDS.alex,
    )!;
    expect(child.thread).toMatchObject({
      kind: "coordination",
      parentThreadId: GOLDEN_CASE_IDS.room,
      teamId: GOLDEN_CASE_IDS.team,
    });
    expect(child.thread.participantIds).toContain(fixture.interoId);
    expect(child.messages[0]).toMatchObject({ senderId: fixture.interoId });

    const room = fixture.conversations.getThread(
      GOLDEN_CASE_IDS.room,
      GOLDEN_CASE_IDS.alex,
    )!;
    const summaries = room.messages.filter(
      (message) => message.kind === "coordination_summary",
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: interoResponseMessageId(GOLDEN_CASE_IDS.sourceMessage),
      senderId: fixture.interoId,
      revision: 1,
      coordinationSummary: {
        interoRequestId: request!.id,
        scope: { kind: "cross_project" },
        brief: { headline: expect.stringContaining("retry") },
      },
    });

    await fixture.sendSourceMessage(
      "@Intero coordinate Auth Platform and Mobile App on retryDelayMs.",
    );
    expect(
      fixture.conversations.listThreads("coordination", GOLDEN_CASE_IDS.alex),
    ).toHaveLength(1);
    expect(
      fixture.conversations
        .getThread(GOLDEN_CASE_IDS.room, GOLDEN_CASE_IDS.alex)!
        .messages.filter((message) => message.kind === "coordination_summary"),
    ).toHaveLength(1);
  });

  it("uses provider prose only after deterministic scope and conflict evaluation", async () => {
    const providerProse = {
      headline: "Provider: retry contract conflict",
      scopeExplanation:
        "Auth Platform and Mobile App are the authorized scope.",
      whatChanged: "The producer is replacing retryDelayMs.",
      whyItMatters: "The consumer still depends on retryDelayMs.",
      needsFromYou: "Confirm a compatibility window.",
    };
    const generateInteroProse = vi.fn(
      async (_input: InteroProseInput) => providerProse,
    );
    const fixture = await createGoldenCaseFixture({
      proseGateway: { generateInteroProse },
    });

    await fixture.sendSourceMessage(
      "@Intero coordinate Auth Platform and Mobile App on retryDelayMs.",
    );

    expect(generateInteroProse).toHaveBeenCalledOnce();
    const providerInput = generateInteroProse.mock.calls[0]![0];
    expect(providerInput).toMatchObject({
      organizationId: GOLDEN_CASE_IDS.organization,
      preferredLanguage: "en-US",
      scope: {
        kind: "cross_project",
        projects: [
          { id: GOLDEN_CASE_IDS.authProject, name: "Auth Platform" },
          { id: GOLDEN_CASE_IDS.mobileProject, name: "Mobile App" },
        ],
      },
      evaluation: {
        classification: "potential_conflict",
        boundaryKey: "api:retry-config/retrydelayms",
      },
    });
    expect(providerInput.evaluation.facts).toHaveLength(2);
    expect(JSON.stringify(providerInput)).not.toContain("@Intero");

    const coordination = (
      await fixture.pilotStore.listCoordination(
        GOLDEN_CASE_IDS.authProject,
        GOLDEN_CASE_IDS.alex,
      )
    )[0]!;
    expect(coordination).toMatchObject({
      projectIds: [GOLDEN_CASE_IDS.authProject, GOLDEN_CASE_IDS.mobileProject],
      brief: {
        headline: providerProse.headline,
        proseSource: "provider",
        interpretations: [
          { statement: providerProse.scopeExplanation, confidence: "high" },
          expect.any(Object),
        ],
      },
    });
  });

  it("falls back deterministically when provider prose is unavailable", async () => {
    const generateInteroProse = vi.fn(async (_input: InteroProseInput) => {
      throw new Error("provider unavailable");
    });
    const fixture = await createGoldenCaseFixture({
      proseGateway: { generateInteroProse },
    });
    await fixture.triggerProactiveConflict();

    await expect(
      fixture.sendSourceMessage(
        "@Intero 请协调 Auth Platform 和 Mobile App 的 retryDelayMs。",
      ),
    ).resolves.toBeDefined();

    const coordination = (
      await fixture.pilotStore.listCoordination(
        GOLDEN_CASE_IDS.authProject,
        GOLDEN_CASE_IDS.alex,
      )
    )[0]!;
    expect(coordination.brief).toMatchObject({
      headline: "api:retry-config/retrydelayms 可能存在冲突",
      proseSource: "deterministic_fallback",
    });
    expect(
      fixture.conversations.listThreads("coordination", GOLDEN_CASE_IDS.alex),
    ).toHaveLength(1);
  });

  it("asks once for ambiguous scope and corrects the same request and Room entry", async () => {
    const fixture = await createGoldenCaseFixture();
    await fixture.sendSourceMessage("@Intero can you check this?");
    const ambiguous = await fixture.pilotStore.getInteroRequestBySourceMessage(
      GOLDEN_CASE_IDS.sourceMessage,
    );
    expect(ambiguous).toMatchObject({
      status: "needs_scope",
      scopeRevision: 1,
      scopeResolution: { kind: "ambiguous" },
    });
    const before = fixture.conversations
      .getThread(GOLDEN_CASE_IDS.room, GOLDEN_CASE_IDS.alex)!
      .messages.find((message) => message.kind === "coordination_summary")!;

    await fixture.service.correctScope({
      requestId: ambiguous!.id,
      principalId: GOLDEN_CASE_IDS.alex,
      projectIds: [GOLDEN_CASE_IDS.authProject, GOLDEN_CASE_IDS.mobileProject],
      now: "2026-08-01T08:05:00.000Z",
    });
    const corrected = await fixture.pilotStore.getInteroRequest(ambiguous!.id);
    expect(corrected).toMatchObject({
      status: "answered",
      scopeRevision: 2,
      scopeResolution: { kind: "cross_project" },
    });
    const summaries = fixture.conversations
      .getThread(GOLDEN_CASE_IDS.room, GOLDEN_CASE_IDS.alex)!
      .messages.filter((message) => message.kind === "coordination_summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ id: before.id, revision: 2 });
    expect(
      fixture.conversations.listThreads("coordination", GOLDEN_CASE_IDS.alex),
    ).toHaveLength(1);
  });

  it("opens one proactive Team-Room conflict and upgrades the same brief with later provider prose", async () => {
    const generateInteroProse = vi.fn(async (_input: InteroProseInput) => ({
      headline: "Provider-upgraded retry conflict",
      scopeExplanation: "Both authorized Projects are affected.",
      whatChanged: "The retry contract changed.",
      whyItMatters: "The consumer still uses the old field.",
      needsFromYou: "Confirm the migration window.",
    }));
    const fixture = await createGoldenCaseFixture({
      proseGateway: { generateInteroProse },
    });
    const unrelatedProjectId = ProjectId.parse(
      "019fc000-0000-7000-8000-000000000014",
    );
    await fixture.pilotStore.createProject({
      id: unrelatedProjectId,
      organizationId: GOLDEN_CASE_IDS.organization,
      name: "Unrelated Team project",
      ownerId: GOLDEN_CASE_IDS.alex,
      primaryTeamId: GOLDEN_CASE_IDS.team,
      participatingTeamIds: [GOLDEN_CASE_IDS.team],
      posture: "collaborative",
      createdAt: "2026-08-01T08:00:00.000Z",
      updatedAt: "2026-08-01T08:00:00.000Z",
    });
    const proactive = await fixture.triggerProactiveConflict();
    expect(proactive).toHaveLength(1);
    expect(proactive[0]).toMatchObject({
      scopeKind: "cross_project",
      projectIds: [GOLDEN_CASE_IDS.authProject, GOLDEN_CASE_IDS.mobileProject],
      sourceRoomThreadId: GOLDEN_CASE_IDS.room,
      interoPrincipalId: fixture.interoId,
    });
    expect(proactive[0]!.sourceMessageId).toBeUndefined();
    const firstSummary = fixture.conversations
      .getThread(GOLDEN_CASE_IDS.room, GOLDEN_CASE_IDS.alex)!
      .messages.find((message) => message.kind === "coordination_summary")!;

    await fixture.sendSourceMessage(
      "@Intero coordinate Auth Platform and Mobile App on retryDelayMs.",
    );

    const coordination = await fixture.pilotStore.listCoordination(
      GOLDEN_CASE_IDS.authProject,
      GOLDEN_CASE_IDS.alex,
    );
    expect(coordination).toHaveLength(1);
    expect(coordination[0]).toMatchObject({
      id: proactive[0]!.id,
      sourceMessageId: GOLDEN_CASE_IDS.sourceMessage,
      interoRequestId: expect.any(String),
      summaryMessageId: firstSummary.id,
      brief: {
        headline: "Provider-upgraded retry conflict",
        proseSource: "provider",
      },
    });
    expect(generateInteroProse).toHaveBeenCalledOnce();
    expect(
      fixture.conversations
        .getThread(GOLDEN_CASE_IDS.room, GOLDEN_CASE_IDS.alex)!
        .messages.filter((message) => message.kind === "coordination_summary"),
    ).toHaveLength(1);
  });

  it("does not guess a public destination when no eligible Team Room exists", async () => {
    const fixture = await createGoldenCaseFixture();
    const conversationsWithoutRooms = new InMemoryPlatformStore();
    const kernelWithoutRooms = new CoordinationKernel(
      fixture.pilotStore,
      conversationsWithoutRooms,
    );

    await expect(
      fixture.triggerProactiveConflict(kernelWithoutRooms),
    ).resolves.toEqual([]);
    expect(
      conversationsWithoutRooms.listThreads(
        "coordination",
        GOLDEN_CASE_IDS.alex,
      ),
    ).toEqual([]);
  });

  it("closes the same path without a false Decision when corrected evidence clears the conflict", async () => {
    const fixture = await createGoldenCaseFixture();
    await fixture.sendSourceMessage(
      "@Intero coordinate Auth Platform and Mobile App on retryDelayMs.",
    );
    const before = (
      await fixture.pilotStore.listCoordination(
        GOLDEN_CASE_IDS.authProject,
        GOLDEN_CASE_IDS.alex,
      )
    )[0]!;
    const beforeSummary = fixture.conversations
      .getThread(GOLDEN_CASE_IDS.room, GOLDEN_CASE_IDS.alex)!
      .messages.find((message) => message.kind === "coordination_summary")!;

    const reconciled = await fixture.correctConflictWithCompatibleEvidence();

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      id: before.id,
      conversationThreadId: before.conversationThreadId,
      summaryMessageId: before.summaryMessageId,
      status: "resolved",
      conclusion: expect.stringContaining(
        "Current authorized evidence no longer supports",
      ),
      brief: {
        headline: expect.stringContaining("Conflict cleared"),
      },
    });
    expect(reconciled[0]).not.toHaveProperty("decisionId");
    expect(reconciled[0]!.brief).not.toHaveProperty("humanDecision");
    expect(
      fixture.conversations.getThread(
        before.conversationThreadId! as ThreadId,
        GOLDEN_CASE_IDS.alex,
      )!.thread.concludedAt,
    ).toBe("2026-08-01T08:20:00.000Z");
    const summaries = fixture.conversations
      .getThread(GOLDEN_CASE_IDS.room, GOLDEN_CASE_IDS.alex)!
      .messages.filter((message) => message.kind === "coordination_summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: beforeSummary.id,
      revision: (beforeSummary.revision ?? 1) + 1,
      coordinationSummary: {
        status: "resolved",
        actionRequired: false,
        conclusion: expect.stringContaining(
          "Current authorized evidence no longer supports",
        ),
      },
    });
    expect(fixture.conversations.listDecisions()).toEqual([]);
    expect(
      await fixture.pilotStore.listCoordinationRelevance(
        GOLDEN_CASE_IDS.authProject,
        GOLDEN_CASE_IDS.alex,
      ),
    ).toEqual([
      expect.objectContaining({
        coordinationThreadId: before.id,
        dismissedAt: "2026-08-01T08:20:00.000Z",
      }),
    ]);
  });

  it("withdraws stale evidence and dismisses the original conflict path idempotently", async () => {
    const fixture = await createGoldenCaseFixture();
    await fixture.sendSourceMessage(
      "@Intero coordinate Auth Platform and Mobile App on retryDelayMs.",
    );
    const before = (
      await fixture.pilotStore.listCoordination(
        GOLDEN_CASE_IDS.authProject,
        GOLDEN_CASE_IDS.alex,
      )
    )[0]!;

    const withdrawn = await fixture.withdrawAuthConflictEvidence();

    expect(withdrawn).toMatchObject({
      duplicate: false,
      coordinationThreads: [
        {
          id: before.id,
          status: "resolved",
          conclusion: expect.stringContaining(
            "no longer supported by active authorized evidence",
          ),
        },
      ],
    });
    expect(withdrawn.coordinationThreads[0]).not.toHaveProperty("decisionId");
    expect(fixture.conversations.listDecisions()).toEqual([]);
    expect(
      fixture.conversations.getThread(
        before.conversationThreadId! as ThreadId,
        GOLDEN_CASE_IDS.alex,
      )!.thread.concludedAt,
    ).toBe("2026-08-01T08:26:00.000Z");
    expect(
      fixture.conversations
        .getThread(GOLDEN_CASE_IDS.room, GOLDEN_CASE_IDS.alex)!
        .messages.filter((message) => message.kind === "coordination_summary"),
    ).toHaveLength(1);
  });
});
