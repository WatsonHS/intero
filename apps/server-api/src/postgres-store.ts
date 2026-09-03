import {
  type ActionEnvelope,
  type ActionInboxItem,
  type ActivityEvent,
  type CanonicalWorkEvent,
  type CapabilityGrant,
  type Claim,
  type ConversationChangeReason,
  type ConversationThread,
  type CoordinationResult,
  type DecisionRecord,
  type KanbanCard,
  type KanbanCardId,
  type OperationId,
  type OrganizationId,
  type OutboxEntry,
  personalStandInId,
  type PrincipalId,
  type Project,
  type ProjectId,
  type PublicWorkProjection,
  type ReactionEmoji,
  type Spec,
  type SpecId,
  type SpecRevision,
  type SpecReviewResponse,
  type ThreadId,
  type ThreadMessage,
  type ThreadMessageAttachment,
  type ThreadMessageStreamState,
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
import { Pool, type PoolClient, type QueryResultRow } from "pg";

import type { PlatformStore, PrincipalSummary } from "./platform-store.js";
import { PilotStoreError } from "./pilot-store.js";
import {
  assertMutableThreadMessage,
  buildThreadMessage,
  claimFromEvent,
  type KanbanCardUpdate,
  type MutationResult,
  normalizeMentionIds,
  sameCoordinationSummaryIdentity,
  sameThreadCreation,
  type StandInQuestionInput,
  type ThreadMessagePage,
  type ThreadMessagePageQuery,
  tombstoneThreadMessage,
  updateMessageReactions,
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

  async ensureProject(project: Project): Promise<Project> {
    return this.write(async (client) => {
      await client.query(
        `INSERT INTO projects
          (id, organization_id, name, project_management_enabled)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           project_management_enabled = EXCLUDED.project_management_enabled,
           updated_at = now()`,
        [
          project.id,
          this.organizationId,
          project.name,
          project.projectManagementEnabled,
        ],
      );
      return project;
    });
  }

  async listProjects(): Promise<Project[]> {
    return this.read(async (client) => {
      const result = await client.query(
        `SELECT id, name, project_management_enabled
         FROM projects
         ORDER BY name`,
      );
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        projectManagementEnabled: row.project_management_enabled,
      }));
    });
  }

  async listKanbanCards(projectId?: ProjectId): Promise<KanbanCard[]> {
    return this.read(async (client) => {
      const result = await client.query(
        `SELECT c.*,
           COALESCE(
             jsonb_agg(cw.workstream_id)
               FILTER (WHERE cw.workstream_id IS NOT NULL),
             '[]'::jsonb
           ) AS related_workstream_ids
         FROM kanban_cards c
         LEFT JOIN kanban_card_workstreams cw ON cw.card_id = c.id
         WHERE ($1::uuid IS NULL OR c.project_id = $1)
         GROUP BY c.id
         ORDER BY c.position, c.created_at`,
        [projectId ?? null],
      );
      return result.rows.map(kanbanCardFromRow);
    });
  }

  async createKanbanCard(card: KanbanCard): Promise<KanbanCard> {
    return this.write(async (client) => {
      const project = await client.query(
        "SELECT id FROM projects WHERE id = $1",
        [card.projectId],
      );
      if (!project.rows[0]) throw new Error("Project was not found.");
      if (card.ownerId) await this.ensurePrincipal(client, card.ownerId);
      await client.query(
        `INSERT INTO kanban_cards
          (id, organization_id, project_id, title, description, "column",
           position, owner_id, estimate_points, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          card.id,
          this.organizationId,
          card.projectId,
          card.title,
          card.description,
          card.column,
          card.position,
          card.ownerId ?? null,
          card.estimatePoints ?? null,
          card.createdAt,
          card.updatedAt,
        ],
      );
      await this.replaceKanbanWorkstreamLinks(
        client,
        card.id,
        card.relatedWorkstreamIds,
      );
      return card;
    });
  }

  async updateKanbanCard(
    cardId: KanbanCardId,
    update: KanbanCardUpdate,
  ): Promise<KanbanCard> {
    return this.write(async (client) => {
      if (update.ownerId) await this.ensurePrincipal(client, update.ownerId);
      const result = await client.query(
        `UPDATE kanban_cards SET
           title = COALESCE($2, title),
           description = COALESCE($3, description),
           "column" = COALESCE($4, "column"),
           position = COALESCE($5, position),
           owner_id = COALESCE($6, owner_id),
           estimate_points = COALESCE($7, estimate_points),
           updated_at = now()
         WHERE id = $1
         RETURNING id`,
        [
          cardId,
          update.title ?? null,
          update.description ?? null,
          update.column ?? null,
          update.position ?? null,
          update.ownerId ?? null,
          update.estimatePoints ?? null,
        ],
      );
      if (!result.rows[0]) throw new Error("Kanban card was not found.");
      if (update.relatedWorkstreamIds) {
        await this.replaceKanbanWorkstreamLinks(
          client,
          cardId,
          update.relatedWorkstreamIds,
        );
      }
      const card = await this.getKanbanCardInTransaction(client, cardId);
      if (!card) throw new Error("Kanban card was not found.");
      return card;
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
      await this.ensurePrincipal(client, grant.principalId, "stand_in");
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
        const attentionPrincipalId = await this.attentionPrincipalId(
          client,
          envelope.threadId,
          envelope.actorId,
        );
        await this.createInboxItem(
          client,
          attentionPrincipalId,
          "scope_expansion",
          "Stand-in action needs authorization",
          decision.reason,
          `coordination:${envelope.operationId}`,
        );
        return coordinationResult(envelope, "rejected", decision.reason);
      }
      if (decision.requiresConfirmation) {
        const attentionPrincipalId = await this.attentionPrincipalId(
          client,
          envelope.threadId,
          envelope.actorId,
        );
        await this.createInboxItem(
          client,
          attentionPrincipalId,
          "consequential_commitment",
          "Stand-in action needs confirmation",
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
            (id, organization_id, thread_id, sender_id, operation_id,
             client_message_id, sequence, kind, body, server_readable, created_at)
           VALUES (
             $1, $2, $3, $4, $5, $1, $6,
             'coordination_action', $7, true, $8
           )
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

  async createThread(
    thread: ConversationThread,
    actorId?: PrincipalId,
  ): Promise<ConversationThread> {
    return this.write(async (client) => {
      const inserted = await client.query(
        `INSERT INTO threads
          (id, organization_id, project_id, kind, title, access_mode,
           access_changed_at_sequence, prior_history_granted, sequence,
           access_version, team_id, parent_thread_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $11, $12)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          thread.id,
          this.organizationId,
          thread.projectId ?? null,
          thread.kind,
          thread.title,
          thread.accessMode,
          thread.accessChangedAtSequence ?? null,
          thread.priorHistoryGranted,
          thread.sequence,
          thread.teamId ?? null,
          thread.parentThreadId ?? null,
          thread.createdAt,
        ],
      );
      if (inserted.rowCount === 0) {
        const existing = await this.getThreadInTransaction(
          client,
          thread.id,
          undefined,
          0,
        );
        if (!existing || !sameThreadCreation(existing.thread, thread)) {
          throw new Error("Thread ID was already used.");
        }
        return existing.thread;
      }
      for (const principalId of new Set([
        ...thread.participantIds,
        ...thread.standInIds,
      ])) {
        await this.ensurePrincipal(
          client,
          principalId,
          thread.standInIds.includes(principalId) ? "stand_in" : "human",
        );
      }
      for (const principalId of new Set([
        ...thread.participantIds,
        ...thread.standInIds,
      ])) {
        await client.query(
          `INSERT INTO thread_participants
            (organization_id, thread_id, principal_id, stand_in)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (thread_id, principal_id) DO UPDATE SET
             stand_in = EXCLUDED.stand_in,
             updated_at = now()`,
          [
            this.organizationId,
            thread.id,
            principalId,
            thread.standInIds.includes(principalId),
          ],
        );
      }
      const stored = (await this.getThreadInTransaction(
        client,
        thread.id,
        undefined,
        0,
      ))!.thread;
      if (actorId) {
        await this.recordConversationChange(client, {
          eventId: thread.id as unknown as OperationId,
          thread: stored,
          actorId,
          reason: "thread_created",
        });
      }
      return stored;
    });
  }

  async ensureRoomServicePrincipal(
    threadId: ThreadId,
    principal: PrincipalSummary,
  ): Promise<ConversationThread> {
    return this.write(async (client) => {
      await client.query("SELECT id FROM threads WHERE id = $1 FOR UPDATE", [
        threadId,
      ]);
      const current = await this.getThreadInTransaction(
        client,
        threadId,
        undefined,
        0,
      );
      if (!current || current.thread.kind !== "room") {
        throw new Error("Source Room was not found.");
      }
      if (current.thread.accessMode !== "agent_readable") {
        throw new Error(
          "Intero is unavailable in a human-only encrypted Room.",
        );
      }
      if (principal.kind !== "service") {
        throw new Error("Room Agent principal must be a service identity.");
      }
      await client.query(
        `INSERT INTO principals (id, display_name, kind)
         VALUES ($1, $2, 'service')
         ON CONFLICT (id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           kind = 'service',
           updated_at = now()`,
        [principal.id, principal.displayName],
      );
      if (current.thread.participantIds.includes(principal.id)) {
        return current.thread;
      }
      await client.query(
        `INSERT INTO thread_participants
          (organization_id, thread_id, principal_id, stand_in,
           visible_from_sequence)
         VALUES ($1, $2, $3, false, 1)
         ON CONFLICT (thread_id, principal_id) DO UPDATE SET
           stand_in = false,
           visible_from_sequence = 1,
           revoked_at = NULL,
           updated_at = now()`,
        [this.organizationId, threadId, principal.id],
      );
      await client.query(
        `UPDATE threads
         SET access_version = access_version + 1,
             updated_at = now()
         WHERE id = $1`,
        [threadId],
      );
      const stored = await this.getThreadInTransaction(
        client,
        threadId,
        undefined,
        0,
      );
      if (!stored) throw new Error("Source Room was not found.");
      await this.recordConversationChange(client, {
        eventId: uuidv7() as OperationId,
        thread: stored.thread,
        actorId: principal.id,
        reason: "access_changed",
      });
      return stored.thread;
    });
  }

  async updateThread(
    threadId: ThreadId,
    input: {
      title?: string;
      addParticipantIds: PrincipalId[];
      removeParticipantIds?: PrincipalId[];
    },
    actorId: PrincipalId,
  ): Promise<{ thread: ConversationThread; event?: ThreadMessage }> {
    return this.write(async (client) => {
      await client.query("SELECT id FROM threads WHERE id = $1 FOR UPDATE", [
        threadId,
      ]);
      const current = await this.getThreadInTransaction(
        client,
        threadId,
        undefined,
        0,
      );
      if (!current || !current.thread.participantIds.includes(actorId)) {
        throw new Error("Thread was not found.");
      }
      if (current.thread.standInIds.includes(actorId)) {
        throw new Error("Only a human participant can manage this Thread.");
      }
      if (
        current.thread.kind !== "room" &&
        current.thread.kind !== "human_group"
      ) {
        throw new Error("Only group conversations can be managed.");
      }
      const title = input.title?.trim();
      if (title !== undefined && (title.length === 0 || title.length > 200)) {
        throw new Error("Thread title is invalid.");
      }
      const addedParticipantIds = [...new Set(input.addParticipantIds)].filter(
        (principalId) => !current.thread.participantIds.includes(principalId),
      );
      const removedParticipantIds = [
        ...new Set(input.removeParticipantIds ?? []),
      ].filter(
        (principalId) =>
          current.thread.participantIds.includes(principalId) &&
          !current.thread.standInIds.includes(principalId),
      );
      if (removedParticipantIds.includes(actorId)) {
        throw new Error("A group manager cannot remove their own access.");
      }
      const titleChanged =
        title !== undefined && title !== current.thread.title;
      if (
        !titleChanged &&
        addedParticipantIds.length === 0 &&
        removedParticipantIds.length === 0
      ) {
        return { thread: current.thread };
      }

      const event =
        addedParticipantIds.length > 0 || removedParticipantIds.length > 0
          ? ({
              id: uuidv7() as ThreadMessage["id"],
              threadId,
              senderId: actorId,
              sequence: current.thread.sequence + 1,
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

      for (const participantId of addedParticipantIds) {
        await this.ensurePrincipal(client, participantId, "human");
        await client.query(
          `INSERT INTO thread_participants
            (organization_id, thread_id, principal_id, stand_in,
             visible_from_sequence, revoked_at)
           VALUES ($1, $2, $3, false, $4, NULL)
           ON CONFLICT (thread_id, principal_id)
           DO UPDATE SET
             stand_in = false,
             visible_from_sequence = EXCLUDED.visible_from_sequence,
             revoked_at = NULL,
             updated_at = now()`,
          [this.organizationId, threadId, participantId, event!.sequence],
        );
      }
      if (removedParticipantIds.length > 0) {
        await client.query(
          `UPDATE thread_participants
           SET revoked_at = $3, updated_at = now()
           WHERE thread_id = $1
             AND principal_id = ANY($2::uuid[])
             AND revoked_at IS NULL`,
          [threadId, removedParticipantIds, event!.createdAt],
        );
      }
      await client.query(
        `UPDATE threads SET
           title = $2,
           sequence = $3,
           access_version = access_version + $4,
           latest_message_at = $5,
           updated_at = now()
         WHERE id = $1`,
        [
          threadId,
          titleChanged ? title : current.thread.title,
          event?.sequence ?? current.thread.sequence,
          event ? 1 : 0,
          event?.createdAt ?? current.thread.latestMessageAt ?? null,
        ],
      );
      if (event) await this.insertMessage(client, event);
      const updated = (await this.getThreadInTransaction(
        client,
        threadId,
        undefined,
        0,
      ))!.thread;
      await this.recordConversationChange(client, {
        eventId: (event?.id ?? uuidv7()) as OperationId,
        thread: updated,
        actorId,
        reason: event ? "access_changed" : "thread_updated",
      });
      return { thread: updated, ...(event ? { event } : {}) };
    });
  }

  async appendMessage(
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
  ): Promise<ThreadMessage> {
    return this.write(async (client) => {
      await client.query("SELECT id FROM threads WHERE id = $1 FOR UPDATE", [
        threadId,
      ]);
      const current = await this.getThreadInTransaction(
        client,
        threadId,
        undefined,
        0,
      );
      if (!current) throw new Error("Thread was not found.");
      if (!current.thread.participantIds.includes(input.senderId)) {
        throw new Error("Sender is not a Thread participant.");
      }
      const mentionedPrincipalIds = normalizeMentionIds(
        current.thread,
        input.senderId,
        input.mentionedPrincipalIds,
      );
      const existingMessage = await client.query(
        "SELECT * FROM messages WHERE thread_id = $1 AND id = $2",
        [threadId, input.id],
      );
      const existing = existingMessage.rows[0]
        ? messageFromRow(existingMessage.rows[0])
        : undefined;
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
          const finalized = await client.query(
            `UPDATE messages
             SET body = $3,
                 stream_state = 'complete',
                 revision = revision + 1,
                 updated_at = now()
             WHERE thread_id = $1 AND id = $2
             RETURNING *`,
            [threadId, input.id, input.body],
          );
          const completed = messageFromRow(finalized.rows[0]!);
          await this.recordConversationChange(client, {
            eventId: uuidv7() as OperationId,
            thread: current.thread,
            actorId: input.senderId,
            reason: "message_updated",
            messageId: completed.id,
          });
          return completed;
        }
        if (
          existing.senderId !== input.senderId ||
          existing.body !== (input.body ?? "") ||
          existing.encryptedBody !== input.encryptedBody ||
          existing.replyToMessageId !== input.replyToMessageId ||
          !sameIds(
            existing.mentionedPrincipalIds ?? [],
            mentionedPrincipalIds,
          ) ||
          !sameIds(
            (existing.attachments ?? []).map((attachment) => attachment.id),
            input.attachmentIds ?? [],
          )
        ) {
          throw new Error("Client message ID was already used.");
        }
        return existing;
      }
      if (input.replyToMessageId) {
        const replyTarget = await client.query(
          `SELECT message.id
           FROM messages AS message
           JOIN thread_participants AS participant
             ON participant.thread_id = message.thread_id
            AND participant.principal_id = $3
            AND participant.revoked_at IS NULL
           WHERE message.thread_id = $1
             AND message.id = $2
             AND message.kind = 'message'
             AND message.sequence >= participant.visible_from_sequence`,
          [threadId, input.replyToMessageId, input.senderId],
        );
        if (!replyTarget.rows[0]) {
          throw new Error("Reply message was not found.");
        }
      }
      const attachments = await this.resolveMessageAttachments(
        client,
        threadId,
        input.senderId,
        input.id,
        input.attachmentIds ?? [],
      );
      const message = buildThreadMessage(current.thread, {
        ...input,
        mentionedPrincipalIds,
        attachments,
      });
      const updated = await client.query<{
        sequence: number;
        access_version: number;
      }>(
        `UPDATE threads
         SET sequence = sequence + 1,
             latest_message_at = $2,
             updated_at = now()
         WHERE id = $1
         RETURNING sequence, access_version`,
        [threadId, message.createdAt],
      );
      const stored = {
        ...message,
        sequence: updated.rows[0]!.sequence,
      };
      await this.insertMessage(client, stored);
      if (attachments.length > 0) {
        const claimed = await client.query(
          `UPDATE attachments
           SET message_id = $1, updated_at = now()
           WHERE id = ANY($2::uuid[])
             AND (message_id IS NULL OR message_id = $1)`,
          [stored.id, attachments.map((attachment) => attachment.id)],
        );
        if ((claimed.rowCount ?? 0) !== attachments.length) {
          throw new Error("One or more attachments were already sent.");
        }
      }
      await this.recordConversationChange(client, {
        eventId: stored.id as unknown as OperationId,
        thread: {
          ...current.thread,
          sequence: stored.sequence,
          accessVersion: updated.rows[0]!.access_version,
          latestMessageAt: stored.createdAt,
        },
        actorId: input.senderId,
        reason: "message_appended",
      });
      return stored;
    });
  }

  async updateMessageStream(input: {
    threadId: ThreadId;
    messageId: ThreadMessage["id"];
    senderId: PrincipalId;
    body: string;
    streamState: ThreadMessageStreamState;
  }): Promise<ThreadMessage> {
    if (input.body.length > 16_000) {
      throw new Error("Stream message exceeds the message size limit.");
    }
    return this.write(async (client) => {
      const current = await client.query(
        `SELECT * FROM messages
         WHERE thread_id = $1 AND id = $2
         FOR UPDATE`,
        [input.threadId, input.messageId],
      );
      const message = current.rows[0]
        ? messageFromRow(current.rows[0])
        : undefined;
      if (!message || message.senderId !== input.senderId) {
        throw new Error("Stream message was not found.");
      }
      if (
        (message.streamState ?? "complete") === "complete" &&
        input.streamState !== "complete"
      ) {
        throw new Error("Completed stream messages are immutable.");
      }
      const result = await client.query(
        `UPDATE messages
         SET body = $3,
             stream_state = $4,
             revision = revision + 1,
             updated_at = now()
         WHERE thread_id = $1 AND id = $2
         RETURNING *`,
        [input.threadId, input.messageId, input.body, input.streamState],
      );
      const updated = messageFromRow(result.rows[0]!);
      const thread = await this.getThreadInTransaction(
        client,
        input.threadId,
        undefined,
        0,
      );
      if (!thread) throw new Error("Thread was not found.");
      await this.recordConversationChange(client, {
        eventId: uuidv7() as OperationId,
        thread: thread.thread,
        actorId: input.senderId,
        reason: "message_updated",
        messageId: input.messageId,
      });
      return updated;
    });
  }

  async upsertCoordinationSummary(input: {
    roomThreadId: ThreadId;
    messageId: ThreadMessage["id"];
    senderId: PrincipalId;
    body: string;
    summary: NonNullable<ThreadMessage["coordinationSummary"]>;
    at: string;
  }): Promise<ThreadMessage> {
    return this.write(async (client) => {
      await client.query("SELECT id FROM threads WHERE id = $1 FOR UPDATE", [
        input.roomThreadId,
      ]);
      const current = await this.getThreadInTransaction(
        client,
        input.roomThreadId,
        undefined,
        0,
      );
      if (!current || current.thread.kind !== "room") {
        throw new Error("Source Room was not found.");
      }
      if (!current.thread.participantIds.includes(input.senderId)) {
        throw new Error("Summary sender is not a Room participant.");
      }
      const existingResult = await client.query(
        `SELECT * FROM messages WHERE thread_id = $1 AND id = $2 FOR UPDATE`,
        [input.roomThreadId, input.messageId],
      );
      const existing = existingResult.rows[0]
        ? messageFromRow(existingResult.rows[0])
        : undefined;
      if (existing) {
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
        const updated = await client.query(
          `UPDATE messages
           SET body = $3,
               metadata = $4,
               revision = revision + 1,
               updated_at = now()
           WHERE thread_id = $1 AND id = $2
           RETURNING *`,
          [
            input.roomThreadId,
            input.messageId,
            input.body,
            json({ coordinationSummary: input.summary }),
          ],
        );
        const message = messageFromRow(updated.rows[0]!);
        await this.recordConversationChange(client, {
          eventId: uuidv7() as OperationId,
          thread: current.thread,
          actorId: input.senderId,
          reason: "message_updated",
          messageId: message.id,
        });
        return message;
      }
      const nextThread = await client.query<{
        sequence: number;
        access_version: number;
      }>(
        `UPDATE threads
         SET sequence = sequence + 1,
             latest_message_at = $2,
             updated_at = now()
         WHERE id = $1
         RETURNING sequence, access_version`,
        [input.roomThreadId, input.at],
      );
      const message: ThreadMessage = {
        id: input.messageId,
        threadId: input.roomThreadId,
        senderId: input.senderId,
        sequence: nextThread.rows[0]!.sequence,
        kind: "coordination_summary",
        body: input.body,
        createdAt: input.at,
        serverReadable: true,
        coordinationSummary: input.summary,
        streamState: "complete",
        revision: 1,
      };
      await this.insertMessage(client, message);
      await this.recordConversationChange(client, {
        eventId: uuidv7() as OperationId,
        thread: {
          ...current.thread,
          sequence: message.sequence,
          accessVersion: nextThread.rows[0]!.access_version,
          latestMessageAt: input.at,
        },
        actorId: input.senderId,
        reason: "message_appended",
        messageId: message.id,
      });
      return message;
    });
  }

  async setMessageReaction(input: {
    threadId: ThreadId;
    messageId: ThreadMessage["id"];
    principalId: PrincipalId;
    emoji: ReactionEmoji;
    reacted: boolean;
  }): Promise<ThreadMessage> {
    return this.write(async (client) => {
      const result = await client.query(
        `SELECT m.*
         FROM messages m
         JOIN thread_participants viewer
           ON viewer.thread_id = m.thread_id
          AND viewer.principal_id = $2
          AND viewer.revoked_at IS NULL
         WHERE m.thread_id = $1
           AND m.id = $3
           AND m.sequence >= viewer.visible_from_sequence
         FOR UPDATE OF m`,
        [input.threadId, input.principalId, input.messageId],
      );
      const current = result.rows[0]
        ? messageFromRow(result.rows[0])
        : undefined;
      if (!current) throw new Error("Message was not found.");
      if (current.deletedAt) {
        throw new PilotStoreError(
          "MESSAGE_DELETED",
          409,
          "Deleted messages cannot be changed.",
        );
      }

      const reactionUpdate = updateMessageReactions(
        current.reactions ?? [],
        input,
      );
      if (!reactionUpdate.changed) return current;

      const updatedRow = await client.query(
        `UPDATE messages
         SET reactions = $3,
             revision = revision + 1,
             updated_at = now()
         WHERE thread_id = $1 AND id = $2
         RETURNING *`,
        [input.threadId, input.messageId, json(reactionUpdate.reactions)],
      );
      const updated = messageFromRow(updatedRow.rows[0]!);
      const thread = await this.getThreadInTransaction(
        client,
        input.threadId,
        undefined,
        0,
      );
      if (!thread) throw new Error("Thread was not found.");
      await this.recordConversationChange(client, {
        eventId: uuidv7() as OperationId,
        thread: thread.thread,
        actorId: input.principalId,
        reason: "message_updated",
        messageId: input.messageId,
      });
      return updated;
    });
  }

  async editThreadMessage(input: {
    threadId: ThreadId;
    messageId: ThreadMessage["id"];
    principalId: PrincipalId;
    body: string;
    mentionedPrincipalIds?: PrincipalId[];
  }): Promise<ThreadMessage> {
    return this.write(async (client) => {
      const loaded = await this.loadMutableMessage(client, input);
      if (!loaded.current.serverReadable || loaded.current.encryptedBody) {
        throw new PilotStoreError(
          "MESSAGE_NOT_MUTABLE",
          409,
          "Encrypted messages cannot be edited.",
        );
      }
      const trimmed = input.body.trim();
      if (!trimmed && !(loaded.current.attachments?.length ?? 0)) {
        throw new Error("Edited messages require a non-empty body.");
      }
      const mentionedPrincipalIds = normalizeMentionIds(
        loaded.thread,
        input.principalId,
        input.mentionedPrincipalIds,
      );
      const editedAt = new Date().toISOString();
      const updatedRow = await client.query(
        `UPDATE messages
         SET body = $3,
             mentioned_principal_ids = $4,
             edited_at = $5,
             revision = revision + 1,
             updated_at = now()
         WHERE thread_id = $1 AND id = $2
         RETURNING *`,
        [
          input.threadId,
          input.messageId,
          trimmed,
          mentionedPrincipalIds,
          editedAt,
        ],
      );
      const updated = messageFromRow(updatedRow.rows[0]!);
      await this.recordConversationChange(client, {
        eventId: uuidv7() as OperationId,
        thread: loaded.thread,
        actorId: input.principalId,
        reason: "message_edited",
        messageId: input.messageId,
      });
      return updated;
    });
  }

  async deleteThreadMessage(input: {
    threadId: ThreadId;
    messageId: ThreadMessage["id"];
    principalId: PrincipalId;
  }): Promise<void> {
    await this.write(async (client) => {
      const loaded = await this.loadMutableMessage(client, input);
      const deletedAt = new Date().toISOString();
      const tombstone = tombstoneThreadMessage(loaded.current, deletedAt);
      await client.query(
        `UPDATE messages
         SET body = '',
             encrypted_body = NULL,
             attachments = '[]'::jsonb,
             reactions = '[]'::jsonb,
             mentioned_principal_ids = '{}'::uuid[],
             deleted_at = $3,
             revision = $4,
             updated_at = now()
         WHERE thread_id = $1 AND id = $2`,
        [input.threadId, input.messageId, deletedAt, tombstone.revision ?? 1],
      );
      await this.recordConversationChange(client, {
        eventId: uuidv7() as OperationId,
        thread: loaded.thread,
        actorId: input.principalId,
        reason: "message_deleted",
        messageId: input.messageId,
      });
    });
  }

  async enqueueStandInQuestion(
    input: StandInQuestionInput,
  ): Promise<ThreadMessage> {
    return this.write(async (client) => {
      const threadId =
        input.source.kind === "new_message"
          ? input.source.thread.id
          : input.source.threadId;
      const questionMessageId = input.source.messageId;
      const createdAt = input.source.createdAt;
      const standInId = personalStandInId(input.standInOwnerId);
      if (input.source.kind === "new_message") {
        for (const principalId of input.source.thread.participantIds) {
          await this.ensurePrincipal(
            client,
            principalId,
            input.source.thread.standInIds.includes(principalId)
              ? "stand_in"
              : "human",
          );
        }
        const insertedThread = await client.query(
          `INSERT INTO threads
            (id, organization_id, project_id, kind, title, access_mode,
             prior_history_granted, sequence, access_version, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, false, 0, 1, $7)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [
            input.source.thread.id,
            this.organizationId,
            input.projectId ?? null,
            input.source.thread.kind,
            input.source.thread.title,
            input.source.thread.accessMode,
            input.source.thread.createdAt,
          ],
        );
        if ((insertedThread.rowCount ?? 0) > 0) {
          for (const principalId of input.source.thread.participantIds) {
            await client.query(
              `INSERT INTO thread_participants
                (organization_id, thread_id, principal_id, stand_in)
               VALUES ($1, $2, $3, $4)`,
              [
                this.organizationId,
                input.source.thread.id,
                principalId,
                input.source.thread.standInIds.includes(principalId),
              ],
            );
          }
          await this.recordConversationChange(client, {
            eventId: input.source.thread.id as unknown as OperationId,
            thread: input.source.thread,
            actorId: input.askedByPrincipalId,
            reason: "thread_created",
          });
        } else {
          const existingThread = await this.getThreadInTransaction(
            client,
            input.source.thread.id,
            undefined,
            0,
          );
          if (
            !existingThread ||
            !sameThreadCreation(existingThread.thread, input.source.thread)
          ) {
            throw new Error("Stand-in Thread ID was already used.");
          }
        }
      } else {
        await this.ensurePrincipal(client, standInId, "stand_in");
      }

      const existingJob = await client.query<{ question_message_id: string }>(
        `SELECT question_message_id
         FROM stand_in_question_jobs
         WHERE id = $1`,
        [input.jobId],
      );
      if (existingJob.rows[0]) {
        const existingMessage = await client.query(
          "SELECT * FROM messages WHERE id = $1",
          [existingJob.rows[0].question_message_id],
        );
        if (!existingMessage.rows[0]) {
          throw new Error("Stand-in question job lost its source message.");
        }
        return messageFromRow(existingMessage.rows[0]);
      }

      await client.query("SELECT id FROM threads WHERE id = $1 FOR UPDATE", [
        threadId,
      ]);
      const current = await this.getThreadInTransaction(
        client,
        threadId,
        undefined,
        0,
      );
      if (!current) throw new Error("Stand-in Thread was not found.");
      const existingQuestion =
        input.source.kind === "existing_message"
          ? await client.query(
              `SELECT *
               FROM messages
               WHERE id = $1
                 AND thread_id = $2
                 AND sender_id = $3
                 AND body IS NOT NULL`,
              [questionMessageId, threadId, input.askedByPrincipalId],
            )
          : undefined;
      if (
        input.source.kind === "existing_message" &&
        !existingQuestion?.rows[0]
      ) {
        throw new Error("Stand-in question source message was not found.");
      }
      const questionMessage =
        input.source.kind === "new_message"
          ? buildThreadMessage(current.thread, {
              id: questionMessageId,
              senderId: input.askedByPrincipalId,
              body: input.source.body,
              createdAt,
            })
          : messageFromRow(existingQuestion!.rows[0]);
      const sequenceIncrement = input.source.kind === "new_message" ? 2 : 1;
      const head = await client.query<{ sequence: number }>(
        `UPDATE threads
         SET sequence = sequence + $3,
             latest_message_at = $2,
             updated_at = now()
         WHERE id = $1
         RETURNING sequence`,
        [threadId, createdAt, sequenceIncrement],
      );
      const stored =
        input.source.kind === "new_message"
          ? {
              ...questionMessage,
              sequence: head.rows[0]!.sequence - 1,
            }
          : questionMessage;
      const pendingAnswer = buildThreadMessage(
        {
          ...current.thread,
          sequence: head.rows[0]!.sequence - 1,
        },
        {
          id: input.answerMessageId,
          senderId: standInId,
          body: "",
          streamState: "pending",
          createdAt,
        },
      );
      if (input.source.kind === "new_message") {
        await this.insertMessage(client, stored);
      }
      await this.insertMessage(client, pendingAnswer);
      if (input.source.kind === "new_message") {
        await this.recordConversationChange(client, {
          eventId: stored.id as unknown as OperationId,
          thread: {
            ...current.thread,
            sequence: stored.sequence,
            latestMessageAt: stored.createdAt,
          },
          actorId: input.askedByPrincipalId,
          reason: "message_appended",
        });
      }
      await this.recordConversationChange(client, {
        eventId: pendingAnswer.id as unknown as OperationId,
        thread: {
          ...current.thread,
          sequence: pendingAnswer.sequence,
          latestMessageAt: pendingAnswer.createdAt,
        },
        actorId: pendingAnswer.senderId,
        reason: "message_appended",
      });
      await client.query(
        `INSERT INTO stand_in_question_jobs
          (id, organization_id, thread_id, project_id, stand_in_owner_id,
           asked_by_principal_id, question_message_id, answer_message_id,
           preferred_language, record_exchange, status, available_at,
           created_at, updated_at)
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           'pending', $11, $11, $11
         )`,
        [
          input.jobId,
          this.organizationId,
          threadId,
          input.projectId,
          input.standInOwnerId,
          input.askedByPrincipalId,
          questionMessageId,
          input.answerMessageId,
          input.preferredLanguage,
          input.recordExchange,
          createdAt,
        ],
      );
      await client.query(
        `INSERT INTO outbox
         (operation_id, organization_id, topic, payload, available_at)
         VALUES (
           $1::uuid, $2::uuid, 'pilot.stand_in.question.enqueue',
           jsonb_build_object(
             'schemaVersion', 3,
             'organizationId', $2::uuid::text,
             'jobId', $1::uuid::text
           ),
           $3
         )`,
        [input.jobId, this.organizationId, createdAt],
      );
      return stored;
    });
  }

  /** Move a person's read marker forward. Never backwards — re-reading an old
   *  message must not resurrect unread counts for everything after it. */
  async markThreadRead(
    threadId: ThreadId,
    principalId: PrincipalId,
    sequence: number,
  ): Promise<void> {
    await this.write(async (client) => {
      const current = await this.getThreadInTransaction(
        client,
        threadId,
        principalId,
        0,
      );
      if (!current) throw new Error("Thread was not found.");
      if (sequence > current.thread.sequence) {
        throw new Error("Read sequence exceeds the Thread head.");
      }
      const changed = await client.query(
        `INSERT INTO thread_reads
          (organization_id, thread_id, principal_id, last_read_sequence)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (thread_id, principal_id) DO UPDATE SET
           last_read_sequence = EXCLUDED.last_read_sequence,
           updated_at = now()
         WHERE thread_reads.last_read_sequence < EXCLUDED.last_read_sequence
         RETURNING last_read_sequence`,
        [this.organizationId, threadId, principalId, sequence],
      );
      if ((changed.rowCount ?? 0) > 0) {
        await this.recordConversationChange(client, {
          eventId: uuidv7() as OperationId,
          thread: current.thread,
          actorId: principalId,
          reason: "read_cursor_changed",
          channels: [`intero:user:${principalId}`],
        });
      }
    });
  }

  async listThreadMessages(
    threadId: ThreadId,
    principalId: PrincipalId,
    query: ThreadMessagePageQuery,
  ): Promise<ThreadMessagePage | undefined> {
    return this.read(async (client) => {
      const thread = await client.query<{
        sequence: number;
        access_version: number;
        visible_from_sequence: number;
      }>(
        `SELECT t.sequence, t.access_version, tp.visible_from_sequence
         FROM threads t
         JOIN thread_participants tp
           ON tp.thread_id = t.id
          AND tp.principal_id = $2
          AND tp.revoked_at IS NULL
         WHERE t.id = $1`,
        [threadId, principalId],
      );
      const metadata = thread.rows[0];
      if (!metadata) return undefined;

      const limit = query.tail ?? query.limit;
      const result =
        query.afterSequence !== undefined
          ? await client.query(
              `SELECT * FROM messages
               WHERE thread_id = $1
                 AND sequence >= $2
                 AND sequence > $3
               ORDER BY sequence
               LIMIT $4`,
              [
                threadId,
                metadata.visible_from_sequence,
                query.afterSequence,
                query.limit + 1,
              ],
            )
          : query.beforeSequence !== undefined
            ? await client.query(
                `SELECT * FROM (
                   SELECT * FROM messages
                   WHERE thread_id = $1
                     AND sequence >= $2
                     AND sequence < $3
                   ORDER BY sequence DESC
                   LIMIT $4
                 ) page
                 ORDER BY sequence`,
                [
                  threadId,
                  metadata.visible_from_sequence,
                  query.beforeSequence,
                  query.limit + 1,
                ],
              )
            : await client.query(
                `SELECT * FROM (
                   SELECT * FROM messages
                   WHERE thread_id = $1
                     AND sequence >= $2
                   ORDER BY sequence DESC
                   LIMIT $3
                 ) page
                 ORDER BY sequence`,
                [threadId, metadata.visible_from_sequence, limit + 1],
              );
      const hasMore = result.rows.length > limit;
      const rows =
        query.beforeSequence !== undefined || query.afterSequence === undefined
          ? result.rows.slice(hasMore ? 1 : 0)
          : result.rows.slice(0, limit);
      return {
        items: rows.map(messageFromRow),
        headSequence: metadata.sequence,
        accessVersion: metadata.access_version,
        hasMore,
      };
    });
  }

  async getThreadMessage(
    threadId: ThreadId,
    principalId: PrincipalId,
    messageId: ThreadMessage["id"],
  ): Promise<ThreadMessage | undefined> {
    return this.read(async (client) => {
      const result = await client.query(
        `SELECT m.*
         FROM messages m
         JOIN thread_participants viewer
           ON viewer.thread_id = m.thread_id
          AND viewer.principal_id = $2
          AND viewer.revoked_at IS NULL
         WHERE m.thread_id = $1
           AND m.id = $3
           AND m.sequence >= viewer.visible_from_sequence`,
        [threadId, principalId, messageId],
      );
      return result.rows[0] ? messageFromRow(result.rows[0]) : undefined;
    });
  }

  async listThreadReads(
    principalId: PrincipalId,
  ): Promise<Array<{ threadId: ThreadId; lastReadSequence: number }>> {
    return this.read(async (client) => {
      const result = await client.query<{
        thread_id: ThreadId;
        last_read_sequence: number;
      }>(
        "SELECT thread_id, last_read_sequence FROM thread_reads WHERE principal_id = $1",
        [principalId],
      );
      return result.rows.map((row) => ({
        threadId: row.thread_id,
        lastReadSequence: row.last_read_sequence,
      }));
    });
  }

  /**
   * Conclude a branched thread: the conclusion is posted into the parent
   * conversation, so the decision lands where the discussion started, and the
   * branch is marked concluded rather than deleted.
   */
  async concludeThreadIntoParent(input: {
    threadId: ThreadId;
    actorId: PrincipalId;
    conclusion: string;
    messageId: ThreadMessage["id"];
    at: string;
  }): Promise<{ thread: ConversationThread; parentMessage: ThreadMessage }> {
    return this.write(async (client) => {
      await client.query("SELECT id FROM threads WHERE id = $1 FOR UPDATE", [
        input.threadId,
      ]);
      const current = await this.getThreadInTransaction(
        client,
        input.threadId,
        undefined,
        0,
      );
      if (!current) throw new Error("Thread was not found.");
      if (!current.thread.parentThreadId) {
        throw new Error("Thread did not branch from another conversation.");
      }
      if (!current.thread.participantIds.includes(input.actorId)) {
        throw new Error("Only a participant can conclude the Thread.");
      }
      await client.query("SELECT id FROM threads WHERE id = $1 FOR UPDATE", [
        current.thread.parentThreadId,
      ]);
      const parent = await this.getThreadInTransaction(
        client,
        current.thread.parentThreadId,
        undefined,
        0,
      );
      if (!parent) throw new Error("Parent Thread was not found.");
      if (!parent.thread.participantIds.includes(input.actorId)) {
        throw new Error("Only a participant of the parent can conclude.");
      }
      const existingMessage = await client.query(
        "SELECT * FROM messages WHERE thread_id = $1 AND id = $2",
        [parent.thread.id, input.messageId],
      );
      const existing = existingMessage.rows[0]
        ? messageFromRow(existingMessage.rows[0])
        : undefined;
      if (current.thread.concludedAt) {
        if (
          existing &&
          existing.senderId === input.actorId &&
          existing.body === input.conclusion
        ) {
          return { thread: current.thread, parentMessage: existing };
        }
        throw new Error("Thread was already concluded.");
      }
      if (existing) throw new Error("Client message ID was already used.");

      const candidate = buildThreadMessage(parent.thread, {
        id: input.messageId,
        senderId: input.actorId,
        body: input.conclusion,
        createdAt: input.at,
      });
      const parentHead = await client.query<{ sequence: number }>(
        `UPDATE threads
         SET sequence = sequence + 1,
             latest_message_at = $2,
             updated_at = now()
         WHERE id = $1
         RETURNING sequence`,
        [parent.thread.id, candidate.createdAt],
      );
      const parentMessage = {
        ...candidate,
        sequence: parentHead.rows[0]!.sequence,
      };
      await this.insertMessage(client, parentMessage);
      await client.query(
        `UPDATE threads SET concluded_at = $2, concluded_by = $3, updated_at = now()
         WHERE id = $1`,
        [input.threadId, input.at, input.actorId],
      );
      const updated = await this.getThreadInTransaction(
        client,
        input.threadId,
        undefined,
        0,
      );
      await this.recordConversationChange(client, {
        eventId: parentMessage.id as unknown as OperationId,
        thread: {
          ...parent.thread,
          sequence: parentMessage.sequence,
          latestMessageAt: parentMessage.createdAt,
        },
        actorId: input.actorId,
        reason: "message_appended",
      });
      await this.recordConversationChange(client, {
        eventId: uuidv7() as OperationId,
        thread: updated!.thread,
        actorId: input.actorId,
        reason: "thread_concluded",
      });
      return { thread: updated!.thread, parentMessage };
    });
  }

  async concludeCoordinationThread(input: {
    threadId: ThreadId;
    actorId: PrincipalId;
    at: string;
  }): Promise<ConversationThread> {
    return this.write(async (client) => {
      await client.query("SELECT id FROM threads WHERE id = $1 FOR UPDATE", [
        input.threadId,
      ]);
      const current = await this.getThreadInTransaction(
        client,
        input.threadId,
        undefined,
        0,
      );
      if (
        !current ||
        current.thread.kind !== "coordination" ||
        !current.thread.parentThreadId
      ) {
        throw new Error("Coordination Thread was not found.");
      }
      if (!current.thread.participantIds.includes(input.actorId)) {
        throw new Error("Only a participant can conclude the Thread.");
      }
      if (current.thread.concludedAt) return current.thread;
      await client.query(
        `UPDATE threads
         SET concluded_at = $2, concluded_by = $3, updated_at = now()
         WHERE id = $1
        `,
        [input.threadId, input.at, input.actorId],
      );
      const concluded = await this.getThreadInTransaction(
        client,
        input.threadId,
        undefined,
        0,
      );
      if (!concluded) throw new Error("Coordination Thread was not found.");
      await this.recordConversationChange(client, {
        eventId: uuidv7() as OperationId,
        thread: concluded.thread,
        actorId: input.actorId,
        reason: "thread_concluded",
      });
      return concluded.thread;
    });
  }

  async addStandInToThread(
    threadId: ThreadId,
    actorId: PrincipalId,
  ): Promise<{ thread: ConversationThread; event: ThreadMessage }> {
    return this.write(async (client) => {
      const current = await this.getThreadInTransaction(
        client,
        threadId,
        undefined,
        0,
      );
      if (!current) throw new Error("Thread was not found.");
      const standInId = personalStandInId(actorId);
      await this.ensurePrincipal(client, standInId, "stand_in");
      await this.ensurePrincipal(client, actorId);
      const transition = addStandIn(current.thread, standInId, actorId);
      await client.query(
        `UPDATE threads SET
           access_mode = $2,
           access_changed_at_sequence = $3,
           prior_history_granted = $4,
           sequence = $5,
           access_version = access_version + 1,
           latest_message_at = $6,
           updated_at = now()
         WHERE id = $1`,
        [
          threadId,
          transition.thread.accessMode,
          transition.thread.accessChangedAtSequence ?? null,
          transition.thread.priorHistoryGranted,
          transition.thread.sequence,
          transition.event.createdAt,
        ],
      );
      await client.query(
        `INSERT INTO thread_participants
          (organization_id, thread_id, principal_id, stand_in,
           visible_from_sequence, revoked_at)
         VALUES ($1, $2, $3, true, $4, NULL)
         ON CONFLICT (thread_id, principal_id)
         DO UPDATE SET
           stand_in = true,
           visible_from_sequence = LEAST(
             thread_participants.visible_from_sequence,
             EXCLUDED.visible_from_sequence
           ),
           revoked_at = NULL,
           updated_at = now()`,
        [this.organizationId, threadId, standInId, transition.event.sequence],
      );
      await this.insertMessage(client, transition.event);
      const updated = (await this.getThreadInTransaction(
        client,
        threadId,
        undefined,
        0,
      ))!.thread;
      await this.recordConversationChange(client, {
        eventId: transition.event.id as unknown as OperationId,
        thread: updated,
        actorId,
        reason: "access_changed",
      });
      return { ...transition, thread: updated };
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
        spec.title,
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
      await this.ensurePrincipal(
        client,
        review.reviewerId,
        review.kind === "stand_in_impact_analysis" ? "stand_in" : "human",
      );
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

  async createDecisionOnce(
    input: Omit<DecisionRecord, "id" | "createdAt">,
  ): Promise<DecisionRecord> {
    if (!input.sourceThreadId) return this.createDecision(input);
    return this.write(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${this.organizationId}:${input.sourceThreadId}`],
      );
      const existing = await client.query(
        `SELECT * FROM decisions
         WHERE organization_id = $1 AND source_thread_id = $2
         LIMIT 1`,
        [this.organizationId, input.sourceThreadId],
      );
      if (existing.rows[0]) return decisionFromRow(existing.rows[0]);
      const decision: DecisionRecord = {
        ...input,
        id: uuidv7() as DecisionRecord["id"],
        createdAt: new Date().toISOString(),
      };
      for (const principalId of decision.decidedBy) {
        await this.ensurePrincipal(client, principalId);
      }
      const inserted = await client.query(
        `INSERT INTO decisions
          (id, organization_id, title, outcome, source_spec_revision_id,
           source_thread_id, affected_scopes, decided_by, supersedes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          decision.id,
          this.organizationId,
          decision.title,
          decision.outcome,
          decision.sourceSpecRevisionId ?? null,
          decision.sourceThreadId,
          json(decision.affectedScopes),
          json(decision.decidedBy),
          decision.supersedes ?? null,
          decision.createdAt,
        ],
      );
      return decisionFromRow(inserted.rows[0]);
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

  async listInbox(principalId?: PrincipalId): Promise<ActionInboxItem[]> {
    return this.read(async (client) => {
      const result = await client.query(
        `SELECT * FROM action_inbox
         WHERE resolved_at IS NULL
           AND ($1::uuid IS NULL OR principal_id = $1)
         ORDER BY created_at DESC`,
        [principalId ?? null],
      );
      return result.rows.map(inboxFromRow);
    });
  }

  async listThreads(
    kind?: ConversationThread["kind"],
    principalId?: PrincipalId,
  ) {
    return this.read(async (client) => {
      const result = await client.query<{
        id: ThreadId;
        unread_count: number;
        mention_count: number;
      }>(
        `SELECT t.id,
                CASE
                  WHEN $2::uuid IS NULL THEN 0
                  ELSE (
                    SELECT count(*)::integer
                    FROM messages m
                    JOIN thread_participants viewer
                      ON viewer.thread_id = m.thread_id
                     AND viewer.principal_id = $2
                     AND viewer.revoked_at IS NULL
                    LEFT JOIN thread_reads tr
                      ON tr.thread_id = m.thread_id
                     AND tr.principal_id = $2
                    WHERE m.thread_id = t.id
                      AND m.sequence >= viewer.visible_from_sequence
                      AND m.sequence > COALESCE(tr.last_read_sequence, 0)
                      AND m.sender_id <> $2
                  )
                END AS unread_count,
                CASE
                  WHEN $2::uuid IS NULL THEN 0
                  ELSE (
                    SELECT count(*)::integer
                    FROM messages m
                    JOIN thread_participants viewer
                      ON viewer.thread_id = m.thread_id
                     AND viewer.principal_id = $2
                     AND viewer.revoked_at IS NULL
                    LEFT JOIN thread_reads tr
                      ON tr.thread_id = m.thread_id
                     AND tr.principal_id = $2
                    WHERE m.thread_id = t.id
                      AND m.sequence >= viewer.visible_from_sequence
                      AND m.sequence > COALESCE(tr.last_read_sequence, 0)
                      AND m.sender_id <> $2
                      AND $2 = ANY(m.mentioned_principal_ids)
                  )
                END AS mention_count
         FROM threads t
         WHERE ($1::text IS NULL OR t.kind = $1)
           AND (
             $2::uuid IS NULL OR EXISTS (
               SELECT 1
               FROM thread_participants tp
               WHERE tp.thread_id = t.id
                 AND tp.principal_id = $2
                 AND tp.revoked_at IS NULL
             )
           )
         ORDER BY COALESCE(t.latest_message_at, t.created_at) DESC
         LIMIT 50`,
        [kind ?? null, principalId ?? null],
      );
      const items = await Promise.all(
        result.rows.map(async (row) => {
          const item = await this.getThreadInTransaction(
            client,
            row.id,
            principalId,
            100,
          );
          return item
            ? {
                ...item,
                unreadCount: row.unread_count,
                mentionCount: row.mention_count,
              }
            : undefined;
        }),
      );
      return items.filter(
        (
          item,
        ): item is {
          thread: ConversationThread;
          messages: ThreadMessage[];
          unreadCount: number;
          mentionCount: number;
        } => item !== undefined,
      );
    });
  }

  async getThread(threadId: ThreadId, principalId?: PrincipalId) {
    return this.read(async (client) => {
      const item = await this.getThreadInTransaction(
        client,
        threadId,
        principalId,
        100,
      );
      if (!item) return undefined;
      if (!principalId) {
        return { ...item, unreadCount: 0, mentionCount: 0 };
      }
      const unread = await client.query<{ unread_count: number }>(
        `SELECT count(*)::integer AS unread_count
         FROM messages m
         JOIN thread_participants viewer
           ON viewer.thread_id = m.thread_id
          AND viewer.principal_id = $2
          AND viewer.revoked_at IS NULL
         LEFT JOIN thread_reads tr
           ON tr.thread_id = m.thread_id
          AND tr.principal_id = $2
         WHERE m.thread_id = $1
           AND m.sequence >= viewer.visible_from_sequence
           AND m.sequence > COALESCE(tr.last_read_sequence, 0)
           AND m.sender_id <> $2`,
        [threadId, principalId],
      );
      const mentions = await client.query<{ mention_count: number }>(
        `SELECT count(*)::integer AS mention_count
         FROM messages m
         JOIN thread_participants viewer
           ON viewer.thread_id = m.thread_id
          AND viewer.principal_id = $2
          AND viewer.revoked_at IS NULL
         LEFT JOIN thread_reads tr
           ON tr.thread_id = m.thread_id
          AND tr.principal_id = $2
         WHERE m.thread_id = $1
           AND m.sequence >= viewer.visible_from_sequence
           AND m.sequence > COALESCE(tr.last_read_sequence, 0)
           AND m.sender_id <> $2
           AND $2 = ANY(m.mentioned_principal_ids)`,
        [threadId, principalId],
      );
      return {
        ...item,
        unreadCount: unread.rows[0]?.unread_count ?? 0,
        mentionCount: mentions.rows[0]?.mention_count ?? 0,
      };
    });
  }

  async hasThreadAccess(
    threadId: ThreadId,
    principalId: PrincipalId,
  ): Promise<boolean> {
    return this.read(async (client) => {
      const result = await client.query(
        `SELECT 1
         FROM thread_participants
         WHERE thread_id = $1
           AND principal_id = $2
           AND revoked_at IS NULL`,
        [threadId, principalId],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async listVisiblePeerPrincipalIds(
    viewerId: PrincipalId,
    candidateIds: readonly PrincipalId[],
  ): Promise<PrincipalId[]> {
    if (candidateIds.length === 0) return [];
    return this.read(async (client) => {
      const result = await client.query<{ principal_id: PrincipalId }>(
        `SELECT DISTINCT peer.principal_id
         FROM thread_participants viewer
         JOIN thread_participants peer
           ON peer.thread_id = viewer.thread_id
          AND peer.revoked_at IS NULL
         WHERE viewer.principal_id = $1
           AND viewer.revoked_at IS NULL
           AND peer.principal_id = ANY($2::uuid[])`,
        [viewerId, [...new Set(candidateIds)]],
      );
      const visible = new Set(result.rows.map((row) => row.principal_id));
      if (candidateIds.includes(viewerId)) visible.add(viewerId);
      return candidateIds.filter((principalId) => visible.has(principalId));
    });
  }

  async getThreadAccessVersion(
    threadId: ThreadId,
    principalId: PrincipalId,
  ): Promise<number | undefined> {
    return this.read(async (client) => {
      const result = await client.query<{ access_version: number }>(
        `SELECT t.access_version
         FROM threads t
         JOIN thread_participants tp
           ON tp.thread_id = t.id
          AND tp.principal_id = $2
          AND tp.revoked_at IS NULL
         WHERE t.id = $1`,
        [threadId, principalId],
      );
      return result.rows[0]?.access_version;
    });
  }

  async getSpec(specId: SpecId) {
    return this.read((client) => this.getSpecInTransaction(client, specId));
  }

  async listSpecs() {
    return this.read(async (client) => {
      const result = await client.query<{ id: SpecId }>(
        "SELECT id FROM specs ORDER BY created_at DESC",
      );
      const items = await Promise.all(
        result.rows.map((row) => this.getSpecInTransaction(client, row.id)),
      );
      return items.filter(
        (
          item,
        ): item is {
          spec: Spec;
          revisions: SpecRevision[];
          reviews: SpecReviewResponse[];
        } => item !== undefined,
      );
    });
  }

  async upsertPrincipal(
    principal: PrincipalSummary,
  ): Promise<PrincipalSummary> {
    return this.write(async (client) => {
      await client.query(
        `INSERT INTO principals (id, display_name, kind)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           kind = EXCLUDED.kind,
           updated_at = now()`,
        [principal.id, principal.displayName, principal.kind],
      );
      return principal;
    });
  }

  async listPrincipals(ids: PrincipalId[]): Promise<PrincipalSummary[]> {
    if (ids.length === 0) return [];
    return this.read(async (client) => {
      const result = await client.query<{
        id: PrincipalId;
        display_name: string;
        kind: PrincipalSummary["kind"];
      }>(
        `SELECT id, display_name, kind
         FROM principals
         WHERE id = ANY($1::uuid[])
         ORDER BY display_name, id`,
        [[...new Set(ids)]],
      );
      return result.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        kind: row.kind,
      }));
    });
  }

  async listActionEnvelopes(ids: OperationId[]): Promise<ActionEnvelope[]> {
    if (ids.length === 0) return [];
    return this.read(async (client) => {
      const result = await client.query<{ envelope: ActionEnvelope }>(
        `SELECT envelope
         FROM action_envelopes
         WHERE operation_id = ANY($1::uuid[])
         ORDER BY created_at`,
        [[...new Set(ids)]],
      );
      return result.rows.map((row) => row.envelope);
    });
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

  private async getKanbanCardInTransaction(
    client: PoolClient,
    cardId: KanbanCardId,
  ): Promise<KanbanCard | undefined> {
    const result = await client.query(
      `SELECT c.*,
         COALESCE(
           jsonb_agg(cw.workstream_id)
             FILTER (WHERE cw.workstream_id IS NOT NULL),
           '[]'::jsonb
         ) AS related_workstream_ids
       FROM kanban_cards c
       LEFT JOIN kanban_card_workstreams cw ON cw.card_id = c.id
       WHERE c.id = $1
       GROUP BY c.id`,
      [cardId],
    );
    return result.rows[0] ? kanbanCardFromRow(result.rows[0]) : undefined;
  }

  private async replaceKanbanWorkstreamLinks(
    client: PoolClient,
    cardId: KanbanCardId,
    workstreamIds: WorkstreamId[],
  ): Promise<void> {
    await client.query(
      "DELETE FROM kanban_card_workstreams WHERE card_id = $1",
      [cardId],
    );
    if (workstreamIds.length === 0) return;
    const inserted = await client.query(
      `INSERT INTO kanban_card_workstreams
        (organization_id, card_id, workstream_id)
       SELECT $1, $2, w.id
       FROM workstreams w
       WHERE w.organization_id = $1
         AND w.id = ANY($3::uuid[])`,
      [this.organizationId, cardId, workstreamIds],
    );
    if (inserted.rowCount !== workstreamIds.length) {
      throw new Error("Workstream was not found.");
    }
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

  private async loadMutableMessage(
    client: PoolClient,
    input: {
      threadId: ThreadId;
      messageId: ThreadMessage["id"];
      principalId: PrincipalId;
    },
  ): Promise<{
    thread: ConversationThread;
    current: ThreadMessage;
  }> {
    const result = await client.query(
      `SELECT m.*
       FROM messages m
       JOIN thread_participants viewer
         ON viewer.thread_id = m.thread_id
        AND viewer.principal_id = $2
        AND viewer.revoked_at IS NULL
       WHERE m.thread_id = $1
         AND m.id = $3
         AND m.sequence >= viewer.visible_from_sequence
       FOR UPDATE OF m`,
      [input.threadId, input.principalId, input.messageId],
    );
    const current = result.rows[0] ? messageFromRow(result.rows[0]) : undefined;
    if (!current) throw new Error("Message was not found.");
    const thread = await this.getThreadInTransaction(
      client,
      input.threadId,
      undefined,
      0,
    );
    if (!thread) throw new Error("Thread was not found.");
    assertMutableThreadMessage({
      thread: thread.thread,
      message: current,
      actorId: input.principalId,
    });
    return { thread: thread.thread, current };
  }

  private async getThreadInTransaction(
    client: PoolClient,
    threadId: ThreadId,
    viewerId?: PrincipalId,
    messageLimit?: number,
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
      stand_in: boolean;
      visible_from_sequence: number;
    }>(
      `SELECT principal_id, stand_in, visible_from_sequence
       FROM thread_participants
       WHERE thread_id = $1 AND revoked_at IS NULL`,
      [threadId],
    );
    const viewer = viewerId
      ? participants.rows.find((item) => item.principal_id === viewerId)
      : undefined;
    if (viewerId && !viewer) return undefined;
    const messages =
      messageLimit === undefined
        ? await client.query(
            `SELECT * FROM messages
             WHERE thread_id = $1
               AND ($2::integer IS NULL OR sequence >= $2)
             ORDER BY sequence`,
            [threadId, viewer?.visible_from_sequence ?? null],
          )
        : await client.query(
            `SELECT * FROM (
               SELECT * FROM messages
               WHERE thread_id = $1
                 AND ($2::integer IS NULL OR sequence >= $2)
               ORDER BY sequence DESC
               LIMIT $3
             ) tail
             ORDER BY sequence`,
            [threadId, viewer?.visible_from_sequence ?? null, messageLimit],
          );
    return {
      thread: {
        id: row.id,
        kind: row.kind,
        title: row.title,
        participantIds: participants.rows.map((item) => item.principal_id),
        standInIds: participants.rows
          .filter((item) => item.stand_in)
          .map((item) => item.principal_id),
        accessMode: row.access_mode,
        ...(row.access_changed_at_sequence
          ? { accessChangedAtSequence: row.access_changed_at_sequence }
          : {}),
        priorHistoryGranted: row.prior_history_granted,
        sequence: row.sequence,
        accessVersion: row.access_version,
        ...(row.latest_message_at
          ? { latestMessageAt: asIso(row.latest_message_at) }
          : {}),
        ...(row.project_id ? { projectId: row.project_id } : {}),
        ...(row.team_id ? { teamId: row.team_id } : {}),
        ...(row.parent_thread_id
          ? { parentThreadId: row.parent_thread_id }
          : {}),
        ...(row.concluded_at ? { concludedAt: asIso(row.concluded_at) } : {}),
        ...(row.concluded_by ? { concludedBy: row.concluded_by } : {}),
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
        (id, organization_id, thread_id, sender_id, client_message_id,
         sequence, kind, body, encrypted_body, server_readable,
         mentioned_principal_ids, attachments, metadata, stream_state,
         revision, reply_to_message_id, created_at)
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17
       )`,
      [
        message.id,
        this.organizationId,
        message.threadId,
        message.senderId,
        message.id,
        message.sequence,
        message.kind,
        message.body,
        message.encryptedBody ?? null,
        message.serverReadable,
        message.mentionedPrincipalIds ?? [],
        json(message.attachments ?? []),
        json(
          message.coordinationSummary
            ? { coordinationSummary: message.coordinationSummary }
            : {},
        ),
        message.streamState ?? "complete",
        message.revision ?? 1,
        message.replyToMessageId ?? null,
        message.createdAt,
      ],
    );
  }

  private async resolveMessageAttachments(
    client: PoolClient,
    threadId: ThreadId,
    senderId: PrincipalId,
    messageId: ThreadMessage["id"],
    attachmentIds: ThreadMessageAttachment["id"][],
  ): Promise<ThreadMessageAttachment[]> {
    const uniqueIds = [...new Set(attachmentIds)];
    if (uniqueIds.length !== attachmentIds.length) {
      throw new Error("Attachment IDs must be unique.");
    }
    if (uniqueIds.length === 0) return [];
    const result = await client.query<{
      id: ThreadMessageAttachment["id"];
      thread_id: ThreadId;
      owner_id: PrincipalId;
      file_name: string;
      content_type: string;
      byte_size: number;
      state: string;
      message_id: ThreadMessage["id"] | null;
    }>(
      `SELECT id, thread_id, owner_id, file_name, content_type, byte_size,
              state, message_id
       FROM attachments
       WHERE id = ANY($1::uuid[])
       FOR UPDATE`,
      [uniqueIds],
    );
    if (result.rows.length !== uniqueIds.length) {
      throw new Error("One or more attachments were not found.");
    }
    const byId = new Map(result.rows.map((row) => [row.id, row]));
    return uniqueIds.map((id) => {
      const row = byId.get(id)!;
      if (
        row.thread_id !== threadId ||
        row.owner_id !== senderId ||
        row.state !== "available" ||
        (row.message_id !== null && row.message_id !== messageId)
      ) {
        throw new Error("An attachment is not available for this message.");
      }
      if (!row.content_type.startsWith("image/")) {
        throw new Error("Conversation attachments must be images.");
      }
      return {
        id: row.id,
        fileName: row.file_name,
        contentType: row.content_type,
        byteSize: Number(row.byte_size),
      };
    });
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

  private async attentionPrincipalId(
    client: PoolClient,
    threadId: ThreadId,
    actorId: PrincipalId,
  ): Promise<PrincipalId> {
    const result = await client.query<{ principal_id: PrincipalId }>(
      `SELECT tp.principal_id
       FROM thread_participants tp
       JOIN principals p ON p.id = tp.principal_id
       WHERE tp.thread_id = $1
         AND tp.principal_id <> $2
         AND p.kind = 'human'
       ORDER BY tp.principal_id
       LIMIT 1`,
      [threadId, actorId],
    );
    return result.rows[0]?.principal_id ?? actorId;
  }

  private async ensurePrincipal(
    client: PoolClient,
    id: PrincipalId,
    kind: PrincipalSummary["kind"] = "human",
  ): Promise<void> {
    await client.query(
      `INSERT INTO principals (id, display_name, kind)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET
         kind = CASE
           WHEN EXCLUDED.kind = 'stand_in' THEN 'stand_in'
           ELSE principals.kind
         END,
         updated_at = now()`,
      [
        id,
        kind === "stand_in" ? "Intero Stand-in" : `Principal ${id.slice(0, 8)}`,
        kind,
      ],
    );
  }

  private async recordConversationChange(
    client: PoolClient,
    input: {
      eventId: OperationId;
      thread: ConversationThread;
      actorId: PrincipalId;
      reason: ConversationChangeReason;
      channels?: string[];
      messageId?: ThreadMessage["id"];
    },
  ): Promise<void> {
    const occurredAt = new Date().toISOString();
    const activity = await client.query(
      `INSERT INTO activity_events
        (organization_id, operation_id, actor_id, aggregate_type, aggregate_id,
         event_type, metadata, occurred_at)
       VALUES ($1, $2, $3, 'conversation', $4, 'conversation.changed', $5, $6)
       ON CONFLICT (operation_id) DO NOTHING
       RETURNING operation_id`,
      [
        this.organizationId,
        input.eventId,
        input.actorId,
        input.thread.id,
        json({
          reason: input.reason,
          headSequence: input.thread.sequence,
          accessVersion: input.thread.accessVersion ?? 1,
          ...(input.messageId ? { messageId: input.messageId } : {}),
        }),
        occurredAt,
      ],
    );
    if (activity.rowCount === 0) return;

    const payload = {
      schemaVersion: 1,
      eventId: input.eventId,
      type: "conversation.changed",
      threadId: input.thread.id,
      headSequence: input.thread.sequence,
      accessVersion: input.thread.accessVersion ?? 1,
      reason: input.reason,
      ...(input.messageId ? { messageId: input.messageId } : {}),
      occurredAt,
    };
    await client.query(
      `INSERT INTO outbox
        (operation_id, organization_id, topic, payload, attempts, available_at)
       VALUES ($1, $2, 'conversation.changed', $3, 0, $4)`,
      [input.eventId, this.organizationId, json(payload), occurredAt],
    );
    const channels = new Set(
      input.channels ?? [
        `intero:thread:${input.thread.id}`,
        ...input.thread.participantIds.map(
          (principalId) => `intero:user:${principalId}`,
        ),
      ],
    );
    for (const channel of channels) {
      await client.query(
        `INSERT INTO outbox_publications
          (operation_id, organization_id, channel, available_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (operation_id, channel) DO NOTHING`,
        [input.eventId, this.organizationId, channel, occurredAt],
      );
    }
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

function kanbanCardFromRow(row: QueryResultRow): KanbanCard {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    column: row.column,
    position: row.position,
    ...(row.owner_id ? { ownerId: row.owner_id } : {}),
    ...(row.estimate_points !== null
      ? { estimatePoints: row.estimate_points }
      : {}),
    relatedWorkstreamIds: row.related_workstream_ids,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
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
  const metadata =
    (row.metadata as
      | { coordinationSummary?: ThreadMessage["coordinationSummary"] }
      | undefined) ?? {};
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
    ...(row.operation_id ? { operationId: row.operation_id } : {}),
    ...(metadata.coordinationSummary
      ? { coordinationSummary: metadata.coordinationSummary }
      : {}),
    ...(row.reply_to_message_id
      ? { replyToMessageId: row.reply_to_message_id }
      : {}),
    ...((row.mentioned_principal_ids as PrincipalId[] | undefined)?.length
      ? { mentionedPrincipalIds: row.mentioned_principal_ids as PrincipalId[] }
      : {}),
    ...((row.attachments as ThreadMessageAttachment[] | undefined)?.length
      ? { attachments: row.attachments as ThreadMessageAttachment[] }
      : {}),
    streamState:
      (row.stream_state as ThreadMessageStreamState | undefined) ?? "complete",
    revision: Number(row.revision ?? 1),
    ...((row.reactions as ThreadMessage["reactions"] | undefined)?.length
      ? { reactions: row.reactions as NonNullable<ThreadMessage["reactions"]> }
      : {}),
    ...(row.edited_at ? { editedAt: asIso(row.edited_at) } : {}),
    ...(row.deleted_at ? { deletedAt: asIso(row.deleted_at) } : {}),
  };
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].toSorted();
  const sortedRight = [...right].toSorted();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
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
