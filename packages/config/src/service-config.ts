import { z } from "zod";

import {
  loadPilotAdapterConfig,
  loadRuntimeConfig,
  type PilotAdapterConfig,
  type RuntimeConfig,
} from "./index.js";

const ServerSecret = z.string().min(16);
const OrganizationId = z.uuid();

const DisabledObjectStorageConfig = z.object({
  mode: z.literal("disabled"),
});

const MinioObjectStorageConfig = z
  .object({
    mode: z.literal("minio"),
    endpoint: z.url(),
    region: z.string().min(1),
    accessKeyId: z.string().min(1),
    secretAccessKey: ServerSecret,
    bucket: z
      .string()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
    tenantPrefix: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9/_-]*$/),
    maxObjectBytes: z
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024),
    pendingUploadTtlSeconds: z.number().int().min(60).max(86_400),
    quarantineRetentionDays: z.number().int().min(1).max(365),
    abortIncompleteMultipartDays: z.number().int().min(1).max(30),
    encryption: z.enum(["AES256", "aws:kms"]),
    kmsKeyId: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.encryption === "aws:kms" && !value.kmsKeyId) {
      context.addIssue({
        code: "custom",
        path: ["kmsKeyId"],
        message:
          "INTERO_OBJECT_STORAGE_KMS_KEY_ID is required for aws:kms encryption.",
      });
    }
  });

export const ObjectStorageConfig = z.discriminatedUnion("mode", [
  DisabledObjectStorageConfig,
  MinioObjectStorageConfig,
]);
export type ObjectStorageConfig = z.infer<typeof ObjectStorageConfig>;

export interface ApiServiceConfig {
  runtime: RuntimeConfig;
  pilot: PilotAdapterConfig;
  organizationId: string;
  objectStorage: ObjectStorageConfig;
  metricsEnabled: boolean;
  spiceDbInsecure: boolean;
  allowDevelopmentIdentity: boolean;
  auth?: {
    publicUrl: string;
    secret: string;
    magicLinkWebhook?: string;
    developmentMagicLinks: boolean;
    passkeyRpId: string;
    trustedOrigins: string[];
    github?: { clientId: string; clientSecret: string };
  };
}

export interface WorkerServiceConfig {
  pilot: PilotAdapterConfig;
  organizationId: string;
  workerDatabaseUrl: string;
  concurrency: number;
  metricsHost: string;
  metricsPort: number;
  spiceDbInsecure: boolean;
}

export interface MigratorServiceConfig {
  databaseUrl: string;
  workerDatabaseUrl: string;
  spiceDb?: {
    endpoint: string;
    token: string;
    insecure: boolean;
  };
}

export type SpiceDbMigratorConfig = NonNullable<
  MigratorServiceConfig["spiceDb"]
>;

export function loadObjectStorageConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ObjectStorageConfig {
  const mode = environment.INTERO_OBJECT_STORAGE ?? "disabled";
  return ObjectStorageConfig.parse(
    mode === "disabled"
      ? { mode }
      : {
          mode,
          endpoint: environment.INTERO_OBJECT_STORAGE_ENDPOINT,
          region: environment.INTERO_OBJECT_STORAGE_REGION ?? "us-east-1",
          accessKeyId: environment.INTERO_OBJECT_STORAGE_ACCESS_KEY_ID,
          secretAccessKey: environment.INTERO_OBJECT_STORAGE_SECRET_ACCESS_KEY,
          bucket: environment.INTERO_OBJECT_STORAGE_BUCKET,
          tenantPrefix:
            environment.INTERO_OBJECT_STORAGE_TENANT_PREFIX ?? "tenants",
          maxObjectBytes: Number(
            environment.INTERO_OBJECT_STORAGE_MAX_BYTES ?? 25 * 1024 * 1024,
          ),
          pendingUploadTtlSeconds: Number(
            environment.INTERO_OBJECT_STORAGE_PENDING_TTL_SECONDS ?? 3_600,
          ),
          quarantineRetentionDays: Number(
            environment.INTERO_OBJECT_STORAGE_QUARANTINE_DAYS ?? 30,
          ),
          abortIncompleteMultipartDays: Number(
            environment.INTERO_OBJECT_STORAGE_ABORT_MULTIPART_DAYS ?? 1,
          ),
          encryption: environment.INTERO_OBJECT_STORAGE_ENCRYPTION ?? "AES256",
          kmsKeyId: environment.INTERO_OBJECT_STORAGE_KMS_KEY_ID,
        },
  );
}

export function loadApiServiceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiServiceConfig {
  const authSecret = environment.INTERO_AUTH_SECRET;
  const magicLinkWebhook = environment.INTERO_MAGIC_LINK_WEBHOOK;
  const developmentMagicLinks =
    environment.INTERO_AUTH_DEVELOPMENT_LINKS === "true";
  if (Boolean(authSecret) !== Boolean(magicLinkWebhook || developmentMagicLinks)) {
    throw new Error(
      "INTERO_AUTH_SECRET requires INTERO_MAGIC_LINK_WEBHOOK or explicit INTERO_AUTH_DEVELOPMENT_LINKS=true.",
    );
  }
  const githubClientId = environment.INTERO_GITHUB_CLIENT_ID;
  const githubClientSecret = environment.INTERO_GITHUB_CLIENT_SECRET;
  if (Boolean(githubClientId) !== Boolean(githubClientSecret)) {
    throw new Error(
      "INTERO_GITHUB_CLIENT_ID and INTERO_GITHUB_CLIENT_SECRET must be configured together.",
    );
  }
  const runtime = loadRuntimeConfig(environment);
  return {
    runtime,
    pilot: loadPilotAdapterConfig(environment),
    organizationId: OrganizationId.parse(
      environment.INTERO_ORGANIZATION_ID ??
        "019b5ac0-7600-7000-8000-000000000001",
    ),
    objectStorage: loadObjectStorageConfig(environment),
    metricsEnabled: environment.INTERO_METRICS_ENABLED !== "false",
    spiceDbInsecure: environment.INTERO_SPICEDB_INSECURE === "true",
    allowDevelopmentIdentity:
      environment.INTERO_ALLOW_DEVELOPMENT_IDENTITY === "true",
    ...(authSecret && (magicLinkWebhook || developmentMagicLinks)
      ? {
          auth: {
            publicUrl: z
              .url()
              .parse(
                environment.INTERO_PUBLIC_URL ??
                  `http://${runtime.host}:${runtime.port}`,
              ),
            secret: z.string().min(32).parse(authSecret),
            ...(magicLinkWebhook
              ? { magicLinkWebhook: z.url().parse(magicLinkWebhook) }
              : {}),
            developmentMagicLinks,
            trustedOrigins: (
              environment.INTERO_AUTH_TRUSTED_ORIGINS ??
              environment.INTERO_PUBLIC_URL ??
              `http://${runtime.host}:${runtime.port}`
            )
              .split(",")
              .map((origin) => z.url().parse(origin.trim())),
            passkeyRpId: z
              .string()
              .min(1)
              .parse(environment.INTERO_PASSKEY_RP_ID ?? "localhost"),
            ...(githubClientId && githubClientSecret
              ? {
                  github: {
                    clientId: githubClientId,
                    clientSecret: ServerSecret.parse(githubClientSecret),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}

export function loadWorkerServiceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerServiceConfig {
  const pilot = loadPilotAdapterConfig(environment);
  if (pilot.persistence !== "postgres") {
    throw new Error("server-worker requires PostgreSQL Pilot persistence.");
  }
  if (pilot.standInJobs !== "transactional-outbox") {
    throw new Error(
      "server-worker requires transactional-outbox Stand-in jobs.",
    );
  }
  return {
    pilot,
    organizationId: OrganizationId.parse(
      environment.INTERO_ORGANIZATION_ID ??
        "019b5ac0-7600-7000-8000-000000000001",
    ),
    workerDatabaseUrl: z.url().parse(environment.INTERO_WORKER_DATABASE_URL),
    concurrency: z.coerce
      .number()
      .int()
      .min(1)
      .max(64)
      .default(8)
      .parse(environment.INTERO_WORKER_CONCURRENCY),
    metricsHost: z
      .string()
      .default("127.0.0.1")
      .parse(environment.INTERO_WORKER_METRICS_HOST),
    metricsPort: z.coerce
      .number()
      .int()
      .min(1)
      .max(65_535)
      .default(9464)
      .parse(environment.INTERO_WORKER_METRICS_PORT),
    spiceDbInsecure: environment.INTERO_SPICEDB_INSECURE === "true",
  };
}

export function loadMigratorServiceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MigratorServiceConfig {
  const databaseUrl = z.url().parse(environment.DATABASE_URL);
  const endpoint = environment.INTERO_SPICEDB_ENDPOINT;
  const token = environment.INTERO_SPICEDB_TOKEN;
  if (Boolean(endpoint) !== Boolean(token)) {
    throw new Error(
      "INTERO_SPICEDB_ENDPOINT and INTERO_SPICEDB_TOKEN must be configured together.",
    );
  }
  return {
    databaseUrl,
    workerDatabaseUrl: z
      .url()
      .parse(environment.INTERO_WORKER_DATABASE_URL ?? databaseUrl),
    ...(endpoint && token
      ? {
          spiceDb: {
            endpoint,
            token,
            insecure: environment.INTERO_SPICEDB_INSECURE === "true",
          },
        }
      : {}),
  };
}

export function loadSpiceDbMigratorConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SpiceDbMigratorConfig {
  const endpoint = z.string().min(1).parse(environment.INTERO_SPICEDB_ENDPOINT);
  const token = ServerSecret.parse(environment.INTERO_SPICEDB_TOKEN);
  return {
    endpoint,
    token,
    insecure: environment.INTERO_SPICEDB_INSECURE === "true",
  };
}
