import { z } from "zod";

import {
  loadPilotAdapterConfig,
  loadRuntimeConfig,
  type PilotAdapterConfig,
  type RuntimeConfig,
} from "./index.js";

const ServerSecret = z.string().min(16);
const OrganizationId = z.uuid();
const RuntimeMode = z.enum(["development", "product"]);
export type RuntimeMode = z.infer<typeof RuntimeMode>;
const DevelopmentRealtimeTokenSecret =
  "intero-development-realtime-token-secret-v1";
const DevelopmentRealtimeApiKey = "intero-development-realtime-api-key-v1";
const DevelopmentCentrifugoApiUrl = "http://localhost:8000";
const DevelopmentCentrifugoPublicUrl = "http://localhost:4311";

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

export const ObjectStorageConfig = MinioObjectStorageConfig;
export type ObjectStorageConfig = z.infer<typeof ObjectStorageConfig>;

export interface ApiServiceConfig {
  runtime: RuntimeConfig;
  runtimeMode: RuntimeMode;
  pilot: PilotAdapterConfig;
  organizationId: string;
  objectStorage: ObjectStorageConfig;
  metricsEnabled: boolean;
  spiceDbInsecure: boolean;
  allowDevelopmentIdentity: boolean;
  realtime: {
    publicUrl: string;
    tokenSecret: string;
  };
  auth?: {
    publicUrl: string;
    secret: string;
    passkeyRpId: string;
    trustedOrigins: string[];
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
  return ObjectStorageConfig.parse({
    mode: environment.INTERO_OBJECT_STORAGE,
    endpoint: environment.INTERO_OBJECT_STORAGE_ENDPOINT,
    region: environment.INTERO_OBJECT_STORAGE_REGION ?? "us-east-1",
    accessKeyId: environment.INTERO_OBJECT_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: environment.INTERO_OBJECT_STORAGE_SECRET_ACCESS_KEY,
    bucket: environment.INTERO_OBJECT_STORAGE_BUCKET,
    tenantPrefix: environment.INTERO_OBJECT_STORAGE_TENANT_PREFIX ?? "tenants",
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
  });
}

export function loadApiServiceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiServiceConfig {
  const authSecret = environment.INTERO_AUTH_SECRET;
  const runtime = loadRuntimeConfig(environment);
  const runtimeMode = RuntimeMode.parse(
    environment.INTERO_RUNTIME_MODE ??
      (environment.NODE_ENV === "production" ? "product" : "development"),
  );
  const publicUrl = normalizePublicUrl(
    environment.INTERO_PUBLIC_URL ?? `http://localhost:${runtime.port}`,
  );
  const publicUrlHost = new URL(publicUrl).hostname;
  const configuredTrustedOrigins =
    environment.INTERO_AUTH_TRUSTED_ORIGINS?.split(",").map((origin) =>
      z.url().parse(origin.trim()),
    ) ?? [];
  const trustedOrigins = Array.from(
    new Set([
      ...defaultAuthTrustedOrigins(publicUrl, runtime.port),
      ...configuredTrustedOrigins,
    ]),
  );
  const pilotEnvironment = withDevelopmentCentrifugoDefaults(
    environment,
    runtimeMode,
  );
  const pilot = loadPilotAdapterConfig(pilotEnvironment);
  const realtimeTokenSecret =
    environment.INTERO_CENTRIFUGO_TOKEN_SECRET ??
    (runtimeMode === "development"
      ? DevelopmentRealtimeTokenSecret
      : undefined);
  const realtimePublicUrl =
    environment.INTERO_CENTRIFUGO_PUBLIC_URL ??
    (runtimeMode === "development"
      ? environment.INTERO_PUBLIC_URL
        ? publicUrl
        : DevelopmentCentrifugoPublicUrl
      : undefined);
  const developmentIdentityRequested =
    environment.INTERO_ALLOW_DEVELOPMENT_IDENTITY === "true";
  if (runtimeMode === "product" && developmentIdentityRequested) {
    throw new Error(
      "Product runtime cannot enable INTERO_ALLOW_DEVELOPMENT_IDENTITY.",
    );
  }
  if (runtimeMode === "product" && !authSecret) {
    throw new Error(
      "Product runtime requires INTERO_AUTH_SECRET for session authentication.",
    );
  }
  if (runtimeMode === "product" && !environment.INTERO_PUBLIC_URL) {
    throw new Error(
      "Product runtime requires INTERO_PUBLIC_URL as its canonical external address.",
    );
  }
  if (runtimeMode === "product" && !pilot.databaseUrl) {
    throw new Error(
      "Product runtime requires INTERO_DATABASE_URL for persistent sessions.",
    );
  }
  if (runtimeMode === "product" && !realtimeTokenSecret) {
    throw new Error(
      "Product Centrifugo realtime requires INTERO_CENTRIFUGO_TOKEN_SECRET.",
    );
  }
  if (runtimeMode === "product" && !pilot.centrifugoApiKey) {
    throw new Error(
      "Product Centrifugo realtime requires INTERO_CENTRIFUGO_API_KEY.",
    );
  }
  return {
    runtime,
    runtimeMode,
    pilot,
    organizationId: OrganizationId.parse(
      environment.INTERO_ORGANIZATION_ID ??
        "019b5ac0-7600-7000-8000-000000000001",
    ),
    objectStorage: loadObjectStorageConfig(environment),
    metricsEnabled: environment.INTERO_METRICS_ENABLED !== "false",
    spiceDbInsecure: environment.INTERO_SPICEDB_INSECURE === "true",
    allowDevelopmentIdentity:
      runtimeMode === "development" && developmentIdentityRequested,
    realtime: {
      publicUrl: z
        .url()
        .parse(realtimePublicUrl ?? publicUrl)
        .replace(/\/+$/, ""),
      tokenSecret: z.string().min(32).parse(realtimeTokenSecret),
    },
    ...(authSecret
      ? {
          auth: {
            publicUrl: z.url().parse(publicUrl),
            secret: z.string().min(32).parse(authSecret),
            trustedOrigins,
            passkeyRpId: z
              .string()
              .min(1)
              .parse(environment.INTERO_PASSKEY_RP_ID ?? publicUrlHost),
          },
        }
      : {}),
  };
}

function normalizePublicUrl(value: string): string {
  const parsed = new URL(z.url().parse(value));
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("INTERO_PUBLIC_URL must use HTTP or HTTPS.");
  }
  if (
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error(
      "INTERO_PUBLIC_URL must be an origin without a path, query, or fragment.",
    );
  }
  return parsed.origin;
}

function defaultAuthTrustedOrigins(
  publicUrl: string,
  apiPort: number,
): string[] {
  const parsed = new URL(publicUrl);
  if (!["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname)) {
    return [parsed.origin];
  }

  const ports = new Set([
    parsed.port || (parsed.protocol === "https:" ? "443" : "80"),
    String(apiPort),
    "4311",
    "5173",
  ]);
  return ["localhost", "127.0.0.1", "0.0.0.0"].flatMap((hostname) =>
    Array.from(ports, (port) => `http://${hostname}:${port}`),
  );
}

export function loadWorkerServiceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerServiceConfig {
  const runtimeMode = RuntimeMode.parse(
    environment.INTERO_RUNTIME_MODE ??
      (environment.NODE_ENV === "production" ? "product" : "development"),
  );
  const pilot = loadPilotAdapterConfig(
    withDevelopmentCentrifugoDefaults(environment, runtimeMode),
  );
  if (runtimeMode === "product" && !pilot.centrifugoApiKey) {
    throw new Error(
      "Product Centrifugo worker requires INTERO_CENTRIFUGO_API_KEY.",
    );
  }
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

function withDevelopmentCentrifugoDefaults(
  environment: NodeJS.ProcessEnv,
  runtimeMode: RuntimeMode,
): NodeJS.ProcessEnv {
  if (runtimeMode !== "development") {
    return environment;
  }
  return {
    ...environment,
    INTERO_CENTRIFUGO_API_URL:
      environment.INTERO_CENTRIFUGO_API_URL ?? DevelopmentCentrifugoApiUrl,
    INTERO_CENTRIFUGO_API_KEY:
      environment.INTERO_CENTRIFUGO_API_KEY ?? DevelopmentRealtimeApiKey,
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
