import type {
  ConversationThread,
  PrincipalId,
  ThreadMessage,
} from "@intero/domain";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import type {
  BootstrapPayload,
  PrincipalSummary,
  ThreadPayload,
} from "../../api.js";
import type { ThreadListCache } from "./constants.js";

export type { ThreadListCache };

export function markCachedThreadRead(
  cached: ThreadListCache | undefined,
  threadId: string,
): ThreadListCache | undefined {
  if (!cached) return cached;
  let changed = false;
  const items = cached.items.map((item) => {
    if (
      item.thread.id !== threadId ||
      ((item.unreadCount ?? 0) === 0 && (item.mentionCount ?? 0) === 0)
    ) {
      return item;
    }
    changed = true;
    return { ...item, unreadCount: 0, mentionCount: 0 };
  });
  return changed ? { ...cached, items } : cached;
}

export function replaceCachedThreadMessage(
  cached: ThreadListCache | undefined,
  updated: ThreadMessage,
): ThreadListCache | undefined {
  if (!cached) return cached;
  let changed = false;
  const items = cached.items.map((item) => {
    if (item.thread.id !== updated.threadId) return item;
    let itemChanged = false;
    const messages = item.messages.map((message) => {
      if (message.id !== updated.id) return message;
      changed = true;
      itemChanged = true;
      return updated;
    });
    return itemChanged ? { ...item, messages } : item;
  });
  return changed ? { ...cached, items } : cached;
}

export function buildGroupChatThreadInput(input: {
  currentPrincipalId: PrincipalId;
  standInPrincipalId: PrincipalId;
  title: string;
  memberIds: string[];
  projectId?: string;
  teamId?: string;
}) {
  return {
    kind: "room" as const,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.teamId ? { teamId: input.teamId } : {}),
    title: input.title,
    participantIds: [
      input.currentPrincipalId,
      input.standInPrincipalId,
      ...input.memberIds.filter((id) => id !== input.currentPrincipalId),
    ],
    standInIds: [input.standInPrincipalId],
  };
}

export function resolveConversationProjectId(
  thread: Pick<ConversationThread, "projectId"> | undefined,
  selectedProjectId: string | undefined,
): string | undefined {
  return thread?.projectId ?? selectedProjectId;
}

export function findExistingDirectMessageThread<
  T extends {
    thread: Pick<ConversationThread, "kind" | "participantIds" | "standInIds">;
  },
>(
  items: T[],
  currentPrincipalId: PrincipalId,
  peerId: PrincipalId,
): T | undefined {
  return items.find((item) => {
    if (item.thread.kind !== "human_direct") return false;
    const humanParticipants = item.thread.participantIds.filter(
      (participantId) => !item.thread.standInIds.includes(participantId),
    );
    return (
      humanParticipants.length === 2 &&
      humanParticipants.includes(currentPrincipalId) &&
      humanParticipants.includes(peerId)
    );
  });
}

export function resolvePilotCommunicationPrincipal(
  identityId: PrincipalId | undefined,
  bootstrap:
    | {
        identities: PrincipalSummary[];
        currentPrincipal?: PrincipalSummary;
      }
    | undefined,
): PrincipalSummary | undefined {
  if (!identityId || !bootstrap) return undefined;
  return bootstrap.currentPrincipal?.id === identityId
    ? bootstrap.currentPrincipal
    : bootstrap.identities.find((principal) => principal.id === identityId);
}

export function resolveConversationIdentity(
  bootstrap: BootstrapPayload | undefined,
  pilotIdentityId: PrincipalId | undefined,
):
  | {
      currentPrincipalId: PrincipalId;
      standInPrincipalId: PrincipalId;
    }
  | undefined {
  const currentPrincipalId = pilotIdentityId ?? bootstrap?.currentPrincipal?.id;
  if (!currentPrincipalId) return undefined;
  const bootstrapMatchesCurrent =
    bootstrap?.currentPrincipal?.id === currentPrincipalId;
  return {
    currentPrincipalId: currentPrincipalId as PrincipalId,
    standInPrincipalId:
      (bootstrapMatchesCurrent
        ? (bootstrap?.standInPrincipal?.id as PrincipalId | undefined)
        : undefined) ??
      personalStandInPrincipalId(currentPrincipalId as PrincipalId),
  };
}

export function canRenderCommunicationItems(input: {
  itemCount: number;
  canonicalPending: boolean;
  canonicalError: boolean;
}): boolean {
  return (
    input.itemCount > 0 || (!input.canonicalPending && !input.canonicalError)
  );
}

export function ownStandInControlState(
  thread: ConversationThread,
  ownStandInId: string | undefined,
): "add" | "present" | undefined {
  if (
    !ownStandInId ||
    (thread.kind !== "room" && thread.kind !== "human_group")
  ) {
    return undefined;
  }
  return thread.standInIds.includes(ownStandInId as PrincipalId)
    ? "present"
    : "add";
}

export interface MentionedStandIn {
  principalId: PrincipalId;
  ownerId: PrincipalId;
}

export async function sendCanonicalConversationMessage(
  input: {
    threadId: string;
    senderId: string;
    body: string;
    mentionedStandIns?: MentionedStandIn[];
    clientMessageId?: string;
    mentionedPrincipalIds?: string[];
    attachmentIds?: string[];
    replyToMessageId?: string;
  },
  dependencies: {
    sendMessage: (input: {
      threadId: string;
      senderId: string;
      body: string;
      clientMessageId?: string;
      mentionedPrincipalIds?: string[];
      attachmentIds?: string[];
      replyToMessageId?: string;
    }) => Promise<ThreadMessage>;
  },
): Promise<ThreadMessage> {
  return dependencies.sendMessage({
    threadId: input.threadId,
    senderId: input.senderId,
    body: input.body,
    ...(input.clientMessageId
      ? { clientMessageId: input.clientMessageId }
      : {}),
    mentionedPrincipalIds: input.mentionedPrincipalIds ?? [],
    attachmentIds: input.attachmentIds ?? [],
    ...(input.replyToMessageId
      ? { replyToMessageId: input.replyToMessageId }
      : {}),
  });
}

export class StandInReplyError extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : "The Stand-in could not answer this message.",
      { cause },
    );
    this.name = "StandInReplyError";
  }
}

export async function requestConversationStandInReplies(
  input: {
    threadId: string;
    messageId: string;
    senderId: string;
    mentionedStandIns: MentionedStandIn[];
  },
  dependencies: {
    enqueueReply: (
      identityId: PrincipalId,
      threadId: string,
      messageId: string,
      standInOwnerId: PrincipalId,
    ) => Promise<unknown>;
  },
): Promise<void> {
  if (input.mentionedStandIns.length === 0) return;
  const errors: unknown[] = [];
  for (const mentioned of input.mentionedStandIns) {
    try {
      await dependencies.enqueueReply(
        input.senderId as PrincipalId,
        input.threadId,
        input.messageId,
        mentioned.ownerId,
      );
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw new StandInReplyError(errors[0]);
}

export async function sha256Hex(
  file: Blob,
  subtleCrypto: Pick<SubtleCrypto, "digest"> | null = globalThis.crypto
    ?.subtle ?? null,
): Promise<string> {
  const bytes = await file.arrayBuffer();
  if (!subtleCrypto) return bytesToHex(sha256(new Uint8Array(bytes)));
  return bytesToHex(
    new Uint8Array(await subtleCrypto.digest("SHA-256", bytes)),
  );
}

export function personalStandInPrincipalId(ownerId: PrincipalId): PrincipalId {
  return `${ownerId.slice(0, 14)}5${ownerId.slice(15)}` as PrincipalId;
}

export function mergeCommunicationItems(
  personalStandInItem: ThreadPayload | undefined,
  canonicalItems: ThreadPayload[],
  pilotItems: ThreadPayload[],
  hideCanonicalStandIns = Boolean(personalStandInItem),
): ThreadPayload[] {
  const canonicalPersonalStandIn = personalStandInItem
    ? canonicalItems.find(
        (item) => item.thread.id === personalStandInItem.thread.id,
      )
    : undefined;
  const mergedPersonalStandIn =
    personalStandInItem && canonicalPersonalStandIn
      ? {
          ...personalStandInItem,
          thread: canonicalPersonalStandIn.thread,
          messages: canonicalPersonalStandIn.messages,
          ...(canonicalPersonalStandIn.unreadCount !== undefined
            ? { unreadCount: canonicalPersonalStandIn.unreadCount }
            : {}),
          ...(canonicalPersonalStandIn.mentionCount !== undefined
            ? { mentionCount: canonicalPersonalStandIn.mentionCount }
            : {}),
          ...(canonicalPersonalStandIn.lastReadSequence !== undefined
            ? {
                lastReadSequence: canonicalPersonalStandIn.lastReadSequence,
              }
            : {}),
          principals: [
            ...new Map(
              [
                ...personalStandInItem.principals,
                ...canonicalPersonalStandIn.principals,
              ].map((principal) => [principal.id, principal]),
            ).values(),
          ],
        }
      : personalStandInItem;
  return [
    ...(mergedPersonalStandIn ? [mergedPersonalStandIn] : []),
    ...canonicalItems.filter(
      (item) => !(hideCanonicalStandIns && item.thread.kind === "stand_in"),
    ),
    ...pilotItems,
  ];
}

export function resolveStandInAvatarIdentity(input: {
  standInId: PrincipalId;
  standInOwnerIds: Map<PrincipalId, PrincipalId>;
  principalNames: Map<string, string>;
  fallbackName: string;
}): { ownerId: string; ownerName: string } {
  const ownerId = input.standInOwnerIds.get(input.standInId);
  return {
    ownerId: ownerId ?? input.standInId,
    ownerName:
      (ownerId ? input.principalNames.get(ownerId) : undefined) ??
      input.fallbackName,
  };
}

export function ownerNameFor(
  thread: Pick<ConversationThread, "participantIds" | "standInIds">,
  principalNames: Map<string, string>,
): string {
  const humanId = thread.participantIds.find(
    (id) => !thread.standInIds.includes(id),
  );
  if (!humanId) return "—";
  return principalNames.get(humanId) ?? humanId.slice(0, 8);
}

export function collectPrincipals(
  threadPayloads: ThreadPayload[],
  pulsePrincipals: PrincipalSummary[],
  bootstrapPrincipals: Array<PrincipalSummary | undefined>,
): PrincipalSummary[] {
  const byId = new Map<string, PrincipalSummary>();
  for (const principal of [
    ...threadPayloads.flatMap((item) => item.principals),
    ...pulsePrincipals,
    ...bootstrapPrincipals.filter(
      (item): item is PrincipalSummary => item !== undefined,
    ),
  ]) {
    byId.set(principal.id, principal);
  }
  return [...byId.values()].toSorted((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

export function buildPrincipalNames(
  principals: PrincipalSummary[],
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const principal of principals) {
    counts.set(
      principal.displayName,
      (counts.get(principal.displayName) ?? 0) + 1,
    );
  }
  return new Map(
    principals.map((principal) => [
      principal.id,
      counts.get(principal.displayName) === 1
        ? principal.displayName
        : `${principal.displayName} · ${principal.id.slice(-4)}`,
    ]),
  );
}
