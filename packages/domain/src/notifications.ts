import { z } from "zod";

import { ThreadAccessMode } from "./conversations.js";
import { PrincipalId } from "./ids.js";
import {
  type MessageNotificationMode,
  type NotificationPreferences,
} from "./platform.js";

export const WebPushSubscriptionKeys = z
  .object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  })
  .strict();
export type WebPushSubscriptionKeys = z.infer<typeof WebPushSubscriptionKeys>;

export const WebPushSubscription = z
  .object({
    id: z.uuid(),
    principalId: PrincipalId,
    endpoint: z.url().max(2_048),
    keys: WebPushSubscriptionKeys,
    userAgent: z.string().max(400).optional(),
    createdAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime(),
  })
  .strict();
export type WebPushSubscription = z.infer<typeof WebPushSubscription>;

export const UpsertWebPushSubscriptionRequest = z
  .object({
    endpoint: z.url().max(2_048),
    keys: WebPushSubscriptionKeys,
    userAgent: z.string().max(400).optional(),
  })
  .strict();
export type UpsertWebPushSubscriptionRequest = z.infer<
  typeof UpsertWebPushSubscriptionRequest
>;

export const DeleteWebPushSubscriptionRequest = z
  .object({
    endpoint: z.url().max(2_048),
  })
  .strict();
export type DeleteWebPushSubscriptionRequest = z.infer<
  typeof DeleteWebPushSubscriptionRequest
>;

export const WebPushNotifyPayload = z
  .object({
    schemaVersion: z.literal(1),
    organizationId: z.uuid(),
    eventId: z.string().min(1),
    threadId: z.uuid(),
    headSequence: z.number().int().nonnegative(),
    reason: z.enum(["message_appended", "message_updated"]),
  })
  .strict();
export type WebPushNotifyPayload = z.infer<typeof WebPushNotifyPayload>;

export function defaultNotificationPreferences(
  principalId: PrincipalId,
): NotificationPreferences {
  return {
    principalId,
    mutedKinds: [],
    messages: "mentions",
    updatedAt: new Date(0).toISOString(),
  };
}

export function resolveMessageNotificationMode(
  preferences: Pick<NotificationPreferences, "messages"> | undefined,
): MessageNotificationMode {
  return preferences?.messages ?? "mentions";
}

/**
 * HOOK(T1b): per-thread `mutedUntil` is not on ConversationThread yet.
 * Callers pass the field when T1b lands; omit it until then.
 */
export function isThreadNotificationMuted(
  threadMutedUntil: string | undefined,
  now: Date,
): boolean {
  return Boolean(
    threadMutedUntil && Date.parse(threadMutedUntil) > now.getTime(),
  );
}

export function shouldDeliverMessageNotification(input: {
  mode: MessageNotificationMode;
  mentioned: boolean;
  isSelf: boolean;
  muteUntil?: string;
  /** HOOK(T1b): per-thread mute; ignored when absent. */
  threadMutedUntil?: string;
  now?: Date;
}): boolean {
  if (input.isSelf) return false;
  if (input.mode === "none") return false;
  const now = input.now ?? new Date();
  if (input.muteUntil && Date.parse(input.muteUntil) > now.getTime()) {
    return false;
  }
  if (isThreadNotificationMuted(input.threadMutedUntil, now)) return false;
  if (input.mode === "mentions") return input.mentioned;
  return true;
}

export type MessageNotificationCopy =
  | { kind: "encrypted"; threadTitle: string }
  | { kind: "mention"; threadTitle: string; preview?: string }
  | { kind: "message"; threadTitle: string; preview?: string };

export function classifyMessageNotification(input: {
  accessMode: z.infer<typeof ThreadAccessMode>;
  mentioned: boolean;
  body: string;
}): MessageNotificationCopy {
  if (input.accessMode === "human_only_e2ee") {
    return { kind: "encrypted", threadTitle: "" };
  }
  const preview = previewMessageBody(input.body);
  if (input.mentioned) {
    return preview
      ? { kind: "mention", threadTitle: "", preview }
      : { kind: "mention", threadTitle: "" };
  }
  return preview
    ? { kind: "message", threadTitle: "", preview }
    : { kind: "message", threadTitle: "" };
}

export function shapeMessageNotificationPayload(input: {
  threadTitle: string;
  accessMode: z.infer<typeof ThreadAccessMode>;
  mentioned: boolean;
  body: string;
  locale?: "zh-CN" | "en-US";
}): { title: string; body?: string; threadTitle: string } {
  const locale = input.locale ?? "en-US";
  const threadTitle = input.threadTitle.trim() || "Intero";
  if (input.accessMode === "human_only_e2ee") {
    return {
      title:
        locale === "zh-CN"
          ? `「${threadTitle}」中有新消息`
          : `New message in ${threadTitle}`,
      threadTitle,
    };
  }
  const preview = previewMessageBody(input.body);
  if (input.mentioned) {
    return {
      title: locale === "zh-CN" ? "有人提到了你" : "You were mentioned",
      ...(preview ? { body: preview } : {}),
      threadTitle,
    };
  }
  return {
    title:
      locale === "zh-CN"
        ? `「${threadTitle}」中有新消息`
        : `New message in ${threadTitle}`,
    ...(preview ? { body: preview } : {}),
    threadTitle,
  };
}

function previewMessageBody(body: string): string | undefined {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > 140 ? `${normalized.slice(0, 139)}…` : normalized;
}
