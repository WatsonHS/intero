import { createHash } from "node:crypto";

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  type Attachment,
  type AttachmentState,
  type CreateAttachmentUpload,
  type OrganizationId,
} from "@intero/domain";
import { Pool, type PoolClient } from "pg";

export interface AttachmentStorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle?: boolean;
  serverSideEncryption?: boolean;
}

export class AttachmentService {
  readonly #s3: S3Client;

  constructor(
    private readonly pool: Pool,
    private readonly organizationId: OrganizationId,
    private readonly config: AttachmentStorageConfig,
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

  async ensureBucket(): Promise<void> {
    try {
      await this.#s3.send(
        new HeadBucketCommand({ Bucket: this.config.bucket }),
      );
    } catch {
      await this.#s3.send(
        new CreateBucketCommand({ Bucket: this.config.bucket }),
      );
    }
  }

  async createUpload(input: CreateAttachmentUpload): Promise<{
    attachment: Attachment;
    uploadUrl: string;
    requiredHeaders: Record<string, string>;
  }> {
    const thread = await this.read(async (client) => {
      const result = await client.query<{ access_mode: string }>(
        "SELECT access_mode FROM threads WHERE id = $1",
        [input.threadId],
      );
      return result.rows[0];
    });
    if (!thread) throw new Error("Thread was not found.");
    if (
      thread.access_mode === "human_only_e2ee" &&
      input.encryptionMode !== "client_e2ee"
    ) {
      throw new Error(
        "Human-only Thread attachments must be client-side ciphertext.",
      );
    }
    const now = new Date();
    const attachment: Attachment = {
      ...input,
      objectKey: `${this.organizationId}/${input.id}`,
      state: "pending_upload",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60 * 60 * 1_000).toISOString(),
    };
    await this.write(async (client) => {
      await client.query(
        `INSERT INTO attachments
          (id, organization_id, thread_id, owner_id, file_name, content_type,
           byte_size, checksum_sha256, encryption_mode, object_key, state,
           expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
        [
          attachment.id,
          this.organizationId,
          attachment.threadId,
          attachment.ownerId,
          attachment.fileName,
          attachment.contentType,
          attachment.byteSize,
          attachment.checksumSha256,
          attachment.encryptionMode,
          attachment.objectKey,
          attachment.state,
          attachment.expiresAt,
          attachment.createdAt,
        ],
      );
    });
    const requiredHeaders = {
      "content-type": attachment.contentType,
      "x-amz-meta-sha256": attachment.checksumSha256,
      ...(attachment.encryptionMode === "server_envelope" &&
      this.config.serverSideEncryption !== false
        ? { "x-amz-server-side-encryption": "AES256" }
        : {}),
    };
    const uploadUrl = await getSignedUrl(
      this.#s3,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: attachment.objectKey,
        ContentType: attachment.contentType,
        ContentLength: attachment.byteSize,
        Metadata: { sha256: attachment.checksumSha256 },
        ...(attachment.encryptionMode === "server_envelope" &&
        this.config.serverSideEncryption !== false
          ? { ServerSideEncryption: "AES256" }
          : {}),
      }),
      {
        expiresIn: 900,
        signableHeaders: new Set(["content-type"]),
        unhoistableHeaders: new Set(["x-amz-meta-sha256"]),
      },
    );
    return { attachment, uploadUrl, requiredHeaders };
  }

  async completeUpload(id: string): Promise<Attachment> {
    const attachment = await this.require(id);
    if (attachment.state !== "pending_upload") return attachment;
    const object = await this.#s3.send(
      new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: attachment.objectKey,
      }),
    );
    if (object.ContentLength !== attachment.byteSize) {
      await this.updateState(id, "scan_failed", "size_mismatch");
      throw new Error(
        "Uploaded attachment size does not match the declaration.",
      );
    }
    if (object.Metadata?.sha256 !== attachment.checksumSha256) {
      await this.updateState(id, "scan_failed", "metadata_checksum_mismatch");
      throw new Error("Uploaded attachment checksum metadata does not match.");
    }
    return this.updateState(id, "uploaded");
  }

  async uploadContent(id: string, content: Uint8Array): Promise<void> {
    const attachment = await this.require(id);
    if (attachment.state !== "pending_upload") {
      throw new Error("Attachment is not waiting for an upload.");
    }
    if (content.byteLength !== attachment.byteSize) {
      throw new Error(
        "Uploaded attachment size does not match the declaration.",
      );
    }
    await this.#s3.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: attachment.objectKey,
        Body: content,
        ContentType: attachment.contentType,
        ContentLength: attachment.byteSize,
        Metadata: { sha256: attachment.checksumSha256 },
        ...(attachment.encryptionMode === "server_envelope" &&
        this.config.serverSideEncryption !== false
          ? { ServerSideEncryption: "AES256" }
          : {}),
      }),
    );
  }

  async scan(id: string): Promise<Attachment> {
    const attachment = await this.require(id);
    if (
      attachment.state === "available" ||
      attachment.state === "quarantined"
    ) {
      return attachment;
    }
    if (attachment.state !== "uploaded" && attachment.state !== "scanning") {
      throw new Error("Attachment is not ready for scanning.");
    }
    await this.updateState(id, "scanning");
    try {
      const response = await this.#s3.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: attachment.objectKey,
        }),
      );
      const bytes = await response.Body?.transformToByteArray();
      if (!bytes || bytes.byteLength > 25 * 1024 * 1024) {
        throw new Error("attachment_size_limit");
      }
      const checksum = createHash("sha256").update(bytes).digest("hex");
      if (checksum !== attachment.checksumSha256) {
        return this.updateState(id, "scan_failed", "checksum_mismatch");
      }
      const eicar = Buffer.from(bytes).includes(
        Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE"),
      );
      return this.updateState(
        id,
        eicar ? "quarantined" : "available",
        eicar ? "eicar" : undefined,
      );
    } catch (error) {
      if ((await this.require(id)).state === "scan_failed")
        return this.require(id);
      return this.updateState(
        id,
        "scan_failed",
        error instanceof Error ? error.message : "scanner_failure",
      );
    }
  }

  async cleanupOrphans(now = new Date()): Promise<number> {
    return this.write(async (client) => {
      const expired = await client.query<{
        id: string;
        object_key: string;
      }>(
        `SELECT id, object_key
         FROM attachments
         WHERE message_id IS NULL AND expires_at < $1
         ORDER BY expires_at
         LIMIT 100
         FOR UPDATE SKIP LOCKED`,
        [now.toISOString()],
      );
      for (const item of expired.rows) {
        await this.#s3.send(
          new DeleteObjectCommand({
            Bucket: this.config.bucket,
            Key: item.object_key,
          }),
        );
      }
      if (expired.rows.length > 0) {
        await client.query(
          "DELETE FROM attachments WHERE id = ANY($1::uuid[])",
          [expired.rows.map((item) => item.id)],
        );
      }
      return expired.rows.length;
    });
  }

  async get(id: string): Promise<Attachment | undefined> {
    return this.read(async (client) => {
      const result = await client.query(
        "SELECT * FROM attachments WHERE id = $1",
        [id],
      );
      return result.rows[0] ? attachmentFromRow(result.rows[0]) : undefined;
    });
  }

  async createDownload(
    id: string,
  ): Promise<{ attachment: Attachment; downloadUrl: string }> {
    const attachment = await this.require(id);
    if (attachment.state !== "available") {
      throw new Error("Attachment is not available until scanning succeeds.");
    }
    const downloadUrl = await getSignedUrl(
      this.#s3,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: attachment.objectKey,
      }),
      { expiresIn: 300 },
    );
    return { attachment, downloadUrl };
  }

  async readContent(id: string): Promise<Uint8Array> {
    const attachment = await this.require(id);
    if (attachment.state !== "available") {
      throw new Error("Attachment is not available until scanning succeeds.");
    }
    const response = await this.#s3.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: attachment.objectKey,
      }),
    );
    const content = await response.Body?.transformToByteArray();
    if (!content) throw new Error("Attachment content is unavailable.");
    return content;
  }

  async close(): Promise<void> {
    this.#s3.destroy();
    await this.pool.end();
  }

  private async require(id: string): Promise<Attachment> {
    const attachment = await this.get(id);
    if (!attachment) throw new Error("Attachment was not found.");
    return attachment;
  }

  private async updateState(
    id: string,
    state: AttachmentState,
    errorCode?: string,
  ): Promise<Attachment> {
    return this.write(async (client) => {
      const result = await client.query(
        `UPDATE attachments
         SET state = $2, scan_error_code = $3, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [id, state, errorCode ?? null],
      );
      if (!result.rows[0]) throw new Error("Attachment was not found.");
      return attachmentFromRow(result.rows[0]);
    });
  }

  private async read<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.transaction(true, operation);
  }

  private async write<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
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

function attachmentFromRow(row: Record<string, unknown>): Attachment {
  const createdAt = row.created_at as Date;
  const expiresAt = row.expires_at as Date;
  return {
    id: row.id as Attachment["id"],
    threadId: row.thread_id as Attachment["threadId"],
    ownerId: row.owner_id as Attachment["ownerId"],
    fileName: row.file_name as string,
    contentType: row.content_type as string,
    byteSize: Number(row.byte_size),
    checksumSha256: row.checksum_sha256 as string,
    encryptionMode: row.encryption_mode as Attachment["encryptionMode"],
    objectKey: row.object_key as string,
    state: row.state as Attachment["state"],
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ...(row.message_id
      ? { messageId: row.message_id as Attachment["messageId"] }
      : {}),
  };
}

export * from "./object-store.js";
