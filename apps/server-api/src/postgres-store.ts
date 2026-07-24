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
  type OperationId,
  type OrganizationId,
  type OutboxEntry,
  type PrincipalId,
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
  addRepresentative,
  authorizeEnvelope,
  buildPublicProjection,
  createSpecRevision,
  invalidateAffectedReviews,
  resolveWorkstream,
} from "@intero/representative-core";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

import type { PlatformStore } from "./platform-store.js";
import {
  buildThreadMessage,
  claimFromEvent,
  type MutationResult,
} from "./store.js";

export class PostgresPlatformStore implements PlatformStore {
  constructor(
    private readonly pool: Pool,
    private readonly organizationId: OrganizationId,
  ) {}

  async initializeOrganization(name: string): Promise<void> {
    await this.write(async (client) => {
      await client.query(
        `INSERT INTO organizations (id, name)
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
        [this.organizationId, name],
      );
    });
  }

  async createWorkstream(
    input: Omit<
      Workstream,
      "evidenceClaimIds" | "contradictionClaimIds" | "version"
    >,
  ): Promise<MutationResult<Workstream>> {
    return this.write(async (client) => {
      const workstream: Workstream = {
        ...input,
        evidenceClaimIds: [],
        contradictionClaimIds: [],
        version: 0,
      };
      await this.ensurePrincipal(client, workstream.ownerId);
      await client.query(
        `INSERT INTO workstreams
          (id, organization_id, project_id, owner_id, title, phase, resolved_state,
           freshness_at, confidence_basis_points, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          workstream.id,
          this.organizationId,
          workstream.projectId ?? null,
          workstream.ownerId,
          workstream.title,
          workstream.phase,
          json(workstream),
          workstream.freshnessAt,
          toBasisPoints(workstream.confidence),
          workstream.version,
        ],
      );
      return this.commit(
        client,
        "workstream.created",
        workstream.id,
        workstream.ownerId,
        workstream,
      );
    });
  }

  async addClaim(claim: Claim): Promise<
    MutationResult<{
      claim: Claim;
      workstream: Workstream;
      projection?: PublicWorkProjection;
    }>
  > {
    return this.write((client) => this.addClaimInTransaction(client, claim));
  }

  async ingestEvent(event: CanonicalWorkEvent): Promise<{
    accepted: boolean;
    duplicate: boolean;
    projection?: PublicWorkProjection;
  }> {
    return this.write(async (client) => {
      const inserted = await client.query(
        `INSERT INTO canonical_events
          (id, organization_id, operation_id, idempotency_key, workspace_id,
           workstream_id, source, event_type, privacy, safe_payload, occurred_at, received_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          event.id,
          this.organizationId,
          event.operationId,
          event.idempotencyKey,
          event.workspaceId,
          event.workstreamId ?? null,
          event.source,
          event.type,
          event.privacy,
          json(event.payload),
          event.occurredAt,
          event.receivedAt,
        ],
      );
      if (inserted.rowCount === 0) return { accepted: true, duplicate: true };
      const claim = claimFromEvent(event);
      if (!claim) return { accepted: true, duplicate: false };
      const mutation = await this.addClaimInTransaction(client, claim);
      return {
        accepted: true,
        duplicate: false,
        ...(mutation.value.projection
          ? { projection: mutation.value.projection }
          : {}),
      };
    });
  }

  async applyProjection(
    projection: PublicWorkProjection,
  ): Promise<PublicWorkProjection> {
    return this.write(async (client) => {
      const current = await client.query<{
        projection: PublicWorkProjection;
        version: number;
      }>(
        "SELECT projection, version FROM public_work_projections WHERE workstream_id = $1 FOR UPDATE",
        [projection.id],
      );
      if ((current.rows[0]?.version ?? -1) >= projection.version) {
        return current.rows[0]!.projection;
      }
      await this.ensurePrincipal(client, projection.ownerId);
      await client.query(
        `INSERT INTO workstreams
          (id, organization_id, owner_id, title, phase, resolved_state,
           freshness_at, confidence_basis_points, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           phase = EXCLUDED.phase,
           resolved_state = EXCLUDED.resolved_state,
           freshness_at = EXCLUDED.freshness_at,
           confidence_basis_points = EXCLUDED.confidence_basis_points,
           version = GREATEST(workstreams.version, EXCLUDED.version),
           updated_at = now()`,
        [
          projection.id,
          this.organizationId,
          projection.ownerId,
          projection.title,
          projection.phase,
          json(projection),
          projection.freshnessAt,
          toBasisPoints(projection.confidence),
          projection.version,
        ],
      );
      await client.query(
        `INSERT INTO public_work_projections
          (workstream_id, organization_id, projection, version, freshness_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (workstream_id) DO UPDATE SET
           projection = CASE
             WHEN EXCLUDED.version >= public_work_projections.version
             THEN EXCLUDED.projection
             ELSE public_work_projections.projection
           END,
           version = GREATEST(public_work_projections.version, EXCLUDED.version),
           freshness_at = GREATEST(
             public_work_projections.freshness_at,
             EXCLUDED.freshness_at
           ),
           updated_at = now()`,
        [
          projection.id,
          this.organizationId,
          json(projection),
          projection.version,
          projection.freshnessAt,
        ],
      );
      await this.commit(
        client,
        "projection.synchronized",
        projection.id,
        projection.ownerId,
        projection,
      );
      return projection;
    });
  }

  async putGrant(grant: CapabilityGrant): Promise<CapabilityGrant> {
    return this.write(async (client) => {
      await this.ensurePrincipal(client, grant.principalId);
      await client.query(
        `INSERT INTO capability_grants
          (id, organization_id, principal_id, "grant", policy_version, expires_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           "grant" = EXCLUDED."grant",
           policy_version = EXCLUDED.policy_version,
           expires_at = EXCLUDED.expires_at,
           revoked_at = EXCLUDED.revoked_at,
           updated_at = now()`,
        [
          grant.id,
          this.organizationId,
          grant.principalId,
          json(grant),
          grant.policyVersion,
          grant.expiresAt,
          grant.revokedAt ?? null,
        ],
      );
      return grant;
    });
  }

  async coordinate(envelope: ActionEnvelope): Promise<CoordinationResult> {
    return this.write(async (client) => {
      const duplicate = await client.query(
        "SELECT 1 FROM action_envelopes WHERE operation_id = $1",
        [envelope.operationId],
      );
      if (duplicate.rowCount) {
        return coordinationResult(
          envelope,
          "resolved",
          "This action was already applied.",
        );
      }
      const grantResult = await client.query<{ grant: CapabilityGrant }>(
        'SELECT "grant" FROM capability_grants WHERE id = $1',
        [envelope.authorityGrantId],
      );
      const grant = grantResult.rows[0]?.grant;
      const decision = grant
        ? authorizeEnvelope(envelope, grant)
        : {
            allowed: false as const,
            reason: "Capability Grant was not found.",
          };
      if (!decision.allowed) {
        await this.createInboxItem(
          client,
          envelope.actorId,
          "scope_expansion",
          "Representative action needs authorization",
          decision.reason,
          `coordination:${envelope.operationId}`,
        );
        return coordinationResult(envelope, "rejected", decision.reason);
      }
      if (decision.requiresConfirmation) {
        await this.createInboxItem(
          client,
          envelope.actorId,
          "consequential_commitment",
          "Representative action needs confirmation",
          envelope.humanMessage,
          `coordination:${envelope.operationId}`,
        );
        return coordinationResult(
          envelope,
          "needs_human",
          "Human confirmation is required.",
        );
      }
      await client.query(
        `INSERT INTO action_envelopes
          (operation_id, organization_id, actor_id, thread_id, workstream_id,
           authority_grant_id, action, envelope)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          envelope.operationId,
          this.organizationId,
          envelope.actorId,
          envelope.threadId,
          envelope.workstreamId ?? null,
          envelope.authorityGrantId,
          envelope.action,
          json(envelope),
        ],
      );
      const thread = await client.query<{ sequence: number }>(
        `UPDATE threads SET sequence = sequence + 1, updated_at = now()
         WHERE id = $1
         RETURNING sequence`,
        [envelope.threadId],
      );
      if (thread.rows[0]) {
        await client.query(
          `INSERT INTO messages
            (id, organization_id, thread_id, sender_id, operation_id, sequence,
             kind, body, server_readable, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'coordination_action', $7, true, $8)
           ON CONFLICT (organization_id, operation_id) DO NOTHING`,
          [
            uuidv7(),
            this.organizationId,
            envelope.threadId,
            envelope.actorId,
            envelope.operationId,
            thread.rows[0].sequence,
            envelope.humanMessage,
            envelope.createdAt,
          ],
        );
      }
      await this.commit(
        client,
        "coordination.action_recorded",
        envelope.operationId,
        envelope.actorId,
        envelope,
      );
      return coordinationResult(envelope, "resolved", envelope.humanMessage);
    });
  }

  async createThread(thread: ConversationThread): Promise<ConversationThread> {
    return this.write(async (client) => {
      for (const principalId of new Set([
        ...thread.participantIds,
        ...thread.representativeIds,
      ])) {
        await this.ensurePrincipal(client, principalId);
      }
      await client.query(
        `INSERT INTO threads
          (id, organization_id, kind, title, access_mode, access_changed_at_sequence,
           prior_history_granted, sequence, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          thread.id,
          this.organizationId,
          thread.kind,
          thread.title,
          thread.accessMode,
          thread.accessChangedAtSequence ?? null,
          thread.priorHistoryGranted,
          thread.sequence,
          thread.createdAt,
        ],
      );
      for (const principalId of new Set([
        ...thread.participantIds,
        ...thread.representativeIds,
      ])) {
        await client.query(
          `INSERT INTO thread_participants
            (organization_id, thread_id, principal_id, representative)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (thread_id, principal_id) DO UPDATE SET
             representative = EXCLUDED.representative,
             updated_at = now()`,
          [
            this.organizationId,
            thread.id,
            principalId,
            thread.representativeIds.includes(principalId),
          ],
        );
      }
      return (await this.getThreadInTransaction(client, thread.id))!.thread;
    });
  }

  async appendMessage(
    threadId: ThreadId,
    input: {
      id: ThreadMessage["id"];
      senderId: PrincipalId;
      body?: string;
      encryptedBody?: string;
      createdAt: string;
    },
  ): Promise<ThreadMessage> {
    return this.write(async (client) => {
      const current = await this.getThreadInTransaction(client, threadId);
      if (!current) throw new Error("Thread was not found.");
      if (!current.thread.participantIds.includes(input.senderId)) {
        throw new Error("Sender is not a Thread participant.");
      }
      const message = buildThreadMessage(current.thread, input);
      await client.query(
        "UPDATE threads SET sequence = $2, updated_at = now() WHERE id = $1",
        [threadId, message.sequence],
      );
      await this.insertMessage(client, message);
      return message;
    });
  }

  async addRepresentativeToThread(
    threadId: ThreadId,
    representativeId: PrincipalId,
    actorId: PrincipalId,
  ): Promise<{ thread: ConversationThread; event: ThreadMessage }> {
    return this.write(async (client) => {
      const current = await this.getThreadInTransaction(client, threadId);
      if (!current) throw new Error("Thread was not found.");
      await this.ensurePrincipal(client, representativeId);
      await this.ensurePrincipal(client, actorId);
      const transition = addRepresentative(
        current.thread,
        representativeId,
        actorId,
      );
      await client.query(
        `UPDATE threads SET
           access_mode = $2,
           access_changed_at_sequence = $3,
           prior_history_granted = $4,
           sequence = $5,
           updated_at = now()
         WHERE id = $1`,
        [
          threadId,
          transition.thread.accessMode,
          transition.thread.accessChangedAtSequence ?? null,
          transition.thread.priorHistoryGranted,
          transition.thread.sequence,
        ],
      );
      await client.query(
        `INSERT INTO thread_participants
          (organization_id, thread_id, principal_id, representative)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (thread_id, principal_id)
         DO UPDATE SET representative = true, updated_at = now()`,
        [this.organizationId, threadId, representativeId],
      );
      await this.insertMessage(client, transition.event);
      return transition;
    });
  }

  async createSpec(input: {
    spec: Omit<Spec, "currentRevisionId" | "createdAt">;
    markdown: string;
    changeSummary: string;
    affectedScopes: string[];
    createdBy: PrincipalId;
  }): Promise<{ spec: Spec; revision: SpecRevision }> {
    return this.write(async (client) => {
      await this.ensurePrincipal(client, input.createdBy);
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
      await client.query(
        `INSERT INTO specs
          (id, organization_id, title, current_revision_id, review_thread_id,
           related_workstream_ids, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          spec.id,
          this.organizationId,
          spec.title,
          spec.currentRevisionId,
          spec.reviewThreadId ?? null,
          json(spec.relatedWorkstreamIds),
          spec.status,
          spec.createdAt,
        ],
      );
      await this.insertRevision(client, revision);
      await this.createInboxItem(
        client,
        input.createdBy,
        "review_request",
        `Review requested: ${spec.title}`,
        input.changeSummary,
        `spec:${spec.id}:revision:${revision.id}`,
      );
      return { spec, revision };
    });
  }

  async addSpecRevision(
    specId: SpecId,
    input: Omit<SpecRevision, "id" | "blocks" | "createdAt">,
  ): Promise<SpecRevision> {
    return this.write(async (client) => {
      const current = await this.getSpecInTransaction(client, specId);
      if (!current) throw new Error("Spec was not found.");
      const revision = createSpecRevision({
        ...input,
        specId,
        revision: current.revisions.length + 1,
      });
      const invalidated = invalidateAffectedReviews(current.reviews, revision);
      await this.insertRevision(client, revision);
      for (const review of invalidated.filter((item) => item.invalidatedAt)) {
        await client.query(
          `UPDATE spec_reviews SET invalidated_at = $3, updated_at = now()
           WHERE spec_id = $1 AND revision_id = $2 AND reviewer_id = $4`,
          [specId, review.revisionId, review.invalidatedAt, review.reviewerId],
        );
      }
      await client.query(
        `UPDATE specs SET current_revision_id = $2, status = 'in_review', updated_at = now()
         WHERE id = $1`,
        [specId, revision.id],
      );
      return revision;
    });
  }

  async addReview(
    specId: SpecId,
    review: SpecReviewResponse,
  ): Promise<SpecReviewResponse> {
    return this.write(async (client) => {
      const specResult = await client.query<{ current_revision_id: string }>(
        "SELECT current_revision_id FROM specs WHERE id = $1",
        [specId],
      );
      const currentRevisionId = specResult.rows[0]?.current_revision_id;
      if (!currentRevisionId) throw new Error("Spec was not found.");
      if (review.revisionId !== currentRevisionId) {
        throw new Error(
          "Review response must target the current Spec revision.",
        );
      }
      await this.ensurePrincipal(client, review.reviewerId);
      await client.query(
        `INSERT INTO spec_reviews
          (id, organization_id, spec_id, revision_id, reviewer_id, kind,
           affected_scopes, body, invalidated_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          uuidv7(),
          this.organizationId,
          specId,
          review.revisionId,
          review.reviewerId,
          review.kind,
          json(review.affectedScopes),
          review.body,
          review.invalidatedAt ?? null,
          review.createdAt,
        ],
      );
      if (
        review.kind === "human_changes_requested" ||
        review.kind === "human_approval"
      ) {
        await client.query(
          "UPDATE specs SET status = $2, updated_at = now() WHERE id = $1",
          [
            specId,
            review.kind === "human_changes_requested"
              ? "changes_requested"
              : "approved",
          ],
        );
      }
      return review;
    });
  }

  async createDecision(
    input: Omit<DecisionRecord, "id" | "createdAt">,
  ): Promise<DecisionRecord> {
    return this.write(async (client) => {
      const decision: DecisionRecord = {
        ...input,
        id: uuidv7() as DecisionRecord["id"],
        createdAt: new Date().toISOString(),
      };
      for (const principalId of decision.decidedBy)
        await this.ensurePrincipal(client, principalId);
      await client.query(
        `INSERT INTO decisions
          (id, organization_id, title, outcome, source_spec_revision_id,
           source_thread_id, affected_scopes, decided_by, supersedes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          decision.id,
          this.organizationId,
          decision.title,
          decision.outcome,
          decision.sourceSpecRevisionId ?? null,
          decision.sourceThreadId ?? null,
          json(decision.affectedScopes),
          json(decision.decidedBy),
          decision.supersedes ?? null,
          decision.createdAt,
        ],
      );
      return decision;
    });
  }

  async cursor(after: number, limit: number) {
    return this.read(async (client) => {
      const result = await client.query(
        `SELECT * FROM activity_events
         WHERE sequence > $1 ORDER BY sequence LIMIT $2`,
        [after, limit + 1],
      );
      const hasMore = result.rows.length > limit;
      const items = result.rows.slice(0, limit).map(activityFromRow);
      return { items, nextCursor: items.at(-1)?.sequence ?? after, hasMore };
    });
  }

  async listProjections(): Promise<PublicWorkProjection[]> {
    return this.read(async (client) => {
      const result = await client.query<{ projection: PublicWorkProjection }>(
        "SELECT projection FROM public_work_projections ORDER BY freshness_at DESC",
      );
      return result.rows.map((row) => row.projection);
    });
  }

  async listInbox(): Promise<ActionInboxItem[]> {
    return this.read(async (client) => {
      const result = await client.query(
        "SELECT * FROM action_inbox WHERE resolved_at IS NULL ORDER BY created_at DESC",
      );
      return result.rows.map(inboxFromRow);
    });
  }

  async listThreads(kind?: ConversationThread["kind"]) {
    return this.read(async (client) => {
      const result = await client.query<{ id: ThreadId }>(
        `SELECT id FROM threads
         WHERE ($1::text IS NULL OR kind = $1)
         ORDER BY created_at DESC
         LIMIT 50`,
        [kind ?? null],
      );
      const items = await Promise.all(
        result.rows.map((row) => this.getThreadInTransaction(client, row.id)),
      );
      return items.filter(
        (
          item,
        ): item is { thread: ConversationThread; messages: ThreadMessage[] } =>
          item !== undefined,
      );
    });
  }

  async getThread(threadId: ThreadId) {
    return this.read((client) => this.getThreadInTransaction(client, threadId));
  }

  async getSpec(specId: SpecId) {
    return this.read((client) => this.getSpecInTransaction(client, specId));
  }

  async listDecisions(): Promise<DecisionRecord[]> {
    return this.read(async (client) => {
      const result = await client.query(
        "SELECT * FROM decisions ORDER BY created_at DESC",
      );
      return result.rows.map(decisionFromRow);
    });
  }

  async latestProjectionFreshness(): Promise<string | undefined> {
    return this.read(async (client) => {
      const result = await client.query<{ freshness_at: Date }>(
        "SELECT freshness_at FROM public_work_projections ORDER BY freshness_at DESC LIMIT 1",
      );
      return result.rows[0]?.freshness_at.toISOString();
    });
  }

  async listActivity(): Promise<ActivityEvent[]> {
    return this.read(async (client) => {
      const result = await client.query(
        "SELECT * FROM activity_events ORDER BY sequence DESC LIMIT 500",
      );
      return result.rows.map(activityFromRow);
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async addClaimInTransaction(
    client: PoolClient,
    claim: Claim,
  ): Promise<
    MutationResult<{
      claim: Claim;
      workstream: Workstream;
      projection?: PublicWorkProjection;
    }>
  > {
    const workstreamResult = await client.query<{ resolved_state: Workstream }>(
      "SELECT resolved_state FROM workstreams WHERE id = $1 FOR UPDATE",
      [claim.workstreamId],
    );
    const current = workstreamResult.rows[0]?.resolved_state;
    if (!current) throw new Error("Workstream was not found.");
    await client.query(
      `INSERT INTO claims
        (id, organization_id, workstream_id, predicate, value, source_type,
         source_ref, observed_at, valid_until, confidence_basis_points, privacy,
         evidence_refs, supersedes, withdrawn_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        claim.id,
        this.organizationId,
        claim.workstreamId,
        claim.predicate,
        claim.value,
        claim.sourceType,
        claim.sourceRef,
        claim.observedAt,
        claim.validUntil ?? null,
        toBasisPoints(claim.confidence),
        claim.privacy,
        json(claim.evidenceRefs),
        claim.supersedes ?? null,
        claim.withdrawnAt ?? null,
      ],
    );
    const claimsResult = await client.query(
      "SELECT * FROM claims WHERE workstream_id = $1",
      [claim.workstreamId],
    );
    const next = resolveWorkstream({
      workstream: current,
      claims: claimsResult.rows.map(claimFromRow),
    });
    const projection = buildPublicProjection(current, next);
    await client.query(
      `UPDATE workstreams SET
         title = $2, phase = $3, resolved_state = $4, freshness_at = $5,
         confidence_basis_points = $6, version = $7, updated_at = now()
       WHERE id = $1`,
      [
        next.id,
        next.title,
        next.phase,
        json(next),
        next.freshnessAt,
        toBasisPoints(next.confidence),
        next.version,
      ],
    );
    if (projection) {
      await client.query(
        `INSERT INTO public_work_projections
          (workstream_id, organization_id, projection, version, freshness_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (workstream_id) DO UPDATE SET
           projection = EXCLUDED.projection,
           version = EXCLUDED.version,
           freshness_at = EXCLUDED.freshness_at,
           updated_at = now()`,
        [
          next.id,
          this.organizationId,
          json(projection),
          projection.version,
          projection.freshnessAt,
        ],
      );
    }
    return this.commit(client, "claim.recorded", claim.id, next.ownerId, {
      claim,
      workstream: next,
      ...(projection ? { projection } : {}),
    });
  }

  private async getThreadInTransaction(
    client: PoolClient,
    threadId: ThreadId,
  ): Promise<
    { thread: ConversationThread; messages: ThreadMessage[] } | undefined
  > {
    const threadResult = await client.query(
      "SELECT * FROM threads WHERE id = $1",
      [threadId],
    );
    const row = threadResult.rows[0];
    if (!row) return undefined;
    const participants = await client.query<{
      principal_id: PrincipalId;
      representative: boolean;
    }>(
      "SELECT principal_id, representative FROM thread_participants WHERE thread_id = $1",
      [threadId],
    );
    const messages = await client.query(
      "SELECT * FROM messages WHERE thread_id = $1 ORDER BY sequence",
      [threadId],
    );
    return {
      thread: {
        id: row.id,
        kind: row.kind,
        title: row.title,
        participantIds: participants.rows.map((item) => item.principal_id),
        representativeIds: participants.rows
          .filter((item) => item.representative)
          .map((item) => item.principal_id),
        accessMode: row.access_mode,
        ...(row.access_changed_at_sequence
          ? { accessChangedAtSequence: row.access_changed_at_sequence }
          : {}),
        priorHistoryGranted: row.prior_history_granted,
        sequence: row.sequence,
        createdAt: asIso(row.created_at),
      },
      messages: messages.rows.map(messageFromRow),
    };
  }

  private async getSpecInTransaction(
    client: PoolClient,
    specId: SpecId,
  ): Promise<
    | { spec: Spec; revisions: SpecRevision[]; reviews: SpecReviewResponse[] }
    | undefined
  > {
    const specResult = await client.query("SELECT * FROM specs WHERE id = $1", [
      specId,
    ]);
    const row = specResult.rows[0];
    if (!row) return undefined;
    const revisions = await client.query(
      "SELECT * FROM spec_revisions WHERE spec_id = $1 ORDER BY revision",
      [specId],
    );
    const reviews = await client.query(
      "SELECT * FROM spec_reviews WHERE spec_id = $1 ORDER BY created_at",
      [specId],
    );
    return {
      spec: {
        id: row.id,
        title: row.title,
        currentRevisionId: row.current_revision_id,
        ...(row.review_thread_id
          ? { reviewThreadId: row.review_thread_id }
          : {}),
        relatedWorkstreamIds: row.related_workstream_ids,
        status: row.status,
        createdAt: asIso(row.created_at),
      },
      revisions: revisions.rows.map(revisionFromRow),
      reviews: reviews.rows.map(reviewFromRow),
    };
  }

  private async insertRevision(
    client: PoolClient,
    revision: SpecRevision,
  ): Promise<void> {
    await client.query(
      `INSERT INTO spec_revisions
        (id, organization_id, spec_id, revision, markdown, blocks, change_summary,
         affected_scopes, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        revision.id,
        this.organizationId,
        revision.specId,
        revision.revision,
        revision.markdown,
        json(revision.blocks),
        revision.changeSummary,
        json(revision.affectedScopes),
        revision.createdBy,
        revision.createdAt,
      ],
    );
  }

  private async insertMessage(
    client: PoolClient,
    message: ThreadMessage,
  ): Promise<void> {
    await client.query(
      `INSERT INTO messages
        (id, organization_id, thread_id, sender_id, sequence, kind, body,
         encrypted_body, server_readable, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        message.id,
        this.organizationId,
        message.threadId,
        message.senderId,
        message.sequence,
        message.kind,
        message.body,
        message.encryptedBody ?? null,
        message.serverReadable,
        message.createdAt,
      ],
    );
  }

  private async createInboxItem(
    client: PoolClient,
    principalId: PrincipalId,
    kind: ActionInboxItem["kind"],
    title: string,
    detail: string,
    sourceRef: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO action_inbox
        (id, organization_id, principal_id, kind, title, detail, source_ref, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (organization_id, principal_id, dedupe_key)
         WHERE resolved_at IS NULL
       DO NOTHING`,
      [
        uuidv7(),
        this.organizationId,
        principalId,
        kind,
        title,
        detail,
        sourceRef,
        sourceRef,
      ],
    );
  }

  private async ensurePrincipal(
    client: PoolClient,
    id: PrincipalId,
  ): Promise<void> {
    await client.query(
      `INSERT INTO principals (id, display_name, kind)
       VALUES ($1, $2, 'human')
       ON CONFLICT (id) DO NOTHING`,
      [id, `Principal ${id.slice(0, 8)}`],
    );
  }

  private async commit<T extends object>(
    client: PoolClient,
    eventType: string,
    aggregateId: string,
    actorId: PrincipalId,
    value: T,
  ): Promise<MutationResult<T>> {
    const operationId = uuidv7() as OperationId;
    const occurredAt = new Date().toISOString();
    const activityResult = await client.query<{ sequence: number }>(
      `INSERT INTO activity_events
        (organization_id, operation_id, actor_id, aggregate_type, aggregate_id,
         event_type, metadata, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING sequence`,
      [
        this.organizationId,
        operationId,
        actorId,
        eventType.split(".")[0] ?? "domain",
        aggregateId,
        eventType,
        json({ version: "1" }),
        occurredAt,
      ],
    );
    const activity: ActivityEvent = {
      sequence: activityResult.rows[0]!.sequence,
      organizationId: this.organizationId,
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
    await client.query(
      `INSERT INTO outbox
        (operation_id, organization_id, topic, payload, attempts, available_at)
       VALUES ($1, $2, $3, $4, 0, $5)`,
      [
        operationId,
        this.organizationId,
        eventType,
        json(outbox.payload),
        occurredAt,
      ],
    );
    return { value, activity, outbox };
  }

  private async read<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await this.setTenant(client);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async write<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.setTenant(client);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async setTenant(client: PoolClient): Promise<void> {
    await client.query(
      "SELECT set_config('intero.organization_id', $1, true)",
      [this.organizationId],
    );
  }
}

function toBasisPoints(value: number): number {
  return Math.round(value * 10_000);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function asIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function claimFromRow(row: QueryResultRow): Claim {
  return {
    id: row.id,
    workstreamId: row.workstream_id,
    predicate: row.predicate,
    value: row.value,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    observedAt: asIso(row.observed_at),
    ...(row.valid_until ? { validUntil: asIso(row.valid_until) } : {}),
    confidence: row.confidence_basis_points / 10_000,
    privacy: row.privacy,
    evidenceRefs: row.evidence_refs,
    ...(row.supersedes ? { supersedes: row.supersedes } : {}),
    ...(row.withdrawn_at ? { withdrawnAt: asIso(row.withdrawn_at) } : {}),
  };
}

function messageFromRow(row: QueryResultRow): ThreadMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderId: row.sender_id,
    sequence: row.sequence,
    kind: row.kind,
    body: row.body ?? "",
    createdAt: asIso(row.created_at),
    serverReadable: row.server_readable,
    ...(row.encrypted_body ? { encryptedBody: row.encrypted_body } : {}),
  };
}

function revisionFromRow(row: QueryResultRow): SpecRevision {
  return {
    id: row.id,
    specId: row.spec_id,
    revision: row.revision,
    markdown: row.markdown,
    blocks: row.blocks,
    changeSummary: row.change_summary,
    affectedScopes: row.affected_scopes,
    createdBy: row.created_by,
    createdAt: asIso(row.created_at),
  };
}

function reviewFromRow(row: QueryResultRow): SpecReviewResponse {
  return {
    revisionId: row.revision_id,
    reviewerId: row.reviewer_id,
    kind: row.kind,
    affectedScopes: row.affected_scopes,
    body: row.body,
    createdAt: asIso(row.created_at),
    ...(row.invalidated_at ? { invalidatedAt: asIso(row.invalidated_at) } : {}),
  };
}

function decisionFromRow(row: QueryResultRow): DecisionRecord {
  return {
    id: row.id,
    title: row.title,
    outcome: row.outcome,
    ...(row.source_spec_revision_id
      ? { sourceSpecRevisionId: row.source_spec_revision_id }
      : {}),
    ...(row.source_thread_id ? { sourceThreadId: row.source_thread_id } : {}),
    affectedScopes: row.affected_scopes,
    decidedBy: row.decided_by,
    ...(row.supersedes ? { supersedes: row.supersedes } : {}),
    createdAt: asIso(row.created_at),
  };
}

function activityFromRow(row: QueryResultRow): ActivityEvent {
  return {
    sequence: row.sequence,
    organizationId: row.organization_id,
    operationId: row.operation_id,
    actorId: row.actor_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    metadata: row.metadata,
    occurredAt: asIso(row.occurred_at),
  };
}

function inboxFromRow(row: QueryResultRow): ActionInboxItem {
  return {
    id: row.id,
    principalId: row.principal_id,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    sourceRef: row.source_ref,
    createdAt: asIso(row.created_at),
    ...(row.resolved_at ? { resolvedAt: asIso(row.resolved_at) } : {}),
  };
}

function coordinationResult(
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
