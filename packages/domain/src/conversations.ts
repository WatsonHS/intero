import { z } from "zod";

import {
  ArtifactId,
  MessageId,
  OperationId,
  PrincipalId,
  ProjectId,
  ThreadId,
} from "./ids.js";
import { PilotCoordinationBrief } from "./pilot.js";

export const ThreadKind = z.enum([
  "human_direct",
  "human_group",
  "stand_in",
  "room",
  "coordination",
  "spec_review",
  "decision",
  "task",
]);
export type ThreadKind = z.infer<typeof ThreadKind>;

export const ThreadAccessMode = z.enum(["human_only_e2ee", "agent_readable"]);
export type ThreadAccessMode = z.infer<typeof ThreadAccessMode>;

export const ConversationThread = z
  .object({
    id: ThreadId,
    kind: ThreadKind,
    title: z.string().min(1).max(200),
    participantIds: z.array(PrincipalId).min(1),
    standInIds: z.array(PrincipalId),
    accessMode: ThreadAccessMode,
    accessChangedAtSequence: z.number().int().positive().optional(),
    priorHistoryGranted: z.boolean(),
    sequence: z.number().int().nonnegative(),
    /** Changes whenever participants or their visibility boundary changes. */
    accessVersion: z.number().int().positive().optional(),
    /** Denormalized ordering field; message history remains authoritative. */
    latestMessageAt: z.iso.datetime().optional(),
    /** Project whose shareable Work State bounds Stand-in answers. */
    projectId: ProjectId.optional(),
    /** Owning team. Optional on purpose: a thread may span teams or none. */
    teamId: z.uuid().optional(),
    /** The conversation this one was branched out of, if any. */
    parentThreadId: ThreadId.optional(),
    /** Set once the branch has been concluded back into its parent. */
    concludedAt: z.iso.datetime().optional(),
    concludedBy: PrincipalId.optional(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type ConversationThread = z.infer<typeof ConversationThread>;

/**
 * How much of a thread a person has seen. Unread is derived from this and the
 * message sequence rather than stored, so it cannot drift.
 */
export const ThreadReadState = z
  .object({
    threadId: ThreadId,
    principalId: PrincipalId,
    lastReadSequence: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ThreadReadState = z.infer<typeof ThreadReadState>;

export const ThreadMessageAttachment = z
  .object({
    id: ArtifactId,
    fileName: z.string().min(1).max(240),
    contentType: z.string().min(1).max(160),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024),
  })
  .strict();
export type ThreadMessageAttachment = z.infer<typeof ThreadMessageAttachment>;

export const ThreadMessageStreamState = z.enum([
  "pending",
  "streaming",
  "complete",
  "failed",
]);
export type ThreadMessageStreamState = z.infer<typeof ThreadMessageStreamState>;

const EmojiComponent = String.raw`(?:\p{Emoji_Presentation}\uFE0F?|\p{Extended_Pictographic}\uFE0F)(?:\p{Emoji_Modifier})?`;
const SingleEmojiSequence = new RegExp(
  String.raw`^(?:` +
    `${EmojiComponent}[\\u{E0020}-\\u{E007E}]+\\u{E007F}|` +
    String.raw`\p{Regional_Indicator}{2}|` +
    String.raw`[#*0-9]\uFE0F?\u20E3|` +
    `${EmojiComponent}(?:\\u200D${EmojiComponent})*` +
    String.raw`)$`,
  "u",
);

export function isSingleEmojiSequence(value: string): boolean {
  return SingleEmojiSequence.test(value);
}

export const ReactionEmoji = z
  .string()
  .min(1)
  .max(64)
  .refine(isSingleEmojiSequence, "Use exactly one emoji.");
export type ReactionEmoji = z.infer<typeof ReactionEmoji>;

export const ThreadMessageReaction = z
  .object({
    emoji: ReactionEmoji,
    principalIds: z
      .array(PrincipalId)
      .min(1)
      .max(100)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Reaction principals must be unique.",
      ),
  })
  .strict();
export type ThreadMessageReaction = z.infer<typeof ThreadMessageReaction>;

const ThreadMessageReactions = z
  .array(ThreadMessageReaction)
  .max(40)
  .refine(
    (reactions) =>
      new Set(reactions.map((reaction) => reaction.emoji)).size ===
      reactions.length,
    "Reaction emojis must be unique per message.",
  );

export const ThreadMessage = z
  .object({
    id: MessageId,
    threadId: ThreadId,
    senderId: PrincipalId,
    sequence: z.number().int().positive(),
    kind: z.enum([
      "message",
      "system_access_change",
      "coordination_action",
      "coordination_summary",
    ]),
    body: z.string().max(16_000),
    createdAt: z.iso.datetime(),
    serverReadable: z.boolean(),
    encryptedBody: z.string().max(100_000).optional(),
    operationId: OperationId.optional(),
    coordinationSummary: z
      .object({
        coordinationThreadId: ThreadId,
        interoRequestId: z.uuid().optional(),
        status: z.enum(["open", "waiting", "needs_action", "resolved"]),
        situation: z.string().min(1).max(600),
        boundaryKey: z.string().min(3).max(160),
        affectedPrincipalIds: z.array(PrincipalId).min(1).max(20),
        conclusion: z.string().max(600),
        unresolvedQuestion: z.string().max(600),
        actionRequired: z.boolean(),
        freshnessAt: z.iso.datetime(),
        sourceCount: z.number().int().positive().max(20),
        scope: z
          .discriminatedUnion("kind", [
            z
              .object({
                kind: z.enum(["single_project", "cross_project", "team"]),
                projectIds: z.array(ProjectId).min(1).max(20),
              })
              .strict(),
            z
              .object({
                kind: z.literal("ambiguous"),
                candidates: z
                  .array(
                    z
                      .object({
                        projectId: ProjectId,
                        name: z.string().min(1).max(160),
                      })
                      .strict(),
                  )
                  .max(20),
              })
              .strict(),
          ])
          .optional(),
        brief: PilotCoordinationBrief.optional(),
      })
      .strict()
      .optional(),
    /** Stable identities, separate from the human-readable Markdown body. */
    mentionedPrincipalIds: z.array(PrincipalId).max(20).optional(),
    /** Message quoted by this reply. The target must belong to the same thread. */
    replyToMessageId: MessageId.optional(),
    /** Safe immutable metadata; object keys and signed URLs never enter history. */
    attachments: z.array(ThreadMessageAttachment).max(8).optional(),
    /** Present for durable Stand-in streams; omitted legacy rows are complete. */
    streamState: ThreadMessageStreamState.optional(),
    revision: z.number().int().positive().optional(),
    /** Aggregated participant reactions; omitted when the message has none. */
    reactions: ThreadMessageReactions.optional(),
    /** Set when the sender last edited a `kind: "message"` body. */
    editedAt: z.iso.datetime().optional(),
    /**
     * Tombstone timestamp. The row and sequence stay; body, attachments,
     * reactions, and encryptedBody are cleared.
     */
    deletedAt: z.iso.datetime().optional(),
    /** Normalized http(s) URLs the server attempted to unfurl. At most two. */
    previewUrls: z.array(z.url().max(2_048)).max(2).optional(),
    /** Sender hid link preview cards on this message. */
    previewsHidden: z.boolean().optional(),
  })
  .strict();
export type ThreadMessage = z.infer<typeof ThreadMessage>;

export const LinkPreviewStatus = z.enum(["ok", "failed", "blocked"]);
export type LinkPreviewStatus = z.infer<typeof LinkPreviewStatus>;

/**
 * Public page metadata cached from Open Graph / Twitter card / `<title>`.
 * The cache is not tenant data: it never stores message bodies or cookies.
 */
export const LinkPreview = z
  .object({
    url: z.url().max(2_048),
    status: LinkPreviewStatus,
    title: z.string().min(1).max(300).optional(),
    description: z.string().min(1).max(1_000).optional(),
    siteName: z.string().min(1).max(200).optional(),
    /** https image URL only; the client loads it directly and never via Intero. */
    image: z.url().max(2_048).optional(),
    fetchedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type LinkPreview = z.infer<typeof LinkPreview>;

const HTTP_URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]]+/giu;
const TRAILING_URL_PUNCTUATION = /[.,;:!?]+$/u;

export function normalizePublicHttpUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw.replace(TRAILING_URL_PUNCTUATION, ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443")
    ) {
      url.port = "";
    }
    return url.href;
  } catch {
    return undefined;
  }
}

/** First `limit` unique http(s) URLs in a server-readable message body. */
export function extractHttpUrls(body: string, limit = 2): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(HTTP_URL_IN_TEXT)) {
    const normalized = normalizePublicHttpUrl(match[0] ?? "");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    found.push(normalized);
    if (found.length >= limit) break;
  }
  return found;
}

export const ConversationChangeReason = z.enum([
  "thread_created",
  "thread_updated",
  "message_appended",
  "message_updated",
  "message_edited",
  "message_deleted",
  "read_cursor_changed",
  "access_changed",
  "thread_concluded",
]);
export type ConversationChangeReason = z.infer<typeof ConversationChangeReason>;

/**
 * Realtime carries only a pointer to authoritative conversation state. Message
 * content is deliberately absent so Centrifugo history is not a content store.
 */
export const ConversationChangedEvent = z
  .object({
    schemaVersion: z.literal(1),
    eventId: OperationId,
    type: z.literal("conversation.changed"),
    threadId: ThreadId,
    headSequence: z.number().int().nonnegative(),
    accessVersion: z.number().int().positive(),
    reason: ConversationChangeReason,
    /** Pointer used to repair an in-place message revision. */
    messageId: MessageId.optional(),
    occurredAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((event, context) => {
    if (
      (event.reason === "message_updated" ||
        event.reason === "message_edited" ||
        event.reason === "message_deleted") &&
      !event.messageId
    ) {
      context.addIssue({
        code: "custom",
        path: ["messageId"],
        message: `${event.reason} events require a messageId pointer.`,
      });
    }
  });
export type ConversationChangedEvent = z.infer<typeof ConversationChangedEvent>;

/** Ephemeral typing hint. Never persisted and never carries message content. */
export const TypingEvent = z
  .object({
    type: z.literal("typing"),
    threadId: ThreadId,
    principalId: PrincipalId,
    at: z.iso.datetime(),
  })
  .strict();
export type TypingEvent = z.infer<typeof TypingEvent>;

export const PresenceState = z.enum(["online", "away", "offline"]);
export type PresenceState = z.infer<typeof PresenceState>;

export const PresenceSnapshot = z
  .object({
    principalId: PrincipalId,
    state: PresenceState,
    lastSeenAt: z.iso.datetime().optional(),
  })
  .strict();
export type PresenceSnapshot = z.infer<typeof PresenceSnapshot>;
