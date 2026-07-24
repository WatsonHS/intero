import { z } from "zod";

import { ArtifactId, PrincipalId, ThreadId } from "./ids.js";

export const AttachmentEncryptionMode = z.enum([
  "client_e2ee",
  "server_envelope",
]);
export type AttachmentEncryptionMode = z.infer<typeof AttachmentEncryptionMode>;

export const AttachmentState = z.enum([
  "pending_upload",
  "uploaded",
  "scanning",
  "available",
  "quarantined",
  "scan_failed",
]);
export type AttachmentState = z.infer<typeof AttachmentState>;

export const Attachment = z
  .object({
    id: ArtifactId,
    threadId: ThreadId,
    ownerId: PrincipalId,
    fileName: z.string().min(1).max(240),
    contentType: z.string().min(1).max(160),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    encryptionMode: AttachmentEncryptionMode,
    objectKey: z.string().min(1).max(800),
    state: AttachmentState,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type Attachment = z.infer<typeof Attachment>;

export const CreateAttachmentUpload = Attachment.pick({
  id: true,
  threadId: true,
  ownerId: true,
  fileName: true,
  contentType: true,
  byteSize: true,
  checksumSha256: true,
  encryptionMode: true,
});
export type CreateAttachmentUpload = z.infer<typeof CreateAttachmentUpload>;
