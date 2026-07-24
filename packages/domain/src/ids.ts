import { randomBytes } from "node:crypto";

import { z } from "zod";

const uuidSchema = z.uuid();

export const PrincipalId = uuidSchema.brand<"PrincipalId">();
export const OrganizationId = uuidSchema.brand<"OrganizationId">();
export const ProjectId = uuidSchema.brand<"ProjectId">();
export const WorkspaceId = uuidSchema.brand<"WorkspaceId">();
export const WorkstreamId = uuidSchema.brand<"WorkstreamId">();
export const ClaimId = uuidSchema.brand<"ClaimId">();
export const ThreadId = uuidSchema.brand<"ThreadId">();
export const MessageId = uuidSchema.brand<"MessageId">();
export const SpecId = uuidSchema.brand<"SpecId">();
export const SpecRevisionId = uuidSchema.brand<"SpecRevisionId">();
export const DecisionId = uuidSchema.brand<"DecisionId">();
export const ArtifactId = uuidSchema.brand<"ArtifactId">();
export const CapabilityGrantId = uuidSchema.brand<"CapabilityGrantId">();
export const EventId = uuidSchema.brand<"EventId">();
export const OperationId = uuidSchema.brand<"OperationId">();

export type PrincipalId = z.infer<typeof PrincipalId>;
export type OrganizationId = z.infer<typeof OrganizationId>;
export type ProjectId = z.infer<typeof ProjectId>;
export type WorkspaceId = z.infer<typeof WorkspaceId>;
export type WorkstreamId = z.infer<typeof WorkstreamId>;
export type ClaimId = z.infer<typeof ClaimId>;
export type ThreadId = z.infer<typeof ThreadId>;
export type MessageId = z.infer<typeof MessageId>;
export type SpecId = z.infer<typeof SpecId>;
export type SpecRevisionId = z.infer<typeof SpecRevisionId>;
export type DecisionId = z.infer<typeof DecisionId>;
export type ArtifactId = z.infer<typeof ArtifactId>;
export type CapabilityGrantId = z.infer<typeof CapabilityGrantId>;
export type EventId = z.infer<typeof EventId>;
export type OperationId = z.infer<typeof OperationId>;

/**
 * Generates a monotonic-sortable UUIDv7 without taking a dependency on a
 * database or platform-specific UUID extension.
 */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  const timestamp = BigInt(now);

  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
