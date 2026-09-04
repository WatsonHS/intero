import { AttachmentService, MinioObjectStore } from "@intero/attachments";
import { loadApiServiceConfig, PrivacySafeMetrics } from "@intero/config";
import { OrganizationId, PrincipalId } from "@intero/domain";
import { Pool } from "pg";

import { PostgresActionInboxEventSource } from "./action-inbox-events.js";
import { buildApp } from "./app.js";
import { createInteroAuth } from "./auth.js";
import {
  CentrifugoCallEventPublisher,
  LiveKitCallTokenIssuer,
} from "./call-routes.js";
import { assertDatabaseMigrationReadiness } from "./database/migration-readiness.js";
import { NormalizedPostgresPilotStore } from "./normalized-postgres-pilot-store.js";
import type { PlatformStore } from "./platform-store.js";
import type { PilotStore } from "./pilot-store.js";
import { InMemoryPilotStore } from "./pilot-store.js";
import { TransactionalOutboxJobRunner } from "./pilot-service.js";
import { PostgresPlatformStore } from "./postgres-store.js";
import { AesGcmProviderSecretCipher } from "./provider-secrets.js";
import { PostgresProjectWorkStore } from "./project-work-store.js";
import {
  loadSpiceDbCertificate,
  SpiceDbAuthorization,
} from "./spicedb-authorization.js";
import { CentrifugoAccessRevoker } from "./realtime-routes.js";
import { SpiceDbPilotAuthorization } from "./spicedb-pilot-authorization.js";

const serviceConfig = loadApiServiceConfig();
const config = serviceConfig.runtime;
const pilotAdapterConfig = serviceConfig.pilot;
const databaseUrl = pilotAdapterConfig.databaseUrl;
if (!databaseUrl) {
  throw new Error(
    "Intero API requires INTERO_DATABASE_URL because MinIO object metadata is persisted in PostgreSQL.",
  );
}
const providerEncryptionSecret = pilotAdapterConfig.providerEncryptionKey;
const ATTACHMENT_CLEANUP_INTERVAL_MS = 5 * 60 * 1_000;
const organizationId = OrganizationId.parse(serviceConfig.organizationId);
const organizationName =
  process.env.INTERO_ORGANIZATION_NAME ?? "Intero Development";
const currentPrincipal = {
  id: PrincipalId.parse(
    process.env.INTERO_PRINCIPAL_ID ?? "019b5ac0-7600-7000-8000-000000000002",
  ),
  displayName: process.env.INTERO_PRINCIPAL_NAME ?? "Intero User",
  kind: "human" as const,
};
const standInId = PrincipalId.parse(
  process.env.INTERO_STAND_IN_ID ?? "019b5ac0-7600-7000-8000-000000000003",
);
const standInPrincipal = {
  id: standInId,
  displayName: process.env.INTERO_STAND_IN_NAME ?? "Intero Stand-in",
  kind: "stand_in" as const,
};
let authDatabase: Pool;
let databasePool: Pool;
let objectStore: MinioObjectStore;
let attachmentService: AttachmentService;
let store: PlatformStore;
let pilotStore: PilotStore;
let projectWorkStore: PostgresProjectWorkStore;
let actionInboxEvents: PostgresActionInboxEventSource;
{
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await assertDatabaseMigrationReadiness(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }
  databasePool = pool;
  authDatabase = pool;
  const postgresStore = new PostgresPlatformStore(
    pool,
    organizationId,
    providerEncryptionSecret
      ? new AesGcmProviderSecretCipher(providerEncryptionSecret)
      : undefined,
  );
  await postgresStore.initializeOrganization(organizationName);
  if (providerEncryptionSecret) {
    await postgresStore.ensureWebPushKeys();
  }
  store = postgresStore;
  pilotStore =
    pilotAdapterConfig.persistence === "postgres"
      ? new NormalizedPostgresPilotStore(pool, organizationId)
      : new InMemoryPilotStore();
  projectWorkStore = new PostgresProjectWorkStore(pool, organizationId);
  actionInboxEvents = new PostgresActionInboxEventSource(pool, organizationId);
  await actionInboxEvents.start();
  const storage = serviceConfig.objectStorage;
  objectStore = new MinioObjectStore(
    new Pool({ connectionString: databaseUrl }),
    organizationId,
    {
      endpoint: storage.endpoint,
      region: storage.region,
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
      bucket: storage.bucket,
      tenantPrefix: storage.tenantPrefix,
      maxObjectBytes: storage.maxObjectBytes,
      pendingUploadTtlSeconds: storage.pendingUploadTtlSeconds,
      quarantineRetentionDays: storage.quarantineRetentionDays,
      abortIncompleteMultipartDays: storage.abortIncompleteMultipartDays,
      encryption: storage.encryption,
      forcePathStyle: true,
    },
  );
  await objectStore.initialize();
  attachmentService = new AttachmentService(
    new Pool({ connectionString: databaseUrl }),
    organizationId,
    {
      endpoint: storage.endpoint,
      region: storage.region,
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
      bucket: storage.bucket,
      forcePathStyle: true,
      serverSideEncryption: storage.encryption === "AES256",
    },
  );
  await attachmentService.ensureBucket();
}
const auth = serviceConfig.auth
  ? createInteroAuth({
      publicUrl: serviceConfig.auth.publicUrl,
      secret: serviceConfig.auth.secret,
      rpId: serviceConfig.auth.passkeyRpId,
      trustedOrigins: serviceConfig.auth.trustedOrigins,
      rateLimitProfile: serviceConfig.runtimeMode,
      ...(authDatabase ? { database: authDatabase } : {}),
    })
  : undefined;
const spiceDbEndpoint = pilotAdapterConfig.spiceDbEndpoint;
const spiceDbToken = pilotAdapterConfig.spiceDbToken;
const spiceDbCertificate = await loadSpiceDbCertificate(
  serviceConfig.spiceDbCaPath,
);
const authorization =
  pilotAdapterConfig.authorization === "spicedb" &&
  spiceDbEndpoint &&
  spiceDbToken
    ? new SpiceDbAuthorization({
        endpoint: spiceDbEndpoint,
        token: spiceDbToken,
        insecureLocalhost: serviceConfig.spiceDbInsecure,
        ...(spiceDbCertificate ? { certificate: spiceDbCertificate } : {}),
      })
    : undefined;
const app = await buildApp({
  store,
  pilotStore,
  projectWorkStore,
  actionInboxEvents,
  ...(pilotAdapterConfig.standInJobs === "transactional-outbox"
    ? { pilotJobs: new TransactionalOutboxJobRunner() }
    : {}),
  organization: { id: organizationId, name: organizationName },
  currentPrincipal,
  standInPrincipal,
  allowDevelopmentIdentity: serviceConfig.allowDevelopmentIdentity,
  allowDevelopmentOrigins: serviceConfig.runtimeMode === "development",
  enableLegacyApi: serviceConfig.runtimeMode === "development",
  authDatabase,
  ...(providerEncryptionSecret ? { providerEncryptionSecret } : {}),
  readinessDependencies: [
    pilotStore instanceof NormalizedPostgresPilotStore
      ? {
          name: "pilot_postgres",
          critical: true,
          check: () => pilotStore.checkReadiness(),
        }
      : {
          name: "pilot_memory",
          critical: true,
          check: async () => ({
            status: "ready" as const,
            detail: "development_only",
          }),
        },
    ...(pilotStore instanceof NormalizedPostgresPilotStore
      ? [
          {
            name: "stand_in_worker",
            critical: false,
            check: () => pilotStore.checkWorkerReadiness(),
          },
        ]
      : []),
    ...(authorization
      ? [
          {
            name: "spicedb",
            critical: true,
            check: () => authorization.checkReadiness(),
          },
        ]
      : []),
    {
      name: "object_store",
      critical: true,
      check: () => objectStore.checkReadiness(),
    },
  ],
  metrics: new PrivacySafeMetrics(),
  ...(auth ? { auth } : {}),
  ...(serviceConfig.auth
    ? {
        authCorsOrigins: serviceConfig.auth.trustedOrigins,
        authActivationSecret: serviceConfig.auth.secret,
        authPublicUrl: serviceConfig.auth.publicUrl,
      }
    : {}),
  ...(authorization ? { authorization } : {}),
  ...(authorization
    ? {
        pilotAuthorization: new SpiceDbPilotAuthorization(
          pilotStore,
          authorization,
        ),
      }
    : {}),
  attachments: attachmentService,
  realtimeConfig: serviceConfig.realtime,
  ...(serviceConfig.calls
    ? {
        callTokenIssuer: new LiveKitCallTokenIssuer(
          serviceConfig.calls.serverUrl,
          serviceConfig.calls.apiKey,
          serviceConfig.calls.apiSecret,
        ),
      }
    : {}),
  ...(pilotAdapterConfig.centrifugoApiUrl && pilotAdapterConfig.centrifugoApiKey
    ? {
        realtimeAccessRevoker: new CentrifugoAccessRevoker(
          pilotAdapterConfig.centrifugoApiUrl,
          pilotAdapterConfig.centrifugoApiKey,
        ),
        callEventPublisher: new CentrifugoCallEventPublisher(
          pilotAdapterConfig.centrifugoApiUrl,
          pilotAdapterConfig.centrifugoApiKey,
        ),
      }
    : {}),
});
if (authorization) app.addHook("onClose", async () => authorization.close());
app.addHook("onClose", async () => objectStore.close());
const service = attachmentService;
let cleanupRunning = false;
const cleanupExpiredAttachments = async () => {
  if (cleanupRunning) return;
  cleanupRunning = true;
  try {
    let removed = 0;
    do {
      removed = await service.cleanupOrphans();
    } while (removed === 100);
  } catch (error) {
    app.log.error({ err: error }, "Attachment orphan cleanup failed.");
  } finally {
    cleanupRunning = false;
  }
};
void cleanupExpiredAttachments();
const cleanupTimer = setInterval(
  () => void cleanupExpiredAttachments(),
  ATTACHMENT_CLEANUP_INTERVAL_MS,
);
cleanupTimer.unref();
app.addHook("onClose", async () => {
  clearInterval(cleanupTimer);
  await service.close();
});
app.addHook("onClose", async () => {
  await actionInboxEvents.close();
  await databasePool.end();
});

await app.listen({ host: config.host, port: config.port });
let resolveStopRequested: ((signal: "SIGINT" | "SIGTERM") => void) | undefined;
const stopRequested = new Promise<"SIGINT" | "SIGTERM">((resolve) => {
  resolveStopRequested = resolve;
});
const handleSigint = () => resolveStopRequested?.("SIGINT");
const handleSigterm = () => resolveStopRequested?.("SIGTERM");
process.once("SIGINT", handleSigint);
process.once("SIGTERM", handleSigterm);

await stopRequested;
process.off("SIGINT", handleSigint);
process.off("SIGTERM", handleSigterm);
await app.close();
