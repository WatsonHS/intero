import {
  ActionEnvelope,
  CapabilityGrant,
  ConversationThread,
  OrganizationId,
  PilotAgentBinding,
  PilotAgentTicket,
  PilotCheckpointInput,
  PilotProject,
  PilotTeam,
  PilotTeamInvitation,
  PrincipalId,
  ProjectId,
  type ThreadMessage,
  WorkCodeReference,
  WorkComment,
  WorkCommentId,
  WorkRelation,
  type PilotStandInOutput,
  type WorkActor,
} from "@intero/domain";
import { hashPassword } from "better-auth/crypto";
import { createHash } from "node:crypto";
import { Pool } from "pg";

import { migrateDatabase } from "./database/migrate.js";
import { PostgresAutomationStore } from "./automation-store.js";
import { NormalizedPostgresPilotStore } from "./normalized-postgres-pilot-store.js";
import { PostgresPlatformStore } from "./postgres-store.js";
import { PostgresProjectWorkStore } from "./project-work-store.js";
import { AesGcmProviderSecretCipher } from "./provider-secrets.js";

const DEMO_DATABASE_PATTERN = /(demo|test|validation)/i;
const DEMO_EMAIL_SUFFIX = "@demo.intero.test";
const DEMO_ORGANIZATION_NAME = "Intero Demo Product Studio";
const DEMO_SEED_VERSION = 7;
export const DEMO_PASSWORD = "Intero-demo-2026!";
const CANONICAL_RUNTIME_PRINCIPAL_IDS = [
  "019b5ac0-7600-7000-8000-000000000002",
  "019b5ac0-7600-7000-8000-000000000003",
  "019b5ac0-7600-7000-8000-000000000004",
] as const;

export const DEMO_IDS = {
  organization: OrganizationId.parse("019f9a00-0000-7000-8000-000000000001"),
  principals: {
    alex: PrincipalId.parse("019f9a00-0000-7000-8000-000000000101"),
    priya: PrincipalId.parse("019f9a00-0000-7000-8000-000000000102"),
    morgan: PrincipalId.parse("019f9a00-0000-7000-8000-000000000103"),
    jordan: PrincipalId.parse("019f9a00-0000-7000-8000-000000000104"),
    standIn: PrincipalId.parse("019f9a00-0000-7000-8000-000000000201"),
  },
  teams: {
    product: "019f9a00-0000-7000-8000-000000000301",
    platform: "019f9a00-0000-7000-8000-000000000302",
  },
  project: ProjectId.parse("019f9a00-0000-7000-8000-000000000401"),
  workspace: "019f9a00-0000-7000-8000-000000000501",
  invitation: {
    priyaProduct: "019f9a00-0000-7000-8000-000000000801",
    morganProduct: "019f9a00-0000-7000-8000-000000000802",
    jordanProduct: "019f9a00-0000-7000-8000-000000000803",
    alexPlatform: "019f9a00-0000-7000-8000-000000000804",
    priyaPlatform: "019f9a00-0000-7000-8000-000000000805",
    jordanPlatform: "019f9a00-0000-7000-8000-000000000806",
    pending: "019f9a00-0000-7000-8000-000000000807",
  },
  dm: {
    thread: "019f9a00-0000-7000-8000-000000000701",
    first: "019f9a00-0000-7000-8000-000000000702",
    second: "019f9a00-0000-7000-8000-000000000703",
    platformThread: "019f9a00-0000-7000-8000-000000000704",
    platformFirst: "019f9a00-0000-7000-8000-000000000705",
    platformSecond: "019f9a00-0000-7000-8000-000000000706",
    platformThird: "019f9a00-0000-7000-8000-000000000707",
  },
  conversations: {
    productTeamThread: "019f9a00-0000-7000-8000-000000000c04",
    productTeamMessages: [
      "019f9a00-0000-7000-8000-000000000c41",
      "019f9a00-0000-7000-8000-000000000c42",
      "019f9a00-0000-7000-8000-000000000c43",
      "019f9a00-0000-7000-8000-000000000c44",
    ],
    groupThread: "019f9a00-0000-7000-8000-000000000c01",
    groupMessages: [
      "019f9a00-0000-7000-8000-000000000c11",
      "019f9a00-0000-7000-8000-000000000c12",
      "019f9a00-0000-7000-8000-000000000c13",
      "019f9a00-0000-7000-8000-000000000c14",
      "019f9a00-0000-7000-8000-000000000c15",
    ],
    standInThread: "019f9a00-0000-7000-8000-000000000c02",
    standInMessages: [
      "019f9a00-0000-7000-8000-000000000c21",
      "019f9a00-0000-7000-8000-000000000c22",
      "019f9a00-0000-7000-8000-000000000c23",
      "019f9a00-0000-7000-8000-000000000c24",
      "019f9a00-0000-7000-8000-000000000c25",
      "019f9a00-0000-7000-8000-000000000c26",
    ],
    actionThread: "019f9a00-0000-7000-8000-000000000c03",
    confirmationGrant: "019f9a00-0000-7000-8000-000000000d01",
    scopeGrant: "019f9a00-0000-7000-8000-000000000d02",
    confirmationOperation: "019f9a00-0000-7000-8000-000000000d11",
    scopeOperation: "019f9a00-0000-7000-8000-000000000d12",
  },
} as const;

const DEMO_USERS = [
  {
    key: "alex",
    authUserId: "intero-demo-alex",
    principalId: DEMO_IDS.principals.alex,
    displayName: "Alex Rivera",
    avatarTone: "accent",
    email: `alex${DEMO_EMAIL_SUFFIX}`,
  },
  {
    key: "priya",
    authUserId: "intero-demo-priya",
    principalId: DEMO_IDS.principals.priya,
    displayName: "Priya Shah",
    avatarTone: "green",
    email: `priya${DEMO_EMAIL_SUFFIX}`,
  },
  {
    key: "morgan",
    authUserId: "intero-demo-morgan",
    principalId: DEMO_IDS.principals.morgan,
    displayName: "Morgan Lee",
    avatarTone: "amber",
    email: `morgan${DEMO_EMAIL_SUFFIX}`,
  },
  {
    key: "jordan",
    authUserId: "intero-demo-jordan",
    principalId: DEMO_IDS.principals.jordan,
    displayName: "Jordan Kim",
    avatarTone: "cool",
    email: `jordan${DEMO_EMAIL_SUFFIX}`,
  },
] as const;

export interface DemoTarget {
  databaseUrl: string;
  databaseName: string;
  host: string;
  port: string;
  confirmation: string;
}

export interface DemoSeedResult {
  status: "seeded" | "already_seeded";
  seedVersion: number;
  organizationId: string;
  projectId: string;
  pendingInvitationToken: string;
  identities: Array<{
    displayName: string;
    email: string;
    principalId: string;
  }>;
}

export function expectedDemoConfirmation(databaseUrl: string): string {
  const target = parsePostgresUrl(databaseUrl);
  return `INTERO_DEMO_DISPOSABLE:${target.hostname}:${target.port || "5432"}/${target.pathname.slice(1)}`;
}

export function requireDemoTarget(input: {
  databaseUrl?: string;
  confirmation?: string;
  nodeEnv?: string;
  demoEnabled?: string;
}): DemoTarget {
  if (!input.databaseUrl) {
    throw new Error("DATABASE_URL is required for the Demo data command.");
  }
  if (!["development", "test"].includes(input.nodeEnv ?? "")) {
    throw new Error(
      "Demo data commands require NODE_ENV=development or NODE_ENV=test.",
    );
  }
  if (input.demoEnabled !== "true") {
    throw new Error(
      "Demo data commands require the explicit INTERO_DEMO_DATA=true gate.",
    );
  }
  const target = parsePostgresUrl(input.databaseUrl);
  const host = target.hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(
      "Demo data commands only accept a loopback PostgreSQL target.",
    );
  }
  const databaseName = decodeURIComponent(target.pathname.replace(/^\/+/, ""));
  if (!databaseName || !DEMO_DATABASE_PATTERN.test(databaseName)) {
    throw new Error(
      "The Demo database name must contain demo, test, or validation.",
    );
  }
  const expected = expectedDemoConfirmation(input.databaseUrl);
  if (input.confirmation !== expected) {
    throw new Error(
      `Refusing Demo data command. Set INTERO_DEMO_CONFIRM exactly to ${expected}.`,
    );
  }
  return {
    databaseUrl: input.databaseUrl,
    databaseName,
    host,
    port: target.port || "5432",
    confirmation: expected,
  };
}

export async function seedDemoData(input: {
  target: DemoTarget;
  providerEncryptionKey: string;
  publicUrl?: string;
  now?: Date;
}): Promise<DemoSeedResult> {
  await migrateDatabase(input.target.databaseUrl);
  const pool = new Pool({ connectionString: input.target.databaseUrl });
  try {
    const state = await inspectDemoOwnership(pool);
    if (state === "seeded") return demoResult("already_seeded");
    if (state === "partial") {
      throw new Error(
        "The selected database contains a partial Intero Demo seed. Run the guarded demo:reset command before reseeding.",
      );
    }

    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    await bootstrapDemoIdentities(pool);

    const pilotStore = new NormalizedPostgresPilotStore(
      pool,
      DEMO_IDS.organization,
    );
    const productTeam: PilotTeam = {
      id: DEMO_IDS.teams.product,
      organizationId: DEMO_IDS.organization,
      name: "产品体验",
      createdAt: offsetIso(now, -30 * 86_400_000),
    };
    await pilotStore.setupOrganization({
      organization: {
        id: DEMO_IDS.organization,
        name: DEMO_ORGANIZATION_NAME,
        deploymentBaseUrl: input.publicUrl ?? "http://127.0.0.1:4310",
        deploymentValidatedAt: nowIso,
        provider: { configured: false },
      },
      administratorId: DEMO_IDS.principals.alex,
      initialTeam: productTeam,
    });

    const cipher = new AesGcmProviderSecretCipher(input.providerEncryptionKey);
    await pilotStore.configureProvider({
      administratorId: DEMO_IDS.principals.alex,
      endpoint: "http://127.0.0.1:4312/v1",
      defaultModel: "intero-demo-deterministic",
      encryptedApiKey: cipher.encrypt("demo-placeholder-not-a-real-secret"),
    });

    const platformTeam: PilotTeam = {
      id: DEMO_IDS.teams.platform,
      organizationId: DEMO_IDS.organization,
      name: "开发者平台",
      createdAt: offsetIso(now, -28 * 86_400_000),
    };
    await insertAdditionalTeam(pool, platformTeam);
    await seedMembershipsAndInvitations(pilotStore, now);

    const project: PilotProject = {
      id: DEMO_IDS.project,
      organizationId: DEMO_IDS.organization,
      name: "统一发布控制台",
      ownerId: DEMO_IDS.principals.alex,
      primaryTeamId: DEMO_IDS.teams.product,
      participatingTeamIds: [DEMO_IDS.teams.product, DEMO_IDS.teams.platform],
      posture: "collaborative",
      createdAt: offsetIso(now, -21 * 86_400_000),
      updatedAt: nowIso,
    };
    await pilotStore.createProject(project);
    await pool.query(
      "UPDATE projects SET project_management_enabled=true, timezone='Asia/Shanghai' WHERE id=$1",
      [project.id],
    );

    await seedDirectMessages(pilotStore, now);
    const coordinationThreadId = await seedPilotWorkState(pilotStore, now);
    await seedCanonicalCollaboration(
      new PostgresPlatformStore(pool, DEMO_IDS.organization),
      pool,
      now,
    );
    const workStore = new PostgresProjectWorkStore(pool, DEMO_IDS.organization);
    await seedProjectWork(workStore, project.id, coordinationThreadId, now);
    await seedBoundedAutomation(input.target.databaseUrl, now);
    await pool.query(
      `UPDATE action_inbox
       SET title = regexp_replace(title, '^Review requested · ', '请评审 · ')
       WHERE organization_id=$1 AND kind='review_request'`,
      [DEMO_IDS.organization],
    );
    await markDemoSeedComplete(pool, nowIso);
    return demoResult("seeded");
  } finally {
    await pool.end();
  }
}

async function seedBoundedAutomation(
  databaseUrl: string,
  now: Date,
): Promise<void> {
  const automation = new PostgresAutomationStore(
    new Pool({ connectionString: databaseUrl }),
    DEMO_IDS.organization,
  );
  try {
    await automation.updatePolicy({
      projectId: DEMO_IDS.project,
      enabled: true,
      enabledSignals: [
        "blocker",
        "dependency_change",
        "spec_review_stale",
        "coordination_unresolved",
        "project_work_risk",
      ],
      staleSpecReviewHours: 24,
      unresolvedCoordinationHours: 12,
      actorId: DEMO_IDS.principals.alex,
    });
    await automation.detectMeaningfulSignals(now.toISOString());
    const signals = await automation.listSignals(DEMO_IDS.project);
    const example =
      signals.find(({ signal }) => signal.kind === "project_work_risk") ??
      signals[0];
    if (example) {
      await automation.openCoordination(
        example.signal.id,
        offsetIso(now, 5_000),
      );
    }
  } finally {
    await automation.close();
  }
}

export async function resetDemoData(target: DemoTarget): Promise<{
  status: "reset" | "already_empty";
  tableCount: number;
}> {
  await migrateDatabase(target.databaseUrl);
  const pool = new Pool({ connectionString: target.databaseUrl });
  try {
    const state = await inspectDemoOwnership(pool);
    if (state === "empty") return { status: "already_empty", tableCount: 0 };
    const tables = await pool.query<{ tablename: string }>(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname='public'
       ORDER BY tablename`,
    );
    const names = tables.rows
      .map((row) => row.tablename)
      .filter((name) => name !== "__drizzle_migrations");
    if (names.length > 0) {
      await pool.query(
        `TRUNCATE TABLE ${names.map(quoteIdentifier).join(", ")} RESTART IDENTITY CASCADE`,
      );
    }
    return { status: "reset", tableCount: names.length };
  } finally {
    await pool.end();
  }
}

async function inspectDemoOwnership(
  pool: Pool,
): Promise<"empty" | "partial" | "seeded"> {
  const organizations = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM organizations ORDER BY id",
  );
  const users = await pool.query<{ email: string }>(
    `SELECT email FROM "user" ORDER BY email`,
  );
  const principals = await pool.query<{ id: string; email: string | null }>(
    `SELECT p.id, u.email
     FROM principals p
     LEFT JOIN auth_principals ap ON ap.principal_id = p.id
     LEFT JOIN "user" u ON u.id = ap.auth_user_id
     ORDER BY p.id`,
  );
  const allowedPrincipalIds = new Set<string>([
    ...DEMO_USERS.map((user) => user.principalId),
    DEMO_IDS.principals.standIn,
    ...CANONICAL_RUNTIME_PRINCIPAL_IDS,
  ]);
  const hasUnknownIdentity =
    users.rows.some((user) => !user.email.endsWith(DEMO_EMAIL_SUFFIX)) ||
    principals.rows.some(
      (principal) =>
        !allowedPrincipalIds.has(principal.id) &&
        !principal.email?.endsWith(DEMO_EMAIL_SUFFIX),
    );
  if (organizations.rows.length === 0) {
    if (users.rowCount || principals.rowCount || hasUnknownIdentity) {
      throw new Error(
        "The selected database contains identities without the Intero Demo organization; refusing to treat it as disposable.",
      );
    }
    return "empty";
  }
  if (
    organizations.rows.length !== 1 ||
    organizations.rows[0]?.id !== DEMO_IDS.organization ||
    organizations.rows[0]?.name !== DEMO_ORGANIZATION_NAME ||
    hasUnknownIdentity
  ) {
    throw new Error(
      "The selected database contains non-Demo Intero data; refusing to modify it.",
    );
  }
  const project = await pool.query<{ id: string }>(
    "SELECT id FROM projects WHERE id=$1",
    [DEMO_IDS.project],
  );
  const marker = await pool.query<{ version: number }>(
    `SELECT (metadata->>'demoSeedVersion')::int AS version
     FROM activity_events
     WHERE organization_id=$1 AND event_type='demo.seed.completed'
     ORDER BY sequence DESC
     LIMIT 1`,
    [DEMO_IDS.organization],
  );
  return project.rowCount && marker.rows[0]?.version === DEMO_SEED_VERSION
    ? "seeded"
    : "partial";
}

async function bootstrapDemoIdentities(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    for (const user of DEMO_USERS) {
      await client.query(
        `INSERT INTO principals (id,display_name,avatar_tone,kind)
         VALUES ($1,$2,$3,'human')`,
        [user.principalId, user.displayName, user.avatarTone],
      );
      await client.query(
        `INSERT INTO "user"
          (id,name,email,"emailVerified","createdAt","updatedAt")
         VALUES ($1,$2,$3,true,now(),now())`,
        [user.authUserId, user.displayName, user.email],
      );
      await client.query(
        `INSERT INTO auth_principals (auth_user_id,principal_id)
         VALUES ($1,$2)`,
        [user.authUserId, user.principalId],
      );
      await client.query(
        `INSERT INTO account
          (id,"accountId","providerId","userId",password,"createdAt","updatedAt")
         VALUES ($1,$2,'credential',$2,$3,now(),now())`,
        [`intero-demo-credential-${user.key}`, user.authUserId, passwordHash],
      );
    }
    await client.query(
      `INSERT INTO principals (id,display_name,kind)
       VALUES ($1,'Demo Stand-in','stand_in')`,
      [DEMO_IDS.principals.standIn],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function insertAdditionalTeam(
  pool: Pool,
  team: PilotTeam,
): Promise<void> {
  await pool.query(
    `INSERT INTO pilot_teams
      (id,organization_id,name,data,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$5)`,
    [
      team.id,
      team.organizationId,
      team.name,
      JSON.stringify(team),
      team.createdAt,
    ],
  );
}

async function seedMembershipsAndInvitations(
  store: NormalizedPostgresPilotStore,
  now: Date,
): Promise<void> {
  await acceptDemoInvitation(store, {
    id: DEMO_IDS.invitation.priyaProduct,
    teamId: DEMO_IDS.teams.product,
    user: DEMO_USERS[1],
    now,
  });
  await acceptDemoInvitation(store, {
    id: DEMO_IDS.invitation.morganProduct,
    teamId: DEMO_IDS.teams.product,
    user: DEMO_USERS[2],
    now,
  });
  await acceptDemoInvitation(store, {
    id: DEMO_IDS.invitation.jordanProduct,
    teamId: DEMO_IDS.teams.product,
    user: DEMO_USERS[3],
    now,
  });
  await acceptDemoInvitation(store, {
    id: DEMO_IDS.invitation.alexPlatform,
    teamId: DEMO_IDS.teams.platform,
    user: DEMO_USERS[0],
    now,
  });
  await acceptDemoInvitation(store, {
    id: DEMO_IDS.invitation.priyaPlatform,
    teamId: DEMO_IDS.teams.platform,
    user: DEMO_USERS[1],
    now,
  });
  await acceptDemoInvitation(store, {
    id: DEMO_IDS.invitation.jordanPlatform,
    teamId: DEMO_IDS.teams.platform,
    user: DEMO_USERS[3],
    now,
  });
  await store.updateTeamMemberRole({
    teamId: DEMO_IDS.teams.product,
    memberId: DEMO_IDS.principals.priya,
    role: "leader",
    principalId: DEMO_IDS.principals.alex,
    now: now.toISOString(),
  });
  await store.updateTeamMemberRole({
    teamId: DEMO_IDS.teams.platform,
    memberId: DEMO_IDS.principals.jordan,
    role: "leader",
    principalId: DEMO_IDS.principals.alex,
    now: now.toISOString(),
  });
  const createdAt = offsetIso(now, -2 * 86_400_000);
  const pendingToken = demoPendingInvitationToken();
  const pending = PilotTeamInvitation.parse({
    id: DEMO_IDS.invitation.pending,
    organizationId: DEMO_IDS.organization,
    teamId: DEMO_IDS.teams.product,
    displayName: "Casey Nguyen",
    email: `casey${DEMO_EMAIL_SUFFIX}`,
    tokenHash: sha256(pendingToken),
    createdBy: DEMO_IDS.principals.alex,
    expiresAt: offsetIso(now, 7 * 86_400_000),
    createdAt,
    updatedAt: createdAt,
  });
  await store.createInvitation(pending, DEMO_IDS.principals.alex);
}

async function acceptDemoInvitation(
  store: NormalizedPostgresPilotStore,
  input: {
    id: string;
    teamId: string;
    user: (typeof DEMO_USERS)[number];
    now: Date;
  },
): Promise<void> {
  const token = `intero-demo-invite-${input.user.key}-${input.teamId.slice(-3)}`;
  const createdAt = offsetIso(input.now, -20 * 86_400_000);
  const acceptedAt = offsetIso(input.now, -19 * 86_400_000);
  const invitation = PilotTeamInvitation.parse({
    id: input.id,
    organizationId: DEMO_IDS.organization,
    teamId: input.teamId,
    displayName: input.user.displayName,
    email: input.user.email,
    tokenHash: sha256(token),
    createdBy: DEMO_IDS.principals.alex,
    expiresAt: offsetIso(input.now, 30 * 86_400_000),
    createdAt,
    updatedAt: createdAt,
  });
  await store.createInvitation(invitation, DEMO_IDS.principals.alex);
  await store.acceptInvitation({
    tokenHash: invitation.tokenHash,
    email: input.user.email,
    principalId: input.user.principalId,
    now: acceptedAt,
  });
}

async function seedDirectMessages(
  store: NormalizedPostgresPilotStore,
  now: Date,
): Promise<void> {
  const thread = await store.getOrCreateDirectMessage({
    id: DEMO_IDS.dm.thread,
    teamId: DEMO_IDS.teams.product,
    principalId: DEMO_IDS.principals.alex,
    peerId: DEMO_IDS.principals.morgan,
    now: offsetIso(now, -4 * 3_600_000),
  });
  await store.sendDirectMessage({
    id: DEMO_IDS.dm.first,
    threadId: thread.id,
    senderId: DEMO_IDS.principals.alex,
    sequence: 1,
    body: "发布检查清单已经整理好了。下午评审前，你能帮忙验证一下空状态和重连提示吗？",
    createdAt: offsetIso(now, -3.5 * 3_600_000),
  });
  await store.sendDirectMessage({
    id: DEMO_IDS.dm.second,
    threadId: thread.id,
    senderId: DEMO_IDS.principals.morgan,
    sequence: 2,
    body: "可以。我会覆盖空状态、加载状态和重连状态，并把截图和结果补到 Work Item 里。",
    createdAt: offsetIso(now, -3.25 * 3_600_000),
  });
  const platformThread = await store.getOrCreateDirectMessage({
    id: DEMO_IDS.dm.platformThread,
    teamId: DEMO_IDS.teams.platform,
    principalId: DEMO_IDS.principals.alex,
    peerId: DEMO_IDS.principals.priya,
    now: offsetIso(now, -95 * 60_000),
  });
  await store.sendDirectMessage({
    id: DEMO_IDS.dm.platformFirst,
    threadId: platformThread.id,
    senderId: DEMO_IDS.principals.priya,
    sequence: 1,
    body: "灰度发布还卡在一个跨团队权限关系上。Jordan 正在补 Project-Team 绑定，修复后可以继续吗？",
    createdAt: offsetIso(now, -90 * 60_000),
  });
  await store.sendDirectMessage({
    id: DEMO_IDS.dm.platformSecond,
    threadId: platformThread.id,
    senderId: DEMO_IDS.principals.alex,
    sequence: 2,
    body: "先别自动继续。让 Jordan 跑完租户隔离校验，把结果放进 Coordination，我确认后再推进。",
    createdAt: offsetIso(now, -82 * 60_000),
  });
  await store.sendDirectMessage({
    id: DEMO_IDS.dm.platformThird,
    threadId: platformThread.id,
    senderId: DEMO_IDS.principals.priya,
    sequence: 3,
    body: "收到。我会等你的确认，并保留既定的回滚阈值检查。",
    createdAt: offsetIso(now, -76 * 60_000),
  });
}

async function seedCanonicalCollaboration(
  store: PostgresPlatformStore,
  pool: Pool,
  now: Date,
): Promise<void> {
  await seedPersistentTeamConversation(store, now);
  await seedGroupConversation(store, now);
  await seedStandInConversation(store, now);
  await seedActionInbox(store, pool, now);
}

async function seedPersistentTeamConversation(
  store: PostgresPlatformStore,
  now: Date,
): Promise<void> {
  const thread = ConversationThread.parse({
    id: DEMO_IDS.conversations.productTeamThread,
    kind: "room",
    title: "产品体验 · 团队频道",
    participantIds: [
      DEMO_IDS.principals.alex,
      DEMO_IDS.principals.priya,
      DEMO_IDS.principals.morgan,
      DEMO_IDS.principals.jordan,
    ],
    standInIds: [],
    accessMode: "agent_readable",
    priorHistoryGranted: false,
    sequence: 0,
    createdAt: offsetIso(now, -4 * 86_400_000),
  });
  await store.createThread(thread);
  const messages = [
    {
      senderId: DEMO_IDS.principals.priya,
      body: "大家早，今天产品体验组继续看统一发布控制台。请把日常进展留在这里，临时联调问题再单独开讨论。",
    },
    {
      senderId: DEMO_IDS.principals.morgan,
      body: "我会先走一遍浏览器端的空状态、重连和窄屏布局，完成后把可复现步骤发到项目 Work Item。",
    },
    {
      senderId: DEMO_IDS.principals.jordan,
      body: "跨团队权限关系我来跟进；如果租户隔离校验有异常，我会在 Coordination 里明确阻塞和需要确认的人。",
    },
    {
      senderId: DEMO_IDS.principals.alex,
      body: "收到。这里作为产品体验组的长期沟通频道，发布决定仍回到对应项目和 Action Inbox 确认。",
    },
  ] as const;
  for (const [index, message] of messages.entries()) {
    await store.appendMessage(thread.id, {
      id: DEMO_IDS.conversations.productTeamMessages[
        index
      ] as ThreadMessage["id"],
      senderId: message.senderId,
      body: message.body,
      createdAt: offsetIso(now, (-3 * 24 * 60 + index * 95) * 60_000),
    });
  }
}

async function seedGroupConversation(
  store: PostgresPlatformStore,
  now: Date,
): Promise<void> {
  const thread = ConversationThread.parse({
    id: DEMO_IDS.conversations.groupThread,
    kind: "human_group",
    title: "统一发布 · 今日联调",
    participantIds: [
      DEMO_IDS.principals.alex,
      DEMO_IDS.principals.priya,
      DEMO_IDS.principals.morgan,
      DEMO_IDS.principals.jordan,
      DEMO_IDS.principals.standIn,
    ],
    standInIds: [DEMO_IDS.principals.standIn],
    accessMode: "agent_readable",
    priorHistoryGranted: false,
    sequence: 0,
    createdAt: offsetIso(now, -140 * 60_000),
  });
  await store.createThread(thread);
  const messages = [
    {
      senderId: DEMO_IDS.principals.alex,
      body: "今天 15:00 前把统一发布控制台的联调收口。这里先对齐灰度、回滚和浏览器验证三件事。",
    },
    {
      senderId: DEMO_IDS.principals.priya,
      body: "10% 灰度的计划和回滚阈值都准备好了，目前只差跨团队权限关系确认。",
    },
    {
      senderId: DEMO_IDS.principals.jordan,
      body: "我来补 Project-Team 关联并重跑租户隔离校验，预计午饭前给结果。",
    },
    {
      senderId: DEMO_IDS.principals.morgan,
      body: "我会在权限修复后验证空状态、加载状态和断线重连，截图直接放到 Work Item。",
    },
    {
      senderId: DEMO_IDS.principals.standIn,
      body: "已整理：Jordan 负责权限关系，Morgan 负责浏览器验证，Priya 在校验通过后推进 10% 灰度；需要 Alex 确认最终发布动作。",
    },
  ] as const;
  for (const [index, message] of messages.entries()) {
    await store.appendMessage(thread.id, {
      id: DEMO_IDS.conversations.groupMessages[index] as ThreadMessage["id"],
      senderId: message.senderId,
      body: message.body,
      createdAt: offsetIso(now, (-132 + index * 11) * 60_000),
    });
  }
}

async function seedStandInConversation(
  store: PostgresPlatformStore,
  now: Date,
): Promise<void> {
  const thread = ConversationThread.parse({
    id: DEMO_IDS.conversations.standInThread,
    kind: "stand_in",
    title: "Alex 的替身",
    participantIds: [DEMO_IDS.principals.alex, DEMO_IDS.principals.standIn],
    standInIds: [DEMO_IDS.principals.standIn],
    accessMode: "agent_readable",
    priorHistoryGranted: false,
    sequence: 0,
    createdAt: offsetIso(now, -62 * 60_000),
  });
  await store.createThread(thread);
  const messages = [
    {
      senderId: DEMO_IDS.principals.alex,
      body: "帮我总结一下统一发布控制台现在的进展，以及今天需要我决定什么。",
    },
    {
      senderId: DEMO_IDS.principals.standIn,
      body: "发布健康面板已经接入队列、实时状态和依赖就绪度；10% 灰度仍被一个跨团队权限关系阻塞。今天需要你确认：权限校验通过后是否按既定阈值推进灰度。",
    },
    {
      senderId: DEMO_IDS.principals.alex,
      body: "Morgan 的浏览器验证做到哪一步了？",
    },
    {
      senderId: DEMO_IDS.principals.standIn,
      body: "空状态和加载状态已经通过，重连场景还差一次延迟事件验证。依据来自 Morgan 最近提交的 validation_completed 检查点。",
    },
    {
      senderId: DEMO_IDS.principals.standIn,
      body: "我已把跨团队权限缺口整理成 Coordination 请求，等待 Jordan 确认责任和修复结果。",
    },
    {
      senderId: DEMO_IDS.principals.standIn,
      body: "我还把“是否推进 10% 灰度发布”放进 Action Inbox，发布动作不会自动执行。",
    },
  ] as const;
  for (const [index, message] of messages.entries()) {
    await store.appendMessage(thread.id, {
      id: DEMO_IDS.conversations.standInMessages[index] as ThreadMessage["id"],
      senderId: message.senderId,
      body: message.body,
      createdAt: offsetIso(now, (-58 + index * 7) * 60_000),
    });
  }
}

async function seedActionInbox(
  store: PostgresPlatformStore,
  pool: Pool,
  now: Date,
): Promise<void> {
  const thread = ConversationThread.parse({
    id: DEMO_IDS.conversations.actionThread,
    kind: "coordination",
    title: "10% 灰度发布确认",
    participantIds: [
      DEMO_IDS.principals.alex,
      DEMO_IDS.principals.priya,
      DEMO_IDS.principals.jordan,
      DEMO_IDS.principals.standIn,
    ],
    standInIds: [DEMO_IDS.principals.standIn],
    accessMode: "agent_readable",
    priorHistoryGranted: false,
    sequence: 0,
    createdAt: offsetIso(now, -49 * 60_000),
  });
  await store.createThread(thread);

  const confirmationGrant = CapabilityGrant.parse({
    id: DEMO_IDS.conversations.confirmationGrant,
    principalId: DEMO_IDS.principals.standIn,
    actions: ["request_coordination"],
    organizationId: DEMO_IDS.organization,
    projectIds: [DEMO_IDS.project],
    workstreamIds: [],
    resourceScopes: ["project/release"],
    requiresConfirmation: ["request_coordination"],
    expiresAt: offsetIso(now, 30 * 86_400_000),
    policyVersion: "demo-policy-v2",
  });
  await store.putGrant(confirmationGrant);
  await store.coordinate(
    ActionEnvelope.parse({
      schemaVersion: 1,
      operationId: DEMO_IDS.conversations.confirmationOperation,
      action: "coordination_request",
      actorId: DEMO_IDS.principals.standIn,
      authorityGrantId: confirmationGrant.id,
      policyVersion: confirmationGrant.policyVersion,
      threadId: thread.id,
      humanMessage:
        "跨团队权限校验通过后，是否按既定回滚阈值推进 10% 灰度发布？",
      resourceScope: ["project/release/rollout"],
      relatedClaimIds: [],
      evidenceRefs: ["run:staging-rollout-42", "spec:tenant-visibility"],
      requestedActions: [],
      createdAt: offsetIso(now, -41 * 60_000),
    }),
  );

  const scopeGrant = CapabilityGrant.parse({
    id: DEMO_IDS.conversations.scopeGrant,
    principalId: DEMO_IDS.principals.standIn,
    actions: ["request_coordination"],
    organizationId: DEMO_IDS.organization,
    projectIds: [DEMO_IDS.project],
    workstreamIds: [],
    resourceScopes: ["project/release"],
    requiresConfirmation: [],
    expiresAt: offsetIso(now, 30 * 86_400_000),
    policyVersion: "demo-policy-v2",
  });
  await store.putGrant(scopeGrant);
  await store.coordinate(
    ActionEnvelope.parse({
      schemaVersion: 1,
      operationId: DEMO_IDS.conversations.scopeOperation,
      action: "coordination_request",
      actorId: DEMO_IDS.principals.standIn,
      authorityGrantId: scopeGrant.id,
      policyVersion: scopeGrant.policyVersion,
      threadId: thread.id,
      humanMessage: "需要查看尚未授权的客户生产日志来解释异常。",
      resourceScope: ["project/raw-production-logs"],
      relatedClaimIds: [],
      evidenceRefs: [],
      requestedActions: [],
      createdAt: offsetIso(now, -35 * 60_000),
    }),
  );

  await pool.query(
    `UPDATE action_inbox
     SET title = CASE dedupe_key
       WHEN $1 THEN '请确认是否推进 10% 灰度发布'
       WHEN $2 THEN '替身请求扩大数据范围'
       ELSE title
     END,
     detail = CASE dedupe_key
       WHEN $1 THEN '前置校验完成后仍需负责人确认；替身不会自动执行发布动作。'
       WHEN $2 THEN '当前授权不包含客户生产日志。请决定是扩大范围，还是继续只使用结构化验证结果。'
       ELSE detail
     END
     WHERE organization_id=$3 AND dedupe_key IN ($1,$2)`,
    [
      `coordination:${DEMO_IDS.conversations.confirmationOperation}`,
      `coordination:${DEMO_IDS.conversations.scopeOperation}`,
      DEMO_IDS.organization,
    ],
  );
}

async function seedPilotWorkState(
  store: NormalizedPostgresPilotStore,
  now: Date,
): Promise<string> {
  const inputs = [
    {
      ownerId: DEMO_IDS.principals.alex,
      bindingId: "019f9a00-0000-7000-8000-000000000601",
      ticketId: "019f9a00-0000-7000-8000-000000000611",
      client: "codex" as const,
      occurredAt: offsetIso(now, -8 * 60_000),
      checkpoint: {
        schemaVersion: 2 as const,
        clientEventId: "demo-release-checkpoint-alex-v2",
        projectId: DEMO_IDS.project,
        eventType: "artifact_produced" as const,
        workstream: {
          key: "release-observability",
          title: "发布健康观测面板",
          phase: "implementing" as const,
        },
        narrative: {
          currentFocus: "收尾发布健康面板，并验证依赖降级时的展示行为。",
          completedOutcome:
            "已经把队列健康度、实时连接状态和部署就绪度接入同一个安全的运维视图。",
          evidence: [
            "PR #184 包含面板实现",
            "集成测试覆盖健康和依赖降级两种状态",
          ],
          nextStep: "完成浏览器可访问性检查，然后交给 Morgan 做验收。",
          collaboration: {
            needed: false,
            request: "",
            requestedFrom: "",
          },
        },
        evidenceRefs: ["pr:184", "validation:release-health"],
      },
      summary:
        "发布健康面板已整合队列、实时连接和就绪度信号；下一步是浏览器可访问性验证。",
    },
    {
      ownerId: DEMO_IDS.principals.priya,
      bindingId: "019f9a00-0000-7000-8000-000000000602",
      ticketId: "019f9a00-0000-7000-8000-000000000612",
      client: "claude-code" as const,
      occurredAt: offsetIso(now, -47 * 60_000),
      checkpoint: {
        schemaVersion: 2 as const,
        clientEventId: "demo-rollout-blocker-priya-v2",
        projectId: DEMO_IDS.project,
        eventType: "blocker_raised" as const,
        workstream: {
          key: "progressive-rollout",
          title: "渐进式发布控制",
          phase: "blocked" as const,
        },
        narrative: {
          currentFocus: "使用新的租户级权限检查验证第一批 10% 灰度发布。",
          completedOutcome:
            "灰度计划和回滚阈值已经成文，并关联到对应 Feature。",
          evidence: [
            "五种租户形态中已有四种通过 Staging 验证",
            "一个跨团队项目仍返回不完整的权限关系",
          ],
          nextStep: "确认缺失的跨团队关系，重新运行 Staging，再继续灰度。",
          collaboration: {
            needed: true,
            request: "请确认是否由开发者平台团队补齐缺失的 Project-Team 关系。",
            requestedFrom: "Jordan Kim",
          },
        },
        evidenceRefs: ["run:staging-rollout-42", "spec:tenant-visibility"],
      },
      summary:
        "渐进式发布因一个缺失的跨团队权限关系暂停，其余 Staging 检查已经通过。",
      coordination: {
        safeContext:
          "10% 灰度发布被阻塞，因为一个跨团队项目缺少预期的 Project-Team 权限关系。",
        candidateNextSteps: [
          "Jordan 确认并补齐 Project-Team 关系。",
          "Priya 重新运行租户可见性检查。",
          "检查通过后由 Alex 确认是否继续灰度。",
        ],
      },
    },
    {
      ownerId: DEMO_IDS.principals.morgan,
      bindingId: "019f9a00-0000-7000-8000-000000000603",
      ticketId: "019f9a00-0000-7000-8000-000000000613",
      client: "opencode" as const,
      occurredAt: offsetIso(now, -3 * 3_600_000),
      checkpoint: {
        schemaVersion: 2 as const,
        clientEventId: "demo-empty-state-validation-morgan-v2",
        projectId: DEMO_IDS.project,
        eventType: "validation_completed" as const,
        workstream: {
          key: "empty-state-validation",
          title: "空状态与重连验证",
          phase: "validating" as const,
        },
        narrative: {
          currentFocus:
            "在两个独立浏览器上下文中检查 canonical 看板的空状态、加载状态和重连状态。",
          completedOutcome: "桌面宽度和紧凑宽度下的空状态、加载状态均已验证。",
          evidence: [
            "浏览器验证覆盖两个独立 Better Auth 会话",
            "页面未出现独立 Pilot 布局或全局身份选择器",
          ],
          nextStep: "完成重连场景，并把最终截图附到验证 Work Item。",
          collaboration: {
            needed: false,
            request: "",
            requestedFrom: "",
          },
        },
        evidenceRefs: ["browser:demo-empty-loading"],
      },
      summary:
        "两个已登录浏览器会话中的空状态和加载状态均已通过；还需补齐重连证据。",
    },
  ] as const;

  let coordinationThreadId = "";
  for (const input of inputs) {
    const ticketHash = sha256(`demo-ticket-${input.bindingId}`);
    const ticket = PilotAgentTicket.parse({
      id: input.ticketId,
      projectId: DEMO_IDS.project,
      ownerId: input.ownerId,
      client: input.client,
      preferredLanguage: "zh-CN",
      ticketHash,
      expiresAt: offsetIso(now, 24 * 3_600_000),
      createdAt: offsetIso(now, -24 * 3_600_000),
    });
    await store.createAgentTicket(ticket);
    const binding = PilotAgentBinding.parse({
      id: input.bindingId,
      projectId: DEMO_IDS.project,
      ownerId: input.ownerId,
      client: input.client,
      name: `Demo ${input.client} connection`,
      workspaceId: DEMO_IDS.workspace,
      preferredLanguage: "zh-CN",
      credentialHash: sha256(`demo-credential-${input.bindingId}`),
      createdAt: offsetIso(now, -23 * 3_600_000),
      lastSeenAt: input.occurredAt,
    });
    await store.exchangeAgentTicket(ticketHash, binding, now.toISOString());
    const checkpoint = PilotCheckpointInput.parse({
      ...input.checkpoint,
      occurredAt: input.occurredAt,
    });
    const ingested = await store.ingestCheckpoint(
      binding,
      checkpoint,
      offsetIso(new Date(input.occurredAt), 15_000),
    );
    const workerId = "intero-demo-deterministic-gateway";
    await store.claimStandInJob({
      jobKey: checkpoint.clientEventId,
      workerId,
      attempt: 1,
      maxAttempts: 1,
      now: offsetIso(new Date(input.occurredAt), 20_000),
    });
    const output: PilotStandInOutput = {
      safeSummary: input.summary,
      narrative: checkpoint.narrative,
      coordination: {
        shouldOpen: Boolean("coordination" in input),
        safeContext:
          "coordination" in input ? input.coordination.safeContext : "",
        candidateNextSteps:
          "coordination" in input
            ? [...input.coordination.candidateNextSteps]
            : [],
      },
    };
    const completed = await store.completeStandInJob({
      jobKey: checkpoint.clientEventId,
      workerId,
      actorId: input.ownerId,
      projectId: DEMO_IDS.project,
      workStateId: ingested.workState.id,
      output,
      ...("coordination" in input
        ? {
            coordination: {
              safeContext: input.coordination.safeContext,
              candidateNextSteps: [...input.coordination.candidateNextSteps],
            },
          }
        : {}),
      now: offsetIso(new Date(input.occurredAt), 30_000),
    });
    coordinationThreadId =
      completed.coordinationThread?.id ?? coordinationThreadId;
  }
  return coordinationThreadId;
}

async function seedProjectWork(
  store: PostgresProjectWorkStore,
  projectId: ProjectId,
  coordinationThreadId: string,
  now: Date,
): Promise<void> {
  const alex: WorkActor = {
    principalId: DEMO_IDS.principals.alex,
    kind: "human",
    source: "web",
  };
  const priya: WorkActor = {
    principalId: DEMO_IDS.principals.priya,
    kind: "human",
    source: "web",
  };
  const morgan: WorkActor = {
    principalId: DEMO_IDS.principals.morgan,
    kind: "human",
    source: "web",
  };
  const jordan: WorkActor = {
    principalId: DEMO_IDS.principals.jordan,
    kind: "human",
    source: "web",
  };
  const agent: WorkActor = {
    principalId: DEMO_IDS.principals.alex,
    kind: "agent",
    source: "direct_cloud_mcp",
  };
  const today = localDate(now, "Asia/Shanghai");
  const ended = await store.createProgramIncrement(
    {
      projectId,
      startDate: addIsoDays(today, -84),
      sprintCount: 2,
      sprintDurationWeeks: 2,
      timezone: "Asia/Shanghai",
    },
    alex,
  );
  const current = await store.createProgramIncrement(
    {
      projectId,
      startDate: addIsoDays(today, -7),
      sprintCount: 3,
      sprintDurationWeeks: 2,
      timezone: "Asia/Shanghai",
    },
    alex,
  );

  const epic = await store.createEpic(
    {
      projectId,
      title: "可靠的跨团队发布",
      description:
        "让一次横跨产品体验与开发者平台团队的发布过程可理解、可评审、可恢复。",
    },
    alex,
  );

  await store.updateSpecReviewPolicy(
    projectId,
    {
      requiredConfirmations: 1,
      otherMemberAgentsCount: true,
      authorSelfConfirmation: false,
    },
    alex,
  );
  let releaseSpec = await store.createSpecVersion({
    projectId,
    specId: "019f9a00-0000-7000-8000-000000000901",
    title: "租户安全的渐进式发布",
    markdown:
      "# 租户安全的渐进式发布\n\n## 目标\n在不跨越项目可见性边界的前提下，先向 10% 的组织发布。\n\n## 护栏\n- 必须存在显式的 Project-Team 关系。\n- 权限检查结果不一致时立即停止。\n- 回滚应在五分钟内完成。\n\n## 验证\n继续发布前，同时验证主团队和参与团队。",
    changeSummary: "建立第一版灰度发布约束",
    affectedScopes: ["authorization", "release-control"],
    actor: alex,
    idempotencyKey: "demo-spec-rollout-v1",
  });
  const releaseV1 = releaseSpec.spec.currentRevisionId;
  releaseSpec = await store.requestSpecReview(
    projectId,
    releaseSpec.spec.id,
    [DEMO_IDS.principals.priya, DEMO_IDS.principals.jordan],
    alex,
  );
  releaseSpec = await store.addSpecComment({
    projectId,
    specId: releaseSpec.spec.id,
    revisionId: releaseV1,
    lineStart: 6,
    lineEnd: 8,
    selection: "必须存在显式的 Project-Team 关系。",
    body: "请把跨团队关系检查明确写成灰度发布的前置门槛。",
    actor: priya,
  });
  const resolvedThread = releaseSpec.commentThreads.at(-1)!;
  const resolvedRoot = resolvedThread.comments.at(-1)!;
  await store.addSpecComment({
    projectId,
    specId: releaseSpec.spec.id,
    revisionId: releaseV1,
    threadId: resolvedThread.id,
    parentId: resolvedRoot.id,
    lineStart: resolvedThread.lineStart,
    lineEnd: resolvedThread.lineEnd,
    body: "已经放到护栏第一条，并同步加入 Staging 检查清单。",
    actor: alex,
  });
  await store.setSpecCommentStatus({
    projectId,
    threadId: resolvedThread.id,
    status: "resolved",
  });
  await store.confirmSpec(projectId, releaseSpec.spec.id, priya);
  releaseSpec = await store.createSpecVersion({
    projectId,
    specId: releaseSpec.spec.id,
    title: releaseSpec.spec.title,
    markdown:
      "# 租户安全的渐进式发布\n\n## 目标\n在不跨越项目可见性边界的前提下，先向 10% 的组织发布。\n\n## 护栏\n- 灰度前必须存在显式的 Project-Team 关系。\n- 权限检查结果不一致时立即停止。\n- 回滚应在五分钟内完成。\n\n## 验证\n同时验证主团队和参与团队，并把权限关系审计记录作为完成证据。",
    changeSummary: "明确跨团队发布门槛和完成证据",
    affectedScopes: ["authorization", "release-control", "audit"],
    actor: agent,
    idempotencyKey: "demo-spec-rollout-v2",
  });
  await store.requestSpecReview(
    projectId,
    releaseSpec.spec.id,
    [DEMO_IDS.principals.morgan],
    agent,
  );
  await store.addSpecComment({
    projectId,
    specId: releaseSpec.spec.id,
    revisionId: releaseSpec.spec.currentRevisionId,
    lineStart: 11,
    lineEnd: 11,
    selection: "把权限关系审计记录作为完成证据",
    body: "评审人应该以哪一份产物作为正式的权限关系审计记录？",
    actor: morgan,
  });

  let activitySpec = await store.createSpecVersion({
    projectId,
    specId: "019f9a00-0000-7000-8000-000000000902",
    title: "发布动态与重连约定",
    markdown:
      "# 发布动态与重连约定\n\n## 状态\nCanonical 视图需要展示加载中、实时、降级和重连中四种状态。\n\n## 重连\n从最后一个已确认的项目事件继续，不得重复展示同一条更新。",
    changeSummary: "建立第一版实时动态约定",
    affectedScopes: ["realtime", "team-pulse"],
    actor: priya,
    idempotencyKey: "demo-spec-activity-v1",
  });
  activitySpec = await store.requestSpecReview(
    projectId,
    activitySpec.spec.id,
    [DEMO_IDS.principals.morgan, DEMO_IDS.principals.jordan],
    priya,
  );
  await store.addSpecComment({
    projectId,
    specId: activitySpec.spec.id,
    revisionId: activitySpec.spec.currentRevisionId,
    lineStart: 6,
    lineEnd: 6,
    selection: "最后一个已确认的项目事件",
    body: "请明确游标是按项目维护，还是按用户会话维护。",
    actor: jordan,
  });

  const rolloutFeature = await store.createFeature(
    {
      projectId,
      epicId: epic.id,
      title: "渐进式发布控制",
      description: "通过租户安全门槛，对发布进行分阶段、观测、暂停和恢复。",
      stage: "in_development",
      ownerId: DEMO_IDS.principals.priya,
      piId: current.pi.id,
      sprintId: current.sprints[0]!.id,
    },
    priya,
  );
  await store.createFeature(
    {
      projectId,
      title: "键盘优先的评审快捷操作",
      description: "一个可以直接执行、暂时没有拆分 Work Item 的 Feature。",
      stage: "planned",
      ownerId: DEMO_IDS.principals.morgan,
      piId: current.pi.id,
    },
    morgan,
  );
  await store.createFeature(
    {
      projectId,
      epicId: epic.id,
      title: "发布证据归档",
      description:
        "一个已发布的 Feature，用来展示不依赖任务层级推断的完成结果。",
      stage: "released",
      ownerId: DEMO_IDS.principals.jordan,
      piId: ended.pi.id,
    },
    jordan,
  );

  const carryover = await store.createWorkItem(
    {
      projectId,
      featureId: rolloutFeature.id,
      title: "修复部署后的重连游标",
      description:
        "服务滚动部署、浏览器重新连接时，保留最后一个已确认的项目事件。",
      status: "in_progress",
      ownerId: DEMO_IDS.principals.jordan,
      priority: "P1",
      points: 5,
      piId: ended.pi.id,
      sprintId: ended.sprints[0]!.id,
      carryover: false,
      coordinationThreadIds: [],
    },
    jordan,
    "demo-work-carryover",
  );
  await store.closeSprint(projectId, ended.sprints[0]!.id, alex);

  const dependency = await store.createWorkItem(
    {
      projectId,
      title: "补齐跨团队权限关系",
      description: "补齐灰度发布门槛要求的显式 Project-Team 关系。",
      status: "todo",
      ownerId: DEMO_IDS.principals.jordan,
      priority: "P0",
      points: 2,
      piId: current.pi.id,
      sprintId: current.sprints[0]!.id,
      carryover: false,
      coordinationThreadIds: coordinationThreadId
        ? [coordinationThreadId as never]
        : [],
    },
    jordan,
    "demo-work-auth-tuple",
  );
  const active = await store.createWorkItem(
    {
      projectId,
      featureId: rolloutFeature.id,
      title: "执行 10% 租户安全灰度",
      description: "只有主团队和参与团队的权限检查结果一致时，才继续推进发布。",
      status: "in_progress",
      ownerId: DEMO_IDS.principals.priya,
      specId: releaseSpec.spec.id,
      priority: "P0",
      points: 8,
      piId: current.pi.id,
      sprintId: current.sprints[0]!.id,
      carryover: false,
      coordinationThreadIds: coordinationThreadId
        ? [coordinationThreadId as never]
        : [],
    },
    agent,
    "demo-work-rollout",
  );
  const ready = await store.createWorkItem(
    {
      projectId,
      title: "验证看板空状态与重连状态",
      description:
        "在独立登录的浏览器上下文中验证 canonical 加载、空、降级和重连状态。",
      status: "ready_for_test",
      ownerId: DEMO_IDS.principals.morgan,
      specId: activitySpec.spec.id,
      priority: "P1",
      points: 3.5,
      piId: current.pi.id,
      sprintId: current.sprints[0]!.id,
      carryover: false,
      coordinationThreadIds: [],
    },
    morgan,
    "demo-work-browser-validation",
  );
  const done = await store.createWorkItem(
    {
      projectId,
      title: "记录回滚阈值",
      description: "记录触发停止发布的队列、错误率和权限检查阈值。",
      status: "ready_for_test",
      ownerId: DEMO_IDS.principals.alex,
      specId: releaseSpec.spec.id,
      priority: "P2",
      points: 1,
      piId: current.pi.id,
      sprintId: current.sprints[0]!.id,
      carryover: false,
      coordinationThreadIds: [],
    },
    alex,
    "demo-work-rollback-thresholds",
  );
  await store.updateWorkItem(
    projectId,
    done.id,
    {
      status: "done",
      completionEvidence:
        "运行手册中的“停止条件”已经由产品体验和开发者平台团队共同评审。",
    },
    priya,
    "demo-work-rollback-thresholds-done",
  );
  await store.createWorkItem(
    {
      projectId,
      title: "探索中英文发布说明",
      description: "Backlog 候选：为运维人员提供简洁的中英文发布说明。",
      status: "todo",
      priority: "P3",
      carryover: false,
      coordinationThreadIds: [],
    },
    alex,
    "demo-work-localized-notes",
  );

  const relations: WorkRelation[] = [
    {
      sourceId: active.id,
      targetId: dependency.id,
      kind: "blocked_by",
      createdBy: agent,
      createdAt: offsetIso(now, -45 * 60_000),
    },
    {
      sourceId: ready.id,
      targetId: carryover.id,
      kind: "related",
      createdBy: morgan,
      createdAt: offsetIso(now, -2 * 3_600_000),
    },
  ];
  for (const relation of relations) {
    await store.addRelation(projectId, WorkRelation.parse(relation));
  }

  const references: WorkCodeReference[] = [
    {
      id: "019f9a00-0000-7000-8000-000000000a01",
      workItemId: active.id,
      kind: "pull_request",
      label: "PR #184 · 租户安全灰度控制",
      url: "https://github.com/example/intero-demo/pull/184",
      repository: "example/intero-demo",
      value: "#184",
      reportedBy: agent,
      createdAt: offsetIso(now, -50 * 60_000),
    },
    {
      id: "019f9a00-0000-7000-8000-000000000a02",
      workItemId: active.id,
      kind: "commit",
      label: "权限门槛验证",
      repository: "example/intero-demo",
      value: "8d7f2a1",
      reportedBy: agent,
      createdAt: offsetIso(now, -48 * 60_000),
    },
    {
      id: "019f9a00-0000-7000-8000-000000000a03",
      workItemId: ready.id,
      kind: "branch",
      label: "浏览器状态覆盖",
      repository: "example/intero-demo",
      value: "demo/browser-state-coverage",
      reportedBy: morgan,
      createdAt: offsetIso(now, -2.5 * 3_600_000),
    },
  ];
  for (const reference of references) {
    await store.addCodeReference(projectId, WorkCodeReference.parse(reference));
  }

  const rootComment = WorkComment.parse({
    id: WorkCommentId.parse("019f9a00-0000-7000-8000-000000000b01"),
    workItemId: ready.id,
    body: "空状态和加载状态已经通过。重连还需要补一次延迟事件检查。",
    author: morgan,
    createdAt: offsetIso(now, -2 * 3_600_000),
  });
  await store.addWorkComment(projectId, rootComment);
  const reply = WorkComment.parse({
    id: WorkCommentId.parse("019f9a00-0000-7000-8000-000000000b02"),
    workItemId: ready.id,
    parentId: rootComment.id,
    body: "我已经把 Centrifugo 延迟事件加入 demo 检查清单；权限关系修复后请再跑一次。",
    author: jordan,
    createdAt: offsetIso(now, -90 * 60_000),
  });
  await store.addWorkComment(projectId, reply);
}

async function markDemoSeedComplete(pool: Pool, now: string): Promise<void> {
  await pool.query(
    `INSERT INTO activity_events
      (organization_id,operation_id,actor_id,aggregate_type,aggregate_id,
       event_type,metadata,occurred_at)
     VALUES ($1,$2,$3,'demo_seed',$1,'demo.seed.completed',$4,$5)`,
    [
      DEMO_IDS.organization,
      "019f9a00-0000-7000-8000-000000000fff",
      DEMO_IDS.principals.alex,
      JSON.stringify({ demoSeedVersion: DEMO_SEED_VERSION }),
      now,
    ],
  );
}

function demoResult(status: DemoSeedResult["status"]): DemoSeedResult {
  return {
    status,
    seedVersion: DEMO_SEED_VERSION,
    organizationId: DEMO_IDS.organization,
    projectId: DEMO_IDS.project,
    pendingInvitationToken: demoPendingInvitationToken(),
    identities: DEMO_USERS.map((user) => ({
      displayName: user.displayName,
      email: user.email,
      principalId: user.principalId,
    })),
  };
}

function demoPendingInvitationToken(): string {
  return "intero-demo-pending-casey";
}

function parsePostgresUrl(value: string): URL {
  const target = new URL(value);
  if (!["postgres:", "postgresql:"].includes(target.protocol)) {
    throw new Error("Demo data commands require a PostgreSQL DATABASE_URL.");
  }
  return target;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function offsetIso(date: Date, milliseconds: number): string {
  return new Date(date.getTime() + milliseconds).toISOString();
}

function localDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addIsoDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
