import { loadRuntimeConfig } from "@intero/config";
import { AttachmentService } from "@intero/attachments";
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

import { buildApp } from "./app.js";
import { createInteroAuth, type MagicLinkSender } from "./auth.js";
import type { PlatformStore } from "./platform-store.js";
import { PostgresPlatformStore } from "./postgres-store.js";
import { SpiceDbAuthorization } from "./spicedb-authorization.js";
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

const config = loadRuntimeConfig();
const databaseUrl = process.env.INTERO_DATABASE_URL;
const organizationId = OrganizationId.parse(
  process.env.INTERO_ORGANIZATION_ID ?? "019b5ac0-7600-7000-8000-000000000001",
);
const organizationName =
  process.env.INTERO_ORGANIZATION_NAME ?? "Intero Development";
const currentPrincipal = {
  id: PrincipalId.parse(
    process.env.INTERO_PRINCIPAL_ID ?? "019b5ac0-7600-7000-8000-000000000002",
  ),
  displayName: process.env.INTERO_PRINCIPAL_NAME ?? "Intero User",
  kind: "human" as const,
};
const localRepresentativeId = PrincipalId.parse(
  process.env.INTERO_LOCAL_REPRESENTATIVE_ID ??
    "019b5ac0-7600-7000-8000-000000000003",
);
const representativePrincipal = {
  id: localRepresentativeId,
  displayName:
    process.env.INTERO_LOCAL_REPRESENTATIVE_NAME ?? "Intero Representative",
  kind: "representative" as const,
};
let authDatabase: Pool | undefined;
let attachments: AttachmentService | undefined;
let store: PlatformStore;
if (databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
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
  attachments = new AttachmentService(
    new Pool({ connectionString: databaseUrl }),
    organizationId,
    {
      endpoint: process.env.INTERO_S3_ENDPOINT ?? "http://127.0.0.1:9000",
      region: process.env.INTERO_S3_REGION ?? "us-east-1",
      accessKeyId: process.env.INTERO_S3_ACCESS_KEY_ID ?? "intero",
      secretAccessKey:
        process.env.INTERO_S3_SECRET_ACCESS_KEY ?? "intero-development",
      bucket: process.env.INTERO_S3_BUCKET ?? "intero-attachments",
      forcePathStyle: true,
      serverSideEncryption: process.env.INTERO_S3_SERVER_ENCRYPTION !== "false",
    },
  );
  await attachments.ensureBucket();
} else {
  const memoryStore = new InMemoryPlatformStore();
  if (demoSeedingEnabled(process.env.INTERO_SEED_DEMO))
    seedDemoStore(memoryStore);
  store = memoryStore;
}
const authSecret = process.env.INTERO_AUTH_SECRET;
const magicLinkWebhook = process.env.INTERO_MAGIC_LINK_WEBHOOK;
const auth =
  authSecret && magicLinkWebhook
    ? createInteroAuth(
        {
          publicUrl:
            process.env.INTERO_PUBLIC_URL ??
            `http://${config.host}:${config.port}`,
          secret: authSecret,
          rpId: process.env.INTERO_PASSKEY_RP_ID ?? "localhost",
          ...(authDatabase ? { database: authDatabase } : {}),
          ...(process.env.INTERO_GITHUB_CLIENT_ID &&
          process.env.INTERO_GITHUB_CLIENT_SECRET
            ? {
                githubClientId: process.env.INTERO_GITHUB_CLIENT_ID,
                githubClientSecret: process.env.INTERO_GITHUB_CLIENT_SECRET,
              }
            : {}),
        },
        new WebhookMagicLinkSender(magicLinkWebhook),
      )
    : undefined;
const spiceDbEndpoint = process.env.INTERO_SPICEDB_ENDPOINT;
const spiceDbToken = process.env.INTERO_SPICEDB_TOKEN;
const authorization =
  spiceDbEndpoint && spiceDbToken
    ? new SpiceDbAuthorization({
        endpoint: spiceDbEndpoint,
        token: spiceDbToken,
        insecureLocalhost: process.env.INTERO_SPICEDB_INSECURE !== "false",
      })
    : undefined;
const app = await buildApp({
  store,
  organization: { id: organizationId, name: organizationName },
  currentPrincipal,
  representativePrincipal,
  inboxPrincipalIds: [currentPrincipal.id, localRepresentativeId],
  ...(auth ? { auth } : {}),
  ...(authorization ? { authorization } : {}),
  ...(attachments ? { attachments } : {}),
});
if (authorization) app.addHook("onClose", async () => authorization.close());
if (attachments) app.addHook("onClose", async () => attachments.close());

await app.listen({ host: config.host, port: config.port });

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
  const representativeId =
    "019b5ac0-7600-7000-8000-000000000003" as PrincipalId;
  const threadId = "019b5ac0-7600-7000-8000-000000000060" as ThreadId;
  if (!(await store.getThread(threadId))) {
    await store.createThread({
      id: threadId,
      kind: "representative",
      title: "Your Representative",
      participantIds: [humanId, representativeId],
      representativeIds: [representativeId],
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      sequence: 0,
      createdAt: new Date(Date.now() - 240_000).toISOString(),
    });
    await store.appendMessage(threadId, {
      id: "019b5ac0-7600-7000-8000-000000000061" as ThreadMessage["id"],
      senderId: representativeId,
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
      participantIds: [humanId, representativeId],
      representativeIds: [representativeId],
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
