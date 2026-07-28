import { z } from "zod";

import { MessageId, OperationId, PrincipalId, ThreadId } from "./ids.js";

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

export const ThreadMessage = z
  .object({
    id: MessageId,
    threadId: ThreadId,
    senderId: PrincipalId,
    sequence: z.number().int().positive(),
    kind: z.enum(["message", "system_access_change", "coordination_action"]),
    body: z.string().max(16_000),
    createdAt: z.iso.datetime(),
    serverReadable: z.boolean(),
    encryptedBody: z.string().max(100_000).optional(),
    operationId: OperationId.optional(),
  })
  .strict();
export type ThreadMessage = z.infer<typeof ThreadMessage>;

export const ConversationChangeReason = z.enum([
  "thread_created",
  "message_appended",
  "read_cursor_changed",
  "access_changed",
  "thread_concluded",
]);
export type ConversationChangeReason = z.infer<
  typeof ConversationChangeReason
>;

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
    occurredAt: z.iso.datetime(),
  })
  .strict();
export type ConversationChangedEvent = z.infer<
  typeof ConversationChangedEvent
>;
