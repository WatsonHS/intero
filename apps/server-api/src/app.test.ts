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

  it("keeps demo fixtures opt-in", () => {
    expect(demoSeedingEnabled(undefined)).toBe(false);
    expect(demoSeedingEnabled("false")).toBe(false);
    expect(demoSeedingEnabled("true")).toBe(true);
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

  it("reports the Local Representative online only after a fresh heartbeat", async () => {
    const before = await app.inject({
      method: "GET",
      url: "/v1/offline-status",
    });
    expect(before.json()).toMatchObject({
      localRuntime: "offline",
      fallback: "public",
    });

    const heartbeat = await app.inject({
      method: "POST",
      url: "/v1/runtime/heartbeat",
    });
    expect(heartbeat.statusCode).toBe(202);

    const after = await app.inject({
      method: "GET",
      url: "/v1/offline-status",
    });
    expect(after.json()).toMatchObject({
      localRuntime: "online",
      fallback: "local",
      disclosure: "Local Representative is connected.",
    });
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
      representativePrincipal: {
        id: "019b5ac0-7600-7000-8000-000000000003",
        displayName: "Intero Representative",
        kind: "representative",
      },
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
        representativeIds: [actorId],
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
    const inbox = await app.inject({ method: "GET", url: "/v1/action-inbox" });
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
      representativeIds: [],
      accessMode: "human_only_e2ee",
      priorHistoryGranted: false,
      createdAt: "2026-07-24T10:00:00.000Z",
    };
    await app.inject({ method: "POST", url: "/v1/threads", payload: thread });
    const transition = await app.inject({
      method: "POST",
      url: `/v1/threads/${thread.id}/representatives`,
      payload: { actorId: human, representativeId: uuidv7() },
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
    const representative = uuidv7() as PrincipalId;
    const representativeThread = uuidv7() as ConversationThread["id"];
    const roomThread = uuidv7() as ConversationThread["id"];
    for (const [id, kind] of [
      [representativeThread, "representative"],
      [roomThread, "room"],
    ] as const) {
      await app.inject({
        method: "POST",
        url: "/v1/threads",
        payload: {
          id,
          kind,
          title: `${kind} thread`,
          participantIds: [human, representative],
          representativeIds: [representative],
          accessMode: "agent_readable",
          priorHistoryGranted: false,
          createdAt: "2026-07-24T10:00:00.000Z",
        },
      });
    }
    await app.inject({
      method: "POST",
      url: `/v1/threads/${representativeThread}/messages`,
      payload: {
        id: uuidv7(),
        senderId: representative,
        body: "This is the current durable Representative state.",
        createdAt: "2026-07-24T10:01:00.000Z",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/threads?kind=representative",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().items[0]).toMatchObject({
      thread: { id: representativeThread, kind: "representative" },
      messages: [
        {
          body: "This is the current durable Representative state.",
          sequence: 1,
        },
      ],
    });
    expect(response.json().items[0].principals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: human, kind: "human" }),
        expect.objectContaining({
          id: representative,
          kind: "representative",
        }),
      ]),
    );
  });

  it("accepts only ciphertext before the access boundary and plaintext after it", async () => {
    const human = uuidv7() as PrincipalId;
    const representative = uuidv7() as PrincipalId;
    const threadId = uuidv7() as ConversationThread["id"];
    await app.inject({
      method: "POST",
      url: "/v1/threads",
      payload: {
        id: threadId,
        kind: "human_direct",
        title: "Private design discussion",
        participantIds: [human],
        representativeIds: [],
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
      url: `/v1/threads/${threadId}/representatives`,
      payload: { actorId: human, representativeId: representative },
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
