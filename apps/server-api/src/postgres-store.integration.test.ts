import {
  type ActionEnvelope,
  type ArtifactId,
  type CapabilityGrant,
  type MessageId,
  type OperationId,
  type OrganizationId,
  personalStandInId,
  type PrincipalId,
  type Workstream,
  uuidv7,
} from "@intero/domain";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildTestApp } from "./test-app";
import { migrateDatabase } from "./database/migrate";
import { PostgresPlatformStore } from "./postgres-store";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const databaseSuite = databaseUrl && databaseAppUrl ? describe : describe.skip;

databaseSuite("PostgreSQL platform store", () => {
  const organizationId = uuidv7() as OrganizationId;
  const ownerId = uuidv7() as PrincipalId;
  const standInId = personalStandInId(ownerId);
  const projectId = uuidv7() as Workstream["projectId"];
  const workstreamId = uuidv7() as Workstream["id"];
  const workspaceId = uuidv7() as Workstream["workspaceId"];
  const admin = new Client({ connectionString: databaseUrl });
  let store: PostgresPlatformStore;
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    await admin.connect();
    await admin.query("GRANT USAGE ON SCHEMA public TO intero_app");
    await admin.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO intero_app",
    );
    await admin.query(
      "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO intero_app",
    );
    store = new PostgresPlatformStore(
      new Pool({ connectionString: databaseAppUrl }),
      organizationId,
    );
    await store.initializeOrganization("Postgres store fixture");
    app = await buildTestApp({
      store,
      logger: false,
      currentPrincipal: {
        id: ownerId,
        displayName: "Owner",
        kind: "human",
      },
      standInPrincipal: {
        id: standInId,
        displayName: "Owner Stand-in",
        kind: "stand_in",
      },
      pilotIdentities: [
        {
          id: ownerId,
          displayName: "Owner",
          kind: "human",
        },
      ],
      project: {
        id: projectId!,
        name: "Intero integration fixture",
        projectManagementEnabled: true,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await store.close();
    for (const table of [
      "outbox_publications",
      "stand_in_question_jobs",
      "outbox",
      "activity_events",
      "action_envelopes",
      "action_inbox",
      "canonical_events",
      "spec_reviews",
      "spec_revisions",
      "specs",
      "attachments",
      "messages",
      "thread_participants",
      "threads",
      "capability_grants",
      "public_work_projections",
      "claims",
      "kanban_card_workstreams",
      "kanban_cards",
      "workstreams",
      "projects",
    ]) {
      await admin.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
        organizationId,
      ]);
    }
    await admin.query("DELETE FROM organizations WHERE id = $1", [
      organizationId,
    ]);
    await admin.query("DELETE FROM principals WHERE id = ANY($1::uuid[])", [
      [ownerId, standInId],
    ]);
    await admin.end();
  });

  it("persists an idempotent checkpoint, projection, activity event, and outbox atomically", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/workstreams",
      payload: {
        id: workstreamId,
        workspaceId,
        ownerId,
        title: "Persist the coordination loop",
        phase: "planning",
        scope: [],
        blockers: [],
        dependencies: [],
        decisions: [],
        artifactIds: [],
        freshnessAt: "2026-07-24T10:00:00.000Z",
        confidence: 0.7,
      },
    });
    expect(created.statusCode).toBe(201);

    const event = {
      id: uuidv7(),
      operationId: uuidv7(),
      schemaVersion: 1,
      source: "codex",
      type: "CheckpointReported",
      occurredAt: "2026-07-24T10:01:00.000Z",
      receivedAt: "2026-07-24T10:01:01.000Z",
      workspaceId,
      workstreamId,
      privacy: "P3_PROJECT",
      payload: {
        checkpointKind: "blocker",
        summary: "Waiting for schema review.",
      },
      idempotencyKey: `checkpoint:${uuidv7()}`,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/events",
          payload: { event },
        })
      ).json(),
    ).toMatchObject({ accepted: true, duplicate: false });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/events",
          payload: { event },
        })
      ).json(),
    ).toMatchObject({ accepted: true, duplicate: true });

    const pulse = (
      await app.inject({ method: "GET", url: "/v1/team-pulse" })
    ).json();
    expect(pulse.projections[0]).toMatchObject({
      id: workstreamId,
      phase: "blocked",
      blockers: ["Waiting for schema review."],
    });
    const activity = (
      await app.inject({ method: "GET", url: "/v1/activity" })
    ).json();
    expect(
      activity.items.map((item: { eventType: string }) => item.eventType),
    ).toEqual(["workstream.created", "claim.recorded"]);
    const durable = await admin.query(
      `SELECT
         (SELECT count(*) FROM canonical_events WHERE organization_id = $1) AS events,
         (SELECT count(*) FROM outbox WHERE organization_id = $1) AS outbox`,
      [organizationId],
    );
    expect(durable.rows[0]).toMatchObject({ events: "1", outbox: "2" });
  });

  it("persists the visible coordination result and returns it after a fresh store instance", async () => {
    const threadId = uuidv7() as ActionEnvelope["threadId"];
    await app.inject({
      method: "POST",
      url: "/v1/threads",
      headers: { "x-intero-dev-principal-id": ownerId },
      payload: {
        id: threadId,
        kind: "coordination",
        title: "Schema coordination",
        participantIds: [ownerId],
        standInIds: [ownerId],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        createdAt: "2026-07-24T10:02:00.000Z",
      },
    });
    const grant: CapabilityGrant = {
      id: uuidv7() as CapabilityGrant["id"],
      principalId: ownerId,
      actions: ["request_coordination"],
      organizationId,
      projectIds: [],
      workstreamIds: [workstreamId],
      resourceScopes: ["api/work-state"],
      requiresConfirmation: [],
      expiresAt: "2027-07-24T00:00:00.000Z",
      policyVersion: "policy-1",
    };
    await app.inject({
      method: "POST",
      url: "/v1/capability-grants",
      payload: grant,
    });
    const envelope: ActionEnvelope = {
      schemaVersion: 1,
      operationId: uuidv7() as ActionEnvelope["operationId"],
      action: "coordination_request",
      actorId: ownerId,
      authorityGrantId: grant.id,
      policyVersion: grant.policyVersion,
      threadId,
      workstreamId,
      humanMessage: "Confirm the public Work State boundary.",
      resourceScope: ["api/work-state"],
      relatedClaimIds: [],
      evidenceRefs: [],
      requestedActions: [],
      createdAt: "2026-07-24T10:03:00.000Z",
    };
    const result = await app.inject({
      method: "POST",
      url: "/v1/coordination",
      payload: { envelope },
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().result).toMatchObject({
      status: "resolved",
      threadId,
    });

    const secondStore = new PostgresPlatformStore(
      new Pool({ connectionString: databaseAppUrl }),
      organizationId,
    );
    expect((await secondStore.listProjections())[0]).toMatchObject({
      id: workstreamId,
    });
    expect(
      (await secondStore.listActivity()).map((event) => event.eventType),
    ).toContain("coordination.action_recorded");
    expect((await secondStore.getThread(threadId))?.messages[0]).toMatchObject({
      operationId: envelope.operationId,
      sequence: 1,
    });
    expect(
      await secondStore.listActionEnvelopes([envelope.operationId]),
    ).toEqual([expect.objectContaining({ operationId: envelope.operationId })]);
    expect(await secondStore.listPrincipals([ownerId])).toEqual([
      expect.objectContaining({
        id: ownerId,
        kind: "stand_in",
      }),
    ]);
    await secondStore.close();
  });

  it("persists optional Kanban-to-Workstream associations", async () => {
    const cardId = uuidv7();
    const created = await app.inject({
      method: "POST",
      url: "/v1/kanban/cards",
      payload: {
        id: cardId,
        projectId,
        title: "Verify the durable board",
        description: "The card can exist before a Workstream is attached.",
        column: "planned",
        position: 0,
        relatedWorkstreamIds: [],
      },
    });
    expect(created.statusCode).toBe(201);

    const linked = await app.inject({
      method: "PATCH",
      url: `/v1/kanban/cards/${cardId}`,
      payload: {
        column: "in_progress",
        relatedWorkstreamIds: [workstreamId],
      },
    });
    expect(linked.json()).toMatchObject({
      column: "in_progress",
      relatedWorkstreamIds: [workstreamId],
    });

    const secondStore = new PostgresPlatformStore(
      new Pool({ connectionString: databaseAppUrl }),
      organizationId,
    );
    expect(await secondStore.listKanbanCards(projectId)).toEqual([
      expect.objectContaining({
        id: cardId,
        relatedWorkstreamIds: [workstreamId],
      }),
    ]);
    await secondStore.close();
  });

  it("persists a Stand-in placeholder and revises the same message while streaming", async () => {
    const threadId = uuidv7() as ActionEnvelope["threadId"];
    const questionMessageId = uuidv7() as MessageId;
    const answerMessageId = uuidv7() as MessageId;
    await store.upsertPrincipal({
      id: ownerId,
      displayName: "Owner",
      kind: "human",
    });
    await store.upsertPrincipal({
      id: standInId,
      displayName: "Owner Stand-in",
      kind: "stand_in",
    });
    await store.enqueueStandInQuestion({
      jobId: uuidv7() as OperationId,
      projectId: projectId!,
      standInOwnerId: ownerId,
      askedByPrincipalId: ownerId,
      answerMessageId,
      preferredLanguage: "en-US",
      recordExchange: true,
      source: {
        kind: "new_message",
        thread: {
          id: threadId,
          kind: "stand_in",
          title: "Owner Stand-in",
          participantIds: [ownerId, standInId],
          standInIds: [standInId],
          accessMode: "agent_readable",
          priorHistoryGranted: false,
          sequence: 0,
          accessVersion: 1,
          createdAt: new Date().toISOString(),
        },
        messageId: questionMessageId,
        body: "What changed?",
        createdAt: new Date().toISOString(),
      },
    });

    expect((await store.getThread(threadId, ownerId))?.messages).toEqual([
      expect.objectContaining({ id: questionMessageId, sequence: 1 }),
      expect.objectContaining({
        id: answerMessageId,
        sequence: 2,
        body: "",
        streamState: "pending",
        revision: 1,
      }),
    ]);
    await store.updateMessageStream({
      threadId,
      messageId: answerMessageId,
      senderId: standInId,
      body: "A partial grounded answer",
      streamState: "streaming",
    });
    await store.updateMessageStream({
      threadId,
      messageId: answerMessageId,
      senderId: standInId,
      body: "A complete grounded answer.",
      streamState: "complete",
    });

    expect(
      await store.getThreadMessage(threadId, ownerId, answerMessageId),
    ).toMatchObject({
      sequence: 2,
      body: "A complete grounded answer.",
      streamState: "complete",
      revision: 3,
    });
  });

  it("enqueues a projectless Stand-in question without an untyped SQL parameter", async () => {
    const threadId = uuidv7() as ActionEnvelope["threadId"];
    const questionMessageId = uuidv7() as MessageId;
    const answerMessageId = uuidv7() as MessageId;
    const jobId = uuidv7() as OperationId;
    await store.upsertPrincipal({
      id: ownerId,
      displayName: "Owner",
      kind: "human",
    });
    await store.upsertPrincipal({
      id: standInId,
      displayName: "Owner Stand-in",
      kind: "stand_in",
    });

    await expect(
      store.enqueueStandInQuestion({
        jobId,
        standInOwnerId: ownerId,
        askedByPrincipalId: ownerId,
        answerMessageId,
        preferredLanguage: "en-US",
        recordExchange: false,
        source: {
          kind: "new_message",
          thread: {
            id: threadId,
            kind: "stand_in",
            title: "Projectless Stand-in",
            participantIds: [ownerId, standInId],
            standInIds: [standInId],
            accessMode: "agent_readable",
            priorHistoryGranted: false,
            sequence: 0,
            accessVersion: 1,
            createdAt: new Date().toISOString(),
          },
          messageId: questionMessageId,
          body: "Hello without a project",
          createdAt: new Date().toISOString(),
        },
      }),
    ).resolves.toMatchObject({ id: questionMessageId });

    const persisted = await admin.query<{
      project_id: string | null;
      payload: {
        schemaVersion: number;
        organizationId: string;
        jobId: string;
      };
    }>(
      `SELECT jobs.project_id, outbox.payload
       FROM stand_in_question_jobs jobs
       JOIN outbox ON outbox.operation_id = jobs.id
       WHERE jobs.id = $1`,
      [jobId],
    );
    expect(persisted.rows[0]).toEqual({
      project_id: null,
      payload: {
        schemaVersion: 3,
        organizationId,
        jobId,
      },
    });
  });

  it("claims multiple image attachments for one message atomically", async () => {
    const threadId = uuidv7() as ActionEnvelope["threadId"];
    const messageId = uuidv7() as MessageId;
    const attachmentIds = [uuidv7(), uuidv7()] as ArtifactId[];
    await store.createThread({
      id: threadId,
      kind: "human_group",
      title: "Image fixture",
      participantIds: [ownerId, standInId],
      standInIds: [standInId],
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      sequence: 0,
      accessVersion: 1,
      createdAt: new Date().toISOString(),
    });
    for (const [index, attachmentId] of attachmentIds.entries()) {
      await admin.query(
        `INSERT INTO attachments
          (id, organization_id, thread_id, owner_id, file_name, content_type,
           byte_size, checksum_sha256, encryption_mode, object_key, state,
           expires_at)
         VALUES (
           $1, $2, $3, $4, $5, 'image/png', 1, $6,
           'server_envelope', $7, 'available', now() + interval '1 hour'
         )`,
        [
          attachmentId,
          organizationId,
          threadId,
          ownerId,
          `image-${index}.png`,
          "0".repeat(64),
          `${organizationId}/${attachmentId}`,
        ],
      );
    }

    const message = await store.appendMessage(threadId, {
      id: messageId,
      senderId: ownerId,
      body: "Two images",
      attachmentIds,
      createdAt: new Date().toISOString(),
    });
    expect(message.attachments?.map((attachment) => attachment.id)).toEqual(
      attachmentIds,
    );
    const claims = await admin.query<{ message_id: string }>(
      `SELECT message_id
       FROM attachments
       WHERE id = ANY($1::uuid[])
       ORDER BY id`,
      [attachmentIds],
    );
    expect(claims.rows).toHaveLength(2);
    expect(
      claims.rows.every((attachment) => attachment.message_id === messageId),
    ).toBe(true);
  });
});
