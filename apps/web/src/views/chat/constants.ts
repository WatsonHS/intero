import type { ConversationThread, ThreadMessage } from "@intero/domain";

import type { ThreadPayload } from "../../api.js";
import type { TranslationKey } from "../../i18n/locales/zh-CN.js";
import type { ConversationRealtimeStatus } from "../../realtime/coordinator.js";

export const THREAD_GROUPS: Array<{
  kind: ConversationThread["kind"];
  label: TranslationKey;
}> = [
  { kind: "stand_in", label: "chat.group.standIn" },
  { kind: "human_group", label: "chat.group.temp" },
  { kind: "room", label: "chat.group.rooms" },
  { kind: "human_direct", label: "chat.group.direct" },
];
export const RELEVANT_KINDS = new Set(THREAD_GROUPS.map((group) => group.kind));
export const DIRECTORY_REFRESH_INTERVAL_MS = 60_000;
export const MAX_MESSAGE_IMAGES = 8;
export const MAX_MESSAGE_IMAGE_BYTES = 25 * 1024 * 1024;
export const MENTION_LISTBOX_ID = "communications-mention-listbox";
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "😢", "🙏", "👀"];
export const MESSAGE_IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export type AmbiguousCoordinationScope = Extract<
  NonNullable<NonNullable<ThreadMessage["coordinationSummary"]>["scope"]>,
  { kind: "ambiguous" }
>;

export const REALTIME_STATUS: Record<
  ConversationRealtimeStatus,
  {
    label: TranslationKey;
    detail: TranslationKey;
    tone: "green" | "amber" | "danger" | "muted";
  }
> = {
  live: {
    label: "chat.realtime.live",
    detail: "chat.realtime.liveDetail",
    tone: "green",
  },
  connecting: {
    label: "chat.realtime.connecting",
    detail: "chat.realtime.connectingDetail",
    tone: "amber",
  },
  degraded: {
    label: "chat.realtime.degraded",
    detail: "chat.realtime.degradedDetail",
    tone: "amber",
  },
  offline: {
    label: "chat.realtime.offline",
    detail: "chat.realtime.offlineDetail",
    tone: "danger",
  },
  disabled: {
    label: "chat.realtime.disabled",
    detail: "chat.realtime.disabledDetail",
    tone: "muted",
  },
};

export interface ComposerImage {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  previewUrl: string;
  status: "uploading" | "available" | "failed";
}

export interface ThreadListCache {
  items: ThreadPayload[];
}
