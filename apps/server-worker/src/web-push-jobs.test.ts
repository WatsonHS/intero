import type {
  ConversationThread,
  NotificationPreferences,
  OrganizationId,
  PrincipalId,
  ThreadMessage,
  WebPushSubscription,
} from "@intero/domain";
import { describe, expect, it, vi } from "vitest";

import {
  conversationEventToWebPushPayload,
  deliverConversationWebPush,
  GoneWebPushSubscriptionError,
  GraphileWebPushJobRunner,
  WEB_PUSH_TASK,
  type WebPushSender,
} from "./web-push-jobs.js";

const ORGANIZATION_ID =
  "019fb800-0000-7000-8000-000000000001" as OrganizationId;
const THREAD_ID = "019fb800-0000-7000-8000-000000000010";
const ALEX = "019b5ac0-7600-7000-8000-000000000002" as PrincipalId;
const PRIYA = "019b5ac0-7600-7000-8000-000000000004" as PrincipalId;

const thread: ConversationThread = {
  id: THREAD_ID as ConversationThread["id"],
  kind: "human_direct",
  title: "Secret DM",
  participantIds: [ALEX, PRIYA],
  standInIds: [],
  accessMode: "agent_readable",
  priorHistoryGranted: false,
  sequence: 3,
  createdAt: "2026-09-03T12:00:00.000Z",
};

const message: ThreadMessage = {
  id: "019fb800-0000-7000-8000-000000000011" as ThreadMessage["id"],
  threadId: THREAD_ID as ThreadMessage["threadId"],
  senderId: ALEX,
  sequence: 3,
  kind: "message",
  body: "Please review the cursor repair",
  createdAt: "2026-09-03T12:00:01.000Z",
  serverReadable: true,
  mentionedPrincipalIds: [PRIYA],
  streamState: "complete",
};

const subscription: WebPushSubscription = {
  id: "019fb800-0000-7000-8000-000000000012",
  principalId: PRIYA,
  endpoint: "https://push.example/priya",
  keys: { p256dh: "p256dh-key", auth: "auth-key" },
  createdAt: "2026-09-03T11:00:00.000Z",
  lastSeenAt: "2026-09-03T11:00:00.000Z",
};

function preferences(
  messages: NotificationPreferences["messages"],
): NotificationPreferences {
  return {
    principalId: PRIYA,
    mutedKinds: [],
    messages,
    updatedAt: "2026-09-03T11:00:00.000Z",
  };
}

function storeStub(overrides?: {
  thread?: ConversationThread;
  message?: ThreadMessage;
  subscriptions?: WebPushSubscription[];
}) {
  return {
    getMessageAtSequence: vi.fn(async () => ({
      thread: overrides?.thread ?? thread,
      message: overrides?.message ?? message,
    })),
    listPrincipals: vi.fn(async () => [
      { id: ALEX, displayName: "Alex", kind: "human" as const },
      { id: PRIYA, displayName: "Priya", kind: "human" as const },
    ]),
    listWebPushSubscriptionsForPrincipals: vi.fn(async () => [
      ...(overrides?.subscriptions ?? [subscription]),
    ]),
    deleteWebPushSubscriptionByEndpoint: vi.fn(async () => true),
  };
}

describe("Web Push conversation jobs", () => {
  it("enqueues one Graphile job per conversation event", async () => {
    const addJob = vi.fn().mockResolvedValue({});
    const runner = new GraphileWebPushJobRunner(
      { addJob } as never,
      ORGANIZATION_ID,
    );
    const payload = conversationEventToWebPushPayload(ORGANIZATION_ID, {
      schemaVersion: 1,
      eventId: "019fb800-0000-7000-8000-000000000101",
      type: "conversation.changed",
      threadId: THREAD_ID,
      headSequence: 3,
      accessVersion: 1,
      reason: "message_appended",
      occurredAt: "2026-09-03T12:00:01.000Z",
    });
    expect(payload).toMatchObject({ threadId: THREAD_ID, headSequence: 3 });
    await runner.enqueue(payload!);
    expect(addJob).toHaveBeenCalledWith(WEB_PUSH_TASK, payload, {
      jobKey: "web-push:019fb800-0000-7000-8000-000000000101",
      jobKeyMode: "unsafe_dedupe",
      queueName: `web-push-${ORGANIZATION_ID}`,
      maxAttempts: 8,
    });
  });

  it("shapes an e2ee payload without message content for a fake sender", async () => {
    const sent: string[] = [];
    const sender: WebPushSender = {
      async send(_subscription, payload) {
        sent.push(payload);
      },
    };
    const result = await deliverConversationWebPush({
      payload: {
        schemaVersion: 1,
        organizationId: ORGANIZATION_ID,
        eventId: "event-1",
        threadId: THREAD_ID,
        headSequence: 3,
        reason: "message_appended",
      },
      store: storeStub({
        thread: { ...thread, accessMode: "human_only_e2ee" },
        message: {
          ...message,
          body: "",
          serverReadable: false,
          encryptedBody: "ciphertext-must-not-leak",
        },
      }),
      getPreferences: async () => preferences("all"),
      sender,
    });
    expect(result).toEqual({ delivered: 1, removed: 0 });
    expect(sent).toHaveLength(1);
    const payload = JSON.parse(sent[0]!) as Record<string, unknown>;
    expect(payload).toEqual({
      threadId: THREAD_ID,
      title: "New message in Secret DM",
      threadTitle: "Secret DM",
    });
    expect(JSON.stringify(payload)).not.toContain("ciphertext");
    expect(JSON.stringify(payload)).not.toContain("Please review");
  });

  it("honors all/mentions/none and drops gone subscriptions", async () => {
    const sender: WebPushSender = {
      async send() {
        throw new GoneWebPushSubscriptionError(410, subscription.endpoint);
      },
    };
    const store = storeStub();
    const skipped = await deliverConversationWebPush({
      payload: {
        schemaVersion: 1,
        organizationId: ORGANIZATION_ID,
        eventId: "event-2",
        threadId: THREAD_ID,
        headSequence: 3,
        reason: "message_appended",
      },
      store,
      getPreferences: async () => preferences("none"),
      sender,
    });
    expect(skipped.delivered).toBe(0);
    expect(store.deleteWebPushSubscriptionByEndpoint).not.toHaveBeenCalled();

    const mentionsOnly = await deliverConversationWebPush({
      payload: {
        schemaVersion: 1,
        organizationId: ORGANIZATION_ID,
        eventId: "event-3",
        threadId: THREAD_ID,
        headSequence: 3,
        reason: "message_appended",
      },
      store: storeStub({
        message: { ...message, mentionedPrincipalIds: [] },
      }),
      getPreferences: async () => preferences("mentions"),
      sender,
    });
    expect(mentionsOnly.delivered).toBe(0);

    const gone = await deliverConversationWebPush({
      payload: {
        schemaVersion: 1,
        organizationId: ORGANIZATION_ID,
        eventId: "event-4",
        threadId: THREAD_ID,
        headSequence: 3,
        reason: "message_appended",
      },
      store,
      getPreferences: async () => preferences("mentions"),
      sender,
    });
    expect(gone).toEqual({ delivered: 0, removed: 1 });
    expect(store.deleteWebPushSubscriptionByEndpoint).toHaveBeenCalledWith(
      subscription.endpoint,
    );
  });
});
