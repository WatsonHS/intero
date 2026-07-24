import { z } from "zod";

import { EventId, OperationId, WorkspaceId, WorkstreamId } from "./ids.js";

export const PrivacyLevel = z.enum([
  "P0_LOCAL_ONLY",
  "P1_REPRESENTATIVE_PRIVATE",
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
  "assistantResponse",
  "chainOfThought",
  "toolInput",
  "toolOutput",
  "terminalOutput",
  "fileContent",
  "accessToken",
  "apiKey",
  "secret",
]);

export function containsForbiddenEventField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenEventField);
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(
    ([key, nested]) =>
      FORBIDDEN_EVENT_FIELDS.has(key) || containsForbiddenEventField(nested),
  );
}
