import { createHash } from "node:crypto";

import {
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { type OrganizationId, uuidv7 } from "@intero/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MinioObjectStore } from "./object-store.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const endpoint = process.env.INTERO_OBJECT_STORAGE_ENDPOINT;
const integrationSuite =
  databaseUrl && databaseAppUrl && endpoint ? describe : describe.skip;

integrationSuite("MinIO ObjectStorePort contract", () => {
  const organizationId = uuidv7() as OrganizationId;
  const outsiderOrganizationId = uuidv7() as OrganizationId;
  const bucket = "intero-phase3-object-store";
  const admin = new Pool({ connectionString: databaseUrl });
  const store = new MinioObjectStore(
    new Pool({ connectionString: databaseAppUrl }),
    organizationId,
    config(endpoint!, bucket),
  );
  const outsiderStore = new MinioObjectStore(
    new Pool({ connectionString: databaseAppUrl }),
    outsiderOrganizationId,
    config(endpoint!, bucket),
  );
  const s3 = new S3Client({
    endpoint: endpoint!,
    region: "us-east-1",
    credentials: {
      accessKeyId: "intero",
      secretAccessKey: "intero-development",
    },
    forcePathStyle: true,
  });

  beforeAll(async () => {
    await admin.query(
      `INSERT INTO organizations (id, name)
       VALUES ($1, 'Object Store A'), ($2, 'Object Store B')`,
      [organizationId, outsiderOrganizationId],
    );
    await store.initialize();
  });

  afterAll(async () => {
    await admin.query(
      `UPDATE object_store_objects
       SET state = 'failed', expires_at = now() - interval '1 second'
       WHERE organization_id = $1`,
      [organizationId],
    );
    await store.cleanup(new Date());
    await store.close();
    await outsiderStore.close();
    await admin.query(
      "DELETE FROM object_store_objects WHERE organization_id IN ($1, $2)",
      [organizationId, outsiderOrganizationId],
    );
    await admin.query("DELETE FROM organizations WHERE id IN ($1, $2)", [
      organizationId,
      outsiderOrganizationId,
    ]);
    await admin.end();
    s3.destroy();
  });

  it("configures bucket encryption and quarantine lifecycle", async () => {
    await expect(
      s3.send(new GetBucketEncryptionCommand({ Bucket: bucket })),
    ).resolves.toMatchObject({
      ServerSideEncryptionConfiguration: {
        Rules: [
          {
            ApplyServerSideEncryptionByDefault: {
              SSEAlgorithm: "AES256",
            },
          },
        ],
      },
    });
    await expect(
      s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })),
    ).resolves.toMatchObject({
      Rules: [
        {
          Status: "Enabled",
          Expiration: { Days: 1 },
        },
      ],
    });
  });

  it("keeps metadata authoritative and publishes only after checksum and scan gates", async () => {
    const bytes = Buffer.from("phase-three-object");
    const upload = await store.createUpload({
      objectId: uuidv7(),
      purpose: "artifact",
      checksumSha256: sha256(bytes),
      byteSize: bytes.byteLength,
      contentType: "application/octet-stream",
      encrypted: true,
    });
    expect(upload.object.objectKey).toBe(
      `tenants/${organizationId}/objects/${upload.object.objectId}`,
    );
    expect(await outsiderStore.get(upload.object.objectId)).toBeUndefined();
    const response = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: upload.requiredHeaders,
      body: bytes,
    });
    expect(response.ok).toBe(true);
    await expect(
      store.completeUpload(upload.object.objectId),
    ).resolves.toMatchObject({
      state: "uploaded",
    });
    await expect(
      store.markScanned(upload.object.objectId, "clean"),
    ).resolves.toMatchObject({ state: "available" });
  });

  it("quarantines checksum mismatch under the tenant prefix", async () => {
    const declared = Buffer.from("declared");
    const actual = Buffer.from("alteredd");
    const upload = await store.createUpload({
      objectId: uuidv7(),
      purpose: "artifact",
      checksumSha256: sha256(declared),
      byteSize: actual.byteLength,
      contentType: "application/octet-stream",
      encrypted: true,
    });
    const response = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: upload.requiredHeaders,
      body: actual,
    });
    expect(response.ok).toBe(true);
    await expect(
      store.completeUpload(upload.object.objectId),
    ).resolves.toMatchObject({
      state: "quarantined",
      failureCode: "checksum_mismatch",
      objectKey: `tenants/quarantine/${organizationId}/${upload.object.objectId}`,
    });
  });

  it("rejects unauthorized raw plaintext, enforces size, and tombstones cleanup", async () => {
    await expect(
      store.createUpload({
        objectId: uuidv7(),
        purpose: "authorized_raw",
        checksumSha256: "0".repeat(64),
        byteSize: 1,
        contentType: "text/plain",
        encrypted: false,
      }),
    ).rejects.toThrow("authorized_raw_requires_encryption");
    await expect(
      store.createUpload({
        objectId: uuidv7(),
        purpose: "artifact",
        checksumSha256: "0".repeat(64),
        byteSize: 1_025,
        contentType: "text/plain",
        encrypted: true,
      }),
    ).rejects.toThrow("object_size_limit");

    const reservation = await store.createUpload({
      objectId: uuidv7(),
      purpose: "artifact",
      checksumSha256: "0".repeat(64),
      byteSize: 1,
      contentType: "text/plain",
      encrypted: true,
    });
    await admin.query(
      `UPDATE object_store_objects
       SET expires_at = now() - interval '1 second'
       WHERE object_id = $1`,
      [reservation.object.objectId],
    );
    await expect(store.cleanup(new Date())).resolves.toBeGreaterThanOrEqual(1);
    await expect(store.get(reservation.object.objectId)).resolves.toMatchObject(
      {
        state: "deleted",
        deletedAt: expect.any(String),
      },
    );
  });

  it("reports dependency outage without exposing credentials", async () => {
    const unavailable = new MinioObjectStore(
      new Pool({ connectionString: databaseAppUrl }),
      organizationId,
      config("http://127.0.0.1:59997", "unavailable-object-store"),
    );
    await expect(unavailable.checkReadiness()).resolves.toEqual({
      status: "unavailable",
      detail: "object_store_unavailable",
    });
    await unavailable.close();
  });
});

function config(endpoint: string, bucket: string) {
  return {
    endpoint,
    region: "us-east-1",
    accessKeyId: "intero",
    secretAccessKey: "intero-development",
    bucket,
    tenantPrefix: "tenants",
    maxObjectBytes: 1_024,
    pendingUploadTtlSeconds: 60,
    quarantineRetentionDays: 1,
    abortIncompleteMultipartDays: 1,
    encryption: "AES256" as const,
    forcePathStyle: true,
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
