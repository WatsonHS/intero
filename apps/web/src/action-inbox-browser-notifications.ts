import type { ActionInboxItem, NotificationPreferences } from "@intero/domain";

import { presentSystemNotification } from "./system-notifications.js";

export type BrowserNotificationPermission =
  NotificationPermission | "unsupported";

export interface ActionInboxSnapshot {
  items: ActionInboxItem[];
  preferences: NotificationPreferences;
}

export function currentBrowserNotificationPermission(): BrowserNotificationPermission {
  return typeof Notification === "undefined"
    ? "unsupported"
    : Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.requestPermission();
}

export function selectNewBrowserNotifiableItems(input: {
  previous: ActionInboxSnapshot | undefined;
  current: ActionInboxSnapshot;
  occurredAt: string;
  now?: Date;
}): ActionInboxItem[] {
  if (!input.previous) return [];
  const now = input.now ?? new Date();
  const muteUntil = input.current.preferences.muteUntil;
  if (muteUntil && Date.parse(muteUntil) > now.getTime()) return [];

  const known = new Set(input.previous.items.map((item) => item.id));
  const muted = new Set(input.current.preferences.mutedKinds);
  const eventThreshold = Date.parse(input.occurredAt) - 5_000;

  return input.current.items.filter(
    (item) =>
      !known.has(item.id) &&
      !muted.has(item.kind) &&
      !item.readAt &&
      !item.dismissedAt &&
      !item.resolvedAt &&
      Date.parse(item.createdAt) >= eventThreshold,
  );
}

export function showActionInboxBrowserNotification(
  item: ActionInboxItem,
  onOpen: () => void,
): boolean {
  return presentSystemNotification({
    title: item.title,
    body: item.detail,
    tag: `intero-action-inbox-${item.id}`,
    data: { itemId: item.id },
    onOpen,
  });
}
