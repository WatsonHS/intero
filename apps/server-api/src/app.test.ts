import type {
  ActionEnvelope,
  CapabilityGrant,
  ConversationThread,
  PrincipalId,
  SpecId,
  Workstream,
} from "@intero/domain";
import { uuidv7 } from "@intero/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { demoSeedingEnabled, InMemoryPlatformStore } from "./store.js";

describe("Intero API vertical slice", () => {
  let store: InMemoryPlatformStore;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    store = new InMemoryPlatformStore();
    app = await buildApp({ store, logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("branches a Thread, concludes it back into its parent, and refuses twice", async () => {
    const alex = "019f9a00-0000-7000-8000-000000000101" as PrincipalId;
    const priya = "019f9a00-0000-7000-8000-000000000102" as PrincipalId;
    const teamId = uuidv7();
    const createThread = (body: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/v1/threads", payload: body });

    const parentId = uuidv7();
    const parent = await createThread({
      id: parentId,
      kind: "room",
      title: "#intero-core",
      participantIds: [alex, priya],
      standInIds: [],
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      teamId,
      createdAt: new Date().toISOString(),
    });
    expect(parent.statusCode).toBe(201);
    // The owning team is optional but must survive the round trip when set.
    expect(parent.json<ConversationThread>().teamId).toBe(teamId);

    const branchId = uuidv7();
    const branch = await createThread({
      id: branchId,
      kind: "human_group",
      title: "confidence ownership",
      participantIds: [alex, priya],
      standInIds: [],
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      parentThreadId: parentId,
      createdAt: new Date().toISOString(),
    });
    expect(branch.json<ConversationThread>().parentThreadId).toBe(parentId);

    const concluded = await app.inject({
      method: "POST",
      url: `/v1/threads/${branchId}/conclusion`,
      payload: {
        messageId: uuidv7(),
        actorId: alex,
        conclusion: "Settled: optional in revision 3.",
        createdAt: new Date().toISOString(),
      },
    });
    expect(concluded.statusCode).toBe(201);
    const result = concluded.json<{
      thread: ConversationThread;
      parentMessage: { body: string; threadId: string };
    }>();
    expect(result.thread.concludedAt).toBeDefined();
    expect(result.thread.concludedBy).toBe(alex);
    // The conclusion lands in the parent, which is the whole point.
    expect(result.parentMessage.threadId).toBe(parentId);
    expect(result.parentMessage.body).toContain("optional in revision 3");

    const again = await app.inject({
      method: "POST",
      url: `/v1/threads/${branchId}/conclusion`,
      payload: {
        messageId: uuidv7(),
        actorId: alex,
        conclusion: "Settled again.",
        createdAt: new Date().toISOString(),
      },
    });
    expect(again.statusCode).toBe(409);
  });

  it("counts unread as other people's messages past your read marker", async () => {
    // Unread is per viewer, so both people must be resolvable identities —
    // an unauthenticated caller has no read marker and sees zero.
    const alex = "019b5ac0-7600-7000-8000-000000000002" as PrincipalId;
    const priya = "019b5ac0-7600-7000-8000-000000000004" as PrincipalId;
    const threadId = uuidv7();
    await app.inject({
      method: "POST",
      url: "/v1/threads",
      payload: {
        id: threadId,
        kind: "room",
        title: "#unread",
        participantIds: [alex, priya],
        standInIds: [],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        createdAt: new Date().toISOString(),
      },
    });
    for (const senderId of [priya, priya, alex]) {
      await app.inject({
        method: "POST",
        url: `/v1/threads/${threadId}/messages`,
        payload: {
          id: uuidv7(),
          senderId,
          body: "hello",
          createdAt: new Date().toISOString(),
        },
      });
    }

    const unreadFor = async (viewer: PrincipalId) => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/threads",
        headers: { "x-intero-dev-principal-id": viewer },
      });
      return response
        .json<{
          items: Array<{ thread: { id: string }; unreadCount: number }>;
        }>()
        .items.find((item) => item.thread.id === threadId)?.unreadCount;
    };

    // Your own messages are never unread to you.
    expect(await unreadFor(alex)).toBe(2);
    expect(await unreadFor(priya)).toBe(1);

    await app.inject({
      method: "POST",
      url: `/v1/threads/${threadId}/read`,
      payload: { principalId: alex, sequence: 3 },
    });
    expect(await unreadFor(alex)).toBe(0);

    // Re-reading an older message must not resurrect the ones after it.
    await app.inject({
      method: "POST",
      url: `/v1/threads/${threadId}/read`,
      payload: { principalId: alex, sequence: 1 },
    });
    expect(await unreadFor(alex)).toBe(0);
  });

  it("keeps demo fixtures opt-in", () => {
    expect(demoSeedingEnabled(undefined)).toBe(false);
    expect(demoSeedingEnabled("false")).toBe(false);
    expect(demoSeedingEnabled("true")).toBe(true);
  });

  it("reports liveness and privacy-safe request metrics without enabling attachments", async () => {
    await app.inject({ method: "GET", url: "/health" });
    const metrics = await app.inject({ method: "GET", url: "/metrics" });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain("intero_http_requests_total");
    expect(metrics.body).not.toContain("prompt");
    expect(metrics.body).not.toContain("principalId");

    const attachmentRoute = await app.inject({
      method: "POST",
      url: "/v1/attachments/uploads",
      payload: {},
    });
    expect(attachmentRoute.statusCode).toBe(503);
    expect(attachmentRoute.json()).toMatchObject({
      code: "ATTACHMENTS_UNAVAILABLE",
    });
  });

  it("reduces a Coding Agent checkpoint into Team Pulse without raw session data", async () => {
    const workstream = await createWorkstream(app);
    const event = {
      id: uuidv7(),
      operationId: uuidv7(),
      schemaVersion: 1,
      source: "codex",
      type: "CheckpointReported",
      occurredAt: "2026-07-24T10:00:00.000Z",
      receivedAt: "2026-07-24T10:00:01.000Z",
      workspaceId: workstream.workspaceId,
      workstreamId: workstream.id,
      privacy: "P3_PROJECT",
      payload: {
        checkpointKind: "blocker",
        summary: "Waiting for the authorization tuple schema.",
      },
      idempotencyKey: "codex:checkpoint:blocker:1",
    };

    const first = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: { event },
    });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ accepted: true, duplicate: false });

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: { event },
    });
    expect(duplicate.json()).toMatchObject({ accepted: true, duplicate: true });

    const pulse = await app.inject({ method: "GET", url: "/v1/team-pulse" });
    expect(pulse.json().projections[0]).toMatchObject({
      id: workstream.id,
      phase: "blocked",
      blockers: ["Waiting for the authorization tuple schema."],
    });
    expect(pulse.json().principals).toEqual([
      expect.objectContaining({
        id: workstream.ownerId,
        displayName: `Principal ${workstream.ownerId.slice(0, 8)}`,
      }),
    ]);
    expect(JSON.stringify(pulse.json())).not.toContain("prompt");

    const firstPage = await app.inject({
      method: "GET",
      url: "/v1/activity?after=0&limit=1",
    });
    expect(firstPage.json()).toMatchObject({ hasMore: true });
    const repaired = await app.inject({
      method: "GET",
      url: `/v1/activity?after=${firstPage.json().nextCursor}&limit=100`,
    });
    expect(repaired.json().items.length).toBeGreaterThan(0);
    expect(
      repaired
        .json()
        .items.every(
          (item: { sequence: number }) =>
            item.sequence > firstPage.json().nextCursor,
        ),
    ).toBe(true);
  });

  it("keeps Kanban cards independent while allowing optional Workstream links", async () => {
    const workstream = await createWorkstream(app);
    const projectId = "019b5ac0-7600-7000-8000-000000000011";
    const independentCardId = uuidv7();
    const linkedCardId = uuidv7();

    const independent = await app.inject({
      method: "POST",
      url: "/v1/kanban/cards",
      payload: {
        id: independentCardId,
        projectId,
        title: "Build the communications directory",
        description: "A project card without a Workstream dependency.",
        column: "planned",
        position: 0,
        relatedWorkstreamIds: [],
      },
    });
    expect(independent.statusCode).toBe(201);
    expect(independent.json()).toMatchObject({
      id: independentCardId,
      relatedWorkstreamIds: [],
    });

    const linked = await app.inject({
      method: "POST",
      url: "/v1/kanban/cards",
      payload: {
        id: linkedCardId,
        projectId,
        title: "Expose Work State in the board",
        description: "",
        column: "in_progress",
        position: 0,
        ownerId: workstream.ownerId,
        relatedWorkstreamIds: [workstream.id],
      },
    });
    expect(linked.statusCode).toBe(201);

    const associated = await app.inject({
      method: "PATCH",
      url: `/v1/kanban/cards/${independentCardId}`,
      payload: { relatedWorkstreamIds: [workstream.id], column: "review" },
    });
    expect(associated.json()).toMatchObject({
      column: "review",
      relatedWorkstreamIds: [workstream.id],
    });

    const board = await app.inject({ method: "GET", url: "/v1/kanban" });
    expect(board.statusCode).toBe(200);
    expect(board.json()).toMatchObject({
      selectedProjectId: projectId,
      cards: expect.arrayContaining([
        expect.objectContaining({
          id: independentCardId,
          relatedWorkstreamIds: [workstream.id],
        }),
        expect.objectContaining({
          id: linkedCardId,
          relatedWorkstreamIds: [workstream.id],
        }),
      ]),
      workstreams: [],
    });

    const duplicateLink = await app.inject({
      method: "PATCH",
      url: `/v1/kanban/cards/${independentCardId}`,
      payload: {
        relatedWorkstreamIds: [workstream.id, workstream.id],
      },
    });
    expect(duplicateLink.statusCode).toBe(400);

    const missingWorkstream = await app.inject({
      method: "PATCH",
      url: `/v1/kanban/cards/${independentCardId}`,
      payload: { relatedWorkstreamIds: [uuidv7()] },
    });
    expect(missingWorkstream.statusCode).toBe(404);

    const missingProject = await app.inject({
      method: "GET",
      url: `/v1/kanban?projectId=${uuidv7()}`,
    });
    expect(missingProject.statusCode).toBe(404);
  });

  it("returns the configured organization and principal bootstrap", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/bootstrap",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      organization: {
        id: "019b5ac0-7600-7000-8000-000000000001",
        name: "Intero Development",
      },
      currentPrincipal: {
        id: "019b5ac0-7600-7000-8000-000000000002",
        displayName: "Intero User",
        kind: "human",
      },
      standInPrincipal: {
        id: "019b5ac0-7600-5000-8000-000000000002",
        displayName: "Intero User 的替身",
        kind: "stand_in",
      },
    });
  });

  it("separates liveness from critical dependency readiness", async () => {
    await app.close();
    app = await buildApp({
      store: new InMemoryPlatformStore(),
      logger: false,
      readinessDependencies: [
        {
          name: "pilot_postgres",
          critical: true,
          check: async () => ({
            status: "unavailable",
            detail: "normalized_pilot_schema_missing",
          }),
        },
      ],
    });

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);

    const readiness = await app.inject({ method: "GET", url: "/ready" });
    expect(readiness.statusCode).toBe(503);
    expect(readiness.json()).toEqual({
      status: "unavailable",
      dependencies: [
        {
          name: "pilot_postgres",
          critical: true,
          status: "unavailable",
          detail: "normalized_pilot_schema_missing",
        },
      ],
    });
  });

  it("enforces Capability Grants and produces one Action Inbox item for expansion", async () => {
    const actorId = "019b5ac0-7600-7000-8000-000000000002" as PrincipalId;
    const workstream = await createWorkstream(app, actorId);
    const threadId = uuidv7() as ActionEnvelope["threadId"];
    await app.inject({
      method: "POST",
      url: "/v1/threads",
      payload: {
        id: threadId,
        kind: "coordination",
        title: "Ownership boundary",
        participantIds: [actorId],
        standInIds: [actorId],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        createdAt: "2026-07-24T09:59:00.000Z",
      },
    });
    const grant: CapabilityGrant = {
      id: uuidv7() as CapabilityGrant["id"],
      principalId: actorId,
      actions: ["declare_ownership"],
      organizationId: uuidv7() as CapabilityGrant["organizationId"],
      projectIds: [],
      workstreamIds: [workstream.id],
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
      action: "ownership_declaration",
      actorId,
      authorityGrantId: grant.id,
      policyVersion: "policy-1",
      threadId,
      workstreamId: workstream.id,
      humanMessage: "I can own the Work State API.",
      resourceScope: ["api/work-state"],
      relatedClaimIds: [],
      evidenceRefs: [],
      requestedActions: [],
      createdAt: "2026-07-24T10:00:00.000Z",
    };
    const allowed = await app.inject({
      method: "POST",
      url: "/v1/coordination",
      payload: { envelope },
    });
    expect(allowed.json().result).toMatchObject({ status: "resolved" });

    const rejected = await app.inject({
      method: "POST",
      url: "/v1/coordination",
      payload: {
        envelope: {
          ...envelope,
          operationId: uuidv7(),
          resourceScope: ["api/identity"],
        },
      },
    });
    expect(rejected.json().result).toMatchObject({
      status: "rejected",
      suggestedAgentAction: "narrow",
    });
    const inbox = await app.inject({
      method: "GET",
      url: "/v1/action-inbox",
      headers: { "x-intero-dev-principal-id": actorId },
    });
    expect(inbox.json().items).toHaveLength(1);
    expect(inbox.json().items[0].kind).toBe("scope_expansion");
    const durableThread = await app.inject({
      method: "GET",
      url: `/v1/threads/${threadId}`,
    });
    expect(durableThread.json()).toMatchObject({
      messages: [{ operationId: envelope.operationId, sequence: 1 }],
      actions: [
        {
          envelope: {
            operationId: envelope.operationId,
            policyVersion: "policy-1",
          },
          status: "resolved",
        },
      ],
    });
  });

  it("records the Human-only to Agent-readable boundary without exposing history", async () => {
    const human = uuidv7() as PrincipalId;
    const thread: Omit<ConversationThread, "sequence"> = {
      id: uuidv7() as ConversationThread["id"],
      kind: "human_group",
      title: "Shared API design",
      participantIds: [human],
      standInIds: [],
      accessMode: "human_only_e2ee",
      priorHistoryGranted: false,
      createdAt: "2026-07-24T10:00:00.000Z",
    };
    await app.inject({ method: "POST", url: "/v1/threads", payload: thread });
    const transition = await app.inject({
      method: "POST",
      url: `/v1/threads/${thread.id}/stand-ins`,
      payload: { actorId: human, standInId: uuidv7() },
    });
    expect(transition.json().thread).toMatchObject({
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      accessChangedAtSequence: 1,
    });
    expect(transition.json().event.kind).toBe("system_access_change");
  });

  it("lists durable threads by kind with their ordered messages", async () => {
    const human = uuidv7() as PrincipalId;
    const standIn = uuidv7() as PrincipalId;
    const standInThread = uuidv7() as ConversationThread["id"];
    const roomThread = uuidv7() as ConversationThread["id"];
    for (const [id, kind] of [
      [standInThread, "stand_in"],
      [roomThread, "room"],
    ] as const) {
      await app.inject({
        method: "POST",
        url: "/v1/threads",
        payload: {
          id,
          kind,
          title: `${kind} thread`,
          participantIds: [human, standIn],
          standInIds: [standIn],
          accessMode: "agent_readable",
          priorHistoryGranted: false,
          createdAt: "2026-07-24T10:00:00.000Z",
        },
      });
    }
    await app.inject({
      method: "POST",
      url: `/v1/threads/${standInThread}/messages`,
      payload: {
        id: uuidv7(),
        senderId: standIn,
        body: "This is the current durable Stand-in state.",
        createdAt: "2026-07-24T10:01:00.000Z",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/threads?kind=stand_in",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().items[0]).toMatchObject({
      thread: { id: standInThread, kind: "stand_in" },
      messages: [
        {
          body: "This is the current durable Stand-in state.",
          sequence: 1,
        },
      ],
    });
    expect(response.json().items[0].principals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: human, kind: "human" }),
        expect.objectContaining({
          id: standIn,
          kind: "stand_in",
        }),
      ]),
    );
  });

  it("accepts only ciphertext before the access boundary and plaintext after it", async () => {
    const human = uuidv7() as PrincipalId;
    const standIn = uuidv7() as PrincipalId;
    const threadId = uuidv7() as ConversationThread["id"];
    await app.inject({
      method: "POST",
      url: "/v1/threads",
      payload: {
        id: threadId,
        kind: "human_direct",
        title: "Private design discussion",
        participantIds: [human],
        standInIds: [],
        accessMode: "human_only_e2ee",
        priorHistoryGranted: false,
        createdAt: "2026-07-24T10:00:00.000Z",
      },
    });
    const rejectedPlaintext = await app.inject({
      method: "POST",
      url: `/v1/threads/${threadId}/messages`,
      payload: {
        id: uuidv7(),
        senderId: human,
        body: "This must never be server-readable.",
        createdAt: "2026-07-24T10:01:00.000Z",
      },
    });
    expect(rejectedPlaintext.statusCode).toBe(400);

    const encrypted = await app.inject({
      method: "POST",
      url: `/v1/threads/${threadId}/messages`,
      payload: {
        id: uuidv7(),
        senderId: human,
        encryptedBody: "opaque-openmls-ciphertext",
        createdAt: "2026-07-24T10:02:00.000Z",
      },
    });
    expect(encrypted.json()).toMatchObject({
      body: "",
      serverReadable: false,
      sequence: 1,
    });
    await app.inject({
      method: "POST",
      url: `/v1/threads/${threadId}/stand-ins`,
      payload: { actorId: human, standInId: standIn },
    });
    const readable = await app.inject({
      method: "POST",
      url: `/v1/threads/${threadId}/messages`,
      payload: {
        id: uuidv7(),
        senderId: human,
        body: "This message is after the visible access boundary.",
        createdAt: "2026-07-24T10:03:00.000Z",
      },
    });
    expect(readable.json()).toMatchObject({
      serverReadable: true,
      sequence: 3,
    });
    const history = await app.inject({
      method: "GET",
      url: `/v1/threads/${threadId}`,
    });
    expect(history.json().thread).toMatchObject({
      accessChangedAtSequence: 2,
      priorHistoryGranted: false,
    });
    expect(history.json().messages[0]).toMatchObject({
      encryptedBody: "opaque-openmls-ciphertext",
      serverReadable: false,
    });
    expect(history.json().messages[1].kind).toBe("system_access_change");
  });

  it("invalidates only affected Spec approvals after a material revision", async () => {
    const author = uuidv7() as PrincipalId;
    const specId = uuidv7() as SpecId;
    const created = await app.inject({
      method: "POST",
      url: "/v1/specs",
      payload: {
        id: specId,
        title: "Public Work State API",
        relatedWorkstreamIds: [],
        status: "in_review",
        markdown: "# API\n\nReturn freshness.",
        changeSummary: "Initial review",
        affectedScopes: ["api", "security"],
        createdBy: author,
      },
    });
    const revisionId = created.json().revision.id;
    expect(await store.listInbox(author)).toEqual([
      expect.objectContaining({
        title: "Public Work State API",
        detail: "Initial review",
      }),
    ]);
    for (const [scope, reviewerId] of [
      ["api", uuidv7()],
      ["security", uuidv7()],
    ]) {
      await app.inject({
        method: "POST",
        url: `/v1/specs/${specId}/reviews`,
        payload: {
          revisionId,
          reviewerId,
          kind: "human_approval",
          affectedScopes: [scope],
          body: `${scope} approved`,
          createdAt: "2026-07-24T10:30:00.000Z",
        },
      });
    }
    await app.inject({
      method: "POST",
      url: `/v1/specs/${specId}/revisions`,
      payload: {
        specId,
        revision: 2,
        markdown: "# API\n\nReturn freshness and confidence.",
        changeSummary: "Add confidence field",
        affectedScopes: ["api"],
        createdBy: author,
      },
    });

    const result = await app.inject({
      method: "GET",
      url: `/v1/specs/${specId}`,
    });
    const reviews = result.json().reviews as Array<{
      affectedScopes: string[];
      invalidatedAt?: string;
    }>;
    expect(
      reviews.find((review) => review.affectedScopes[0] === "api")
        ?.invalidatedAt,
    ).toBeDefined();
    expect(
      reviews.find((review) => review.affectedScopes[0] === "security")
        ?.invalidatedAt,
    ).toBeUndefined();
    const list = await app.inject({ method: "GET", url: "/v1/specs" });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0]).toMatchObject({
      spec: { id: specId, status: "in_review" },
      revisions: [{ revision: 1 }, { revision: 2 }],
    });
  });
});

async function createWorkstream(
  app: Awaited<ReturnType<typeof buildApp>>,
  ownerId = uuidv7() as PrincipalId,
): Promise<Workstream> {
  const payload = {
    id: uuidv7(),
    workspaceId: uuidv7(),
    ownerId,
    title: "Implement the coordination loop",
    phase: "planning",
    scope: [],
    blockers: [],
    dependencies: [],
    decisions: [],
    artifactIds: [],
    freshnessAt: "2026-07-24T09:00:00.000Z",
    confidence: 0.7,
  };
  const response = await app.inject({
    method: "POST",
    url: "/v1/workstreams",
    payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json() as Workstream;
}
