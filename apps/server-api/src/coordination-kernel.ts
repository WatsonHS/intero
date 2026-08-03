import {
  interoResponseMessageId,
  roomInteroPrincipalId,
  type PilotAgentBinding,
  type PilotCheckpointInput,
  type PilotCoordinationThread,
  type PilotProject,
  type ConversationThread,
  type PrincipalId,
  type ThreadId,
  type ThreadMessage,
} from "@intero/domain";
import { evaluateAuthorizedSharedBoundaryClaims } from "@intero/stand-in-core";
import { createHash } from "node:crypto";

import type { PilotStore } from "./pilot-store.js";
import type { PlatformStore } from "./platform-store.js";

export class CoordinationKernel {
  constructor(
    private readonly pilotStore: PilotStore,
    private readonly conversations: PlatformStore,
  ) {}

  async reconcile(input: {
    project: PilotProject;
    binding: PilotAgentBinding;
    workStateId: string;
    checkpoint: PilotCheckpointInput;
    now: string;
  }): Promise<PilotCoordinationThread[]> {
    const result = await this.pilotStore.reconcileSharedBoundaries(input);
    const materialized: PilotCoordinationThread[] = [];
    for (const thread of result.coordinationThreads) {
      materialized.push(
        thread.status === "resolved"
          ? await this.refresh(thread, input.now, input.binding.ownerId)
          : await this.materialize(thread, input.now),
      );
    }
    for (const thread of await this.reconcileTeamBoundaryConflicts(input)) {
      if (!materialized.some((candidate) => candidate.id === thread.id)) {
        materialized.push(thread);
      }
    }
    return materialized;
  }

  private async reconcileTeamBoundaryConflicts(input: {
    project: PilotProject;
    binding: PilotAgentBinding;
    workStateId: string;
    checkpoint: PilotCheckpointInput;
    now: string;
  }): Promise<PilotCoordinationThread[]> {
    const visibleProjects = await this.pilotStore.listProjects(
      input.binding.ownerId,
    );
    const visibleRooms = await this.conversations.listThreads(
      "room",
      input.binding.ownerId,
    );
    const materialized: PilotCoordinationThread[] = [];
    for (const teamId of input.project.participatingTeamIds) {
      const scopedProjects = visibleProjects.filter((project) =>
        project.participatingTeamIds.includes(teamId),
      );
      if (scopedProjects.length < 2) continue;
      const projectIds = scopedProjects.map((project) => project.id);
      const claims = await this.pilotStore.listSharedBoundaryClaims(
        projectIds,
        input.binding.ownerId,
      );
      const matches = evaluateAuthorizedSharedBoundaryClaims(
        claims,
        projectIds,
        input.now,
      ).filter((match) => {
        if (match.classification !== "potential_conflict") return false;
        const producer = claims.find(
          (claim) => claim.id === match.producerClaimId,
        );
        const consumer = claims.find(
          (claim) => claim.id === match.consumerClaimId,
        );
        return (
          producer?.workStateId === input.workStateId ||
          consumer?.workStateId === input.workStateId
        );
      });
      for (const match of matches) {
        const sources = claims.filter((claim) =>
          [match.producerClaimId, match.consumerClaimId].includes(claim.id),
        );
        const sourceProjectIds = [
          ...new Set(sources.map((claim) => claim.projectId)),
        ].toSorted();
        if (sourceProjectIds.length < 2) continue;
        const sourceOwnerIds = new Set(sources.map((claim) => claim.ownerId));
        const sourceRoom = visibleRooms
          .map((payload) => payload.thread)
          .filter(
            (thread) =>
              thread.teamId === teamId &&
              thread.accessMode === "agent_readable" &&
              [...sourceOwnerIds].every((ownerId) =>
                thread.participantIds.includes(ownerId),
              ),
          )
          .toSorted((left, right) => left.id.localeCompare(right.id))[0];
        if (!sourceRoom) continue;
        const interoPrincipalId = roomInteroPrincipalId(sourceRoom.id);
        await this.conversations.ensureRoomServicePrincipal(sourceRoom.id, {
          id: interoPrincipalId,
          displayName: "Intero",
          kind: "service",
        });
        const thread = await this.pilotStore.openScopedCoordination({
          teamId,
          scopeKind: "cross_project",
          projectIds: sourceProjectIds,
          sourceRoomThreadId: sourceRoom.id,
          requestedByPrincipalId: input.binding.ownerId,
          interoPrincipalId,
          match,
          sourceClaims: claims,
          now: input.now,
        });
        if (
          thread &&
          !materialized.some((candidate) => candidate.id === thread.id)
        ) {
          materialized.push(await this.materialize(thread, input.now));
        }
      }
    }
    return materialized;
  }

  async refresh(
    thread: PilotCoordinationThread,
    now: string,
    closeActorId?: PrincipalId,
    canCommit: () => Promise<boolean> = async () => true,
  ): Promise<PilotCoordinationThread> {
    if (!(await canCommit())) return thread;
    if (
      !thread.conversationThreadId ||
      !thread.sourceRoomThreadId ||
      !thread.summaryMessageId
    ) {
      const materialized = await this.materialize(thread, now, canCommit);
      if (
        materialized.status === "resolved" &&
        materialized.conversationThreadId &&
        closeActorId
      ) {
        await this.conversations.concludeCoordinationThread({
          threadId: materialized.conversationThreadId as ThreadId,
          actorId: closeActorId,
          at: now,
        });
      }
      return materialized;
    }
    await this.writeSummary(thread, now, canCommit);
    if (thread.status === "resolved" && closeActorId) {
      await this.conversations.concludeCoordinationThread({
        threadId: thread.conversationThreadId as ThreadId,
        actorId: closeActorId,
        at: now,
      });
    }
    return thread;
  }

  private async materialize(
    thread: PilotCoordinationThread,
    now: string,
    canCommit: () => Promise<boolean> = async () => true,
  ): Promise<PilotCoordinationThread> {
    if (
      thread.conversationThreadId &&
      thread.sourceRoomThreadId &&
      thread.summaryMessageId
    ) {
      await this.writeSummary(thread, now, canCommit);
      return thread;
    }
    const sourceRoom = await this.resolveSourceRoom(thread);
    if (!sourceRoom) return thread;

    const conversationThreadId = deterministicUuid(
      `coordination-thread:${thread.id}`,
    ) as ThreadId;
    const summaryMessageId = thread.sourceMessageId
      ? interoResponseMessageId(thread.sourceMessageId as ThreadMessage["id"])
      : (deterministicUuid(
          `coordination-summary:${thread.id}`,
        ) as ThreadMessage["id"]);
    const contextMessageId = deterministicUuid(
      `coordination-context:${thread.id}`,
    ) as ThreadMessage["id"];
    const senderId = thread.interoPrincipalId ?? thread.participantIds[0]!;
    const conversationParticipantIds = [
      ...new Set([...thread.participantIds, senderId]),
    ];
    if (!(await canCommit())) return thread;
    await this.conversations.createThread(
      {
        id: conversationThreadId,
        kind: "coordination",
        title: `Coordination · ${thread.boundaryKey ?? thread.trigger}`,
        participantIds: conversationParticipantIds,
        standInIds: [],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        sequence: 0,
        ...(thread.projectIds?.length === 1 || !thread.projectIds
          ? { projectId: thread.projectId }
          : {}),
        ...(thread.teamId ? { teamId: thread.teamId } : {}),
        parentThreadId: sourceRoom.id,
        createdAt: thread.createdAt,
      },
      senderId,
    );
    if (!(await canCommit())) return thread;
    await this.conversations.appendMessage(conversationThreadId, {
      id: contextMessageId,
      senderId,
      body: thread.safeContext,
      createdAt: thread.createdAt,
    });
    const pendingLink: PilotCoordinationThread = {
      ...thread,
      conversationThreadId,
      sourceRoomThreadId: sourceRoom.id,
      summaryMessageId,
      updatedAt: now,
    };
    await this.writeSummary(pendingLink, now, canCommit);
    if (!(await canCommit())) return thread;
    return this.pilotStore.linkCoordinationArtifacts({
      coordinationThreadId: thread.id,
      conversationThreadId,
      sourceRoomThreadId: sourceRoom.id,
      summaryMessageId,
      now,
    });
  }

  private async resolveSourceRoom(
    thread: PilotCoordinationThread,
  ): Promise<ConversationThread | undefined> {
    const viewerId = thread.participantIds[0]!;
    if (thread.sourceRoomThreadId) {
      const direct = await this.conversations.getThread(
        thread.sourceRoomThreadId as ThreadId,
        viewerId,
      );
      return direct?.thread.kind === "room" ? direct.thread : undefined;
    }
    const rooms = await this.conversations.listThreads("room", viewerId);
    return rooms
      .map((item) => item.thread)
      .filter(
        (room) =>
          room.projectId === thread.projectId &&
          thread.participantIds.every((principalId) =>
            room.participantIds.includes(principalId),
          ),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      )[0];
  }

  private async writeSummary(
    thread: PilotCoordinationThread,
    now: string,
    canCommit: () => Promise<boolean> = async () => true,
  ): Promise<ThreadMessage | undefined> {
    if (!thread.sourceRoomThreadId || !thread.summaryMessageId) {
      throw new Error("Coordination summary is not linked to a source Room.");
    }
    if (!(await canCommit())) return undefined;
    const status =
      thread.status === "resolved"
        ? ("resolved" as const)
        : thread.status === "needs_confirmation"
          ? ("needs_action" as const)
          : ("open" as const);
    const conclusion = thread.conclusion ?? "";
    const unresolvedQuestion =
      thread.status === "resolved"
        ? ""
        : (thread.candidateNextSteps[0] ?? "Confirm the shared boundary.");
    const body = conclusion
      ? `${thread.safeContext}\n\nConclusion: ${conclusion}`
      : `${thread.safeContext}\n\nNext: ${unresolvedQuestion}`;
    return this.conversations.upsertCoordinationSummary({
      roomThreadId: thread.sourceRoomThreadId as ThreadId,
      messageId: thread.summaryMessageId as ThreadMessage["id"],
      senderId: thread.interoPrincipalId ?? thread.participantIds[0]!,
      body,
      summary: {
        coordinationThreadId: (thread.conversationThreadId ??
          thread.id) as ThreadId,
        ...(thread.interoRequestId
          ? { interoRequestId: thread.interoRequestId }
          : {}),
        status,
        situation: thread.safeContext,
        boundaryKey: thread.boundaryKey ?? `coordination:${thread.id}`,
        affectedPrincipalIds: thread.participantIds,
        conclusion,
        unresolvedQuestion,
        actionRequired: thread.status === "needs_confirmation",
        freshnessAt: now,
        sourceCount: thread.sourceClaimIds?.length ?? 1,
        ...(thread.scopeKind && thread.projectIds
          ? {
              scope: {
                kind: thread.scopeKind,
                projectIds: thread.projectIds,
              },
            }
          : {}),
        ...(thread.brief ? { brief: thread.brief } : {}),
      },
      at: thread.createdAt,
    });
  }
}

function deterministicUuid(seed: string): string {
  const value = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    `5${value.slice(13, 16)}`,
    `8${value.slice(17, 20)}`,
    value.slice(20),
  ].join("-");
}
