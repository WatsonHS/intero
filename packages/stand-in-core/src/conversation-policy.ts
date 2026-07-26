import type {
  ConversationThread,
  PrincipalId,
  ThreadMessage,
} from "@intero/domain";
import { uuidv7 } from "@intero/domain";

export interface AddStandInResult {
  thread: ConversationThread;
  event: ThreadMessage;
}

export function addStandIn(
  thread: ConversationThread,
  standInId: PrincipalId,
  actorId: PrincipalId,
  now = new Date(),
): AddStandInResult {
  if (thread.standInIds.includes(standInId)) {
    throw new Error("Stand-in is already present in this Thread.");
  }

  const sequence = thread.sequence + 1;
  return {
    thread: {
      ...thread,
      participantIds: [...thread.participantIds, standInId],
      standInIds: [...thread.standInIds, standInId],
      accessMode: "agent_readable",
      accessChangedAtSequence: sequence,
      sequence,
    },
    event: {
      id: uuidv7() as ThreadMessage["id"],
      threadId: thread.id,
      senderId: actorId,
      sequence,
      kind: "system_access_change",
      body: "A Stand-in was added. New messages are Agent-readable; earlier encrypted history remains withheld.",
      createdAt: now.toISOString(),
      serverReadable: true,
    },
  };
}

export function canStandInRead(
  thread: ConversationThread,
  message: ThreadMessage,
): boolean {
  if (thread.accessMode !== "agent_readable") return false;
  if (thread.priorHistoryGranted) return true;
  return (
    thread.accessChangedAtSequence !== undefined &&
    message.sequence >= thread.accessChangedAtSequence &&
    message.serverReadable
  );
}
