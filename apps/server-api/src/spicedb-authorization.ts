import { v1 } from "@authzed/authzed-node";
import { readFile } from "node:fs/promises";

import type { AuthorizationPort } from "./ports.js";

export interface SpiceDbAuthorizationConfig {
  endpoint: string;
  token: string;
  insecureLocalhost?: boolean;
  certificate?: Buffer;
  timeoutMs?: number;
}

export class SpiceDbAuthorization implements AuthorizationPort {
  readonly #client: v1.ZedClientInterface;
  readonly #timeoutMs: number;
  #relationshipWriteTail: Promise<void> = Promise.resolve();

  constructor(config: SpiceDbAuthorizationConfig) {
    if (config.insecureLocalhost && config.certificate) {
      throw new Error(
        "SpiceDB cannot use both insecure transport and a custom CA certificate.",
      );
    }
    this.#client = config.certificate
      ? v1.NewClientWithCustomCert(
          config.token,
          config.endpoint,
          config.certificate,
        )
      : v1.NewClient(
          config.token,
          config.endpoint,
          config.insecureLocalhost
            ? config.endpoint.startsWith("localhost:")
              ? v1.ClientSecurity.INSECURE_LOCALHOST_ALLOWED
              : v1.ClientSecurity.INSECURE_PLAINTEXT_CREDENTIALS
            : v1.ClientSecurity.SECURE,
        );
    this.#timeoutMs = config.timeoutMs ?? 2_000;
  }

  async check(input: {
    principalId: string;
    permission: string;
    resourceType: string;
    resourceId: string;
    consistencyToken?: string;
  }): Promise<{ allowed: boolean; consistencyToken?: string }> {
    try {
      const response = await unary<v1.CheckPermissionResponse>((callback) =>
        this.#client.checkPermission(
          v1.CheckPermissionRequest.create({
            consistency: v1.Consistency.create({
              requirement: input.consistencyToken
                ? {
                    oneofKind: "atLeastAsFresh",
                    atLeastAsFresh: v1.ZedToken.create({
                      token: input.consistencyToken,
                    }),
                  }
                : { oneofKind: "fullyConsistent", fullyConsistent: true },
            }),
            resource: v1.ObjectReference.create({
              objectType: input.resourceType,
              objectId: input.resourceId,
            }),
            permission: input.permission,
            subject: v1.SubjectReference.create({
              object: v1.ObjectReference.create({
                objectType: "principal",
                objectId: input.principalId,
              }),
            }),
          }),
          { deadline: Date.now() + this.#timeoutMs },
          callback,
        ),
      );
      const token = response.checkedAt?.token;
      return {
        allowed:
          response.permissionship ===
          v1.CheckPermissionResponse_Permissionship.HAS_PERMISSION,
        ...(token ? { consistencyToken: token } : {}),
      };
    } catch {
      return { allowed: false };
    }
  }

  async writeSchema(schema: string): Promise<string | undefined> {
    const response = await unary<v1.WriteSchemaResponse>((callback) =>
      this.#client.writeSchema(
        v1.WriteSchemaRequest.create({ schema }),
        { deadline: Date.now() + this.#timeoutMs },
        callback,
      ),
    );
    return response.writtenAt?.token;
  }

  async checkReadiness(): Promise<{
    status: "ready" | "unavailable";
    detail?: string;
  }> {
    try {
      const response = await unary<v1.ReadSchemaResponse>((callback) =>
        this.#client.readSchema(
          v1.ReadSchemaRequest.create(),
          { deadline: Date.now() + this.#timeoutMs },
          callback,
        ),
      );
      if (!response.schemaText.includes("definition project")) {
        return {
          status: "unavailable",
          detail: "spicedb_schema_missing",
        };
      }
      return { status: "ready" };
    } catch {
      return {
        status: "unavailable",
        detail: "spicedb_unavailable",
      };
    }
  }

  async touchRelationship(input: {
    resourceType: string;
    resourceId: string;
    relation: string;
    principalId?: string;
    subjectType?: string;
    subjectId?: string;
    subjectRelation?: string;
  }): Promise<string | undefined> {
    // The bundled in-memory SpiceDB datastore can acknowledge concurrent
    // writes at adjacent revisions while retaining only a subset of them.
    // Preserve write ordering per client so a successful authorization repair
    // is immediately durable before its consistency token is checked.
    const write = this.#relationshipWriteTail.then(() =>
      this.#writeRelationship(input),
    );
    this.#relationshipWriteTail = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }

  async #writeRelationship(input: {
    resourceType: string;
    resourceId: string;
    relation: string;
    principalId?: string;
    subjectType?: string;
    subjectId?: string;
    subjectRelation?: string;
  }): Promise<string | undefined> {
    const subjectId = input.subjectId ?? input.principalId;
    if (!subjectId) throw new Error("A relationship subject is required.");
    const response = await unary<v1.WriteRelationshipsResponse>((callback) =>
      this.#client.writeRelationships(
        v1.WriteRelationshipsRequest.create({
          updates: [
            v1.RelationshipUpdate.create({
              operation: v1.RelationshipUpdate_Operation.TOUCH,
              relationship: v1.Relationship.create({
                resource: v1.ObjectReference.create({
                  objectType: input.resourceType,
                  objectId: input.resourceId,
                }),
                relation: input.relation,
                subject: v1.SubjectReference.create({
                  object: v1.ObjectReference.create({
                    objectType: input.subjectType ?? "principal",
                    objectId: subjectId,
                  }),
                  ...(input.subjectRelation
                    ? { optionalRelation: input.subjectRelation }
                    : {}),
                }),
              }),
            }),
          ],
        }),
        { deadline: Date.now() + this.#timeoutMs },
        callback,
      ),
    );
    return response.writtenAt?.token;
  }

  close(): void {
    this.#client.close();
  }
}

export async function loadSpiceDbCertificate(
  path?: string,
): Promise<Buffer | undefined> {
  return path ? readFile(path) : undefined;
}

function unary<T>(
  call: (callback: (error: Error | null, value?: T) => void) => unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    call((error, value) => {
      if (error) reject(error);
      else if (!value) reject(new Error("SpiceDB returned no response."));
      else resolve(value);
    });
  });
}
