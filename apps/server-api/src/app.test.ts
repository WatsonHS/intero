import type {
  ActionEnvelope,
  Attachment,
  CapabilityGrant,
  ConversationThread,
  CreateAttachmentUpload,
  MessageId,
  PrincipalId,
  SpecId,
  ThreadId,
  Workstream,
} from "@intero/domain";
import {
  OrganizationId,
  personalStandInId,
  ProjectId,
  roomInteroPrincipalId,
  uuidv7,
} from "@intero/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildTestApp } from "./test-app.js";
import { InMemoryPilotStore } from "./pilot-store.js";
import { demoSeedingEnabled, InMemoryPlatformStore } from "./store.js";

const ALEX = "019b5ac0-7600-7000-8000-000000000002" as PrincipalId;
const STAND_IN = personalStandInId(ALEX);
const PRIYA = "019b5ac0-7600-7000-8000-000000000004" as PrincipalId;
const MORGAN = "019b5ac0-7600-7000-8000-000000000005" as PrincipalId;

function auth(principalId: PrincipalId = ALEX) {
  return { "x-intero-dev-principal-id": principalId };
}

describe("Intero API vertical slice", () => {
  let store: InMemoryPlatformStore;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let revokedRealtimeAccess: Array<{
    principalId: PrincipalId;
    threadId: string;
  }>;

  beforeEach(async () => {
    store = new InMemoryPlatformStore();
    revokedRealtimeAccess = [];
    app = await buildTestApp({
      store,
      logger: false,
      pilotIdentities: [
        { id: ALEX, displayName: "Alex Rivera", kind: "human" },
        { id: PRIYA, displayName: "Priya Shah", kind: "human" },
        { id: MORGAN, displayName: "Morgan Chen", kind: "human" },
      ],
      realtimeAccessRevoker: {
        revoke: async (principalId, threadId) => {
          revokedRealtimeAccess.push({ principalId, threadId });
        },
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("allows browser requests from the all-interfaces development address", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://0.0.0.0:5173" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://0.0.0.0:5173",
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("branches a Thread, concludes it back into its parent, and allows an exact retry", async () => {
    const alex = ALEX;
    const priya = PRIYA;
    const teamId = uuidv7();
    const createThread = (body: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/v1/threads",
        headers: auth(alex),
        payload: body,
      });

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

    const conclusionMessageId = uuidv7();
    const conclusionPayload = {
      clientMessageId: conclusionMessageId,
      conclusion: "Settled: optional in revision 3.",
    };
    const concluded = await app.inject({
      method: "POST",
      url: `/v1/threads/${branchId}/conclusion`,
      headers: auth(alex),
      payload: conclusionPayload,
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

    const exactRetry = await app.inject({
      method: "POST",
      url: `/v1/threads/${branchId}/conclusion`,
      headers: auth(alex),
      payload: conclusionPayload,
    });
    expect(exactRetry.statusCode).toBe(201);
    expect(exactRetry.json().parentMessage).toMatchObject({
      id: conclusionMessageId,
      threadId: parentId,
      sequence: 1,
    });

    const again = await app.inject({
      method: "POST",
      url: `/v1/threads/${branchId}/conclusion`,
      headers: auth(alex),
      payload: {
        clientMessageId: uuidv7(),
        conclusion: "Settled again.",
      },
    });
    expect(again.statusCode).toBe(409);
  });

  it("does not let a colliding Thread ID mutate its participant set", async () => {
    const threadId = uuidv7();
    const original = {
      id: threadId,
      kind: "human_direct" as const,
      title: "Stable participant boundary",
      participantIds: [ALEX],
      standInIds: [],
      accessMode: "agent_readable" as const,
      priorHistoryGranted: false,
      createdAt: new Date().toISOString(),
    };
    const created = await app.inject({
      method: "POST",
      url: "/v1/threads",
      headers: auth(ALEX),
      payload: original,
    });
    expect(created.statusCode).toBe(201);

    const collision = await app.inject({
      method: "POST",
      url: "/v1/threads",
      headers: auth(ALEX),
      payload: {
        ...original,
        participantIds: [ALEX, PRIYA],
      },
    });
    expect(collision.statusCode).toBe(400);
    expect(collision.json()).toMatchObject({
      code: "DOMAIN_ERROR",
      message: "Thread ID was already used.",
    });

    const stored = await app.inject({
      method: "GET",
      url: `/v1/threads/${threadId}`,
      headers: auth(ALEX),
    });
    expect(stored.json().thread.participantIds).toEqual([ALEX]);
  });

  it("provisions one Room-local Intero and answers an exact mention idempotently", async () => {
    await app.close();
    const pilotStore = new InMemoryPilotStore();
    const organizationId = OrganizationId.parse(uuidv7());
    const teamId = uuidv7();
    const projectId = ProjectId.parse(uuidv7());
    const now = new Date().toISOString();
    await pilotStore.setupOrganization({
      organization: {
        id: organizationId,
        name: "Intero Lab",
        deploymentBaseUrl: "http://127.0.0.1:4310",
        deploymentValidatedAt: now,
        provider: { configured: false },
      },
      administratorId: ALEX,
      initialTeam: {
        id: teamId,
        organizationId,
        name: "Engineering",
        createdAt: now,
      },
    });
    await pilotStore.createProject({
      id: projectId,
      organizationId,
      name: "Auth Platform",
      ownerId: ALEX,
      primaryTeamId: teamId,
      participatingTeamIds: [teamId],
      posture: "collaborative",
      createdAt: now,
      updatedAt: now,
    });
    store = new InMemoryPlatformStore();
    app = await buildTestApp({
      store,
      pilotStore,
      logger: false,
      pilotIdentities: [
        { id: ALEX, displayName: "Alex Rivera", kind: "human" },
        { id: PRIYA, displayName: "Priya Shah", kind: "human" },
      ],
    });

    const roomId = uuidv7() as import("@intero/domain").ThreadId;
    const interoId = roomInteroPrincipalId(roomId);
    const created = await app.inject({
      method: "POST",
      url: "/v1/threads",
      headers: auth(ALEX),
      payload: {
        id: roomId,
        kind: "room",
        title: "#engineering",
        participantIds: [ALEX],
        standInIds: [],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        projectId,
        teamId,
        createdAt: now,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().participantIds).toEqual([ALEX, interoId]);

    const sourceMessageId = uuidv7();
    const payload = {
      clientMessageId: sourceMessageId,
      body: "@Intero check Auth Platform.",
      mentionedPrincipalIds: [interoId],
    };
    const sent = await app.inject({
      method: "POST",
      url: `/v1/threads/${roomId}/messages`,
      headers: auth(ALEX),
      payload,
    });
    expect(sent.statusCode).toBe(201);
    const replay = await app.inject({
      method: "POST",
      url: `/v1/threads/${roomId}/messages`,
      headers: auth(ALEX),
      payload,
    });
    expect(replay.statusCode).toBe(201);

    const room = await app.inject({
      method: "GET",
      url: `/v1/threads/${roomId}`,
      headers: auth(ALEX),
    });
    expect(room.json().principals).toContainEqual({
      id: interoId,
      displayName: "Intero",
      kind: "service",
    });
    expect(
      room
        .json()
        .messages.filter(
          (message: { senderId: string }) => message.senderId === interoId,
        ),
    ).toHaveLength(1);
    expect(
      await pilotStore.getInteroRequestBySourceMessage(sourceMessageId),
    ).toMatchObject({
      status: "answered",
      scopeRevision: 1,
      scopeResolution: { kind: "single_project", projectIds: [projectId] },
    });

    const encryptedRoomId = uuidv7() as import("@intero/domain").ThreadId;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/threads",
          headers: auth(ALEX),
          payload: {
            id: encryptedRoomId,
            kind: "room",
            title: "Private",
            participantIds: [ALEX],
            standInIds: [],
            accessMode: "human_only_e2ee",
            priorHistoryGranted: false,
            teamId,
            createdAt: now,
          },
        })
      ).json().participantIds,
    ).toEqual([ALEX]);
    const unsupported = await app.inject({
      method: "POST",
      url: `/v1/threads/${encryptedRoomId}/messages`,
      headers: auth(ALEX),
      payload: {
        clientMessageId: uuidv7(),
        encryptedBody: "ciphertext",
        mentionedPrincipalIds: [roomInteroPrincipalId(encryptedRoomId)],
      },
    });
    expect(unsupported.statusCode).toBe(409);
    expect(unsupported.json().code).toBe("INTERO_ROOM_ACCESS_UNSUPPORTED");
  });

  it("lets a group member rename the chat and add a member without exposing earlier history", async () => {
    const threadId = uuidv7();
    await app.inject({
      method: "POST",
      url: "/v1/threads",
      headers: auth(ALEX),
      payload: {
        id: threadId,
        kind: "room",
        title: "Launch planning",
        participantIds: [ALEX],
        standInIds: [],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        createdAt: new Date().toISOString(),
      },
    });
    await app.inject({
      method: "POST",
      url: `/v1/threads/${threadId}/messages`,
      headers: auth(ALEX),
      payload: {
        clientMessageId: uuidv7(),
        body: "History from before Priya joined.",
      },
    });
    const rejected = await app.inject({
      method: "PATCH",
      url: `/v1/threads/${threadId}`,
      headers: auth(PRIYA),
      payload: { title: "Hijacked" },
    });
    expect(rejected.statusCode).toBe(404);

    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/threads/${threadId}`,
      headers: auth(ALEX),
      payload: {
        title: "Launch room",
        addParticipantIds: [PRIYA],
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      thread: {
        title: "Launch room",
        participantIds: [
          ALEX,
          roomInteroPrincipalId(threadId as ThreadId),
          PRIYA,
        ],
        sequence: 2,
        accessVersion: 2,
      },
      event: {
        kind: "system_access_change",
        sequence: 2,
      },
    });

    const newMemberView = await app.inject({
      method: "GET",
      url: `/v1/threads/${threadId}`,
      headers: auth(PRIYA),
    });
    expect(newMemberView.statusCode).toBe(200);
    expect(newMemberView.json().messages).toEqual([
      expect.objectContaining({
        kind: "system_access_change",
        sequence: 2,
      }),
    ]);

    const removed = await app.inject({
      method: "PATCH",
      url: `/v1/threads/${threadId}`,
      headers: auth(ALEX),
      payload: { removeParticipantIds: [PRIYA] },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({
      thread: {
        participantIds: [ALEX, roomInteroPrincipalId(threadId as ThreadId)],
        sequence: 3,
        accessVersion: 3,
      },
      event: {
        kind: "system_access_change",
        sequence: 3,
      },
    });
    expect(revokedRealtimeAccess).toEqual([{ principalId: PRIYA, threadId }]);
    const revokedView = await app.inject({
      method: "GET",
      url: `/v1/threads/${threadId}`,
      headers: auth(PRIYA),
    });
    expect(revokedView.statusCode).toBe(404);
  });

  it("keeps a failed realtime disconnect visible and retryable after durable removal", async () => {
    await app.close();
    let realtimeAvailable = false;
    app = await buildTestApp({
      store,
      logger: false,
      pilotIdentities: [
        { id: ALEX, displayName: "Alex Rivera", kind: "human" },
        { id: PRIYA, displayName: "Priya Shah", kind: "human" },
      ],
      realtimeAccessRevoker: {
        revoke: async () => {
          if (!realtimeAvailable) throw new Error("centrifugo unavailable");
        },
      },
    });
    const threadId = uuidv7();
    await app.inject({
      method: "POST",
      url: "/v1/threads",
      headers: auth(ALEX),
      payload: {
        id: threadId,
        kind: "room",
        title: "Removal retry",
        participantIds: [ALEX, PRIYA],
        standInIds: [],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        createdAt: new Date().toISOString(),
      },
    });

    const remove = () =>
      app.inject({
        method: "PATCH",
        url: `/v1/threads/${threadId}`,
        headers: auth(ALEX),
        payload: { removeParticipantIds: [PRIYA] },
      });
    const pending = await remove();
    expect(pending.statusCode).toBe(503);
    expect(pending.json()).toMatchObject({
      code: "REALTIME_ACCESS_REVOKE_PENDING",
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/threads/${threadId}`,
          headers: auth(PRIYA),
        })
      ).statusCode,
    ).toBe(404);

    realtimeAvailable = true;
    expect((await remove()).statusCode).toBe(200);
  });

  it("settles a retried message ID exactly once and rejects payload drift", async () => {
    const threadId = uuidv7();
    const clientMessageId = uuidv7();
    await app.inject({
      method: "POST",
      url: "/v1/threads",
      headers: auth(ALEX),
      payload: {
        id: threadId,
        kind: "human_direct",
        title: "Idempotent delivery",
        participantIds: [ALEX],
        standInIds: [],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        createdAt: new Date().toISOString(),
      },
    });
    const send = (body: string) =>
      app.inject({
        method: "POST",
        url: `/v1/threads/${threadId}/messages`,
        headers: auth(ALEX),
        payload: { clientMessageId, body },
      });

    const first = await send("Committed once.");
    const retry = await send("Committed once.");
    const drift = await send("Changed while retrying.");

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(drift.statusCode).toBe(400);
    expect(drift.json()).toMatchObject({
      code: "DOMAIN_ERROR",
      message: "Client message ID was already used.",
    });
    const stored = await app.inject({
      method: "GET",
      url: `/v1/threads/${threadId}`,
      headers: auth(ALEX),
    });
    expect(stored.json().messages).toEqual([
      expect.objectContaining({
        id: clientMessageId,
        sequence: 1,
        body: "Committed once.",
      }),
    ]);
  });

  it("persists same-thread quote replies and rejects cross-thread references", async () => {
    const threadId = uuidv7();
    const otherThreadId = uuidv7();
    const originalMessageId = uuidv7();
    const otherMessageId = uuidv7();
    for (const [id, title] of [
      [threadId, "Reply thread"],
      [otherThreadId, "Other thread"],
    ]) {
      const created = await app.inject({
        method: "POST",
        url: "/v1/threads",
        headers: auth(ALEX),
        payload: {
          id,
          kind: "human_direct",
          title,
          participantIds: [ALEX],
          standInIds: [],
          accessMode: "agent_readable",
          priorHistoryGranted: false,
          createdAt: new Date().toISOString(),
        },
      });
      expect(created.statusCode).toBe(201);
    }
    for (const [targetThreadId, clientMessageId, body] of [
      [threadId, originalMessageId, "Original message"],
      [otherThreadId, otherMessageId, "Outside this conversation"],
    ]) {
      const sent = await app.inject({
        method: "POST",
        url: `/v1/threads/${targetThreadId}/messages`,
        headers: auth(ALEX),
        payload: { clientMessageId, body },
      });
      expect(sent.statusCode).toBe(201);
    }

    const replyId = uuidv7();
    const sendReply = (replyToMessageId?: string) =>
      app.inject({
        method: "POST",
        url: `/v1/threads/${threadId}/messages`,
        headers: auth(ALEX),
        payload: {
          clientMessageId: replyId,
          body: "Quoted reply",
          ...(replyToMessageId ? { replyToMessageId } : {}),
        },
      });
    const first = await sendReply(originalMessageId);
    const retry = await sendReply(originalMessageId);
    const drift = await sendReply();
    const crossThread = await app.inject({
      method: "POST",
      url: `/v1/threads/${threadId}/messages`,
      headers: auth(ALEX),
      payload: {
        clientMessageId: uuidv7(),
        body: "Invalid quote",
        replyToMessageId: otherMessageId,
      },
    });

    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      id: replyId,
      replyToMessageId: originalMessageId,
    });
    expect(retry.json()).toEqual(first.json());
    expect(drift.statusCode).toBe(400);
    expect(crossThread.statusCode).toBe(404);
    expect(crossThread.json()).toMatchObject({
      code: "DOMAIN_ERROR",
      message: "Reply message was not found.",
    });
  });

  it("adds, deduplicates, and removes durable message reactions", async () => {
    const threadId = uuidv7();
    const messageId = uuidv7();
    await app.inject({
      method: "POST",
      url: "/v1/threads",
      headers: auth(ALEX),
      payload: {
        id: threadId,
        kind: "room",
        title: "Reaction room",
        participantIds: [ALEX, PRIYA],
        standInIds: [],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        createdAt: new Date().toISOString(),
      },
    });
    await app.inject({
      method: "POST",
      url: `/v1/threads/${threadId}/messages`,
      headers: auth(ALEX),
      payload: { clientMessageId: messageId, body: "Ship it." },
    });
    const react = (principalId: PrincipalId, emoji: string, reacted: boolean) =>
      app.inject({
        method: "PUT",
        url: `/v1/threads/${threadId}/messages/${messageId}/reaction`,
        headers: auth(principalId),
        payload: { emoji, reacted },
      });

    const added = await react(ALEX, "👍", true);
    expect(added.statusCode).toBe(200);
    expect(added.json()).toMatchObject({
      revision: 2,
      reactions: [{ emoji: "👍", principalIds: [ALEX] }],
    });

    const exactRetry = await react(ALEX, "👍", true);
    expect(exactRetry.json()).toMatchObject({
      revision: 2,
      reactions: [{ emoji: "👍", principalIds: [ALEX] }],
    });

    const joined = await react(PRIYA, "👍", true);
    expect(joined.json()).toMatchObject({
      revision: 3,
      reactions: [{ emoji: "👍", principalIds: [ALEX, PRIYA] }],
    });

    const removed = await react(ALEX, "👍", false);
    expect(removed.json()).toMatchObject({
      revision: 4,
      reactions: [{ emoji: "👍", principalIds: [PRIYA] }],
    });

    const invalid = await react(ALEX, "not-an-emoji", true);
    expect(invalid.statusCode).toBe(400);

    const hidden = await react(MORGAN, "🎉", true);
    expect(hidden.statusCode).toBe(404);
  });

  it("counts unread as other people's messages past your read marker", async () => {
    // Unread is per viewer, so both people must be resolvable identities —
    // an unauthenticated caller has no read marker and sees zero.
    const alex = ALEX;
    const priya = PRIYA;
    const threadId = uuidv7();
    await app.inject({
      method: "POST",
      url: "/v1/threads",
      headers: auth(alex),
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
    for (const [index, senderId] of [priya, priya, alex].entries()) {
      await app.inject({
        method: "POST",
        url: `/v1/threads/${threadId}/messages`,
        headers: auth(senderId),
        payload: {
          clientMessageId: uuidv7(),
          body: "hello",
          mentionedPrincipalIds: index === 0 ? [alex] : [],
        },
      });
    }

    const countsFor = async (viewer: PrincipalId) => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/threads",
        headers: { "x-intero-dev-principal-id": viewer },
      });
      return response
        .json<{
          items: Array<{
            thread: { id: string };
            unreadCount: number;
            mentionCount: number;
          }>;
        }>()
        .items.find((item) => item.thread.id === threadId);
    };

    // Your own messages are never unread to you.
    expect(await countsFor(alex)).toMatchObject({
      unreadCount: 2,
      mentionCount: 1,
    });
    expect(await countsFor(priya)).toMatchObject({
      unreadCount: 1,
      mentionCount: 0,
    });

    await app.inject({
      method: "POST",
      url: `/v1/threads/${threadId}/read`,
      headers: auth(alex),
      payload: { sequence: 3 },
    });
    expect(await countsFor(alex)).toMatchObject({
      unreadCount: 0,
      mentionCount: 0,
    });

    // Re-reading an older message must not resurrect the ones after it.
    await app.inject({
      method: "POST",
      url: `/v1/threads/${threadId}/read`,
      headers: auth(alex),
      payload: { sequence: 1 },
    });
    expect(await countsFor(alex)).toMatchObject({
      unreadCount: 0,
      mentionCount: 0,
    });
  });

  it("keeps demo fixtures opt-in", () => {
    expect(demoSeedingEnabled(undefined)).toBe(false);
    expect(demoSeedingEnabled("false")).toBe(false);
    expect(demoSeedingEnabled("true")).toBe(true);
  });

  it("reports liveness and privacy-safe request metrics in isolated tests", async () => {
    await app.inject({ method: "GET", url: "/health" });
    const metrics = await app.inject({ method: "GET", url: "/metrics" });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain("intero_http_requests_total");
    expect(metrics.body).not.toContain("prompt");
    expect(metrics.body).not.toContain("principalId");
  });

  it("keeps conversation image bytes behind the authenticated API boundary", async () => {
    await app.close();
    const content = Buffer.from("safe image bytes");
    const threadId = uuidv7();
    const attachmentId = uuidv7();
    let attachment: Attachment | undefined;
    const attachments = {
      async createUpload(input: CreateAttachmentUpload) {
        const reserved: Attachment = {
          ...input,
          objectKey: `test/${input.id}`,
          state: "pending_upload",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
        attachment = reserved;
        return {
          attachment: reserved,
          uploadUrl: "http://minio.internal/presigned",
          requiredHeaders: { "x-internal-storage": "must-not-leak" },
        };
      },
      async get() {
        return attachment;
      },
      async uploadContent(_id: string, bytes: Uint8Array) {
        expect(Buffer.from(bytes)).toEqual(content);
      },
      async completeUpload() {
        attachment = { ...attachment!, state: "uploaded" };
        return attachment;
      },
      async scan() {
        attachment = { ...attachment!, state: "available" };
        return attachment;
      },
      async createDownload() {
        return {
          attachment: attachment!,
          downloadUrl: "http://minio.internal/presigned-download",
        };
      },
      async readContent() {
        return content;
      },
    };
    app = await buildTestApp({ store, attachments, logger: false });
    const createdThread = await app.inject({
      method: "POST",
      url: "/v1/threads",
      headers: auth(),
      payload: {
        id: threadId,
        kind: "human_group",
        title: "Image boundary",
        participantIds: [ALEX],
        standInIds: [],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        createdAt: new Date().toISOString(),
      },
    });
    expect(createdThread.statusCode).toBe(201);

    const reservation = await app.inject({
      method: "POST",
      url: "/v1/attachments/uploads",
      headers: auth(),
      payload: {
        id: attachmentId,
        threadId,
        ownerId: ALEX,
        fileName: "proof.png",
        contentType: "image/png",
        byteSize: content.byteLength,
        checksumSha256: "0".repeat(64),
        encryptionMode: "server_envelope",
      },
    });
    expect(reservation.statusCode).toBe(201);
    expect(reservation.json()).toMatchObject({
      uploadUrl: `http://localhost/v1/attachments/${attachmentId}/content`,
      requiredHeaders: { "content-type": "image/png" },
    });
    expect(reservation.body).not.toContain("minio.internal");

    const crossedSession = await app.inject({
      method: "PUT",
      url: `/v1/attachments/${attachmentId}/content`,
      headers: { ...auth(PRIYA), "content-type": "image/png" },
      payload: content,
    });
    expect(crossedSession.statusCode).toBe(404);

    const uploaded = await app.inject({
      method: "PUT",
      url: `/v1/attachments/${attachmentId}/content`,
      headers: { ...auth(), "content-type": "image/png" },
      payload: content,
    });
    expect(uploaded.statusCode).toBe(204);

    const completed = await app.inject({
      method: "POST",
      url: `/v1/attachments/${attachmentId}/complete`,
      headers: auth(),
      payload: {},
    });
    expect(completed.statusCode).toBe(202);
    expect(completed.json()).toMatchObject({ state: "available" });

    const download = await app.inject({
      method: "GET",
      url: `/v1/attachments/${attachmentId}`,
      headers: auth(),
    });
    expect(download.json()).toMatchObject({
      downloadUrl: `http://localhost/v1/attachments/${attachmentId}/content`,
    });
    expect(download.body).not.toContain("minio.internal");

    const downloaded = await app.inject({
      method: "GET",
      url: `/v1/attachments/${attachmentId}/content`,
      headers: auth(),
    });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers["content-type"]).toBe("image/png");
    expect(downloaded.rawPayload).toEqual(content);
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
      headers: auth(workstream.ownerId),
      payload: { event },
    });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ accepted: true, duplicate: false });

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: auth(workstream.ownerId),
      payload: { event },
    });
    expect(duplicate.json()).toMatchObject({ accepted: true, duplicate: true });

    const pulse = await app.inject({
      method: "GET",
      url: "/v1/team-pulse",
      headers: auth(workstream.ownerId),
    });
    expect(pulse.json().projections[0]).toMatchObject({
      id: workstream.id,
      phase: "blocked",
      blockers: ["Waiting for the authorization tuple schema."],
    });
    expect(pulse.json().principals).toEqual([
      expect.objectContaining({
        id: workstream.ownerId,
        displayName: "Alex Rivera",
      }),
    ]);
    expect(JSON.stringify(pulse.json())).not.toContain("prompt");

    const firstPage = await app.inject({
      method: "GET",
      url: "/v1/activity?after=0&limit=1",
      headers: auth(workstream.ownerId),
    });
    expect(firstPage.json()).toMatchObject({ hasMore: true });
    const repaired = await app.inject({
      method: "GET",
      url: `/v1/activity?after=${firstPage.json().nextCursor}&limit=100`,
      headers: auth(workstream.ownerId),
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
      headers: auth(workstream.ownerId),
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
      headers: auth(workstream.ownerId),
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
      headers: auth(workstream.ownerId),
      payload: { relatedWorkstreamIds: [workstream.id], column: "review" },
    });
    expect(associated.json()).toMatchObject({
      column: "review",
      relatedWorkstreamIds: [workstream.id],
    });

    const board = await app.inject({
      method: "GET",
      url: "/v1/kanban",
      headers: auth(workstream.ownerId),
    });
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
      headers: auth(workstream.ownerId),
      payload: {
        relatedWorkstreamIds: [workstream.id, workstream.id],
      },
    });
    expect(duplicateLink.statusCode).toBe(400);

    const missingWorkstream = await app.inject({
      method: "PATCH",
      url: `/v1/kanban/cards/${independentCardId}`,
      headers: auth(workstream.ownerId),
      payload: { relatedWorkstreamIds: [uuidv7()] },
    });
    expect(missingWorkstream.statusCode).toBe(404);

    const missingProject = await app.inject({
      method: "GET",
      url: `/v1/kanban?projectId=${uuidv7()}`,
      headers: auth(workstream.ownerId),
    });
    expect(missingProject.statusCode).toBe(404);
  });

  it("does not expose a fallback principal without effective identity", async () => {
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
      adapters: { realtime: "centrifugo" },
    });
  });

  it("disables realtime discovery and token routes at the rollout kill switch", async () => {
    await app.close();
    app = await buildTestApp({
      store,
      logger: false,
      realtimeConfig: {
        publicUrl: "http://localhost:4311",
        tokenSecret: "intero-development-realtime-token-secret-v1",
        enabled: false,
      },
    });
    const bootstrap = await app.inject({
      method: "GET",
      url: "/v1/bootstrap",
      headers: auth(),
    });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({ adapters: {} });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/realtime/session",
          headers: auth(),
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  });

  it("requires identity on organization data and rejects actor spoofing", async () => {
    const unauthenticatedRead = await app.inject({
      method: "GET",
      url: "/v1/team-pulse",
    });
    expect(unauthenticatedRead.statusCode).toBe(401);
    expect(unauthenticatedRead.json()).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });

    const unauthenticatedWrite = await app.inject({
      method: "POST",
      url: "/v1/specs",
      payload: {},
    });
    expect(unauthenticatedWrite.statusCode).toBe(401);

    const spoofedWorkstream = await app.inject({
      method: "POST",
      url: "/v1/workstreams",
      headers: auth(ALEX),
      payload: {
        id: uuidv7(),
        workspaceId: uuidv7(),
        ownerId: PRIYA,
        title: "Spoofed ownership",
        phase: "planning",
        scope: [],
        blockers: [],
        dependencies: [],
        decisions: [],
        artifactIds: [],
        freshnessAt: "2026-07-24T09:00:00.000Z",
        confidence: 0.7,
      },
    });
    expect(spoofedWorkstream.statusCode).toBe(403);
    expect(spoofedWorkstream.json()).toMatchObject({
      code: "WORKSTREAM_OWNER_INVALID",
    });
  });

  it("does not mount legacy canonical mutation routes outside development", async () => {
    await app.close();
    app = await buildTestApp({
      store: new InMemoryPlatformStore(),
      logger: false,
      enableLegacyApi: false,
    });

    for (const url of ["/v1/events", "/v1/authorization/check"]) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: auth(ALEX),
        payload: {},
      });
      expect(response.statusCode).toBe(404);
    }
  });

  it("does not trust local development origins when they are disabled", async () => {
    await app.close();
    app = await buildTestApp({
      store: new InMemoryPlatformStore(),
      logger: false,
      allowDevelopmentOrigins: false,
      authCorsOrigins: ["https://intero.example.com"],
    });

    const local = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://localhost:5173" },
    });
    expect(local.headers["access-control-allow-origin"]).toBeUndefined();

    const trusted = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://intero.example.com" },
    });
    expect(trusted.headers["access-control-allow-origin"]).toBe(
      "https://intero.example.com",
    );
  });

  it("separates liveness from critical dependency readiness", async () => {
    await app.close();
    app = await buildTestApp({
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
      headers: auth(actorId),
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
      headers: auth(actorId),
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
      headers: auth(actorId),
      payload: { envelope },
    });
    expect(allowed.json().result).toMatchObject({ status: "resolved" });

    const rejected = await app.inject({
      method: "POST",
      url: "/v1/coordination",
      headers: auth(actorId),
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
      headers: auth(actorId),
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
    const human = ALEX;
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
    await app.inject({
      method: "POST",
      url: "/v1/threads",
      headers: auth(human),
      payload: thread,
    });
    const attemptedOtherStandIn = await app.inject({
      method: "POST",
      url: `/v1/threads/${thread.id}/stand-ins`,
      headers: auth(human),
      payload: { standInId: personalStandInId(PRIYA) },
    });
    expect(attemptedOtherStandIn.statusCode).toBe(400);
    const transition = await app.inject({
      method: "POST",
      url: `/v1/threads/${thread.id}/stand-ins`,
      headers: auth(human),
      payload: {},
    });
    expect(transition.json().thread).toMatchObject({
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      accessChangedAtSequence: 1,
    });
    expect(transition.json().event.kind).toBe("system_access_change");
    expect(transition.json().thread.standInIds).toEqual([STAND_IN]);
  });

  it("lists durable threads by kind with their ordered messages", async () => {
    const human = ALEX;
    const standIn = STAND_IN;
    const standInThread = uuidv7() as ConversationThread["id"];
    const roomThread = uuidv7() as ConversationThread["id"];
    for (const [id, kind] of [
      [standInThread, "stand_in"],
      [roomThread, "room"],
    ] as const) {
      await app.inject({
        method: "POST",
        url: "/v1/threads",
        headers: auth(human),
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
      headers: auth(human),
      payload: {
        clientMessageId: uuidv7(),
        body: "This is the current durable Stand-in state.",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/threads?kind=stand_in",
      headers: auth(human),
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

  it("bounds the Thread list to a 100-message tail without undercounting unread", () => {
    const threadId = uuidv7() as ConversationThread["id"];
    store.createThread(
      {
        id: threadId,
        kind: "room",
        title: "Long-running room",
        participantIds: [ALEX, PRIYA],
        standInIds: [],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        sequence: 0,
        createdAt: "2026-07-24T10:00:00.000Z",
      },
      ALEX,
    );
    for (let index = 1; index <= 101; index += 1) {
      store.appendMessage(threadId, {
        id: uuidv7() as MessageId,
        senderId: PRIYA,
        body: `message ${index}`,
        createdAt: new Date(Date.UTC(2026, 6, 24, 10, 0, index)).toISOString(),
      });
    }

    const [listed] = store.listThreads("room", ALEX);
    expect(listed?.messages).toHaveLength(100);
    expect(listed?.messages[0]?.sequence).toBe(2);
    expect(listed?.messages.at(-1)?.sequence).toBe(101);
    expect(listed?.unreadCount).toBe(101);
    expect(
      store.listThreadMessages(threadId, ALEX, {
        beforeSequence: 2,
        limit: 100,
      }),
    ).toMatchObject({
      items: [{ sequence: 1, body: "message 1" }],
      headSequence: 101,
      hasMore: false,
    });
  });

  it("accepts only ciphertext before the access boundary and plaintext after it", async () => {
    const human = ALEX;
    const threadId = uuidv7() as ConversationThread["id"];
    await app.inject({
      method: "POST",
      url: "/v1/threads",
      headers: auth(human),
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
      headers: auth(human),
      payload: {
        clientMessageId: uuidv7(),
        body: "This must never be server-readable.",
      },
    });
    expect(rejectedPlaintext.statusCode).toBe(400);

    const encrypted = await app.inject({
      method: "POST",
      url: `/v1/threads/${threadId}/messages`,
      headers: auth(human),
      payload: {
        clientMessageId: uuidv7(),
        encryptedBody: "opaque-openmls-ciphertext",
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
      headers: auth(human),
      payload: {},
    });
    const readable = await app.inject({
      method: "POST",
      url: `/v1/threads/${threadId}/messages`,
      headers: auth(human),
      payload: {
        clientMessageId: uuidv7(),
        body: "This message is after the visible access boundary.",
      },
    });
    expect(readable.json()).toMatchObject({
      serverReadable: true,
      sequence: 3,
    });
    const history = await app.inject({
      method: "GET",
      url: `/v1/threads/${threadId}`,
      headers: auth(human),
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
    const author = ALEX;
    const specId = uuidv7() as SpecId;
    const created = await app.inject({
      method: "POST",
      url: "/v1/specs",
      headers: auth(author),
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
      ["api", PRIYA],
      ["security", MORGAN],
    ] as const) {
      await app.inject({
        method: "POST",
        url: `/v1/specs/${specId}/reviews`,
        headers: auth(reviewerId),
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
      headers: auth(author),
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
      headers: auth(author),
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
    const list = await app.inject({
      method: "GET",
      url: "/v1/specs",
      headers: auth(author),
    });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0]).toMatchObject({
      spec: { id: specId, status: "in_review" },
      revisions: [{ revision: 1 }, { revision: 2 }],
    });
  });
});

async function createWorkstream(
  app: Awaited<ReturnType<typeof buildTestApp>>,
  ownerId = ALEX,
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
    headers: auth(ownerId),
    payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json() as Workstream;
}
