import {
  type ActionEnvelope,
  type ActionInboxItem,
  type ActivityEvent,
  type AuthorizedSearchResult,
  type CanonicalWorkEvent,
  type CapabilityGrant,
  type Claim,
  type ConversationThread,
  type CoordinationResult,
  type DecisionRecord,
  decodeMessageSearchCursor,
  encodeMessageSearchCursor,
  highlightSearchSnippet,
  type MessageSearchCursor,
  type KanbanCard,
  type KanbanCardId,
  type MessageSearchPage,
  extractHttpUrls,
  type LinkPreview,
  type OperationId,
  type OutboxEntry,
  personalStandInId,
  type PrincipalId,
  type Project,
  type ProjectId,
  type PublicWorkProjection,
  type ReactionEmoji,
  type SearchMessageFilters,
  type Spec,
  type SpecId,
  type SpecRevision,
  type SpecReviewResponse,
  type ThreadId,
  type ConversationChangeReason,
  type ThreadMessage,
  type ThreadMessageAttachment,
  type ThreadMessageReaction,
  type ThreadMessageStreamState,
  tokenizeSearchText,
  type UpsertWebPushSubscriptionRequest,
  type WebPushSubscription,
  type Workstream,
  type WorkstreamId,
  uuidv7,
} from "@intero/domain";
import {
  addStandIn,
  authorizeEnvelope,
  buildPublicProjection,
  createSpecRevision,
  invalidateAffectedReviews,
  resolveWorkstream,
} from "@intero/stand-in-core";

import type { PrincipalSummary } from "./platform-store.js";
import { PilotStoreError } from "./pilot-store.js";

const DEMO_ORGANIZATION_ID =
  "019b5ac0-7600-7000-8000-000000000001" as ActivityEvent["organizationId"];
const SYSTEM_PRINCIPAL_ID =
  "019b5ac0-7600-7000-8000-000000000002" as PrincipalId;

export type MutationResult<T> = {
  value: T;
  activity: ActivityEvent;
  outbox: OutboxEntry;
};

export type KanbanCardUpdate = Partial<
  Pick<
    KanbanCard,
    | "title"
    | "description"
    | "column"
    | "position"
    | "ownerId"
    | "estimatePoints"
    | "relatedWorkstreamIds"
  >
>;

export interface ThreadMessagePageQuery {
  afterSequence?: number | undefined;
  beforeSequence?: number | undefined;
  aroundSequence?: number | undefined;
  tail?: number | undefined;
  limit: number;
}

export interface ThreadMessagePage {
  items: ThreadMessage[];
  headSequence: number;
  accessVersion: number;
  hasMore: boolean;
}

export function sameCoordinationSummaryIdentity(
  left: ThreadMessage["coordinationSummary"],
  right: ThreadMessage["coordinationSummary"],
): boolean {
  if (!left || !right) return false;
  if (left.interoRequestId && right.interoRequestId) {
    return left.interoRequestId === right.interoRequestId;
  }
  return left.coordinationThreadId === right.coordinationThreadId;
}

export interface StandInQuestionInput {
  jobId: OperationId;
  /** Optional retrieval scope; Stand-in conversation does not require it. */
  projectId?: ProjectId;
  standInOwnerId: PrincipalId;
  askedByPrincipalId: PrincipalId;
  answerMessageId: ThreadMessage["id"];
  preferredLanguage: "zh-CN" | "en-US";
  recordExchange: boolean;
  source:
    | {
        kind: "new_message";
        thread: ConversationThread;
        messageId: ThreadMessage["id"];
        body: string;
        createdAt: string;
      }
    | {
        kind: "existing_message";
        threadId: ThreadId;
        messageId: ThreadMessage["id"];
        createdAt: string;
      };
}

export class InMemoryPlatformStore {
  readonly projects = new Map<ProjectId, Project>();
  readonly kanbanCards = new Map<KanbanCardId, KanbanCard>();
  readonly workstreams = new Map<WorkstreamId, Workstream>();
  readonly claims = new Map<WorkstreamId, Claim[]>();
  readonly projections = new Map<WorkstreamId, PublicWorkProjection>();
  readonly grants = new Map<CapabilityGrant["id"], CapabilityGrant>();
  readonly envelopes = new Map<OperationId, ActionEnvelope>();
  readonly threads = new Map<ThreadId, ConversationThread>();
  readonly messages = new Map<ThreadId, ThreadMessage[]>();
  readonly linkPreviews = new Map<string, LinkPreview>();
  /** First message sequence visible to a participant after they join. */
  private readonly threadVisibility = new Map<string, number>();
  /** Keyed `${threadId}:${principalId}` — the read marker per person. */
  private readonly threadReads = new Map<
    string,
    { threadId: ThreadId; lastReadSequence: number }
  >();
  readonly specs = new Map<SpecId, Spec>();
  readonly revisions = new Map<SpecId, SpecRevision[]>();
  readonly reviews = new Map<SpecId, SpecReviewResponse[]>();
  readonly decisions = new Map<DecisionRecord["id"], DecisionRecord>();
  readonly inbox = new Map<string, ActionInboxItem>();
  readonly webPushSubscriptions = new Map<string, WebPushSubscription>();
  readonly principals = new Map<PrincipalId, PrincipalSummary>();
  readonly activities: ActivityEvent[] = [];
  readonly outbox: OutboxEntry[] = [];
  readonly processedIdempotencyKeys = new Set<string>();
  #sequence = 0;

  ensureProject(project: Project): Project {
    this.projects.set(project.id, project);
    return project;
  }

  listProjects(): Project[] {
    return [...this.projects.values()].toSorted((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  listKanbanCards(projectId?: ProjectId): KanbanCard[] {
    return [...this.kanbanCards.values()]
      .filter((card) => projectId === undefined || card.projectId === projectId)
      .toSorted(
        (left, right) =>
          left.position - right.position ||
          left.createdAt.localeCompare(right.createdAt),
      );
  }

  createKanbanCard(card: KanbanCard): KanbanCard {
    if (!this.projects.has(card.projectId)) {
      throw new Error("Project was not found.");
    }
    if (this.kanbanCards.has(card.id)) {
      throw new Error("Kanban card already exists.");
    }
    this.ensureKanbanWorkstreams(card.relatedWorkstreamIds);
    if (card.ownerId) this.ensurePrincipal(card.ownerId, "human");
    this.kanbanCards.set(card.id, card);
    return card;
  }

  updateKanbanCard(cardId: KanbanCardId, update: KanbanCardUpdate): KanbanCard {
    const current = this.kanbanCards.get(cardId);
    if (!current) throw new Error("Kanban card was not found.");
    if (update.relatedWorkstreamIds) {
      this.ensureKanbanWorkstreams(update.relatedWorkstreamIds);
    }
    if (update.ownerId) this.ensurePrincipal(update.ownerId, "human");
    const next = {
      ...current,
      ...update,
      updatedAt: new Date().toISOString(),
    };
    this.kanbanCards.set(cardId, next);
    return next;
  }

  createWorkstream(
    input: Omit<
      Workstream,
      "evidenceClaimIds" | "contradictionClaimIds" | "version"
    >,
  ) {
    this.ensurePrincipal(input.ownerId, "human");
    const workstream: Workstream = {
      ...input,
      evidenceClaimIds: [],
      contradictionClaimIds: [],
      version: 0,
    };
    this.workstreams.set(workstream.id, workstream);
    return this.commit(
      "workstream.created",
      workstream.id,
      workstream.ownerId,
      workstream,
    );
  }

  addClaim(claim: Claim): MutationResult<{
    claim: Claim;
    workstream: Workstream;
    projection?: PublicWorkProjection;
  }> {
    const current = this.requireWorkstream(claim.workstreamId);
    const claims = [...(this.claims.get(claim.workstreamId) ?? []), claim];
    this.claims.set(claim.workstreamId, claims);
    const next = resolveWorkstream({ workstream: current, claims });
    this.workstreams.set(next.id, next);
    const projection = buildPublicProjection(current, next);
    if (projection) this.projections.set(next.id, projection);
    return this.commit("claim.recorded", claim.id, next.ownerId, {
      claim,
      workstream: next,
      ...(projection ? { projection } : {}),
    });
  }

  ingestEvent(event: CanonicalWorkEvent): {
    accepted: boolean;
    duplicate: boolean;
    projection?: PublicWorkProjection;
  } {
    if (this.processedIdempotencyKeys.has(event.idempotencyKey)) {
      return { accepted: true, duplicate: true };
    }
    if (!event.workstreamId) {
      throw new Error("Event must be assigned to a Workstream.");
    }
    this.processedIdempotencyKeys.add(event.idempotencyKey);
    const claim = claimFromEvent(event);
    if (!claim) return { accepted: true, duplicate: false };
    const mutation = this.addClaim(claim);
    return {
      accepted: true,
      duplicate: false,
      ...(mutation.value.projection
        ? { projection: mutation.value.projection }
        : {}),
    };
  }

  applyProjection(projection: PublicWorkProjection): PublicWorkProjection {
    const current = this.projections.get(projection.id);
    if (!current || projection.version >= current.version) {
      this.projections.set(projection.id, projection);
    }
    return this.projections.get(projection.id)!;
  }

  putGrant(grant: CapabilityGrant): CapabilityGrant {
    this.ensurePrincipal(grant.principalId, "stand_in");
    this.grants.set(grant.id, grant);
    return grant;
  }

  coordinate(envelope: ActionEnvelope): CoordinationResult {
    if (this.envelopes.has(envelope.operationId)) {
      return this.coordinationResult(
        envelope,
        "resolved",
        "This action was already applied.",
      );
    }
    const grant = this.grants.get(envelope.authorityGrantId);
    const decision = grant
      ? authorizeEnvelope(envelope, grant)
      : { allowed: false as const, reason: "Capability Grant was not found." };
    if (!decision.allowed) {
      const attentionPrincipalId =
        this.humanThreadParticipant(envelope.threadId, envelope.actorId) ??
        envelope.actorId;
      this.createInboxItem(
        attentionPrincipalId,
        "scope_expansion",
        "Stand-in action needs authorization",
        decision.reason,
        `coordination:${envelope.operationId}`,
      );
      return this.coordinationResult(envelope, "rejected", decision.reason);
    }
    if (decision.requiresConfirmation) {
      const attentionPrincipalId =
        this.humanThreadParticipant(envelope.threadId, envelope.actorId) ??
        envelope.actorId;
      this.createInboxItem(
        attentionPrincipalId,
        "consequential_commitment",
        "Stand-in action needs confirmation",
        envelope.humanMessage,
        `coordination:${envelope.operationId}`,
      );
      return this.coordinationResult(
        envelope,
        "needs_human",
        "Human confirmation is required.",
      );
    }
    this.envelopes.set(envelope.operationId, envelope);
    const thread = this.threads.get(envelope.threadId);
    if (thread) {
      const sequence = thread.sequence + 1;
      this.threads.set(thread.id, { ...thread, sequence });
      this.messages.set(thread.id, [
        ...(this.messages.get(thread.id) ?? []),
        {
          id: uuidv7() as ThreadMessage["id"],
          threadId: thread.id,
          senderId: envelope.actorId,
          sequence,
          kind: "coordination_action",
          body: envelope.humanMessage,
          createdAt: envelope.createdAt,
          serverReadable: true,
          operationId: envelope.operationId,
        },
      ]);
    }
    this.commit(
      "coordination.action_recorded",
      envelope.operationId,
      envelope.actorId,
      envelope,
    );
    return this.coordinationResult(envelope, "resolved", envelope.humanMessage);
  }

  createThread(
    thread: ConversationThread,
    actorId?: PrincipalId,
  ): ConversationThread {
    const existing = this.threads.get(thread.id);
    if (existing) {
      if (!sameThreadCreation(existing, thread)) {
        throw new Error("Thread ID was already used.");
      }
      return existing;
    }
    for (const participantId of thread.participantIds) {
      this.ensurePrincipal(
        participantId,
        thread.standInIds.includes(participantId) ? "stand_in" : "human",
      );
    }
    const stored = {
      ...thread,
      accessVersion: thread.accessVersion ?? 1,
    };
    this.threads.set(thread.id, stored);
    this.messages.set(thread.id, []);
    for (const participantId of thread.participantIds) {
      this.threadVisibility.set(`${thread.id}:${participantId}`, 1);
    }
    if (actorId) {
      this.recordConversationChange(
        stored,
        actorId,
        "thread_created",
        thread.id,
      );
    }
    return stored;
  }

  ensureRoomServicePrincipal(
    threadId: ThreadId,
    principal: PrincipalSummary,
  ): ConversationThread {
    const current = this.threads.get(threadId);
    if (!current || current.kind !== "room") {
      throw new Error("Source Room was not found.");
    }
    if (current.accessMode !== "agent_readable") {
      throw new Error("Intero is unavailable in a human-only encrypted Room.");
    }
    if (principal.kind !== "service") {
      throw new Error("Room Agent principal must be a service identity.");
    }
    this.upsertPrincipal(principal);
    if (current.participantIds.includes(principal.id)) return current;
    const updated: ConversationThread = {
      ...current,
      participantIds: [...current.participantIds, principal.id],
      accessVersion: (current.accessVersion ?? 1) + 1,
    };
    this.threads.set(threadId, updated);
    this.threadVisibility.set(`${threadId}:${principal.id}`, 1);
    this.recordConversationChange(
      updated,
      principal.id,
      "access_changed",
      uuidv7(),
    );
    return updated;
  }

  updateThread(
    threadId: ThreadId,
    input: {
      title?: string;
      addParticipantIds: PrincipalId[];
      removeParticipantIds?: PrincipalId[];
    },
    actorId: PrincipalId,
  ): { thread: ConversationThread; event?: ThreadMessage } {
    const current = this.threads.get(threadId);
    if (!current || !current.participantIds.includes(actorId)) {
      throw new Error("Thread was not found.");
    }
    if (current.standInIds.includes(actorId)) {
      throw new Error("Only a human participant can manage this Thread.");
    }
    if (current.kind !== "room" && current.kind !== "human_group") {
      throw new Error("Only group conversations can be managed.");
    }
    const title = input.title?.trim();
    if (title !== undefined && (title.length === 0 || title.length > 200)) {
      throw new Error("Thread title is invalid.");
    }
    const addedParticipantIds = [...new Set(input.addParticipantIds)].filter(
      (principalId) => !current.participantIds.includes(principalId),
    );
    const removedParticipantIds = [
      ...new Set(input.removeParticipantIds ?? []),
    ].filter(
      (principalId) =>
        current.participantIds.includes(principalId) &&
        !current.standInIds.includes(principalId),
    );
    if (removedParticipantIds.includes(actorId)) {
      throw new Error("A group manager cannot remove their own access.");
    }
    for (const participantId of addedParticipantIds) {
      this.ensurePrincipal(participantId, "human");
    }
    const titleChanged = title !== undefined && title !== current.title;
    if (
      !titleChanged &&
      addedParticipantIds.length === 0 &&
      removedParticipantIds.length === 0
    ) {
      return { thread: current };
    }

    const event =
      addedParticipantIds.length > 0 || removedParticipantIds.length > 0
        ? ({
            id: uuidv7() as ThreadMessage["id"],
            threadId,
            senderId: actorId,
            sequence: current.sequence + 1,
            kind: "system_access_change",
            body: [
              addedParticipantIds.length > 0
                ? `${addedParticipantIds.length} member(s) joined; earlier history remains withheld.`
                : "",
              removedParticipantIds.length > 0
                ? `${removedParticipantIds.length} member(s) left and lost access immediately.`
                : "",
            ]
              .filter(Boolean)
              .join(" "),
            createdAt: new Date().toISOString(),
            serverReadable: true,
          } satisfies ThreadMessage)
        : undefined;
    const updated: ConversationThread = {
      ...current,
      ...(titleChanged ? { title } : {}),
      ...(event
        ? {
            participantIds: [
              ...current.participantIds.filter(
                (id) => !removedParticipantIds.includes(id),
              ),
              ...addedParticipantIds,
            ],
            standInIds: current.standInIds.filter(
              (id) => !removedParticipantIds.includes(id),
            ),
            sequence: event!.sequence,
            accessVersion: (current.accessVersion ?? 1) + 1,
            latestMessageAt: event!.createdAt,
          }
        : {}),
    };
    this.threads.set(threadId, updated);
    if (event) {
      this.messages.set(threadId, [
        ...(this.messages.get(threadId) ?? []),
        event,
      ]);
      for (const participantId of addedParticipantIds) {
        this.threadVisibility.set(
          `${threadId}:${participantId}`,
          event.sequence,
        );
      }
      for (const participantId of removedParticipantIds) {
        this.threadVisibility.delete(`${threadId}:${participantId}`);
      }
    }
    this.recordConversationChange(
      updated,
      actorId,
      event ? "access_changed" : "thread_updated",
      event?.id ?? uuidv7(),
    );
    return { thread: updated, ...(event ? { event } : {}) };
  }

  appendMessage(
    threadId: ThreadId,
    input: {
      id: ThreadMessage["id"];
      senderId: PrincipalId;
      body?: string;
      encryptedBody?: string;
      mentionedPrincipalIds?: PrincipalId[];
      attachmentIds?: ThreadMessageAttachment["id"][];
      replyToMessageId?: ThreadMessage["id"];
      streamState?: ThreadMessageStreamState;
      createdAt: string;
    },
  ): ThreadMessage {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error("Thread was not found.");
    if (!thread.participantIds.includes(input.senderId)) {
      throw new Error("Sender is not a Thread participant.");
    }
    if (input.attachmentIds?.length) {
      throw new Error("Attachment storage is unavailable in memory mode.");
    }
    const existing = (this.messages.get(threadId) ?? []).find(
      (message) => message.id === input.id,
    );
    if (existing) {
      if (
        (existing.streamState === "pending" ||
          existing.streamState === "streaming") &&
        existing.senderId === input.senderId &&
        input.body !== undefined &&
        input.encryptedBody === undefined &&
        existing.replyToMessageId === input.replyToMessageId &&
        !input.attachmentIds?.length
      ) {
        return this.updateMessageStream({
          threadId,
          messageId: existing.id,
          senderId: input.senderId,
          body: input.body,
          streamState: "complete",
        });
      }
      if (
        existing.senderId !== input.senderId ||
        existing.body !== (input.body ?? "") ||
        existing.encryptedBody !== input.encryptedBody ||
        existing.replyToMessageId !== input.replyToMessageId ||
        !sameIds(
          existing.mentionedPrincipalIds ?? [],
          input.mentionedPrincipalIds ?? [],
        )
      ) {
        throw new Error("Client message ID was already used.");
      }
      return existing;
    }
    if (
      input.replyToMessageId &&
      this.getThreadMessage(threadId, input.senderId, input.replyToMessageId)
        ?.kind !== "message"
    ) {
      throw new Error("Reply message was not found.");
    }
    const message = withExtractedPreviewUrls(
      thread,
      buildThreadMessage(thread, {
        ...input,
        mentionedPrincipalIds: normalizeMentionIds(
          thread,
          input.senderId,
          input.mentionedPrincipalIds,
        ),
      }),
    );
    const updatedThread = {
      ...thread,
      sequence: message.sequence,
      latestMessageAt: message.createdAt,
      accessVersion: thread.accessVersion ?? 1,
    };
    this.threads.set(threadId, updatedThread);
    this.messages.set(threadId, [
      ...(this.messages.get(threadId) ?? []),
      message,
    ]);
    this.recordConversationChange(
      updatedThread,
      input.senderId,
      "message_appended",
      message.id,
    );
    this.enqueueUnfurl(updatedThread, message);
    return message;
  }

  enqueueStandInQuestion(input: StandInQuestionInput): ThreadMessage {
    const question =
      input.source.kind === "new_message"
        ? (() => {
            this.createThread(input.source.thread, input.askedByPrincipalId);
            return this.appendMessage(input.source.thread.id, {
              id: input.source.messageId,
              senderId: input.askedByPrincipalId,
              body: input.source.body,
              createdAt: input.source.createdAt,
            });
          })()
        : this.getThreadMessage(
            input.source.threadId,
            input.askedByPrincipalId,
            input.source.messageId,
          );
    if (!question || question.senderId !== input.askedByPrincipalId) {
      throw new Error("Stand-in question source message was not found.");
    }
    const threadId =
      input.source.kind === "new_message"
        ? input.source.thread.id
        : input.source.threadId;
    this.appendMessage(threadId, {
      id: input.answerMessageId,
      senderId: personalStandInId(input.standInOwnerId),
      body: "",
      streamState: "pending",
      createdAt: input.source.createdAt,
    });
    return question;
  }

  updateMessageStream(input: {
    threadId: ThreadId;
    messageId: ThreadMessage["id"];
    senderId: PrincipalId;
    body: string;
    streamState: ThreadMessageStreamState;
  }): ThreadMessage {
    const thread = this.threads.get(input.threadId);
    if (!thread) throw new Error("Thread was not found.");
    const messages = this.messages.get(input.threadId) ?? [];
    const index = messages.findIndex(
      (message) => message.id === input.messageId,
    );
    const current = messages[index];
    if (!current || current.senderId !== input.senderId) {
      throw new Error("Stream message was not found.");
    }
    if (
      current.streamState === "complete" &&
      input.streamState !== "complete"
    ) {
      throw new Error("Completed stream messages are immutable.");
    }
    const updated: ThreadMessage = withExtractedPreviewUrls(thread, {
      ...current,
      body: input.body,
      streamState: input.streamState,
      revision: (current.revision ?? 1) + 1,
    });
    const next = [...messages];
    next[index] = updated;
    this.messages.set(input.threadId, next);
    this.recordConversationChange(
      thread,
      input.senderId,
      "message_updated",
      uuidv7(),
      input.messageId,
    );
    if (updated.streamState === "complete") {
      this.enqueueUnfurl(thread, updated);
    }
    return updated;
  }

  upsertCoordinationSummary(input: {
    roomThreadId: ThreadId;
    messageId: ThreadMessage["id"];
    senderId: PrincipalId;
    body: string;
    summary: NonNullable<ThreadMessage["coordinationSummary"]>;
    at: string;
  }): ThreadMessage {
    const thread = this.threads.get(input.roomThreadId);
    if (!thread || thread.kind !== "room") {
      throw new Error("Source Room was not found.");
    }
    if (!thread.participantIds.includes(input.senderId)) {
      throw new Error("Summary sender is not a Room participant.");
    }
    const messages = this.messages.get(thread.id) ?? [];
    const existingIndex = messages.findIndex(
      (message) => message.id === input.messageId,
    );
    if (existingIndex >= 0) {
      const existing = messages[existingIndex]!;
      if (
        existing.kind !== "coordination_summary" ||
        existing.senderId !== input.senderId ||
        !sameCoordinationSummaryIdentity(
          existing.coordinationSummary,
          input.summary,
        )
      ) {
        throw new Error("Coordination summary message ID was already used.");
      }
      const updated: ThreadMessage = {
        ...existing,
        body: input.body,
        coordinationSummary: input.summary,
        revision: (existing.revision ?? 1) + 1,
      };
      const next = [...messages];
      next[existingIndex] = updated;
      this.messages.set(thread.id, next);
      this.recordConversationChange(
        thread,
        input.senderId,
        "message_updated",
        updated.id,
      );
      return updated;
    }
    const message: ThreadMessage = {
      id: input.messageId,
      threadId: thread.id,
      senderId: input.senderId,
      sequence: thread.sequence + 1,
      kind: "coordination_summary",
      body: input.body,
      createdAt: input.at,
      serverReadable: true,
      coordinationSummary: input.summary,
      streamState: "complete",
      revision: 1,
    };
    const updatedThread = {
      ...thread,
      sequence: message.sequence,
      latestMessageAt: input.at,
      accessVersion: thread.accessVersion ?? 1,
    };
    this.threads.set(thread.id, updatedThread);
    this.messages.set(thread.id, [...messages, message]);
    this.recordConversationChange(
      updatedThread,
      input.senderId,
      "message_appended",
      message.id,
    );
    return message;
  }

  setMessageReaction(input: {
    threadId: ThreadId;
    messageId: ThreadMessage["id"];
    principalId: PrincipalId;
    emoji: ReactionEmoji;
    reacted: boolean;
  }): ThreadMessage {
    const thread = this.threads.get(input.threadId);
    const visibleFrom =
      this.threadVisibility.get(`${input.threadId}:${input.principalId}`) ?? 1;
    if (!thread?.participantIds.includes(input.principalId)) {
      throw new Error("Thread was not found.");
    }
    const messages = this.messages.get(input.threadId) ?? [];
    const messageIndex = messages.findIndex(
      (message) =>
        message.id === input.messageId && message.sequence >= visibleFrom,
    );
    const current = messages[messageIndex];
    if (!current) throw new Error("Message was not found.");
    if (current.deletedAt) {
      throw new PilotStoreError(
        "MESSAGE_DELETED",
        409,
        "Deleted messages cannot be changed.",
      );
    }

    const reactionUpdate = updateMessageReactions(current.reactions ?? [], {
      principalId: input.principalId,
      emoji: input.emoji,
      reacted: input.reacted,
    });
    if (!reactionUpdate.changed) return current;

    const updated: ThreadMessage = {
      ...current,
      revision: (current.revision ?? 1) + 1,
    };
    if (reactionUpdate.reactions.length > 0) {
      updated.reactions = reactionUpdate.reactions;
    } else {
      delete updated.reactions;
    }
    const nextMessages = [...messages];
    nextMessages[messageIndex] = updated;
    this.messages.set(input.threadId, nextMessages);
    this.recordConversationChange(
      thread,
      input.principalId,
      "message_updated",
      uuidv7(),
      input.messageId,
    );
    return updated;
  }

  editThreadMessage(input: {
    threadId: ThreadId;
    messageId: ThreadMessage["id"];
    principalId: PrincipalId;
    body: string;
    mentionedPrincipalIds?: PrincipalId[];
  }): ThreadMessage {
    const thread = this.threads.get(input.threadId);
    const visibleFrom =
      this.threadVisibility.get(`${input.threadId}:${input.principalId}`) ?? 1;
    if (!thread?.participantIds.includes(input.principalId)) {
      throw new Error("Thread was not found.");
    }
    const messages = this.messages.get(input.threadId) ?? [];
    const messageIndex = messages.findIndex(
      (message) =>
        message.id === input.messageId && message.sequence >= visibleFrom,
    );
    const current = messages[messageIndex];
    if (!current) throw new Error("Message was not found.");
    assertMutableThreadMessage({
      thread,
      message: current,
      actorId: input.principalId,
    });
    if (!current.serverReadable || current.encryptedBody) {
      throw new PilotStoreError(
        "MESSAGE_NOT_MUTABLE",
        409,
        "Encrypted messages cannot be edited.",
      );
    }
    const trimmed = input.body.trim();
    if (!trimmed && !(current.attachments?.length ?? 0)) {
      throw new Error("Edited messages require a non-empty body.");
    }
    const mentionedPrincipalIds = normalizeMentionIds(
      thread,
      input.principalId,
      input.mentionedPrincipalIds,
    );
    const editedAt = new Date().toISOString();
    const updated: ThreadMessage = {
      ...current,
      body: trimmed,
      editedAt,
      revision: (current.revision ?? 1) + 1,
    };
    if (mentionedPrincipalIds.length > 0) {
      updated.mentionedPrincipalIds = mentionedPrincipalIds;
    } else {
      delete updated.mentionedPrincipalIds;
    }
    const nextMessages = [...messages];
    nextMessages[messageIndex] = updated;
    this.messages.set(input.threadId, nextMessages);
    this.recordConversationChange(
      thread,
      input.principalId,
      "message_edited",
      uuidv7(),
      input.messageId,
    );
    return updated;
  }

  deleteThreadMessage(input: {
    threadId: ThreadId;
    messageId: ThreadMessage["id"];
    principalId: PrincipalId;
  }): void {
    const thread = this.threads.get(input.threadId);
    const visibleFrom =
      this.threadVisibility.get(`${input.threadId}:${input.principalId}`) ?? 1;
    if (!thread?.participantIds.includes(input.principalId)) {
      throw new Error("Thread was not found.");
    }
    const messages = this.messages.get(input.threadId) ?? [];
    const messageIndex = messages.findIndex(
      (message) =>
        message.id === input.messageId && message.sequence >= visibleFrom,
    );
    const current = messages[messageIndex];
    if (!current) throw new Error("Message was not found.");
    assertMutableThreadMessage({
      thread,
      message: current,
      actorId: input.principalId,
    });
    const nextMessages = [...messages];
    nextMessages[messageIndex] = tombstoneThreadMessage(
      current,
      new Date().toISOString(),
    );
    this.messages.set(input.threadId, nextMessages);
    this.recordConversationChange(
      thread,
      input.principalId,
      "message_deleted",
      uuidv7(),
      input.messageId,
    );
  }

  /** Read markers only move forward; see the Postgres store for why. */
  markThreadRead(
    threadId: ThreadId,
    principalId: PrincipalId,
    sequence: number,
  ): void {
    const thread = this.threads.get(threadId);
    if (!thread || !thread.participantIds.includes(principalId)) {
      throw new Error("Thread was not found.");
    }
    if (sequence > thread.sequence) {
      throw new Error("Read sequence exceeds the Thread head.");
    }
    const key = `${threadId}:${principalId}`;
    const current = this.threadReads.get(key)?.lastReadSequence ?? 0;
    if (sequence <= current) return;
    this.threadReads.set(key, {
      threadId,
      lastReadSequence: sequence,
    });
    this.recordConversationChange(
      thread,
      principalId,
      "read_cursor_changed",
      uuidv7(),
    );
  }

  listThreadReads(
    principalId: PrincipalId,
  ): Array<{ threadId: ThreadId; lastReadSequence: number }> {
    return [...this.threadReads.entries()]
      .filter(([key]) => key.endsWith(`:${principalId}`))
      .map(([, value]) => value);
  }

  listThreadMessages(
    threadId: ThreadId,
    principalId: PrincipalId,
    query: ThreadMessagePageQuery,
  ): ThreadMessagePage | undefined {
    const thread = this.threads.get(threadId);
    if (!thread || !thread.participantIds.includes(principalId)) {
      return undefined;
    }
    const all = this.messages.get(threadId) ?? [];
    const visibleFrom =
      this.threadVisibility.get(`${threadId}:${principalId}`) ?? 1;
    const visible = all.filter((message) => message.sequence >= visibleFrom);
    let candidates: ThreadMessage[];
    let hasMore = false;
    if (query.afterSequence !== undefined) {
      const matching = visible.filter(
        (message) => message.sequence > query.afterSequence!,
      );
      candidates = matching.slice(0, query.limit);
      hasMore = matching.length > candidates.length;
    } else if (query.beforeSequence !== undefined) {
      const matching = visible.filter(
        (message) => message.sequence < query.beforeSequence!,
      );
      candidates = matching.slice(-query.limit);
      hasMore = matching.length > candidates.length;
    } else if (query.aroundSequence !== undefined) {
      const around = query.aroundSequence;
      const before = visible
        .filter((message) => message.sequence <= around)
        .slice(-Math.ceil(query.limit / 2));
      const after = visible
        .filter((message) => message.sequence > around)
        .slice(0, Math.floor(query.limit / 2));
      candidates = [...before, ...after];
      hasMore =
        (visible[0] !== undefined &&
          candidates[0] !== undefined &&
          visible[0].sequence < candidates[0].sequence) ||
        (visible.at(-1)?.sequence ?? 0) > (candidates.at(-1)?.sequence ?? 0);
    } else {
      const limit = query.tail ?? query.limit;
      candidates = visible.slice(-limit);
      hasMore = visible.length > candidates.length;
    }
    return {
      items: structuredClone(candidates),
      headSequence: thread.sequence,
      accessVersion: thread.accessVersion ?? 1,
      hasMore,
    };
  }

  getThreadMessage(
    threadId: ThreadId,
    principalId: PrincipalId,
    messageId: ThreadMessage["id"],
  ): ThreadMessage | undefined {
    if (!this.hasThreadAccess(threadId, principalId)) return undefined;
    const visibleFrom =
      this.threadVisibility.get(`${threadId}:${principalId}`) ?? 1;
    return (this.messages.get(threadId) ?? []).find(
      (message) => message.id === messageId && message.sequence >= visibleFrom,
    );
  }

  searchMessages(
    principalId: PrincipalId,
    input: {
      filters: SearchMessageFilters;
      cursor?: string | undefined;
      limit: number;
    },
  ): MessageSearchPage {
    const cursor = input.cursor
      ? decodeMessageSearchCursor(input.cursor)
      : undefined;
    const queryTokens = tokenizeSearchText(input.filters.text);
    const ranked: Array<{
      message: ThreadMessage;
      thread: ConversationThread;
      rank: number;
      snippet: string;
    }> = [];
    for (const thread of this.threads.values()) {
      if (
        !this.messageSearchThreadVisible(thread, principalId, input.filters)
      ) {
        continue;
      }
      const visibleFrom =
        this.threadVisibility.get(`${thread.id}:${principalId}`) ?? 1;
      for (const message of this.messages.get(thread.id) ?? []) {
        if (
          !this.messageSearchCandidateVisible(
            message,
            principalId,
            visibleFrom,
            input.filters,
          )
        ) {
          continue;
        }
        const rank = rankSearchMessage(message.body, queryTokens);
        if (queryTokens.length > 0 && rank === 0) continue;
        if (cursor && !isAfterSearchCursor(rank, message, cursor)) continue;
        ranked.push({
          message,
          thread,
          rank,
          snippet: highlightSearchSnippet(message.body, queryTokens),
        });
      }
    }
    ranked.sort((left, right) => {
      if (right.rank !== left.rank) return right.rank - left.rank;
      const byTime = right.message.createdAt.localeCompare(
        left.message.createdAt,
      );
      if (byTime !== 0) return byTime;
      return right.message.id.localeCompare(left.message.id);
    });
    const page = ranked.slice(0, input.limit);
    const last = page.at(-1);
    return {
      items: page.map(({ message, thread, snippet }) =>
        messageSearchResult(thread, message, snippet),
      ),
      ...(ranked.length > input.limit && last
        ? {
            nextCursor: encodeMessageSearchCursor({
              rank: last.rank,
              createdAt: last.message.createdAt,
              id: last.message.id,
            }),
          }
        : {}),
    };
  }

  private messageSearchThreadVisible(
    thread: ConversationThread,
    principalId: PrincipalId,
    filters: SearchMessageFilters,
  ): boolean {
    if (!thread.participantIds.includes(principalId)) return false;
    if (filters.inThreadId && thread.id !== filters.inThreadId) return false;
    if (
      filters.inTitle &&
      !thread.title
        .toLocaleLowerCase()
        .includes(filters.inTitle.toLocaleLowerCase())
    ) {
      return false;
    }
    return true;
  }

  private messageSearchCandidateVisible(
    message: ThreadMessage,
    principalId: PrincipalId,
    visibleFrom: number,
    filters: SearchMessageFilters,
  ): boolean {
    if (message.deletedAt) return false;
    if (!message.serverReadable) return false;
    if (message.sequence < visibleFrom) return false;
    if (
      filters.fromPrincipalId &&
      message.senderId !== filters.fromPrincipalId
    ) {
      return false;
    }
    if (filters.fromDisplayName) {
      const name = this.principals.get(message.senderId)?.displayName ?? "";
      if (
        !name
          .toLocaleLowerCase()
          .includes(filters.fromDisplayName.toLocaleLowerCase())
      ) {
        return false;
      }
    }
    if (
      filters.before &&
      message.createdAt >= `${filters.before}T00:00:00.000Z`
    ) {
      return false;
    }
    if (filters.after && message.createdAt < `${filters.after}T00:00:00.000Z`) {
      return false;
    }
    if (filters.hasAttachment && !(message.attachments?.length ?? 0)) {
      return false;
    }
    return true;
  }

  getStoredThreadMessage(
    threadId: ThreadId,
    messageId: ThreadMessage["id"],
  ): ThreadMessage | undefined {
    return (this.messages.get(threadId) ?? []).find(
      (message) => message.id === messageId,
    );
  }

  hideMessagePreviews(
    threadId: ThreadId,
    messageId: ThreadMessage["id"],
    principalId: PrincipalId,
  ): ThreadMessage {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error("Thread was not found.");
    const messages = this.messages.get(threadId) ?? [];
    const index = messages.findIndex((message) => message.id === messageId);
    const current = messages[index];
    if (!current) throw new Error("Message was not found.");
    if (current.senderId !== principalId) {
      throw new Error("Only the sender can hide link previews.");
    }
    if (current.previewsHidden) return current;
    const updated: ThreadMessage = {
      ...current,
      previewsHidden: true,
      revision: (current.revision ?? 1) + 1,
    };
    const next = [...messages];
    next[index] = updated;
    this.messages.set(threadId, next);
    this.recordConversationChange(
      thread,
      principalId,
      "message_updated",
      uuidv7(),
      messageId,
    );
    return updated;
  }

  attachMessagePreviewUrls(
    threadId: ThreadId,
    messageId: ThreadMessage["id"],
    previewUrls: string[],
  ): ThreadMessage {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error("Thread was not found.");
    const messages = this.messages.get(threadId) ?? [];
    const index = messages.findIndex((message) => message.id === messageId);
    const current = messages[index];
    if (!current) throw new Error("Message was not found.");
    const updated: ThreadMessage = {
      ...current,
      ...(previewUrls.length ? { previewUrls } : {}),
      revision: (current.revision ?? 1) + 1,
    };
    const next = [...messages];
    next[index] = updated;
    this.messages.set(threadId, next);
    this.recordConversationChange(
      thread,
      current.senderId,
      "message_updated",
      uuidv7(),
      messageId,
    );
    return updated;
  }

  getLinkPreviews(urls: string[], at = new Date()): LinkPreview[] {
    const now = at.toISOString();
    return urls.flatMap((url) => {
      const preview = this.linkPreviews.get(url);
      if (!preview || preview.expiresAt <= now) return [];
      return [preview];
    });
  }

  putLinkPreview(preview: LinkPreview): LinkPreview {
    this.linkPreviews.set(preview.url, preview);
    return preview;
  }

  private enqueueUnfurl(
    thread: ConversationThread,
    message: ThreadMessage,
  ): void {
    if (
      thread.accessMode === "human_only_e2ee" ||
      !message.serverReadable ||
      !message.previewUrls?.length
    ) {
      return;
    }
    this.outbox.push({
      operationId: uuidv7() as OperationId,
      topic: "conversation.unfurl.enqueue",
      payload: {
        schemaVersion: 1,
        organizationId: DEMO_ORGANIZATION_ID,
        threadId: thread.id,
        messageId: message.id,
      },
      attempts: 0,
      availableAt: message.createdAt,
    });
  }

  concludeThreadIntoParent(input: {
    threadId: ThreadId;
    actorId: PrincipalId;
    conclusion: string;
    messageId: ThreadMessage["id"];
    at: string;
  }): { thread: ConversationThread; parentMessage: ThreadMessage } {
    const thread = this.threads.get(input.threadId);
    if (!thread) throw new Error("Thread was not found.");
    if (!thread.parentThreadId) {
      throw new Error("Thread did not branch from another conversation.");
    }
    if (!thread.participantIds.includes(input.actorId)) {
      throw new Error("Only a participant can conclude the Thread.");
    }
    const parent = this.threads.get(thread.parentThreadId);
    if (!parent) throw new Error("Parent Thread was not found.");
    if (!parent.participantIds.includes(input.actorId)) {
      throw new Error("Only a participant of the parent can conclude.");
    }
    const existing = (this.messages.get(parent.id) ?? []).find(
      (message) => message.id === input.messageId,
    );
    if (thread.concludedAt) {
      if (
        existing &&
        existing.senderId === input.actorId &&
        existing.body === input.conclusion
      ) {
        return { thread, parentMessage: existing };
      }
      throw new Error("Thread was already concluded.");
    }
    if (existing) throw new Error("Client message ID was already used.");
    const parentMessage = buildThreadMessage(parent, {
      id: input.messageId,
      senderId: input.actorId,
      body: input.conclusion,
      createdAt: input.at,
    });
    this.threads.set(parent.id, {
      ...parent,
      sequence: parentMessage.sequence,
      latestMessageAt: parentMessage.createdAt,
    });
    this.messages.set(parent.id, [
      ...(this.messages.get(parent.id) ?? []),
      parentMessage,
    ]);
    const concluded: ConversationThread = {
      ...thread,
      concludedAt: input.at,
      concludedBy: input.actorId,
    };
    this.threads.set(thread.id, concluded);
    this.recordConversationChange(
      this.threads.get(parent.id)!,
      input.actorId,
      "message_appended",
      parentMessage.id,
    );
    this.recordConversationChange(
      concluded,
      input.actorId,
      "thread_concluded",
      uuidv7(),
    );
    return { thread: concluded, parentMessage };
  }

  concludeCoordinationThread(input: {
    threadId: ThreadId;
    actorId: PrincipalId;
    at: string;
  }): ConversationThread {
    const thread = this.threads.get(input.threadId);
    if (!thread || thread.kind !== "coordination" || !thread.parentThreadId) {
      throw new Error("Coordination Thread was not found.");
    }
    if (!thread.participantIds.includes(input.actorId)) {
      throw new Error("Only a participant can conclude the Thread.");
    }
    if (thread.concludedAt) return thread;
    const concluded: ConversationThread = {
      ...thread,
      concludedAt: input.at,
      concludedBy: input.actorId,
    };
    this.threads.set(thread.id, concluded);
    this.recordConversationChange(
      concluded,
      input.actorId,
      "thread_concluded",
      uuidv7(),
    );
    return concluded;
  }

  addStandInToThread(
    threadId: ThreadId,
    actorId: PrincipalId,
  ): { thread: ConversationThread; event: ThreadMessage } {
    const current = this.threads.get(threadId);
    if (!current) throw new Error("Thread was not found.");
    const standInId = personalStandInId(actorId);
    this.ensurePrincipal(standInId, "stand_in");
    this.ensurePrincipal(actorId, "human");
    const transition = addStandIn(current, standInId, actorId);
    const updatedThread = {
      ...transition.thread,
      accessVersion: (current.accessVersion ?? 1) + 1,
      latestMessageAt: transition.event.createdAt,
    };
    this.threads.set(threadId, updatedThread);
    this.messages.set(threadId, [
      ...(this.messages.get(threadId) ?? []),
      transition.event,
    ]);
    this.recordConversationChange(
      updatedThread,
      actorId,
      "access_changed",
      transition.event.id,
    );
    return { ...transition, thread: updatedThread };
  }

  createSpec(input: {
    spec: Omit<Spec, "currentRevisionId" | "createdAt">;
    markdown: string;
    changeSummary: string;
    affectedScopes: string[];
    createdBy: PrincipalId;
  }): { spec: Spec; revision: SpecRevision } {
    this.ensurePrincipal(input.createdBy, "human");
    const revision = createSpecRevision({
      specId: input.spec.id,
      revision: 1,
      markdown: input.markdown,
      changeSummary: input.changeSummary,
      affectedScopes: input.affectedScopes,
      createdBy: input.createdBy,
    });
    const spec: Spec = {
      ...input.spec,
      currentRevisionId: revision.id,
      createdAt: revision.createdAt,
    };
    this.specs.set(spec.id, spec);
    this.revisions.set(spec.id, [revision]);
    this.reviews.set(spec.id, []);
    this.createInboxItem(
      input.createdBy,
      "review_request",
      spec.title,
      input.changeSummary,
      `spec:${spec.id}:revision:${revision.id}`,
    );
    return { spec, revision };
  }

  addSpecRevision(
    specId: SpecId,
    input: Omit<SpecRevision, "id" | "blocks" | "createdAt">,
  ): SpecRevision {
    const spec = this.specs.get(specId);
    if (!spec) throw new Error("Spec was not found.");
    const existing = this.revisions.get(specId) ?? [];
    const revision = createSpecRevision({
      ...input,
      specId,
      revision: existing.length + 1,
    });
    const reviews = invalidateAffectedReviews(
      this.reviews.get(specId) ?? [],
      revision,
    );
    this.reviews.set(specId, reviews);
    this.revisions.set(specId, [...existing, revision]);
    this.specs.set(specId, {
      ...spec,
      currentRevisionId: revision.id,
      status: "in_review",
    });
    return revision;
  }

  addReview(specId: SpecId, review: SpecReviewResponse): SpecReviewResponse {
    const spec = this.specs.get(specId);
    if (!spec) throw new Error("Spec was not found.");
    if (review.revisionId !== spec.currentRevisionId) {
      throw new Error("Review response must target the current Spec revision.");
    }
    this.ensurePrincipal(
      review.reviewerId,
      review.kind === "stand_in_impact_analysis" ? "stand_in" : "human",
    );
    this.reviews.set(specId, [...(this.reviews.get(specId) ?? []), review]);
    if (review.kind === "human_changes_requested") {
      this.specs.set(specId, { ...spec, status: "changes_requested" });
    } else if (review.kind === "human_approval") {
      this.specs.set(specId, { ...spec, status: "approved" });
    }
    return review;
  }

  createDecision(
    input: Omit<DecisionRecord, "id" | "createdAt">,
  ): DecisionRecord {
    const decision: DecisionRecord = {
      ...input,
      id: uuidv7() as DecisionRecord["id"],
      createdAt: new Date().toISOString(),
    };
    this.decisions.set(decision.id, decision);
    return decision;
  }

  createDecisionOnce(
    input: Omit<DecisionRecord, "id" | "createdAt">,
  ): DecisionRecord {
    if (input.sourceThreadId) {
      const existing = [...this.decisions.values()].find(
        (decision) => decision.sourceThreadId === input.sourceThreadId,
      );
      if (existing) return existing;
    }
    return this.createDecision(input);
  }

  cursor(after: number, limit: number) {
    const items = this.activities
      .filter((event) => event.sequence > after)
      .slice(0, limit);
    const nextCursor = items.at(-1)?.sequence ?? after;
    return {
      items,
      nextCursor,
      hasMore: this.activities.some((event) => event.sequence > nextCursor),
    };
  }

  listProjections(): PublicWorkProjection[] {
    return [...this.projections.values()];
  }

  private ensureKanbanWorkstreams(workstreamIds: WorkstreamId[]): void {
    for (const workstreamId of workstreamIds) {
      if (
        !this.workstreams.has(workstreamId) &&
        !this.projections.has(workstreamId)
      ) {
        throw new Error("Related Workstream was not found.");
      }
    }
  }

  listInbox(principalId?: PrincipalId): ActionInboxItem[] {
    return [...this.inbox.values()].filter(
      (item) =>
        item.resolvedAt === undefined &&
        (principalId === undefined || item.principalId === principalId),
    );
  }

  listThreads(kind?: ConversationThread["kind"], principalId?: PrincipalId) {
    return [...this.threads.values()]
      .filter(
        (thread) =>
          (kind === undefined || thread.kind === kind) &&
          (principalId === undefined ||
            thread.participantIds.includes(principalId)),
      )
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((thread) => {
        const visibleFrom = principalId
          ? (this.threadVisibility.get(`${thread.id}:${principalId}`) ?? 1)
          : 1;
        const messages = (this.messages.get(thread.id) ?? []).filter(
          (message) => message.sequence >= visibleFrom,
        );
        const lastRead = principalId
          ? (this.threadReads.get(`${thread.id}:${principalId}`)
              ?.lastReadSequence ?? 0)
          : 0;
        return {
          thread,
          messages: messages.slice(-100),
          unreadCount: principalId
            ? messages.filter(
                (message) =>
                  message.sequence > lastRead &&
                  message.senderId !== principalId,
              ).length
            : 0,
          mentionCount: principalId
            ? messages.filter(
                (message) =>
                  message.sequence > lastRead &&
                  message.senderId !== principalId &&
                  message.mentionedPrincipalIds?.includes(principalId),
              ).length
            : 0,
        };
      });
  }

  getThread(threadId: ThreadId, principalId?: PrincipalId) {
    const thread = this.threads.get(threadId);
    if (
      !thread ||
      (principalId !== undefined &&
        !thread.participantIds.includes(principalId))
    ) {
      return undefined;
    }
    const visibleFrom = principalId
      ? (this.threadVisibility.get(`${thread.id}:${principalId}`) ?? 1)
      : 1;
    const messages = (this.messages.get(threadId) ?? []).filter(
      (message) => message.sequence >= visibleFrom,
    );
    const lastRead = principalId
      ? (this.threadReads.get(`${thread.id}:${principalId}`)
          ?.lastReadSequence ?? 0)
      : 0;
    return {
      thread,
      messages: messages.slice(-100),
      unreadCount: principalId
        ? messages.filter(
            (message) =>
              message.sequence > lastRead && message.senderId !== principalId,
          ).length
        : 0,
      mentionCount: principalId
        ? messages.filter(
            (message) =>
              message.sequence > lastRead &&
              message.senderId !== principalId &&
              message.mentionedPrincipalIds?.includes(principalId),
          ).length
        : 0,
    };
  }

  hasThreadAccess(threadId: ThreadId, principalId: PrincipalId): boolean {
    return (
      this.threads.get(threadId)?.participantIds.includes(principalId) ?? false
    );
  }

  listVisiblePeerPrincipalIds(
    viewerId: PrincipalId,
    candidateIds: readonly PrincipalId[],
  ): PrincipalId[] {
    const wanted = new Set(candidateIds);
    const visible = new Set<PrincipalId>();
    if (wanted.has(viewerId)) visible.add(viewerId);
    for (const thread of this.threads.values()) {
      if (!thread.participantIds.includes(viewerId)) continue;
      for (const principalId of thread.participantIds) {
        if (wanted.has(principalId)) visible.add(principalId);
      }
    }
    return candidateIds.filter((principalId) => visible.has(principalId));
  }

  getThreadAccessVersion(
    threadId: ThreadId,
    principalId: PrincipalId,
  ): number | undefined {
    const thread = this.threads.get(threadId);
    return thread?.participantIds.includes(principalId)
      ? (thread.accessVersion ?? 1)
      : undefined;
  }

  getMessageAtSequence(
    threadId: ThreadId,
    sequence: number,
  ): { thread: ConversationThread; message: ThreadMessage } | undefined {
    const thread = this.threads.get(threadId);
    const message = (this.messages.get(threadId) ?? []).find(
      (item) => item.sequence === sequence,
    );
    if (!thread || !message) return undefined;
    return { thread, message };
  }

  upsertWebPushSubscription(
    principalId: PrincipalId,
    input: UpsertWebPushSubscriptionRequest,
  ): WebPushSubscription {
    const now = new Date().toISOString();
    const existing = [...this.webPushSubscriptions.values()].find(
      (item) => item.endpoint === input.endpoint,
    );
    const subscription: WebPushSubscription = {
      id: existing?.id ?? uuidv7(),
      principalId,
      endpoint: input.endpoint,
      keys: input.keys,
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
    };
    this.webPushSubscriptions.set(subscription.id, subscription);
    return subscription;
  }

  deleteWebPushSubscription(
    principalId: PrincipalId,
    endpoint: string,
  ): boolean {
    for (const [id, subscription] of this.webPushSubscriptions) {
      if (
        subscription.principalId === principalId &&
        subscription.endpoint === endpoint
      ) {
        this.webPushSubscriptions.delete(id);
        return true;
      }
    }
    return false;
  }

  deleteWebPushSubscriptionByEndpoint(endpoint: string): boolean {
    for (const [id, subscription] of this.webPushSubscriptions) {
      if (subscription.endpoint === endpoint) {
        this.webPushSubscriptions.delete(id);
        return true;
      }
    }
    return false;
  }

  listWebPushSubscriptions(principalId: PrincipalId): WebPushSubscription[] {
    return [...this.webPushSubscriptions.values()].filter(
      (item) => item.principalId === principalId,
    );
  }

  listWebPushSubscriptionsForPrincipals(
    principalIds: PrincipalId[],
  ): WebPushSubscription[] {
    const allowed = new Set(principalIds);
    return [...this.webPushSubscriptions.values()].filter((item) =>
      allowed.has(item.principalId),
    );
  }

  private recordConversationChange(
    thread: ConversationThread,
    actorId: PrincipalId,
    reason: ConversationChangeReason,
    eventId: string,
    messageId?: ThreadMessage["id"],
  ): void {
    const operationId = eventId as OperationId;
    const occurredAt = new Date().toISOString();
    const activity: ActivityEvent = {
      sequence: ++this.#sequence,
      organizationId: DEMO_ORGANIZATION_ID,
      operationId,
      actorId,
      aggregateType: "conversation",
      aggregateId: thread.id,
      eventType: "conversation.changed",
      metadata: {
        reason,
        headSequence: String(thread.sequence),
        accessVersion: String(thread.accessVersion ?? 1),
      },
      occurredAt,
    };
    this.activities.push(activity);
    this.outbox.push({
      operationId,
      topic: "conversation.changed",
      payload: {
        schemaVersion: 1,
        eventId,
        type: "conversation.changed",
        threadId: thread.id,
        headSequence: thread.sequence,
        accessVersion: thread.accessVersion ?? 1,
        reason,
        ...(messageId ? { messageId } : {}),
        occurredAt,
      },
      attempts: 0,
      availableAt: occurredAt,
    });
  }

  getSpec(specId: SpecId) {
    const spec = this.specs.get(specId);
    return spec
      ? {
          spec,
          revisions: this.revisions.get(specId) ?? [],
          reviews: this.reviews.get(specId) ?? [],
        }
      : undefined;
  }

  listSpecs() {
    return [...this.specs.values()]
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((spec) => this.getSpec(spec.id))
      .filter(
        (
          item,
        ): item is {
          spec: Spec;
          revisions: SpecRevision[];
          reviews: SpecReviewResponse[];
        } => item !== undefined,
      );
  }

  upsertPrincipal(principal: PrincipalSummary): PrincipalSummary {
    this.principals.set(principal.id, principal);
    return principal;
  }

  listPrincipals(ids: PrincipalId[]): PrincipalSummary[] {
    return [...new Set(ids)]
      .map((id) => this.principals.get(id))
      .filter((item): item is PrincipalSummary => item !== undefined);
  }

  listActionEnvelopes(ids: OperationId[]): ActionEnvelope[] {
    return [...new Set(ids)]
      .map((id) => this.envelopes.get(id))
      .filter((item): item is ActionEnvelope => item !== undefined);
  }

  listDecisions(): DecisionRecord[] {
    return [...this.decisions.values()];
  }

  latestProjectionFreshness(): string | undefined {
    return this.listProjections()
      .map((projection) => projection.freshnessAt)
      .toSorted()
      .at(-1);
  }

  listActivity(): ActivityEvent[] {
    return [...this.activities];
  }

  private requireWorkstream(id: WorkstreamId): Workstream {
    const workstream = this.workstreams.get(id);
    if (!workstream) throw new Error("Workstream was not found.");
    return workstream;
  }

  private ensurePrincipal(
    id: PrincipalId,
    kind: PrincipalSummary["kind"],
  ): void {
    const existing = this.principals.get(id);
    if (existing) {
      if (kind === "stand_in" && existing.kind !== "stand_in") {
        this.principals.set(id, { ...existing, kind });
      }
      return;
    }
    this.principals.set(id, {
      id,
      displayName:
        kind === "stand_in" ? "Intero Stand-in" : `Principal ${id.slice(0, 8)}`,
      kind,
    });
  }

  private createInboxItem(
    principalId: PrincipalId,
    kind: ActionInboxItem["kind"],
    title: string,
    detail: string,
    sourceRef: string,
  ): ActionInboxItem {
    const item: ActionInboxItem = {
      id: uuidv7(),
      principalId,
      kind,
      title,
      detail,
      sourceRef,
      createdAt: new Date().toISOString(),
    };
    this.inbox.set(item.id, item);
    return item;
  }

  private humanThreadParticipant(
    threadId: ThreadId,
    actorId: PrincipalId,
  ): PrincipalId | undefined {
    const thread = this.threads.get(threadId);
    return thread?.participantIds.find(
      (principalId) =>
        principalId !== actorId &&
        this.principals.get(principalId)?.kind === "human",
    );
  }

  private coordinationResult(
    envelope: ActionEnvelope,
    status: CoordinationResult["status"],
    summary: string,
  ): CoordinationResult {
    return {
      threadId: envelope.threadId,
      status,
      summary,
      freshnessAt: new Date().toISOString(),
      stale: false,
      actionOperationIds: status === "resolved" ? [envelope.operationId] : [],
      evidenceRefs: envelope.evidenceRefs,
      suggestedAgentAction:
        status === "resolved"
          ? "continue"
          : status === "needs_human"
            ? "ask_human"
            : status === "waiting"
              ? "wait"
              : "narrow",
    };
  }

  private commit<T extends object>(
    eventType: string,
    aggregateId: string,
    actorId: PrincipalId,
    value: T,
  ): MutationResult<T> {
    const operationId = uuidv7() as OperationId;
    const occurredAt = new Date().toISOString();
    const activity: ActivityEvent = {
      sequence: ++this.#sequence,
      organizationId: DEMO_ORGANIZATION_ID,
      operationId,
      actorId,
      aggregateType: eventType.split(".")[0] ?? "domain",
      aggregateId,
      eventType,
      metadata: { version: "1" },
      occurredAt,
    };
    const outbox: OutboxEntry = {
      operationId,
      topic: eventType,
      payload: {
        aggregateId,
        sequence: activity.sequence,
        eventType,
        occurredAt,
      },
      attempts: 0,
      availableAt: occurredAt,
    };
    this.activities.push(activity);
    this.outbox.push(outbox);
    return { value, activity, outbox };
  }
}

export function buildThreadMessage(
  thread: ConversationThread,
  input: {
    id: ThreadMessage["id"];
    senderId: PrincipalId;
    body?: string;
    encryptedBody?: string;
    mentionedPrincipalIds?: PrincipalId[];
    attachments?: ThreadMessageAttachment[];
    replyToMessageId?: ThreadMessage["id"];
    streamState?: ThreadMessageStreamState;
    createdAt: string;
  },
): ThreadMessage {
  if (thread.accessMode === "human_only_e2ee") {
    if (!input.encryptedBody || input.body) {
      throw new Error(
        "Human-only messages require ciphertext and reject server-readable body.",
      );
    }
    return {
      id: input.id,
      threadId: thread.id,
      senderId: input.senderId,
      sequence: thread.sequence + 1,
      kind: "message",
      body: "",
      encryptedBody: input.encryptedBody,
      createdAt: input.createdAt,
      serverReadable: false,
      ...(input.replyToMessageId
        ? { replyToMessageId: input.replyToMessageId }
        : {}),
      streamState: "complete",
      revision: 1,
    };
  }
  const streamState = input.streamState ?? "complete";
  const hasVisibleContent =
    Boolean(input.body?.trim()) || Boolean(input.attachments?.length);
  if (
    input.encryptedBody ||
    (!hasVisibleContent &&
      streamState !== "pending" &&
      streamState !== "streaming")
  ) {
    throw new Error("Agent-readable messages require a server-readable body.");
  }
  return {
    id: input.id,
    threadId: thread.id,
    senderId: input.senderId,
    sequence: thread.sequence + 1,
    kind: "message",
    body: input.body ?? "",
    createdAt: input.createdAt,
    serverReadable: true,
    ...(input.mentionedPrincipalIds?.length
      ? { mentionedPrincipalIds: input.mentionedPrincipalIds }
      : {}),
    ...(input.replyToMessageId
      ? { replyToMessageId: input.replyToMessageId }
      : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    streamState,
    revision: 1,
  };
}

export function withExtractedPreviewUrls(
  thread: ConversationThread,
  message: ThreadMessage,
): ThreadMessage {
  if (thread.accessMode === "human_only_e2ee" || !message.serverReadable) {
    return message;
  }
  const previewUrls = extractHttpUrls(message.body);
  return previewUrls.length ? { ...message, previewUrls } : message;
}

export function messageMetadata(
  message: ThreadMessage,
): Record<string, unknown> {
  return {
    ...(message.coordinationSummary
      ? { coordinationSummary: message.coordinationSummary }
      : {}),
    ...(message.previewUrls?.length
      ? { previewUrls: message.previewUrls }
      : {}),
    ...(message.previewsHidden ? { previewsHidden: true } : {}),
  };
}

export function updateMessageReactions(
  current: readonly ThreadMessageReaction[],
  input: {
    principalId: PrincipalId;
    emoji: ReactionEmoji;
    reacted: boolean;
  },
): { changed: boolean; reactions: ThreadMessageReaction[] } {
  const reactions = current.map((reaction) => ({
    ...reaction,
    principalIds: [...reaction.principalIds],
  }));
  const reactionIndex = reactions.findIndex(
    (reaction) => reaction.emoji === input.emoji,
  );
  const reaction = reactions[reactionIndex];
  const alreadyReacted =
    reaction?.principalIds.includes(input.principalId) ?? false;
  if (alreadyReacted === input.reacted) {
    return { changed: false, reactions };
  }

  if (reaction && input.reacted) {
    if (reaction.principalIds.length >= 100) {
      throw new Error("This reaction has reached its participant limit.");
    }
    reaction.principalIds.push(input.principalId);
  } else if (reaction) {
    reaction.principalIds = reaction.principalIds.filter(
      (principalId) => principalId !== input.principalId,
    );
    if (reaction.principalIds.length === 0) reactions.splice(reactionIndex, 1);
  } else {
    if (reactions.length >= 40) {
      throw new Error("This message has reached its reaction limit.");
    }
    reactions.push({
      emoji: input.emoji,
      principalIds: [input.principalId],
    });
  }
  return { changed: true, reactions };
}

export function assertMutableThreadMessage(input: {
  thread: ConversationThread;
  message: ThreadMessage;
  actorId: PrincipalId;
}): void {
  if (input.thread.concludedAt) {
    throw new PilotStoreError(
      "THREAD_CONCLUDED",
      409,
      "Concluded threads cannot be edited.",
    );
  }
  if (input.message.deletedAt) {
    throw new PilotStoreError(
      "MESSAGE_DELETED",
      409,
      "Deleted messages cannot be changed.",
    );
  }
  if (input.message.kind !== "message") {
    throw new PilotStoreError(
      "MESSAGE_NOT_MUTABLE",
      409,
      "Only ordinary messages can be edited or deleted.",
    );
  }
  if (
    input.message.streamState === "pending" ||
    input.message.streamState === "streaming"
  ) {
    throw new PilotStoreError(
      "MESSAGE_NOT_MUTABLE",
      409,
      "Only ordinary messages can be edited or deleted.",
    );
  }
  if (input.thread.standInIds.includes(input.message.senderId)) {
    throw new PilotStoreError(
      "MESSAGE_NOT_MUTABLE",
      409,
      "Stand-in messages cannot be edited or deleted.",
    );
  }
  if (input.message.senderId !== input.actorId) {
    throw new PilotStoreError(
      "MESSAGE_FORBIDDEN",
      403,
      "Only the sender can edit or delete this message.",
    );
  }
}

export function tombstoneThreadMessage(
  message: ThreadMessage,
  deletedAt: string,
): ThreadMessage {
  const tombstone: ThreadMessage = {
    id: message.id,
    threadId: message.threadId,
    senderId: message.senderId,
    sequence: message.sequence,
    kind: message.kind,
    body: "",
    createdAt: message.createdAt,
    serverReadable: message.serverReadable,
    deletedAt,
    revision: (message.revision ?? 1) + 1,
  };
  if (message.replyToMessageId) {
    tombstone.replyToMessageId = message.replyToMessageId;
  }
  if (message.streamState) tombstone.streamState = message.streamState;
  if (message.editedAt) tombstone.editedAt = message.editedAt;
  if (message.operationId) tombstone.operationId = message.operationId;
  return tombstone;
}

export function extractMentionIdsFromBody(
  body: string,
  senderId: PrincipalId,
  principals: readonly { id: PrincipalId; displayName: string }[],
): PrincipalId[] {
  const byName = new Map(
    principals
      .filter((principal) => principal.displayName.trim().length > 0)
      .map((principal) => [principal.displayName, principal.id]),
  );
  const names = [...byName.keys()].toSorted(
    (left, right) => right.length - left.length,
  );
  if (names.length === 0) return [];
  const matcher = new RegExp(
    `@(${names.map(escapeRegularExpression).join("|")})(?=$|[\\s，。！？、,.!?:;；：）)\\]】])`,
    "gu",
  );
  const ids: PrincipalId[] = [];
  for (const match of body.matchAll(matcher)) {
    const principalId = byName.get(match[1] ?? "");
    if (principalId && principalId !== senderId && !ids.includes(principalId)) {
      ids.push(principalId);
    }
  }
  return ids;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function normalizeMentionIds(
  thread: ConversationThread,
  senderId: PrincipalId,
  ids: PrincipalId[] = [],
): PrincipalId[] {
  const normalized = [...new Set(ids)];
  if (normalized.length > 20)
    throw new Error("A message has too many mentions.");
  if (
    normalized.some(
      (principalId) =>
        principalId === senderId ||
        !thread.participantIds.includes(principalId),
    )
  ) {
    throw new Error("Mentions must target another active Thread participant.");
  }
  return normalized;
}

export function sameThreadCreation(
  left: ConversationThread,
  right: ConversationThread,
): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.title === right.title &&
    left.accessMode === right.accessMode &&
    left.accessChangedAtSequence === right.accessChangedAtSequence &&
    left.priorHistoryGranted === right.priorHistoryGranted &&
    left.projectId === right.projectId &&
    left.teamId === right.teamId &&
    left.parentThreadId === right.parentThreadId &&
    sameIds(left.participantIds, right.participantIds) &&
    sameIds(left.standInIds, right.standInIds)
  );
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

export function claimFromEvent(event: CanonicalWorkEvent): Claim | undefined {
  if (!event.workstreamId) return undefined;
  const checkpoint = event.payload.checkpointKind;
  if (!checkpoint && event.type !== "ValidationChanged") return undefined;
  const predicate: Claim["predicate"] =
    checkpoint === "intent"
      ? "intent"
      : checkpoint === "decision"
        ? "decision"
        : checkpoint === "blocker"
          ? "blocker"
          : checkpoint === "dependency"
            ? "dependency"
            : checkpoint === "scope"
              ? "scope"
              : checkpoint === "artifact"
                ? "artifact"
                : checkpoint === "pause"
                  ? "paused"
                  : checkpoint === "completion"
                    ? "completed"
                    : "validation";
  const booleanCheckpoint = predicate === "paused" || predicate === "completed";
  const value = booleanCheckpoint
    ? "true"
    : (event.payload.summary ??
      event.payload.validationStatus ??
      event.payload.resourceRef ??
      event.type);
  return {
    id: uuidv7() as Claim["id"],
    workstreamId: event.workstreamId,
    predicate,
    value,
    sourceType:
      event.type === "CheckpointReported"
        ? "coding_agent_report"
        : "direct_observation",
    sourceRef: `${event.source}:${event.id}`,
    observedAt: event.occurredAt,
    confidence: event.type === "CheckpointReported" ? 0.74 : 0.92,
    privacy: event.privacy,
    evidenceRefs: [event.id],
  };
}

function rankSearchMessage(
  body: string,
  queryTokens: readonly string[],
): number {
  if (queryTokens.length === 0) return 0;
  const lower = body.toLocaleLowerCase();
  if (!queryTokens.every((token) => lower.includes(token))) return 0;
  return queryTokens.reduce(
    (sum, token) => sum + lower.split(token).length - 1,
    0,
  );
}

function isAfterSearchCursor(
  rank: number,
  message: ThreadMessage,
  cursor: MessageSearchCursor,
): boolean {
  if (rank !== cursor.rank) return rank < cursor.rank;
  if (message.createdAt !== cursor.createdAt) {
    return message.createdAt < cursor.createdAt;
  }
  return message.id < cursor.id;
}

export function messageSearchResult(
  thread: ConversationThread,
  message: ThreadMessage,
  snippet: string,
): AuthorizedSearchResult {
  return {
    id: message.id,
    type: "message",
    title: thread.title,
    snippet: snippet.slice(0, 500),
    sourceRef: `message:${thread.id}:${message.id}`,
    updatedAt: message.createdAt,
    threadId: thread.id,
    messageId: message.id,
    sequence: message.sequence,
    senderId: message.senderId,
    createdAt: message.createdAt,
    ...(thread.projectId ? { projectId: thread.projectId } : {}),
  };
}

export const systemPrincipalId = SYSTEM_PRINCIPAL_ID;

export function demoSeedingEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function seedDemoStore(store: InMemoryPlatformStore): void {
  const workspaceId =
    "019b5ac0-7600-7000-8000-000000000010" as Workstream["workspaceId"];
  const projectId = "019b5ac0-7600-7000-8000-000000000011" as NonNullable<
    Workstream["projectId"]
  >;
  const workstreams: Array<{
    id: WorkstreamId;
    ownerId: PrincipalId;
    title: string;
    phase: Workstream["phase"];
    checkpoint: Claim["predicate"];
    value: string;
    confidence: number;
  }> = [
    {
      id: "019b5ac0-7600-7000-8000-000000000020" as WorkstreamId,
      ownerId: "019b5ac0-7600-7000-8000-000000000021" as PrincipalId,
      title: "Authorization tuple schema",
      phase: "implementing",
      checkpoint: "decision",
      value: "Keep relationship checks behind the Authorization port.",
      confidence: 0.88,
    },
    {
      id: "019b5ac0-7600-7000-8000-000000000030" as WorkstreamId,
      ownerId: "019b5ac0-7600-7000-8000-000000000031" as PrincipalId,
      title: "Desktop coordination surface",
      phase: "reviewing",
      checkpoint: "dependency",
      value: "Waiting on the Thread access-boundary copy review.",
      confidence: 0.81,
    },
    {
      id: "019b5ac0-7600-7000-8000-000000000040" as WorkstreamId,
      ownerId: "019b5ac0-7600-7000-8000-000000000041" as PrincipalId,
      title: "Cursor repair under reconnect",
      phase: "blocked",
      checkpoint: "blocker",
      value: "Centrifugo replay fixture still drops one sequence.",
      confidence: 0.94,
    },
  ];

  for (const item of workstreams) {
    const created = store.createWorkstream({
      id: item.id,
      workspaceId,
      projectId,
      ownerId: item.ownerId,
      title: item.title,
      phase: item.phase,
      scope: [],
      blockers: [],
      dependencies: [],
      decisions: [],
      artifactIds: [],
      freshnessAt: new Date(Date.now() - 95_000).toISOString(),
      confidence: item.confidence,
    }).value;
    store.addClaim({
      id: uuidv7() as Claim["id"],
      workstreamId: created.id,
      predicate: item.checkpoint,
      value: item.value,
      sourceType:
        item.checkpoint === "blocker"
          ? "direct_observation"
          : "coding_agent_report",
      sourceRef: "demo:canonical-event",
      observedAt: new Date(Date.now() - 65_000).toISOString(),
      confidence: item.confidence,
      privacy: "P3_PROJECT",
      evidenceRefs: ["demo:evidence"],
    });
  }

  store.inbox.set("019b5ac0-7600-7000-8000-000000000050", {
    id: "019b5ac0-7600-7000-8000-000000000050",
    principalId: workstreams[0]!.ownerId,
    kind: "review_request",
    title: "Review the Work State projection",
    detail: "The public schema changes freshness and contradiction fields.",
    sourceRef: "spec:work-state-v2",
    createdAt: new Date(Date.now() - 180_000).toISOString(),
  });

  const humanId = "019b5ac0-7600-7000-8000-000000000021" as PrincipalId;
  const standInId = "019b5ac0-7600-7000-8000-000000000003" as PrincipalId;
  const threadId = "019b5ac0-7600-7000-8000-000000000060" as ThreadId;
  store.createThread({
    id: threadId,
    kind: "stand_in",
    title: "Your Stand-in",
    participantIds: [humanId, standInId],
    standInIds: [standInId],
    accessMode: "agent_readable",
    priorHistoryGranted: false,
    sequence: 0,
    createdAt: new Date(Date.now() - 240_000).toISOString(),
  });
  store.appendMessage(threadId, {
    id: "019b5ac0-7600-7000-8000-000000000061" as ThreadMessage["id"],
    senderId: standInId,
    body: "Three current workstreams are synchronized. One needs attention: cursor recovery remains blocked on a missing sequence.",
    createdAt: new Date(Date.now() - 210_000).toISOString(),
  });
  const roomId = "019b5ac0-7600-7000-8000-000000000070" as ThreadId;
  store.createThread({
    id: roomId,
    kind: "room",
    title: "Intero MVP · Project Room",
    participantIds: [humanId, standInId],
    standInIds: [standInId],
    accessMode: "agent_readable",
    priorHistoryGranted: false,
    sequence: 0,
    createdAt: new Date(Date.now() - 180_000).toISOString(),
  });
  store.appendMessage(roomId, {
    id: "019b5ac0-7600-7000-8000-000000000071" as ThreadMessage["id"],
    senderId: humanId,
    body: "Use this Room for shared MVP decisions; private agent context stays local.",
    createdAt: new Date(Date.now() - 150_000).toISOString(),
  });
}
