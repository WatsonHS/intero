import { createHash } from "node:crypto";

import {
  type ArtifactId,
  type OrganizationId,
  type PrincipalId,
  type ThreadId,
  uuidv7,
} from "@intero/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AttachmentService } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const s3Endpoint = process.env.INTERO_S3_ENDPOINT;
const integrationSuite =
  databaseUrl && databaseAppUrl && s3Endpoint ? describe : describe.skip;

integrationSuite("S3 attachment scan gate", () => {
  const organizationId = uuidv7() as OrganizationId;
  const ownerId = uuidv7() as PrincipalId;
  const readableThreadId = uuidv7() as ThreadId;
  const encryptedThreadId = uuidv7() as ThreadId;
  const appPool = new Pool({ connectionString: databaseAppUrl });
  const adminPool = new Pool({ connectionString: databaseUrl });
  const service = new AttachmentService(appPool, organizationId, {
    endpoint: s3Endpoint!,
    region: "us-east-1",
    accessKeyId: "intero",
    secretAccessKey: "intero-development",
    bucket: "intero-attachments-test",
    forcePathStyle: true,
    serverSideEncryption: false,
  });

  beforeAll(async () => {
    await service.ensureBucket();
    await adminPool.query(
      "INSERT INTO organizations (id, name) VALUES ($1, 'Attachment fixture')",
      [organizationId],
    );
    await adminPool.query(
      "INSERT INTO principals (id, display_name, kind) VALUES ($1, 'Attachment owner', 'human')",
      [ownerId],
    );
    for (const [threadId, accessMode] of [
      [readableThreadId, "agent_readable"],
      [encryptedThreadId, "human_only_e2ee"],
    ]) {
      await adminPool.query(
        `INSERT INTO threads
          (id, organization_id, kind, title, access_mode, prior_history_granted, sequence)
         VALUES ($1, $2, 'human_group', 'Attachment fixture', $3, false, 0)`,
        [threadId, organizationId, accessMode],
      );
    }
  });

  afterAll(async () => {
    await adminPool.query(
      `UPDATE attachments SET state = 'pending_upload', expires_at = now() - interval '1 second'
       WHERE organization_id = $1`,
      [organizationId],
    );
    await service.cleanupOrphans(new Date());
    await service.close();
    await adminPool.query("DELETE FROM threads WHERE organization_id = $1", [
      organizationId,
    ]);
    await adminPool.query("DELETE FROM principals WHERE id = $1", [ownerId]);
    await adminPool.query("DELETE FROM organizations WHERE id = $1", [
      organizationId,
    ]);
    await adminPool.end();
  });

  it("publishes only after size, checksum, and malware gates pass", async () => {
    const content = Buffer.from("safe Intero attachment");
    const upload = await service.createUpload({
      id: uuidv7() as ArtifactId,
      threadId: readableThreadId,
      ownerId,
      fileName: "safe.txt",
      contentType: "text/plain",
      byteSize: content.byteLength,
      checksumSha256: sha256(content),
      encryptionMode: "server_envelope",
    });
    const uploaded = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: upload.requiredHeaders,
      body: content,
    });
    if (!uploaded.ok) {
      throw new Error(
        `MinIO upload failed ${uploaded.status} signed=${new URL(upload.uploadUrl).searchParams.get("X-Amz-SignedHeaders")} headers=${JSON.stringify(upload.requiredHeaders)}: ${await uploaded.text()}`,
      );
    }
    await expect(
      service.completeUpload(upload.attachment.id),
    ).resolves.toMatchObject({
      state: "uploaded",
    });
    await expect(service.scan(upload.attachment.id)).resolves.toMatchObject({
      state: "available",
    });
    const download = await service.createDownload(upload.attachment.id);
    await expect(
      fetch(download.downloadUrl).then((response) => response.text()),
    ).resolves.toBe(content.toString());
  });

  it("quarantines malware and rejects plaintext in Human-only Threads", async () => {
    const eicar = Buffer.from(
      "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
    );
    const upload = await service.createUpload({
      id: uuidv7() as ArtifactId,
      threadId: encryptedThreadId,
      ownerId,
      fileName: "ciphertext.bin",
      contentType: "application/octet-stream",
      byteSize: eicar.byteLength,
      checksumSha256: sha256(eicar),
      encryptionMode: "client_e2ee",
    });
    const uploaded = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: upload.requiredHeaders,
      body: eicar,
    });
    if (!uploaded.ok) {
      throw new Error(
        `MinIO upload failed ${uploaded.status} signed=${new URL(upload.uploadUrl).searchParams.get("X-Amz-SignedHeaders")} headers=${JSON.stringify(upload.requiredHeaders)}: ${await uploaded.text()}`,
      );
    }
    await service.completeUpload(upload.attachment.id);
    await expect(service.scan(upload.attachment.id)).resolves.toMatchObject({
      state: "quarantined",
    });
    await expect(service.createDownload(upload.attachment.id)).rejects.toThrow(
      "not available",
    );
    await expect(
      service.createUpload({
        id: uuidv7() as ArtifactId,
        threadId: encryptedThreadId,
        ownerId,
        fileName: "plaintext.txt",
        contentType: "text/plain",
        byteSize: 1,
        checksumSha256: sha256(Buffer.from("x")),
        encryptionMode: "server_envelope",
      }),
    ).rejects.toThrow("client-side ciphertext");
  });

  it("cleans expired orphan reservations", async () => {
    const content = Buffer.from("x");
    const upload = await service.createUpload({
      id: uuidv7() as ArtifactId,
      threadId: readableThreadId,
      ownerId,
      fileName: "orphan.txt",
      contentType: "text/plain",
      byteSize: 1,
      checksumSha256: sha256(content),
      encryptionMode: "server_envelope",
    });
    await adminPool.query(
      "UPDATE attachments SET expires_at = now() - interval '1 second' WHERE id = $1",
      [upload.attachment.id],
    );
    await expect(service.cleanupOrphans(new Date())).resolves.toBe(1);
    await expect(service.get(upload.attachment.id)).resolves.toBeUndefined();
  });
});

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
