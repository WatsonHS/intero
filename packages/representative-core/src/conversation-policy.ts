import type {
  ConversationThread,
  PrincipalId,
  ThreadMessage,
} from "@intero/domain";
import { uuidv7 } from "@intero/domain";

export interface AddRepresentativeResult {
  thread: ConversationThread;
  event: ThreadMessage;
}

export function addRepresentative(
  thread: ConversationThread,
  representativeId: PrincipalId,
  actorId: PrincipalId,
  now = new Date(),
): AddRepresentativeResult {
  if (thread.representativeIds.includes(representativeId)) {
    throw new Error("Representative is already present in this Thread.");
  }

  const sequence = thread.sequence + 1;
  return {
    thread: {
      ...thread,
      participantIds: [...thread.participantIds, representativeId],
      representativeIds: [...thread.representativeIds, representativeId],
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
      body: "A Representative was added. New messages are Agent-readable; earlier encrypted history remains withheld.",
      createdAt: now.toISOString(),
      serverReadable: true,
    },
  };
}

export function canRepresentativeRead(
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
