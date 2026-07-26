import {
  ActionEnvelope,
  ConversationThread,
  PrincipalId,
  PublicWorkProjection,
  ThreadMessage,
  type PilotCoordinationThread,
  type PilotDirectMessageThread,
  type PilotPulseEntry,
  type PilotStandInExchange,
  type PilotProject,
} from "@intero/domain";
import { describe, expect, it } from "vitest";

import {
  pilotCoordinationToThreadPayload,
  pilotDmToThreadPayload,
  pilotPulseEntryToProjection,
  pilotStandInToThreadPayload,
} from "./adapters.js";

const IDS = {
  project: "019f0000-0000-7000-8000-000000000001",
  owner: "019f0000-0000-7000-8000-000000000002",
  peer: "019f0000-0000-7000-8000-000000000003",
  standIn: "019f0000-0000-7000-8000-000000000004",
  workState: "019f0000-0000-7000-8000-000000000005",
  pulse: "019f0000-0000-7000-8000-000000000006",
  thread: "019f0000-0000-7000-8000-000000000007",
  message: "019f0000-0000-7000-8000-000000000008",
  binding: "019f0000-0000-7000-8000-000000000009",
  team: "019f0000-0000-7000-8000-000000000010",
  question: "019f0000-0000-7000-8000-000000000011",
  answer: "019f0000-0000-7000-8000-000000000012",
} as const;
const NOW = "2026-07-25T12:00:00.000Z";
const NARRATIVE = {
  currentFocus: "Preparing the billing export for finance review.",
  completedOutcome: "Generated the first complete billing CSV.",
  evidence: ["12,480 invoice rows exported in staging."],
  nextStep: "Confirm the reconciliation column names.",
  collaboration: {
    needed: true,
    request: "Review the tax and status columns.",
    requestedFrom: "Finance",
  },
};

describe("pilot renderer adapters", () => {
  it("maps a safe pulse entry into the canonical workstream contract", () => {
    const entry: PilotPulseEntry = {
      id: IDS.pulse,
      projectId: IDS.project as PilotPulseEntry["projectId"],
      workStateId: IDS.workState,
      ownerId: PrincipalId.parse(IDS.owner),
      title: "Agent connection validation",
      phase: "validating",
      eventType: "validation_completed",
      summary: "The structured checkpoint path is ready.",
      narrative: NARRATIVE,
      freshnessAt: NOW,
      provenance: {
        source: "direct_cloud_mcp",
        client: "codex",
        connectionName: "Codex · intero",
        clientEventId: "connection-check-0001",
        occurredAt: NOW,
        receivedAt: NOW,
      },
      publishedAt: NOW,
    };

    expect(() =>
      PublicWorkProjection.parse(pilotPulseEntryToProjection(entry)),
    ).not.toThrow();
  });

  it("maps participant-only DMs without removing canonical thread semantics", () => {
    const thread: PilotDirectMessageThread = {
      id: IDS.thread,
      teamId: IDS.team,
      participantIds: [
        PrincipalId.parse(IDS.owner),
        PrincipalId.parse(IDS.peer),
      ],
      sequence: 0,
      createdAt: NOW,
    };
    const payload = pilotDmToThreadPayload(
      { thread, messages: [] },
      [
        {
          id: IDS.owner,
          displayName: "Intero User",
          kind: "human",
        },
        { id: IDS.peer, displayName: "Morgan Chen", kind: "human" },
      ],
      IDS.owner,
    );

    expect(payload.thread.title).toBe("Morgan Chen");
    expect(() => ConversationThread.parse(payload.thread)).not.toThrow();
  });

  it("maps bounded pilot coordination into canonical detail contracts", () => {
    const coordination: PilotCoordinationThread = {
      id: IDS.thread,
      projectId: IDS.project as PilotCoordinationThread["projectId"],
      workStateId: IDS.workState,
      trigger: "blocker_raised",
      sourceBindingId: IDS.binding,
      participantIds: [PrincipalId.parse(IDS.owner)],
      safeContext: "The API contract needs a responsible confirmation.",
      candidateNextSteps: ["Confirm the reversible boundary."],
      status: "open",
      createdAt: NOW,
      updatedAt: NOW,
    };
    const payload = pilotCoordinationToThreadPayload(
      coordination,
      [{ id: IDS.owner, displayName: "Intero User", kind: "human" }],
      {
        id: IDS.standIn,
        displayName: "Intero Stand-in",
        kind: "stand_in",
      },
    );

    expect(() => ConversationThread.parse(payload.thread)).not.toThrow();
    expect(() => ThreadMessage.parse(payload.messages[0])).not.toThrow();
    expect(() =>
      ActionEnvelope.parse(payload.actions[0]!.envelope),
    ).not.toThrow();
  });

  it("maps grounded Stand-in exchanges into the canonical conversation", () => {
    const project = {
      id: IDS.project,
      organizationId: IDS.project,
      name: "Intero Pilot",
      ownerId: PrincipalId.parse(IDS.owner),
      primaryTeamId: IDS.team,
      participatingTeamIds: [IDS.team],
      posture: "collaborative",
      createdAt: NOW,
      updatedAt: NOW,
    } as PilotProject;
    const exchange: PilotStandInExchange = {
      id: IDS.thread,
      questionMessageId: IDS.question,
      answerMessageId: IDS.answer,
      projectId: project.id,
      principalId: PrincipalId.parse(IDS.peer),
      question: "What is the status?",
      answer: "The checkpoint path is ready.",
      structuredAnswer: {
        answer: "The checkpoint path is ready.",
        currentStatus: NARRATIVE.currentFocus,
        completedOutcome: NARRATIVE.completedOutcome,
        evidence: [...NARRATIVE.evidence],
        nextStep: NARRATIVE.nextStep,
        neededCollaboration: "Finance should review the columns.",
      },
      sources: [
        {
          workStateId: IDS.workState,
          title: "Agent connection validation",
          eventType: "validation_completed",
          summary: "The checkpoint path is ready.",
          narrative: NARRATIVE,
          freshnessAt: NOW,
          provenance: {
            source: "direct_cloud_mcp",
            client: "codex",
            connectionName: "Codex · intero",
            occurredAt: NOW,
          },
        },
      ],
      createdAt: NOW,
    };
    const payload = pilotStandInToThreadPayload(
      project,
      [exchange],
      { id: IDS.peer, displayName: "Morgan Chen", kind: "human" },
      {
        id: IDS.standIn,
        displayName: "Intero Stand-in",
        kind: "stand_in",
      },
    );

    expect(payload.thread.kind).toBe("stand_in");
    expect(payload.messages).toHaveLength(2);
    expect(payload.messages[1]?.body).toBe("The checkpoint path is ready.");
    expect(() => ConversationThread.parse(payload.thread)).not.toThrow();
  });
});
