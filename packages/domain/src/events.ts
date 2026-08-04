import { z } from "zod";

import { EventId, OperationId, WorkspaceId, WorkstreamId } from "./ids.js";

export const PrivacyLevel = z.enum([
  "P0_LOCAL_ONLY",
  "P1_STAND_IN_PRIVATE",
  "P2_COORDINATION",
  "P3_PROJECT",
  "P4_ORGANIZATION",
]);
export type PrivacyLevel = z.infer<typeof PrivacyLevel>;

export const CanonicalEventType = z.enum([
  "SessionStarted",
  "SessionPaused",
  "SessionStopped",
  "WorkspaceChanged",
  "ResourceTouched",
  "GitStateChanged",
  "PlanChanged",
  "ValidationChanged",
  "ArtifactDetected",
  "CoordinationRequested",
  "CheckpointReported",
]);
export type CanonicalEventType = z.infer<typeof CanonicalEventType>;

export const EventSource = z.enum([
  "codex",
  "claude-code",
  "opencode",
  "grok-build",
  "cursor",
  "desktop",
  "system",
]);
export type EventSource = z.infer<typeof EventSource>;

export const SafeEventPayload = z
  .object({
    phase: z.string().max(80).optional(),
    summary: z.string().max(600).optional(),
    resourceKind: z
      .enum(["file", "symbol", "api", "schema", "config", "artifact"])
      .optional(),
    resourceRef: z.string().max(300).optional(),
    gitBranch: z.string().max(240).optional(),
    gitHead: z.string().max(64).optional(),
    validationName: z.string().max(160).optional(),
    validationStatus: z
      .enum(["pending", "passed", "failed", "skipped"])
      .optional(),
    checkpointKind: z
      .enum([
        "intent",
        "decision",
        "blocker",
        "dependency",
        "scope",
        "artifact",
        "validation",
        "pause",
        "completion",
      ])
      .optional(),
  })
  .strict();
export type SafeEventPayload = z.infer<typeof SafeEventPayload>;

export const CanonicalWorkEvent = z
  .object({
    id: EventId,
    operationId: OperationId,
    schemaVersion: z.literal(1),
    source: EventSource,
    type: CanonicalEventType,
    occurredAt: z.iso.datetime(),
    receivedAt: z.iso.datetime(),
    workspaceId: WorkspaceId,
    workstreamId: WorkstreamId.optional(),
    privacy: PrivacyLevel,
    payload: SafeEventPayload,
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();
export type CanonicalWorkEvent = z.infer<typeof CanonicalWorkEvent>;

export const FORBIDDEN_EVENT_FIELDS = new Set([
  "prompt",
  "prompttext",
  "assistantresponse",
  "chainofthought",
  "toolinput",
  "tooloutput",
  "toolresponse",
  "terminaloutput",
  "stdout",
  "stderr",
  "filecontent",
  "accesstoken",
  "authorization",
  "apikey",
  "command",
  "toolresult",
  "secret",
]);

export function containsForbiddenEventField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenEventField);
  }
  if (typeof value === "string") {
    return containsLikelySecret(value);
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(
    ([key, nested]) =>
      FORBIDDEN_EVENT_FIELDS.has(normalizeFieldName(key)) ||
      containsForbiddenEventField(nested),
  );
}

function normalizeFieldName(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function containsLikelySecret(value: string): boolean {
  return [
    /\bsk-[A-Za-z0-9_-]{16,}\b/,
    /\bAKIA[A-Z0-9]{16}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/i,
  ].some((pattern) => pattern.test(value));
}
