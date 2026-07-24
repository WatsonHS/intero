import { z } from "zod";

import { MessageId, OperationId, PrincipalId, ThreadId } from "./ids.js";

export const ThreadKind = z.enum([
  "human_direct",
  "human_group",
  "representative",
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
    representativeIds: z.array(PrincipalId),
    accessMode: ThreadAccessMode,
    accessChangedAtSequence: z.number().int().positive().optional(),
    priorHistoryGranted: z.boolean(),
    sequence: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type ConversationThread = z.infer<typeof ConversationThread>;

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
