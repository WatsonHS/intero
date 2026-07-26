import type {
  CapabilityGrantId,
  MessageId,
  OperationId,
  PilotCoordinationThread,
  PilotDirectMessage,
  PilotDirectMessageThread,
  PilotProject,
  PilotPulseEntry,
  PilotStandInExchange,
  PrincipalId,
  PublicWorkProjection,
  ThreadId,
  WorkstreamId,
} from "@intero/domain";

import type { PrincipalSummary, ThreadPayload } from "../api.js";

export function pilotPulseEntryToProjection(
  entry: PilotPulseEntry,
): PublicWorkProjection {
  const changedFields: PublicWorkProjection["changedFields"] =
    entry.eventType === "work_completed"
      ? ["completed"]
      : entry.eventType === "blocker_raised"
        ? ["blockers"]
        : entry.eventType === "dependency_declared"
          ? ["dependencies"]
          : entry.eventType === "decision_recorded"
            ? ["decisions"]
            : ["phase"];
  return {
    id: entry.workStateId as WorkstreamId,
    projectId: entry.projectId,
    ownerId: entry.ownerId,
    title: entry.title,
    phase: entry.phase,
    blockers: entry.eventType === "blocker_raised" ? [entry.summary] : [],
    dependencies:
      entry.eventType === "dependency_declared" ? [entry.summary] : [],
    decisions: entry.eventType === "decision_recorded" ? [entry.summary] : [],
    artifactIds: [],
    freshnessAt: entry.freshnessAt,
    confidence: 1,
    contradictionClaimIds: [],
    version: 1,
    changedFields,
    projectedAt: entry.publishedAt,
  };
}

export function pilotDmToThreadPayload(
  item: {
    thread: PilotDirectMessageThread;
    messages: PilotDirectMessage[];
  },
  principals: PrincipalSummary[],
  currentIdentityId?: string,
): ThreadPayload {
  const standInIds = item.thread.standInId
    ? [item.thread.standInId]
    : [];
  const participantIds = [...item.thread.participantIds, ...standInIds];
  return {
    thread: {
      id: item.thread.id as ThreadId,
      kind: "human_direct",
      title: directMessageTitle(item.thread, principals, currentIdentityId),
      participantIds,
      standInIds,
      accessMode: "agent_readable",
      ...(item.thread.standInAddedAfterSequence !== undefined
        ? {
            accessChangedAtSequence:
              item.thread.standInAddedAfterSequence + 1,
          }
        : {}),
      priorHistoryGranted: false,
      sequence: item.thread.sequence,
      createdAt: item.thread.createdAt,
    },
    messages: item.messages.map((message) => ({
      id: message.id as MessageId,
      threadId: message.threadId as ThreadId,
      senderId: message.senderId,
      sequence: message.sequence,
      kind: "message",
      body: message.body,
      createdAt: message.createdAt,
      serverReadable: true,
    })),
    principals,
    actions: [],
  };
}

export function pilotStandInToThreadPayload(
  project: PilotProject,
  exchanges: PilotStandInExchange[],
  principal: PrincipalSummary,
  standIn: PrincipalSummary,
): ThreadPayload {
  const threadId = project.id as unknown as ThreadId;
  const principalId = principal.id as PrincipalId;
  const standInId = standIn.id as PrincipalId;
  const messages: ThreadPayload["messages"] = exchanges.flatMap(
    (exchange, index) => [
      {
        id: exchange.questionMessageId as MessageId,
        threadId,
        senderId: principalId,
        sequence: index * 2 + 1,
        kind: "message" as const,
        body: exchange.question,
        createdAt: exchange.createdAt,
        serverReadable: true,
      },
      {
        id: exchange.answerMessageId as MessageId,
        threadId,
        senderId: standInId,
        sequence: index * 2 + 2,
        kind: "message" as const,
        body: exchange.answer,
        createdAt: exchange.createdAt,
        serverReadable: true,
      },
    ],
  );
  return {
    thread: {
      id: threadId,
      kind: "stand_in",
      title: `${project.name} Stand-in`,
      participantIds: [principalId, standInId],
      standInIds: [standInId],
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      sequence: messages.length,
      createdAt: project.createdAt,
    },
    messages,
    principals: [principal, standIn],
    actions: [],
  };
}

export function pilotCoordinationToThreadPayload(
  coordination: PilotCoordinationThread,
  principals: PrincipalSummary[],
  standIn?: PrincipalSummary,
): ThreadPayload {
  const standInIds: PrincipalId[] = standIn
    ? [standIn.id as PrincipalId]
    : [];
  const participantIds = [...coordination.participantIds, ...standInIds];
  const sourceId = coordination.participantIds[0]!;
  const suggestionSenderId =
    (standIn?.id as PrincipalId | undefined) ?? sourceId;
  const operationId = coordination.id as OperationId;
  const threadId = coordination.id as ThreadId;
  const messages: ThreadPayload["messages"] = [
    {
      id: coordination.workStateId as MessageId,
      threadId,
      senderId: sourceId,
      sequence: 1,
      kind: "coordination_action",
      body: coordination.safeContext,
      createdAt: coordination.createdAt,
      serverReadable: true,
      operationId,
    },
    {
      id: coordination.sourceBindingId as MessageId,
      threadId,
      senderId: suggestionSenderId,
      sequence: 2,
      kind: "message",
      body: coordination.candidateNextSteps.join(" · "),
      createdAt: coordination.updatedAt,
      serverReadable: true,
    },
  ];
  if (coordination.conclusion) {
    messages.push({
      id: coordination.id as MessageId,
      threadId,
      senderId:
        coordination.responsibleParticipantId ??
        coordination.participantIds[0]!,
      sequence: 3,
      kind: "message",
      body: coordination.conclusion,
      createdAt: coordination.confirmedAt ?? coordination.updatedAt,
      serverReadable: true,
    });
  }
  return {
    thread: {
      id: threadId,
      kind: "coordination",
      title: pilotCoordinationTitle(coordination.trigger),
      participantIds,
      standInIds,
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      sequence: messages.length,
      createdAt: coordination.createdAt,
    },
    messages,
    principals,
    actions: [
      {
        envelope: {
          schemaVersion: 1,
          operationId,
          action: pilotCoordinationAction(coordination.trigger),
          actorId: sourceId,
          authorityGrantId: coordination.sourceBindingId as CapabilityGrantId,
          policyVersion: "project-internal-v1",
          threadId,
          workstreamId: coordination.workStateId as WorkstreamId,
          humanMessage: coordination.safeContext,
          resourceScope: [`project:${coordination.projectId}`],
          relatedClaimIds: [],
          evidenceRefs: [`work-state:${coordination.workStateId}`],
          requestedActions:
            coordination.trigger === "review_requested"
              ? ["arrange_review"]
              : ["request_coordination"],
          createdAt: coordination.createdAt,
        },
        status: "resolved",
      },
    ],
  };
}

export function pilotCoordinationTitle(
  trigger: PilotCoordinationThread["trigger"],
): string {
  if (trigger === "dependency_declared") return "依赖协助";
  if (trigger === "blocker_raised") return "工作阻塞";
  if (trigger === "review_requested") return "等待评审";
  return "协作确认";
}

function pilotCoordinationAction(
  trigger: PilotCoordinationThread["trigger"],
): ThreadPayload["actions"][number]["envelope"]["action"] {
  if (trigger === "dependency_declared") return "dependency_request";
  if (trigger === "blocker_raised") return "conflict_notice";
  return "coordination_request";
}

function directMessageTitle(
  thread: PilotDirectMessageThread,
  principals: PrincipalSummary[],
  currentIdentityId?: string,
): string {
  const names = new Map(
    principals.map((principal) => [principal.id, principal.displayName]),
  );
  const peerId = currentIdentityId
    ? (thread.participantIds.find((id) => id !== currentIdentityId) ??
      thread.participantIds[0])
    : undefined;
  return peerId
    ? (names.get(peerId) ?? peerId.slice(0, 8))
    : thread.participantIds
        .map((id) => names.get(id) ?? id.slice(0, 8))
        .join(" ↔ ");
}
