import { createHash } from "node:crypto";

import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketEncryptionCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
  type ServerSideEncryption,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { OrganizationId } from "@intero/domain";
import { Pool, type PoolClient } from "pg";

export type StoredObjectState =
  | "pending_upload"
  | "uploaded"
  | "available"
  | "quarantined"
  | "failed"
  | "deleted";

export interface StoredObjectMetadata {
  objectId: string;
  organizationId: OrganizationId;
  purpose: "artifact" | "authorized_raw";
  objectKey: string;
  contentType: string;
  byteSize: number;
  checksumSha256: string;
  encrypted: boolean;
  encryptionMode: "AES256" | "aws:kms";
  state: StoredObjectState;
  failureCode?: string;
  expiresAt: string;
  uploadedAt?: string;
  scannedAt?: string;
  deletedAt?: string;
}

export interface MinioObjectStoreConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  tenantPrefix: string;
  maxObjectBytes: number;
  pendingUploadTtlSeconds: number;
  quarantineRetentionDays: number;
  abortIncompleteMultipartDays: number;
  encryption: "AES256" | "aws:kms";
  kmsKeyId?: string;
  forcePathStyle?: boolean;
}

export interface CreateStoredObjectUpload {
  objectId: string;
  purpose: "artifact" | "authorized_raw";
  checksumSha256: string;
  byteSize: number;
  contentType: string;
  encrypted: boolean;
}

export class MinioObjectStore {
  readonly mode = "minio";
  readonly #s3: S3Client;

  constructor(
    private readonly pool: Pool,
    private readonly organizationId: OrganizationId,
    private readonly config: MinioObjectStoreConfig,
  ) {
    this.#s3 = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? true,
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.#s3.send(
        new HeadBucketCommand({ Bucket: this.config.bucket }),
      );
    } catch {
      await this.#s3.send(
        new CreateBucketCommand({ Bucket: this.config.bucket }),
      );
    }
    try {
      await this.#s3.send(
        new PutBucketEncryptionCommand({
          Bucket: this.config.bucket,
          ServerSideEncryptionConfiguration: {
            Rules: [
              {
                ApplyServerSideEncryptionByDefault: {
                  SSEAlgorithm: this.config.encryption as ServerSideEncryption,
                  ...(this.config.kmsKeyId
                    ? { KMSMasterKeyID: this.config.kmsKeyId }
                    : {}),
                },
                ...(this.config.encryption === "aws:kms"
                  ? { BucketKeyEnabled: true }
                  : {}),
              },
            ],
          },
        }),
      );
    } catch (error) {
      throw new Error("object_store_bucket_encryption_configuration_failed", {
        cause: error,
      });
    }
    try {
      await this.#s3.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: this.config.bucket,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: "intero-quarantine-retention",
                Status: "Enabled",
                Filter: {
                  Prefix: `${this.config.tenantPrefix}/quarantine/`,
                },
                Expiration: {
                  Days: this.config.quarantineRetentionDays,
                },
                AbortIncompleteMultipartUpload: {
                  DaysAfterInitiation: this.config.abortIncompleteMultipartDays,
                },
              },
            ],
          },
        }),
      );
    } catch (error) {
      throw new Error("object_store_bucket_lifecycle_configuration_failed", {
        cause: error,
      });
    }
  }

  async checkReadiness(): Promise<{
    status: "ready" | "unavailable";
    detail?: string;
  }> {
    try {
      await this.#s3.send(
        new HeadBucketCommand({ Bucket: this.config.bucket }),
      );
      return { status: "ready" };
    } catch {
      return { status: "unavailable", detail: "object_store_unavailable" };
    }
  }

  async createUpload(input: CreateStoredObjectUpload): Promise<{
    object: StoredObjectMetadata;
    uploadUrl: string;
    expiresAt: string;
    requiredHeaders: Record<string, string>;
  }> {
    validateUpload(input, this.config.maxObjectBytes);
    const objectKey = `${this.config.tenantPrefix}/${this.organizationId}/objects/${input.objectId}`;
    const expiresAt = new Date(
      Date.now() + this.config.pendingUploadTtlSeconds * 1_000,
    ).toISOString();
    const object = await this.write(async (client) => {
      const result = await client.query(
        `INSERT INTO object_store_objects
          (object_id, organization_id, purpose, object_key, content_type,
           byte_size, checksum_sha256, encrypted, encryption_mode, state,
           expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending_upload', $10)
         ON CONFLICT (object_id) DO UPDATE SET object_id = EXCLUDED.object_id
         RETURNING *`,
        [
          input.objectId,
          this.organizationId,
          input.purpose,
          objectKey,
          input.contentType,
          input.byteSize,
          input.checksumSha256,
          input.encrypted,
          this.config.encryption,
          expiresAt,
        ],
      );
      const stored = storedObjectFromRow(result.rows[0]!);
      assertReservationMatches(stored, input, objectKey);
      return stored;
    });
    const requiredHeaders = encryptionHeaders(this.config);
    const uploadUrl = await getSignedUrl(
      this.#s3,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: object.objectKey,
        ContentLength: object.byteSize,
        ContentType: object.contentType,
        Metadata: { sha256: object.checksumSha256 },
        ServerSideEncryption: this.config.encryption as ServerSideEncryption,
        ...(this.config.kmsKeyId ? { SSEKMSKeyId: this.config.kmsKeyId } : {}),
      }),
      { expiresIn: Math.min(this.config.pendingUploadTtlSeconds, 900) },
    );
    return { object, uploadUrl, expiresAt, requiredHeaders };
  }

  async completeUpload(objectId: string): Promise<StoredObjectMetadata> {
    const object = await this.require(objectId);
    if (object.state !== "pending_upload") return object;
    try {
      const head = await this.#s3.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: object.objectKey,
        }),
      );
      if (head.ContentLength !== object.byteSize) {
        return this.quarantine(object, "size_mismatch");
      }
      if (head.Metadata?.sha256 !== object.checksumSha256) {
        return this.quarantine(object, "metadata_checksum_mismatch");
      }
      const response = await this.#s3.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: object.objectKey,
        }),
      );
      const bytes = await response.Body?.transformToByteArray();
      if (!bytes || bytes.byteLength > this.config.maxObjectBytes) {
        return this.quarantine(object, "size_limit");
      }
      const checksum = createHash("sha256").update(bytes).digest("hex");
      if (checksum !== object.checksumSha256) {
        return this.quarantine(object, "checksum_mismatch");
      }
      return this.update(objectId, {
        state: "uploaded",
        uploadedAt: new Date().toISOString(),
      });
    } catch (error) {
      return this.update(objectId, {
        state: "failed",
        failureCode: safeErrorCode(error, "object_head_failed"),
      });
    }
  }

  async markScanned(
    objectId: string,
    result: "clean" | "infected" | "failed",
  ): Promise<StoredObjectMetadata> {
    const object = await this.require(objectId);
    if (object.state === "available" || object.state === "quarantined") {
      return object;
    }
    if (object.state !== "uploaded") {
      throw new Error("Object must be uploaded before scanning.");
    }
    if (result === "clean") {
      return this.update(objectId, {
        state: "available",
        scannedAt: new Date().toISOString(),
      });
    }
    return this.quarantine(
      object,
      result === "infected" ? "scanner_infected" : "scanner_failed",
    );
  }

  async cleanup(now = new Date()): Promise<number> {
    const expired = await this.read(async (client) => {
      const result = await client.query(
        `SELECT *
         FROM object_store_objects
         WHERE state IN ('pending_upload', 'quarantined', 'failed')
           AND expires_at < $1
         ORDER BY expires_at
         LIMIT 500`,
        [now.toISOString()],
      );
      return result.rows.map(storedObjectFromRow);
    });
    for (const object of expired) {
      await this.#s3.send(
        new DeleteObjectCommand({
          Bucket: this.config.bucket,
          Key: object.objectKey,
        }),
      );
      await this.update(object.objectId, {
        state: "deleted",
        deletedAt: now.toISOString(),
      });
    }
    return expired.length;
  }

  async get(objectId: string): Promise<StoredObjectMetadata | undefined> {
    return this.read(async (client) => {
      const result = await client.query(
        "SELECT * FROM object_store_objects WHERE object_id = $1",
        [objectId],
      );
      return result.rows[0] ? storedObjectFromRow(result.rows[0]) : undefined;
    });
  }

  async close(): Promise<void> {
    this.#s3.destroy();
    await this.pool.end();
  }

  private async quarantine(
    object: StoredObjectMetadata,
    failureCode: string,
  ): Promise<StoredObjectMetadata> {
    const quarantineKey = `${this.config.tenantPrefix}/quarantine/${this.organizationId}/${object.objectId}`;
    try {
      await this.#s3.send(
        new CopyObjectCommand({
          Bucket: this.config.bucket,
          Key: quarantineKey,
          CopySource: `${this.config.bucket}/${object.objectKey}`,
          ServerSideEncryption: this.config.encryption as ServerSideEncryption,
          ...(this.config.kmsKeyId
            ? { SSEKMSKeyId: this.config.kmsKeyId }
            : {}),
        }),
      );
      await this.#s3.send(
        new DeleteObjectCommand({
          Bucket: this.config.bucket,
          Key: object.objectKey,
        }),
      );
    } catch {
      return this.update(object.objectId, {
        state: "failed",
        failureCode: "quarantine_move_failed",
      });
    }
    return this.update(object.objectId, {
      state: "quarantined",
      objectKey: quarantineKey,
      failureCode,
      scannedAt: new Date().toISOString(),
      expiresAt: new Date(
        Date.now() + this.config.quarantineRetentionDays * 86_400_000,
      ).toISOString(),
    });
  }

  private async require(objectId: string): Promise<StoredObjectMetadata> {
    const object = await this.get(objectId);
    if (!object) throw new Error("Stored object was not found.");
    return object;
  }

  private async update(
    objectId: string,
    patch: {
      state: StoredObjectState;
      objectKey?: string;
      failureCode?: string;
      expiresAt?: string;
      uploadedAt?: string;
      scannedAt?: string;
      deletedAt?: string;
    },
  ): Promise<StoredObjectMetadata> {
    return this.write(async (client) => {
      const result = await client.query(
        `UPDATE object_store_objects
         SET state = $2,
             object_key = COALESCE($3, object_key),
             failure_code = $4,
             expires_at = COALESCE($5, expires_at),
             uploaded_at = COALESCE($6, uploaded_at),
             scanned_at = COALESCE($7, scanned_at),
             deleted_at = COALESCE($8, deleted_at),
             updated_at = now()
         WHERE object_id = $1
         RETURNING *`,
        [
          objectId,
          patch.state,
          patch.objectKey ?? null,
          patch.failureCode ?? null,
          patch.expiresAt ?? null,
          patch.uploadedAt ?? null,
          patch.scannedAt ?? null,
          patch.deletedAt ?? null,
        ],
      );
      if (!result.rows[0]) throw new Error("Stored object was not found.");
      return storedObjectFromRow(result.rows[0]);
    });
  }

  private read<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.transaction(true, operation);
  }

  private write<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.transaction(false, operation);
  }

  private async transaction<T>(
    readOnly: boolean,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
      await client.query(
        "SELECT set_config('intero.organization_id', $1, true)",
        [this.organizationId],
      );
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function validateUpload(
  input: CreateStoredObjectUpload,
  maxObjectBytes: number,
): void {
  if (!/^[0-9a-f-]{36}$/i.test(input.objectId))
    throw new Error("object_id_invalid");
  if (!/^[a-f0-9]{64}$/.test(input.checksumSha256))
    throw new Error("checksum_invalid");
  if (!Number.isInteger(input.byteSize) || input.byteSize <= 0)
    throw new Error("object_size_invalid");
  if (input.byteSize > maxObjectBytes) throw new Error("object_size_limit");
  if (!input.contentType || input.contentType.length > 160)
    throw new Error("content_type_invalid");
  if (input.purpose === "authorized_raw" && !input.encrypted) {
    throw new Error("authorized_raw_requires_encryption");
  }
}

function assertReservationMatches(
  stored: StoredObjectMetadata,
  input: CreateStoredObjectUpload,
  objectKey: string,
): void {
  if (
    stored.objectKey !== objectKey ||
    stored.purpose !== input.purpose ||
    stored.checksumSha256 !== input.checksumSha256 ||
    stored.byteSize !== input.byteSize ||
    stored.contentType !== input.contentType ||
    stored.encrypted !== input.encrypted
  ) {
    throw new Error("object_idempotency_conflict");
  }
}

function encryptionHeaders(
  config: MinioObjectStoreConfig,
): Record<string, string> {
  return {
    "x-amz-server-side-encryption": config.encryption,
    ...(config.kmsKeyId
      ? { "x-amz-server-side-encryption-aws-kms-key-id": config.kmsKeyId }
      : {}),
  };
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return error.name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 120) || fallback;
}

function storedObjectFromRow(
  row: Record<string, unknown>,
): StoredObjectMetadata {
  return {
    objectId: row.object_id as string,
    organizationId: row.organization_id as OrganizationId,
    purpose: row.purpose as StoredObjectMetadata["purpose"],
    objectKey: row.object_key as string,
    contentType: row.content_type as string,
    byteSize: Number(row.byte_size),
    checksumSha256: row.checksum_sha256 as string,
    encrypted: row.encrypted as boolean,
    encryptionMode:
      row.encryption_mode as StoredObjectMetadata["encryptionMode"],
    state: row.state as StoredObjectState,
    ...(row.failure_code ? { failureCode: row.failure_code as string } : {}),
    expiresAt: (row.expires_at as Date).toISOString(),
    ...(row.uploaded_at
      ? { uploadedAt: (row.uploaded_at as Date).toISOString() }
      : {}),
    ...(row.scanned_at
      ? { scannedAt: (row.scanned_at as Date).toISOString() }
      : {}),
    ...(row.deleted_at
      ? { deletedAt: (row.deleted_at as Date).toISOString() }
      : {}),
  };
}
