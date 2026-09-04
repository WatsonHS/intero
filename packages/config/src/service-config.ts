import { z } from "zod";

import {
  loadPilotAdapterConfig,
  loadRuntimeConfig,
  type PilotAdapterConfig,
  type RuntimeConfig,
} from "./index.js";

const ServerSecret = z.string().min(16);
const OrganizationId = z.uuid();
export type RuntimeMode = "development" | "product";
const DevelopmentRealtimeTokenSecret =
  "intero-development-realtime-token-secret-v1";
const DevelopmentRealtimeApiKey = "intero-development-realtime-api-key-v1";
const DevelopmentCentrifugoApiUrl = "http://localhost:8000";
const DevelopmentLiveKitUrl = "ws://localhost:7880";
const DevelopmentLiveKitApiKey = "devkey";
const DevelopmentLiveKitApiSecret = "secret";
const ProductLiveKitApiKey = "intero";

const MinioObjectStorageConfig = z.object({
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
  encryption: z.literal("AES256"),
});

export const ObjectStorageConfig = MinioObjectStorageConfig;
export type ObjectStorageConfig = z.infer<typeof ObjectStorageConfig>;

export interface ApiServiceConfig {
  runtime: RuntimeConfig;
  runtimeMode: RuntimeMode;
  pilot: PilotAdapterConfig;
  organizationId: string;
  objectStorage: ObjectStorageConfig;
  spiceDbInsecure: boolean;
  spiceDbCaPath?: string;
  allowDevelopmentIdentity: boolean;
  realtime: {
    publicUrl: string;
    tokenSecret: string;
  };
  calls?: {
    serverUrl: string;
    apiKey: string;
    apiSecret: string;
  };
  auth?: {
    publicUrl: string;
    secret: string;
    passkeyRpId: string;
    trustedOrigins: string[];
  };
}

export interface WorkerServiceConfig {
  runtimeMode: RuntimeMode;
  pilot: PilotAdapterConfig;
  organizationId: string;
  workerDatabaseUrl: string;
  concurrency: number;
  metricsHost: string;
  metricsPort: number;
  spiceDbInsecure: boolean;
  spiceDbCaPath?: string;
  publicUrl: string;
}

export interface MigratorServiceConfig {
  databaseUrl: string;
  workerDatabaseUrl: string;
  spiceDb?: {
    endpoint: string;
    token: string;
    insecure: boolean;
    caPath?: string;
  };
}

export type SpiceDbMigratorConfig = NonNullable<
  MigratorServiceConfig["spiceDb"]
>;

export function loadObjectStorageConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ObjectStorageConfig {
  return ObjectStorageConfig.parse({
    endpoint: environment.INTERO_OBJECT_STORAGE_ENDPOINT,
    region: "us-east-1",
    accessKeyId: environment.INTERO_OBJECT_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: environment.INTERO_OBJECT_STORAGE_SECRET_ACCESS_KEY,
    bucket: environment.INTERO_OBJECT_STORAGE_BUCKET,
    tenantPrefix: "tenants",
    maxObjectBytes: 25 * 1024 * 1024,
    pendingUploadTtlSeconds: 3_600,
    quarantineRetentionDays: 30,
    abortIncompleteMultipartDays: 1,
    encryption: "AES256",
  });
}

export function loadApiServiceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiServiceConfig {
  const authSecret = environment.INTERO_AUTH_SECRET;
  const runtime = loadRuntimeConfig();
  const runtimeMode = runtimeModeFor(environment);
  const publicUrl = normalizePublicUrl(
    environment.INTERO_PUBLIC_URL ?? `http://localhost:${runtime.port}`,
  );
  const spiceDbCaPath = environment.INTERO_SPICEDB_CA_PATH;
  const spiceDbInsecure = runtimeMode === "development" && !spiceDbCaPath;
  if (runtimeMode === "product" && new URL(publicUrl).protocol !== "https:") {
    throw new Error(
      "Product runtime requires an HTTPS INTERO_PUBLIC_URL for secure sessions, passkeys, and realtime connections.",
    );
  }
  const publicUrlHost = new URL(publicUrl).hostname;
  const trustedOrigins = Array.from(
    new Set([
      ...defaultAuthTrustedOrigins(publicUrl, runtime.port),
      ...(runtimeMode === "development" &&
      new URL(publicUrl).protocol === "http:"
        ? localDevelopmentOrigins(runtime.port)
        : []),
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
  const organizationId = OrganizationId.parse(
    environment.INTERO_ORGANIZATION_ID ??
      "019b5ac0-7600-7000-8000-000000000001",
  );
  const liveKitSecret = environment.INTERO_LIVEKIT_API_SECRET;
  const calls =
    liveKitSecret || runtimeMode === "development"
      ? {
          serverUrl:
            runtimeMode === "product"
              ? `wss://${new URL(publicUrl).host}/rtc`
              : DevelopmentLiveKitUrl,
          apiKey:
            runtimeMode === "product"
              ? ProductLiveKitApiKey
              : DevelopmentLiveKitApiKey,
          apiSecret: z
            .string()
            .min(1)
            .parse(liveKitSecret ?? DevelopmentLiveKitApiSecret),
        }
      : undefined;
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
    organizationId,
    objectStorage: loadObjectStorageConfig(environment),
    spiceDbInsecure,
    ...(spiceDbCaPath ? { spiceDbCaPath } : {}),
    allowDevelopmentIdentity: runtimeMode === "development" && !authSecret,
    realtime: {
      publicUrl,
      tokenSecret: z.string().min(32).parse(realtimeTokenSecret),
    },
    ...(calls ? { calls } : {}),
    ...(authSecret
      ? {
          auth: {
            publicUrl: z.url().parse(publicUrl),
            secret: z.string().min(32).parse(authSecret),
            trustedOrigins,
            passkeyRpId: passkeyRpIdForHost(publicUrlHost),
          },
        }
      : {}),
  };
}

function runtimeModeFor(environment: NodeJS.ProcessEnv): RuntimeMode {
  return environment.NODE_ENV === "production" ? "product" : "development";
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

export function passkeyRpIdForHost(hostname: string): string {
  if (hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") {
    return "localhost";
  }
  return hostname;
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

function localDevelopmentOrigins(apiPort: number): string[] {
  const ports = [String(apiPort), "4311", "5173"];
  return ["localhost", "127.0.0.1", "0.0.0.0"].flatMap((hostname) =>
    ports.map((port) => `http://${hostname}:${port}`),
  );
}

export function loadWorkerServiceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerServiceConfig {
  const runtimeMode = runtimeModeFor(environment);
  const spiceDbCaPath = environment.INTERO_SPICEDB_CA_PATH;
  const spiceDbInsecure = runtimeMode === "development" && !spiceDbCaPath;
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
  const runtime = loadRuntimeConfig();
  const publicUrl = normalizePublicUrl(
    environment.INTERO_PUBLIC_URL ?? `http://localhost:${runtime.port}`,
  );
  return {
    runtimeMode,
    pilot,
    organizationId: OrganizationId.parse(
      environment.INTERO_ORGANIZATION_ID ??
        "019b5ac0-7600-7000-8000-000000000001",
    ),
    workerDatabaseUrl: z.url().parse(environment.INTERO_WORKER_DATABASE_URL),
    concurrency: 8,
    metricsHost: runtimeMode === "product" ? "0.0.0.0" : "127.0.0.1",
    metricsPort: 9464,
    spiceDbInsecure,
    publicUrl,
    ...(spiceDbCaPath ? { spiceDbCaPath } : {}),
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
  const caPath = environment.INTERO_SPICEDB_CA_PATH;
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
            insecure: !caPath,
            ...(caPath ? { caPath } : {}),
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
  const caPath = environment.INTERO_SPICEDB_CA_PATH;
  return {
    endpoint,
    token,
    insecure: !caPath,
    ...(caPath ? { caPath } : {}),
  };
}
