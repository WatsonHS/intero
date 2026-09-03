import {
  ConversationChangedEvent,
  OrganizationId,
  PrincipalId,
  shapeMessageNotificationPayload,
  shouldDeliverMessageNotification,
  WebPushNotifyPayload,
  type NotificationPreferences,
  type ThreadId,
  type WebPushSubscription,
} from "@intero/domain";
import { createRequire } from "node:module";

import type { WorkerUtils } from "graphile-worker";

import type {
  PlatformStore,
  PrincipalSummary,
} from "../../server-api/src/platform-store.js";

export const WEB_PUSH_TASK = "web_push_notify";
export { WebPushNotifyPayload };

export interface WebPushSender {
  send(
    subscription: Pick<WebPushSubscription, "endpoint" | "keys">,
    payload: string,
  ): Promise<void>;
}

export class GoneWebPushSubscriptionError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, endpoint: string) {
    super(`web_push_gone:${statusCode}:${endpoint}`);
    this.statusCode = statusCode;
  }
}

export function isGoneWebPushStatus(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 410;
}

export class GraphileWebPushJobRunner {
  constructor(
    private readonly workerUtils: WorkerUtils,
    private readonly organizationId: OrganizationId,
  ) {}

  async enqueue(payload: WebPushNotifyPayload): Promise<void> {
    if (payload.organizationId !== this.organizationId) {
      throw new Error("cross_organization_web_push_job");
    }
    await this.workerUtils.addJob(WEB_PUSH_TASK, payload, {
      jobKey: `web-push:${payload.eventId}`,
      jobKeyMode: "unsafe_dedupe",
      queueName: `web-push-${payload.organizationId}`,
      maxAttempts: 8,
    });
  }
}

export function conversationEventToWebPushPayload(
  organizationId: OrganizationId,
  event: Record<string, unknown>,
): WebPushNotifyPayload | undefined {
  const parsed = ConversationChangedEvent.safeParse(event);
  if (!parsed.success) return undefined;
  if (
    parsed.data.reason !== "message_appended" &&
    parsed.data.reason !== "message_updated"
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    organizationId,
    eventId: parsed.data.eventId,
    threadId: parsed.data.threadId,
    headSequence: parsed.data.headSequence,
    reason: parsed.data.reason,
  };
}

export async function deliverConversationWebPush(input: {
  payload: WebPushNotifyPayload;
  store: Pick<
    PlatformStore,
    | "getMessageAtSequence"
    | "listPrincipals"
    | "listWebPushSubscriptionsForPrincipals"
    | "deleteWebPushSubscriptionByEndpoint"
  >;
  getPreferences: (
    principalId: PrincipalId,
  ) => Promise<NotificationPreferences>;
  sender: WebPushSender;
  now?: Date;
}): Promise<{ delivered: number; removed: number }> {
  const context = await input.store.getMessageAtSequence(
    input.payload.threadId as ThreadId,
    input.payload.headSequence,
  );
  if (!context) return { delivered: 0, removed: 0 };
  const { thread, message } = context;
  if (message.kind !== "message") return { delivered: 0, removed: 0 };
  if (
    message.streamState === "pending" ||
    message.streamState === "streaming"
  ) {
    return { delivered: 0, removed: 0 };
  }

  const principals = await input.store.listPrincipals(thread.participantIds);
  const humans = principals.filter(
    (principal): principal is PrincipalSummary => principal.kind === "human",
  );
  const recipients = humans.filter(
    (principal) => principal.id !== message.senderId,
  );
  if (recipients.length === 0) return { delivered: 0, removed: 0 };

  const subscriptions = await input.store.listWebPushSubscriptionsForPrincipals(
    recipients.map((principal) => principal.id),
  );
  const subscriptionsByPrincipal = new Map<
    PrincipalId,
    WebPushSubscription[]
  >();
  for (const subscription of subscriptions) {
    const current =
      subscriptionsByPrincipal.get(subscription.principalId) ?? [];
    current.push(subscription);
    subscriptionsByPrincipal.set(subscription.principalId, current);
  }

  const now = input.now ?? new Date();
  let delivered = 0;
  let removed = 0;
  for (const recipient of recipients) {
    const preferences = await input.getPreferences(recipient.id);
    const mentioned = Boolean(
      message.mentionedPrincipalIds?.includes(recipient.id),
    );
    if (
      !shouldDeliverMessageNotification({
        mode: preferences.messages,
        mentioned,
        isSelf: false,
        ...(preferences.muteUntil ? { muteUntil: preferences.muteUntil } : {}),
        // HOOK(T1b): per-thread mutedUntil is not on ConversationThread yet.
        now,
      })
    ) {
      continue;
    }
    const payload = JSON.stringify({
      threadId: thread.id,
      ...shapeMessageNotificationPayload({
        threadTitle: thread.title,
        accessMode: thread.accessMode,
        mentioned,
        body: thread.accessMode === "human_only_e2ee" ? "" : message.body,
        locale: recipient.preferredLanguage ?? "en-US",
      }),
    });
    for (const subscription of subscriptionsByPrincipal.get(recipient.id) ??
      []) {
      try {
        await input.sender.send(subscription, payload);
        delivered += 1;
      } catch (error) {
        const statusCode =
          error instanceof GoneWebPushSubscriptionError
            ? error.statusCode
            : webPushStatusCode(error);
        if (statusCode !== undefined && isGoneWebPushStatus(statusCode)) {
          await input.store.deleteWebPushSubscriptionByEndpoint(
            subscription.endpoint,
          );
          removed += 1;
          continue;
        }
        throw error;
      }
    }
  }
  return { delivered, removed };
}

export function createWebPushLibSender(config: {
  publicKey: string;
  privateKey: string;
  subject: string;
}): WebPushSender {
  const webpush = createRequire(import.meta.url)("web-push") as {
    setVapidDetails(
      subject: string,
      publicKey: string,
      privateKey: string,
    ): void;
    sendNotification(
      subscription: {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      },
      payload: string,
    ): Promise<unknown>;
  };
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return {
    async send(subscription, payload) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: subscription.keys,
          },
          payload,
        );
      } catch (error) {
        const statusCode = webPushStatusCode(error);
        if (statusCode !== undefined && isGoneWebPushStatus(statusCode)) {
          throw new GoneWebPushSubscriptionError(
            statusCode,
            subscription.endpoint,
          );
        }
        throw error;
      }
    },
  };
}

function webPushStatusCode(error: unknown): number | undefined {
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode;
  }
  return undefined;
}
