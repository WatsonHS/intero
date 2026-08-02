import {
  type OrganizationId,
  type PilotStandInExchange,
  type PrincipalId,
  type ProjectId,
  type ThreadId,
  uuidv7,
} from "@intero/domain";
import { describe, expect, it, vi } from "vitest";

import type {
  ModelGateway,
  StandInQuestionInput,
} from "../../server-api/src/pilot-ports.js";
import type { PilotStore } from "../../server-api/src/pilot-store.js";
import type { PlatformStore } from "../../server-api/src/platform-store.js";
import {
  PostgresStandInQuestionRepository,
  StandInQuestionHandler,
} from "./stand-in-questions.js";

const ORGANIZATION_ID =
  "019b5ac0-7600-7000-8000-000000000001" as OrganizationId;
const PROJECT_ID = "019b5ac0-7600-7000-8000-000000000011" as ProjectId;
const OWNER_ID = "019b5ac0-7600-7000-8000-000000000021" as PrincipalId;
const ASKER_ID = "019b5ac0-7600-7000-8000-000000000022" as PrincipalId;

describe("StandInQuestionHandler", () => {
  it("completes a recovered job whose durable reply is already complete", async () => {
    const jobId = uuidv7();
    const repository = {
      claimJob: vi.fn(async () => ({
        status: "claimed" as const,
        job: {
          id: jobId,
          threadId: uuidv7() as ThreadId,
          projectId: PROJECT_ID,
          standInOwnerId: OWNER_ID,
          standInOwnerDisplayName: "Owner",
          askedByPrincipalId: ASKER_ID,
          questionMessageId: uuidv7(),
          answerMessageId: uuidv7(),
          question: "What is the current status?",
          preferredLanguage: "en-US" as const,
          recordExchange: false,
          answerStreamState: "complete" as const,
        },
      })),
      completeJob: vi.fn(async () => undefined),
      failJob: vi.fn(async () => undefined),
    } as unknown as PostgresStandInQuestionRepository;
    const pilotStore = {
      listProjects: vi.fn(),
    } as unknown as PilotStore;
    const model = {
      answerStandInQuestion: vi.fn(),
    } as unknown as ModelGateway;
    const handler = new StandInQuestionHandler(
      repository,
      pilotStore,
      {} as PlatformStore,
      model,
      ORGANIZATION_ID,
    );

    await handler.handle(
      {
        schemaVersion: 2,
        organizationId: ORGANIZATION_ID,
        jobId,
        projectId: PROJECT_ID,
      },
      { workerId: "worker-1", attempt: 2, maxAttempts: 8 },
    );

    expect(repository.completeJob).toHaveBeenCalledWith(jobId);
    expect(pilotStore.listProjects).not.toHaveBeenCalled();
    expect(model.answerStandInQuestion).not.toHaveBeenCalled();
  });

  it("answers a projectless group mention in its originating Thread without requiring Work State", async () => {
    const jobId = uuidv7();
    const threadId = uuidv7() as ThreadId;
    const questionMessageId = uuidv7();
    const answerMessageId = uuidv7();
    const repository = {
      claimJob: vi.fn(async () => ({
        status: "claimed" as const,
        job: {
          id: jobId,
          threadId,
          standInOwnerId: OWNER_ID,
          standInOwnerDisplayName: "Owner",
          askedByPrincipalId: ASKER_ID,
          questionMessageId,
          answerMessageId,
          question: "@Owner's Stand-in What is the current status?",
          preferredLanguage: "en-US" as const,
          recordExchange: false,
        },
      })),
      completeJob: vi.fn(async () => undefined),
      failJob: vi.fn(async () => undefined),
    } as unknown as PostgresStandInQuestionRepository;
    const recordStandInExchange = vi.fn();
    const pilotStore = {
      listProjects: vi.fn(),
      listStandInExchanges: vi.fn(async () => []),
      listTeamPulse: vi.fn(async () => []),
      recordStandInExchange,
    } as unknown as PilotStore;
    const updateMessageStream = vi.fn(async () => ({}));
    const conversations = {
      updateMessageStream,
      appendMessage: vi.fn(async () => ({})),
    } as unknown as PlatformStore;
    const answerStandInQuestion = vi.fn(
      async (_input: StandInQuestionInput) => ({
        answer: "No structured Work State has been published for this member.",
        currentStatus: "No published structured Work State.",
        completedOutcome: "",
        evidence: [],
        nextStep: "Ask the member to publish a project update.",
        neededCollaboration: "",
        sourceWorkStateIds: [],
      }),
    );
    const model = {
      generateStandInOutput: vi.fn(),
      answerStandInQuestion,
    } as unknown as ModelGateway;
    const handler = new StandInQuestionHandler(
      repository,
      pilotStore,
      conversations,
      model,
      ORGANIZATION_ID,
    );

    await handler.handle(
      {
        schemaVersion: 3,
        organizationId: ORGANIZATION_ID,
        jobId,
      },
      { workerId: "worker-1", attempt: 1, maxAttempts: 8 },
    );

    expect(answerStandInQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "What is the current status?",
        sources: [],
      }),
    );
    expect(answerStandInQuestion.mock.calls[0]?.[0]).not.toHaveProperty(
      "project",
    );
    expect(pilotStore.listProjects).not.toHaveBeenCalled();
    expect(recordStandInExchange).not.toHaveBeenCalled();
    expect(updateMessageStream).toHaveBeenLastCalledWith({
      threadId,
      messageId: answerMessageId,
      senderId: expect.any(String),
      body: "No structured Work State has been published for this member.",
      streamState: "complete",
    });
    expect(repository.completeJob).toHaveBeenCalledWith(jobId);
  });

  it("replays the stored exchange answer when a model retry drifts", async () => {
    const jobId = uuidv7();
    const threadId = uuidv7() as ThreadId;
    const questionMessageId = uuidv7();
    const answerMessageId = uuidv7();
    const workStateId = uuidv7();
    const createdAt = "2026-07-28T08:00:00.000Z";
    const order: string[] = [];
    const exchange: PilotStandInExchange = {
      id: jobId,
      questionMessageId,
      answerMessageId,
      projectId: PROJECT_ID,
      principalId: OWNER_ID,
      askedByPrincipalId: ASKER_ID,
      question: "What changed?",
      answer: "The answer persisted by the first attempt.",
      structuredAnswer: {
        answer: "The answer persisted by the first attempt.",
        currentStatus: "Ready",
        completedOutcome: "Migration completed",
        evidence: ["Validation passed"],
        nextStep: "Deploy",
        neededCollaboration: "",
      },
      sources: [
        {
          workStateId,
          title: "Realtime migration",
          eventType: "work_progressed",
          summary: "Migration completed",
          narrative: {
            currentFocus: "Ready",
            completedOutcome: "Migration completed",
            evidence: ["Validation passed"],
            nextStep: "Deploy",
            collaboration: { needed: false, request: "", requestedFrom: "" },
          },
          freshnessAt: createdAt,
          provenance: {
            source: "direct_cloud_mcp",
            client: "codex",
            connectionName: "Codex",
            occurredAt: createdAt,
          },
        },
      ],
      createdAt,
    };
    const repository = {
      claimJob: vi.fn(async () => ({
        status: "claimed" as const,
        job: {
          id: jobId,
          threadId,
          projectId: PROJECT_ID,
          standInOwnerId: OWNER_ID,
          standInOwnerDisplayName: "Owner",
          askedByPrincipalId: ASKER_ID,
          questionMessageId,
          answerMessageId,
          question: "What changed?",
          preferredLanguage: "en-US" as const,
          recordExchange: true,
        },
      })),
      completeJob: vi.fn(async () => undefined),
      failJob: vi.fn(async () => undefined),
    } as unknown as PostgresStandInQuestionRepository;
    const pilotStore = {
      listProjects: vi.fn(async () => [
        {
          id: PROJECT_ID,
          organizationId: ORGANIZATION_ID,
          name: "Intero",
          posture: "collaborative",
        },
      ]),
      listStandInExchanges: vi.fn(async () => [exchange]),
      listTeamPulse: vi.fn(async () => [
        {
          ...exchange.sources[0],
          id: uuidv7(),
          projectId: PROJECT_ID,
          ownerId: OWNER_ID,
          phase: "implementing",
        },
      ]),
      listCoordination: vi.fn(async () => []),
      recordStandInExchange: vi.fn(async () => {
        order.push("exchange");
        return exchange;
      }),
    } as unknown as PilotStore;
    const appendMessage = vi.fn(async () => {
      order.push("message");
      return {};
    });
    const conversations = {
      appendMessage,
    } as unknown as PlatformStore;
    const model = {
      generateStandInOutput: vi.fn(),
      answerStandInQuestion: vi.fn(async () => ({
        answer: "A different answer generated by the retry.",
        currentStatus: "Ready",
        completedOutcome: "Migration completed",
        evidence: "Validation passed",
        nextStep: "Deploy",
        neededCollaboration: "",
        sourceWorkStateIds: [workStateId],
      })),
    } as unknown as ModelGateway;

    const handler = new StandInQuestionHandler(
      repository,
      pilotStore,
      conversations,
      model,
      ORGANIZATION_ID,
    );
    await handler.handle(
      {
        schemaVersion: 1,
        organizationId: ORGANIZATION_ID,
        jobId,
        projectId: PROJECT_ID,
      },
      { workerId: "worker-1", attempt: 2, maxAttempts: 8 },
    );

    expect(order).toEqual(["exchange", "message"]);
    expect(appendMessage).toHaveBeenCalledWith(
      threadId,
      expect.objectContaining({
        id: answerMessageId,
        body: exchange.answer,
        createdAt: exchange.createdAt,
      }),
    );
  });
});
