import {
  type PilotAgentBinding,
  type PilotCheckpointInput,
  type PilotCoordinationThread,
  type PilotProject,
  type ConversationThread,
  type PrincipalId,
  type ThreadId,
  type ThreadMessage,
} from "@intero/domain";
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
      materialized.push(await this.materialize(thread, input.now));
    }
    return materialized;
  }

  async refresh(
    thread: PilotCoordinationThread,
    now: string,
    closeActorId?: PrincipalId,
  ): Promise<PilotCoordinationThread> {
    if (
      !thread.conversationThreadId ||
      !thread.sourceRoomThreadId ||
      !thread.summaryMessageId
    ) {
      const materialized = await this.materialize(thread, now);
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
    await this.writeSummary(thread, now);
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
  ): Promise<PilotCoordinationThread> {
    if (
      thread.conversationThreadId &&
      thread.sourceRoomThreadId &&
      thread.summaryMessageId
    ) {
      await this.writeSummary(thread, now);
      return thread;
    }
    const sourceRoom = await this.resolveSourceRoom(thread);
    if (!sourceRoom) return thread;

    const conversationThreadId = deterministicUuid(
      `coordination-thread:${thread.id}`,
    ) as ThreadId;
    const summaryMessageId = deterministicUuid(
      `coordination-summary:${thread.id}`,
    ) as ThreadMessage["id"];
    const contextMessageId = deterministicUuid(
      `coordination-context:${thread.id}`,
    ) as ThreadMessage["id"];
    const senderId = thread.participantIds[0]!;
    await this.conversations.createThread(
      {
        id: conversationThreadId,
        kind: "coordination",
        title: `Coordination · ${thread.boundaryKey ?? thread.trigger}`,
        participantIds: thread.participantIds,
        standInIds: [],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        sequence: 0,
        projectId: thread.projectId,
        parentThreadId: sourceRoom.id,
        createdAt: thread.createdAt,
      },
      senderId,
    );
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
    await this.writeSummary(pendingLink, now);
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
  ): Promise<ThreadMessage> {
    if (!thread.sourceRoomThreadId || !thread.summaryMessageId) {
      throw new Error("Coordination summary is not linked to a source Room.");
    }
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
      senderId: thread.participantIds[0]!,
      body,
      summary: {
        coordinationThreadId: (thread.conversationThreadId ??
          thread.id) as ThreadId,
        status,
        situation: thread.safeContext,
        boundaryKey: thread.boundaryKey ?? `coordination:${thread.id}`,
        affectedPrincipalIds: thread.participantIds,
        conclusion,
        unresolvedQuestion,
        actionRequired: thread.status === "needs_confirmation",
        freshnessAt: now,
        sourceCount: thread.sourceClaimIds?.length ?? 1,
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
