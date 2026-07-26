import { MinioObjectStore } from "@intero/attachments";
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
import { createHash } from "node:crypto";
import { Pool } from "pg";

import { buildApp } from "./app.js";
import { createInteroAuth, type MagicLinkSender } from "./auth.js";
import { NormalizedPostgresPilotStore } from "./normalized-postgres-pilot-store.js";
import type { PlatformStore } from "./platform-store.js";
import type { PilotStore } from "./pilot-store.js";
import { InMemoryPilotStore } from "./pilot-store.js";
import { TransactionalOutboxJobRunner } from "./pilot-service.js";
import { PostgresPlatformStore } from "./postgres-store.js";
import { PostgresProjectWorkStore } from "./project-work-store.js";
import { SpiceDbAuthorization } from "./spicedb-authorization.js";
import { SpiceDbPilotAuthorization } from "./spicedb-pilot-authorization.js";
import {
  demoSeedingEnabled,
  InMemoryPlatformStore,
  seedDemoStore,
} from "./store.js";

class WebhookMagicLinkSender implements MagicLinkSender {
  constructor(private readonly endpoint: string) {}

  async send(input: {
    email: string;
    url: string;
    expiresInSeconds: number;
  }): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      throw new Error(
        `Magic-link delivery failed with status ${response.status}.`,
      );
    }
  }
}

class DevelopmentMagicLinkSender implements MagicLinkSender {
  private readonly links = new Map<string, string>();

  async send(input: {
    email: string;
    url: string;
    expiresInSeconds: number;
  }): Promise<void> {
    this.links.set(input.email.trim().toLowerCase(), input.url);
  }

  latest(email: string): string | undefined {
    return this.links.get(email.trim().toLowerCase());
  }
}

const serviceConfig = loadApiServiceConfig();
const config = serviceConfig.runtime;
const pilotAdapterConfig = serviceConfig.pilot;
const databaseUrl = pilotAdapterConfig.databaseUrl;
const providerEncryptionSecret = pilotAdapterConfig.providerEncryptionKey;
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
const localStandInId = PrincipalId.parse(
  process.env.INTERO_LOCAL_STAND_IN_ID ??
    "019b5ac0-7600-7000-8000-000000000003",
);
const standInPrincipal = {
  id: localStandInId,
  displayName:
    process.env.INTERO_LOCAL_STAND_IN_NAME ?? "Intero Stand-in",
  kind: "stand_in" as const,
};
let authDatabase: Pool | undefined;
let databasePool: Pool | undefined;
let objectStore: MinioObjectStore | undefined;
let store: PlatformStore;
let pilotStore: PilotStore;
let projectWorkStore: PostgresProjectWorkStore | undefined;
if (databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  databasePool = pool;
  authDatabase = pool;
  const postgresStore = new PostgresPlatformStore(pool, organizationId);
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
  if (serviceConfig.objectStorage.mode === "minio") {
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
    await objectStore.initialize().catch(() => undefined);
  }
} else {
  const memoryStore = new InMemoryPlatformStore();
  if (demoSeedingEnabled(process.env.INTERO_SEED_DEMO))
    seedDemoStore(memoryStore);
  store = memoryStore;
  pilotStore = new InMemoryPilotStore();
}
const developmentMagicLinkSender = serviceConfig.auth?.developmentMagicLinks
  ? new DevelopmentMagicLinkSender()
  : undefined;
const magicLinkSender = serviceConfig.auth
  ? developmentMagicLinkSender ??
    new WebhookMagicLinkSender(serviceConfig.auth.magicLinkWebhook!)
  : undefined;
const auth =
  serviceConfig.auth && magicLinkSender
    ? createInteroAuth(
      {
        publicUrl: serviceConfig.auth.publicUrl,
        secret: serviceConfig.auth.secret,
        rpId: serviceConfig.auth.passkeyRpId,
        trustedOrigins: serviceConfig.auth.trustedOrigins,
        ...(authDatabase ? { database: authDatabase } : {}),
        ...(serviceConfig.auth.github
          ? {
              githubClientId: serviceConfig.auth.github.clientId,
              githubClientSecret: serviceConfig.auth.github.clientSecret,
            }
          : {}),
        authorizeMagicLink: async ({ email, invitationToken }) => {
          if (authDatabase) {
            const client = await authDatabase.connect();
            try {
              await client.query("BEGIN READ ONLY");
              await client.query(
                "SELECT set_config('intero.organization_id',$1,true)",
                [organizationId],
              );
              const existing = await client.query(
                `SELECT 1
                 FROM "user" u
                 JOIN auth_principals ap ON ap.auth_user_id = u.id
                 JOIN memberships m ON m.principal_id = ap.principal_id
                 WHERE lower(u.email) = $1
                   AND m.organization_id = $2
                 LIMIT 1`,
                [email, organizationId],
              );
              await client.query("COMMIT");
              if (existing.rowCount) return true;
            } catch (error) {
              await client.query("ROLLBACK");
              throw error;
            } finally {
              client.release();
            }
          }
          if (!invitationToken) return false;
          const invitation = await pilotStore.findInvitationByTokenHash(
            createHash("sha256").update(invitationToken).digest("hex"),
          );
          const now = new Date().toISOString();
          return Boolean(
            invitation &&
              invitation.email === email &&
              !invitation.acceptedAt &&
              !invitation.revokedAt &&
              invitation.expiresAt > now,
          );
        },
      },
      magicLinkSender,
    )
    : undefined;
const spiceDbEndpoint = pilotAdapterConfig.spiceDbEndpoint;
const spiceDbToken = pilotAdapterConfig.spiceDbToken;
const authorization =
  pilotAdapterConfig.authorization === "spicedb" &&
  spiceDbEndpoint &&
  spiceDbToken
    ? new SpiceDbAuthorization({
        endpoint: spiceDbEndpoint,
        token: spiceDbToken,
        insecureLocalhost: serviceConfig.spiceDbInsecure,
      })
    : undefined;
const app = await buildApp({
  store,
  pilotStore,
  ...(projectWorkStore ? { projectWorkStore } : {}),
  ...(pilotAdapterConfig.standInJobs === "transactional-outbox"
    ? { pilotJobs: new TransactionalOutboxJobRunner() }
    : {}),
  organization: { id: organizationId, name: organizationName },
  currentPrincipal,
  standInPrincipal,
  allowDevelopmentIdentity: serviceConfig.allowDevelopmentIdentity,
  ...(authDatabase ? { authDatabase } : {}),
  inboxPrincipalIds: [currentPrincipal.id, localStandInId],
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
    objectStore
      ? {
          name: "object_store",
          critical: false,
          check: () => objectStore.checkReadiness(),
        }
      : {
          name: "object_store",
          critical: false,
          check: async () => ({
            status: "disabled" as const,
            detail: "policy_disabled",
          }),
        },
  ],
  metrics: serviceConfig.metricsEnabled ? new PrivacySafeMetrics() : false,
  ...(auth ? { auth } : {}),
  ...(serviceConfig.auth
    ? { authCorsOrigins: serviceConfig.auth.trustedOrigins }
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
  ...(objectStore ? { pilotObjectStore: objectStore } : {}),
});
if (authorization) app.addHook("onClose", async () => authorization.close());
if (developmentMagicLinkSender) {
  app.get<{ Querystring: { email?: string } }>(
    "/api/auth/dev/magic-link",
    async (request, reply) => {
      const email = request.query.email?.trim().toLowerCase();
      const url = email ? developmentMagicLinkSender.latest(email) : undefined;
      return url
        ? { url }
        : reply.status(404).send({
            code: "DEVELOPMENT_MAGIC_LINK_NOT_FOUND",
            message: "No development magic link is available for this email.",
          });
    },
  );
}
if (objectStore) app.addHook("onClose", async () => objectStore.close());
if (databasePool)
  app.addHook("onClose", async () => {
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
  const standInId =
    "019b5ac0-7600-7000-8000-000000000003" as PrincipalId;
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
