import {
  type ActionEnvelope,
  type ActionInboxItem,
  type ActivityEvent,
  type CanonicalWorkEvent,
  type CapabilityGrant,
  type Claim,
  type ConversationThread,
  type CoordinationResult,
  type DecisionRecord,
  type KanbanCard,
  type KanbanCardId,
  type OperationId,
  type OutboxEntry,
  type PrincipalId,
  type Project,
  type ProjectId,
  type PublicWorkProjection,
  type Spec,
  type SpecId,
  type SpecRevision,
  type SpecReviewResponse,
  type ThreadId,
  type ThreadMessage,
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

  createThread(thread: ConversationThread): ConversationThread {
    const existing = this.threads.get(thread.id);
    if (existing) return existing;
    for (const participantId of thread.participantIds) {
      this.ensurePrincipal(
        participantId,
        thread.standInIds.includes(participantId) ? "stand_in" : "human",
      );
    }
    this.threads.set(thread.id, thread);
    this.messages.set(thread.id, []);
    return thread;
  }

  appendMessage(
    threadId: ThreadId,
    input: {
      id: ThreadMessage["id"];
      senderId: PrincipalId;
      body?: string;
      encryptedBody?: string;
      createdAt: string;
    },
  ): ThreadMessage {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error("Thread was not found.");
    if (!thread.participantIds.includes(input.senderId)) {
      throw new Error("Sender is not a Thread participant.");
    }
    const message = buildThreadMessage(thread, input);
    this.threads.set(threadId, { ...thread, sequence: message.sequence });
    this.messages.set(threadId, [
      ...(this.messages.get(threadId) ?? []),
      message,
    ]);
    return message;
  }

  /** Read markers only move forward; see the Postgres store for why. */
  markThreadRead(
    threadId: ThreadId,
    principalId: PrincipalId,
    sequence: number,
  ): void {
    const key = `${threadId}:${principalId}`;
    const current = this.threadReads.get(key)?.lastReadSequence ?? 0;
    this.threadReads.set(key, {
      threadId,
      lastReadSequence: Math.max(current, sequence),
    });
  }

  listThreadReads(
    principalId: PrincipalId,
  ): Array<{ threadId: ThreadId; lastReadSequence: number }> {
    return [...this.threadReads.entries()]
      .filter(([key]) => key.endsWith(`:${principalId}`))
      .map(([, value]) => value);
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
    if (thread.concludedAt) throw new Error("Thread was already concluded.");
    if (!thread.participantIds.includes(input.actorId)) {
      throw new Error("Only a participant can conclude the Thread.");
    }
    const parent = this.threads.get(thread.parentThreadId);
    if (!parent) throw new Error("Parent Thread was not found.");
    if (!parent.participantIds.includes(input.actorId)) {
      throw new Error("Only a participant of the parent can conclude.");
    }
    const parentMessage = buildThreadMessage(parent, {
      id: input.messageId,
      senderId: input.actorId,
      body: input.conclusion,
      createdAt: input.at,
    });
    this.threads.set(parent.id, {
      ...parent,
      sequence: parentMessage.sequence,
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
    return { thread: concluded, parentMessage };
  }

  addStandInToThread(
    threadId: ThreadId,
    standInId: PrincipalId,
    actorId: PrincipalId,
  ): { thread: ConversationThread; event: ThreadMessage } {
    const current = this.threads.get(threadId);
    if (!current) throw new Error("Thread was not found.");
    this.ensurePrincipal(standInId, "stand_in");
    this.ensurePrincipal(actorId, "human");
    const transition = addStandIn(current, standInId, actorId);
    this.threads.set(threadId, transition.thread);
    this.messages.set(threadId, [
      ...(this.messages.get(threadId) ?? []),
      transition.event,
    ]);
    return transition;
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

  listThreads(kind?: ConversationThread["kind"]) {
    return [...this.threads.values()]
      .filter((thread) => kind === undefined || thread.kind === kind)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((thread) => ({
        thread,
        messages: this.messages.get(thread.id) ?? [],
      }));
  }

  getThread(threadId: ThreadId) {
    const thread = this.threads.get(threadId);
    return thread
      ? { thread, messages: this.messages.get(threadId) ?? [] }
      : undefined;
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
    };
  }
  if (!input.body || input.encryptedBody) {
    throw new Error("Agent-readable messages require a server-readable body.");
  }
  return {
    id: input.id,
    threadId: thread.id,
    senderId: input.senderId,
    sequence: thread.sequence + 1,
    kind: "message",
    body: input.body,
    createdAt: input.createdAt,
    serverReadable: true,
  };
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
