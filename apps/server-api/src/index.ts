import { AttachmentService, MinioObjectStore } from "@intero/attachments";
import { loadApiServiceConfig, PrivacySafeMetrics } from "@intero/config";
import {
  OrganizationId,
  type Claim,
  PrincipalId,
  type ThreadId,
  type ThreadMessage,
  type Workstream,
  type WorkstreamId,
  uuidv7,
} from "@intero/domain";
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
import { demoSeedingEnabled } from "./store.js";

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
  if (
    demoSeedingEnabled(process.env.INTERO_SEED_DEMO) &&
    (await postgresStore.listProjections()).length === 0
  ) {
    await seedPostgresDemo(postgresStore);
  }
  if (demoSeedingEnabled(process.env.INTERO_SEED_DEMO)) {
    await ensureDemoThreads(postgresStore);
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
      ...(storage.kmsKeyId ? { kmsKeyId: storage.kmsKeyId } : {}),
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
  metrics: serviceConfig.metricsEnabled ? new PrivacySafeMetrics() : false,
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

async function seedPostgresDemo(store: PostgresPlatformStore): Promise<void> {
  const workspaceId =
    "019b5ac0-7600-7000-8000-000000000010" as Workstream["workspaceId"];
  const fixtures: Array<{
    id: WorkstreamId;
    ownerId: PrincipalId;
    title: string;
    phase: Workstream["phase"];
    predicate: Claim["predicate"];
    value: string;
    confidence: number;
  }> = [
    {
      id: "019b5ac0-7600-7000-8000-000000000020" as WorkstreamId,
      ownerId: "019b5ac0-7600-7000-8000-000000000021" as PrincipalId,
      title: "Authorization tuple schema",
      phase: "implementing",
      predicate: "decision",
      value: "Keep relationship checks behind the Authorization port.",
      confidence: 0.88,
    },
    {
      id: "019b5ac0-7600-7000-8000-000000000030" as WorkstreamId,
      ownerId: "019b5ac0-7600-7000-8000-000000000031" as PrincipalId,
      title: "Desktop coordination surface",
      phase: "reviewing",
      predicate: "dependency",
      value: "Waiting on the Thread access-boundary copy review.",
      confidence: 0.81,
    },
    {
      id: "019b5ac0-7600-7000-8000-000000000040" as WorkstreamId,
      ownerId: "019b5ac0-7600-7000-8000-000000000041" as PrincipalId,
      title: "Cursor repair under reconnect",
      phase: "blocked",
      predicate: "blocker",
      value: "Centrifugo replay fixture still drops one sequence.",
      confidence: 0.94,
    },
  ];
  for (const fixture of fixtures) {
    await store.createWorkstream({
      id: fixture.id,
      workspaceId,
      ownerId: fixture.ownerId,
      title: fixture.title,
      phase: fixture.phase,
      scope: [],
      blockers: [],
      dependencies: [],
      decisions: [],
      artifactIds: [],
      freshnessAt: new Date(Date.now() - 95_000).toISOString(),
      confidence: fixture.confidence,
    });
    await store.addClaim({
      id: uuidv7() as Claim["id"],
      workstreamId: fixture.id,
      predicate: fixture.predicate,
      value: fixture.value,
      sourceType:
        fixture.predicate === "blocker"
          ? "direct_observation"
          : "coding_agent_report",
      sourceRef: "demo:canonical-event",
      observedAt: new Date(Date.now() - 65_000).toISOString(),
      confidence: fixture.confidence,
      privacy: "P3_PROJECT",
      evidenceRefs: ["demo:evidence"],
    });
  }
}

async function ensureDemoThreads(store: PostgresPlatformStore): Promise<void> {
  const humanId = "019b5ac0-7600-7000-8000-000000000021" as PrincipalId;
  const standInId = "019b5ac0-7600-7000-8000-000000000003" as PrincipalId;
  const threadId = "019b5ac0-7600-7000-8000-000000000060" as ThreadId;
  if (!(await store.getThread(threadId))) {
    await store.createThread({
      id: threadId,
      kind: "stand_in",
      title: "Your Stand-in",
      participantIds: [humanId, standInId],
      standInIds: [standInId],
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      sequence: 0,
      createdAt: new Date(Date.now() - 240_000).toISOString(),
    });
    await store.appendMessage(threadId, {
      id: "019b5ac0-7600-7000-8000-000000000061" as ThreadMessage["id"],
      senderId: standInId,
      body: "Three current workstreams are synchronized. One needs attention: cursor recovery remains blocked on a missing sequence.",
      createdAt: new Date(Date.now() - 210_000).toISOString(),
    });
  }
  const roomId = "019b5ac0-7600-7000-8000-000000000070" as ThreadId;
  if (!(await store.getThread(roomId))) {
    await store.createThread({
      id: roomId,
      kind: "room",
      title: "Intero MVP · Project Room",
      participantIds: [humanId, standInId],
      standInIds: [standInId],
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      sequence: 0,
      createdAt: new Date(Date.now() - 180_000).toISOString(),
    });
    await store.appendMessage(roomId, {
      id: "019b5ac0-7600-7000-8000-000000000071" as ThreadMessage["id"],
      senderId: humanId,
      body: "Use this Room for shared MVP decisions; private agent context stays local.",
      createdAt: new Date(Date.now() - 150_000).toISOString(),
    });
  }
}
