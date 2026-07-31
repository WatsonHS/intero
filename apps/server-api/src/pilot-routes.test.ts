import {
  PILOT_AGENT_CONFIGURATION_VERSION,
  type MessageId,
  type PilotCheckpointInput,
  type OrganizationId,
  personalStandInId,
  type PrincipalId,
  type ThreadId,
  uuidv7,
} from "@intero/domain";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildTestApp } from "./test-app.js";
import type { ModelGateway } from "./pilot-ports.js";
import { ModelGatewayUnavailableError } from "./pilot-ports.js";
import { teamConversationThreadId } from "./pilot-routes.js";
import { InMemoryPilotStore, PilotStoreError } from "./pilot-store.js";
import { TransactionalOutboxJobRunner } from "./pilot-service.js";
import { InMemoryPlatformStore } from "./store.js";

const A = "019b5ac0-7600-7000-8000-0000000000a1" as PrincipalId;
const B = "019b5ac0-7600-7000-8000-0000000000b2" as PrincipalId;
const C = "019b5ac0-7600-7000-8000-0000000000c3" as PrincipalId;
const identity = (id: PrincipalId) => ({
  "x-intero-dev-principal-id": id,
});
const modelGateway: ModelGateway = {
  async generateStandInOutput({ checkpoint }) {
    if (checkpoint.narrative.currentFocus.includes("provider unavailable")) {
      throw new ModelGatewayUnavailableError("Provider unavailable in test.");
    }
    const coordination = [
      "dependency_declared",
      "blocker_raised",
      "review_requested",
      "coordination_requested",
    ].includes(checkpoint.eventType);
    return {
      safeSummary:
        checkpoint.narrative.completedOutcome ||
        checkpoint.narrative.currentFocus,
      narrative: checkpoint.narrative,
      coordination: {
        shouldOpen: coordination,
        safeContext: coordination
          ? checkpoint.narrative.collaboration.request ||
            checkpoint.narrative.currentFocus
          : "",
        candidateNextSteps: coordination
          ? ["Confirm the responsible owner", "Agree on the safe next step"]
          : [],
      },
    };
  },
  async answerStandInQuestion({ sources }) {
    const source = sources[0];
    if (!source) {
      return {
        answer: "No structured Work State has been published for this member.",
        currentStatus: "No published structured Work State.",
        completedOutcome: "",
        evidence: [],
        nextStep: "Ask the member to publish a project update.",
        neededCollaboration: "",
        sourceWorkStateIds: [],
      };
    }
    return {
      answer: `Grounded in: ${source.summary}`,
      currentStatus: source.narrative.currentFocus,
      completedOutcome: source.narrative.completedOutcome,
      evidence: source.narrative.evidence,
      nextStep: source.narrative.nextStep,
      neededCollaboration: source.narrative.collaboration.needed
        ? source.narrative.collaboration.request
        : "",
      sourceWorkStateIds: [source.workStateId],
    };
  },
};

describe("pilot cloud-first vertical slice", () => {
  let app: FastifyInstance;
  let pilotStore: InMemoryPilotStore;
  let conversationStore: InMemoryPlatformStore;

  beforeEach(async () => {
    pilotStore = new InMemoryPilotStore();
    conversationStore = new InMemoryPlatformStore();
    app = await buildTestApp({
      logger: false,
      pilotStore,
      store: conversationStore,
      pilotIdentities: [
        { id: A, displayName: "Alex Rivera", kind: "human" },
        { id: B, displayName: "Morgan Chen", kind: "human" },
        { id: C, displayName: "Taylor Singh", kind: "human" },
      ],
      deploymentProbe: async () => true,
      providerEncryptionSecret: "test-provider-secret",
      pilotModelGateway: modelGateway,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("persists account display name, avatar tone, and preferred language through the profile boundary", async () => {
    const updated = await app.inject({
      method: "PATCH",
      url: "/v1/pilot/profile",
      headers: identity(A),
      payload: {
        displayName: "Alex Lin",
        avatarTone: "green",
        preferredLanguage: "zh-CN",
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().profile).toMatchObject({
      displayName: "Alex Lin",
      avatarTone: "green",
      preferredLanguage: "zh-CN",
    });

    const fetched = await app.inject({
      method: "GET",
      url: "/v1/pilot/profile",
      headers: identity(A),
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().profile).toMatchObject({
      displayName: "Alex Lin",
      avatarTone: "green",
      preferredLanguage: "zh-CN",
    });

    const invalid = await app.inject({
      method: "PATCH",
      url: "/v1/pilot/profile",
      headers: identity(A),
      payload: { avatarTone: "rainbow" },
    });
    expect(invalid.statusCode).toBe(400);

    const invalidLanguage = await app.inject({
      method: "PATCH",
      url: "/v1/pilot/profile",
      headers: identity(A),
      payload: { preferredLanguage: "fr-FR" },
    });
    expect(invalidLanguage.statusCode).toBe(400);
  });

  it("defaults an unset profile language from the request locale", async () => {
    const chinese = await app.inject({
      method: "GET",
      url: "/v1/pilot/profile",
      headers: {
        ...identity(A),
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    expect(chinese.statusCode).toBe(200);
    expect(chinese.json().profile.preferredLanguage).toBe("zh-CN");

    const english = await app.inject({
      method: "GET",
      url: "/v1/pilot/profile",
      headers: {
        ...identity(B),
        "accept-language": "en-US,en;q=0.9",
      },
    });
    expect(english.statusCode).toBe(200);
    expect(english.json().profile.preferredLanguage).toBe("en-US");
  });

  it("carries the owner's preferred language into Agent prompts and bindings", async () => {
    const { project } = await readyProject(app);
    const chineseProfile = await app.inject({
      method: "PATCH",
      url: "/v1/pilot/profile",
      headers: identity(A),
      payload: { preferredLanguage: "zh-CN" },
    });
    expect(chineseProfile.statusCode).toBe(200);

    const chineseTicket = await app.inject({
      method: "POST",
      url: `/v1/pilot/projects/${project.id}/agent-tickets`,
      headers: identity(A),
      payload: { client: "codex" },
    });
    expect(chineseTicket.statusCode).toBe(201);
    const chineseConnectPrompt = chineseTicket.json().connectPrompt as string;
    expect(chineseConnectPrompt).not.toContain("required = false");
    expect(chineseConnectPrompt).toContain("zh-CN");
    expect(chineseConnectPrompt).toContain(".codex/config.toml");
    expect(chineseConnectPrompt).toContain(".codex/hooks.json");
    expect(chineseConnectPrompt).toContain("AGENTS.md");
    expect(chineseConnectPrompt).toContain("/v1/pilot/mcp");
    expect(chineseConnectPrompt).toContain('"reuseProbeUrl"');
    expect(chineseConnectPrompt).toContain(
      '"retryableUntil":"connected_or_expired"',
    );
    expect(chineseConnectPrompt).toContain(
      '"exchangeRequest":{"method":"POST","headers":{"content-type":"application/json"},"body":',
    );
    expect(chineseConnectPrompt).toContain(
      '"client":"codex","name":"Codex · <repository-name>","workspaceId":"<stable-workspace-uuid>"',
    );
    expect(chineseConnectPrompt).toContain(
      "JSON body 精确使用 ticket、client、name、workspaceId 四个键",
    );
    expect(chineseConnectPrompt).toContain("connected 或 expiresAt 前");
    expect(chineseConnectPrompt).toContain("intero.connection_status");
    expect(chineseConnectPrompt).toContain("intero.validate_connection");
    expect(chineseConnectPrompt).toContain("stand_in.report_checkpoint");
    expect(chineseConnectPrompt).toContain("stand_in.checkpoint_status");
    expect(chineseConnectPrompt).toContain(
      '"checkpointTerminalStatuses":["published","private","failed"]',
    );
    expect(chineseConnectPrompt).toContain(
      '"initialIntent":{"trigger":"first_user_request_understood","timing":"before_substantive_work","eventType":"work_started","fields":["workstreamKey","workstreamTitle","narrative.currentFocus"]}',
    );
    expect(chineseConnectPrompt).toContain(
      "每个新对话理解首条用户请求后、开始实质工作前",
    );
    expect(chineseConnectPrompt).toContain(
      "SessionStart Hook 发送 hooks.allowedPayload",
    );
    expect(chineseConnectPrompt).toContain(
      "本配置任务报告 pending_gui_validation",
    );
    expect(chineseConnectPrompt).toContain(
      "直接使用 Codex 内置的新任务/对话能力，在当前仓库发起独立验证对话",
    );
    expect(chineseConnectPrompt).toContain(
      "新对话报告 MCP、配置版本与 Hook 验证结果",
    );
    expect(chineseConnectPrompt).toContain(
      `"configuration":{"version":${PILOT_AGENT_CONFIGURATION_VERSION}`,
    );
    expect(chineseConnectPrompt).toContain(".worktreeinclude");
    expect(chineseConnectPrompt).toContain(
      'node \\"$(git rev-parse --show-toplevel)/.intero/hook.mjs\\"',
    );
    expect(chineseConnectPrompt).toContain(
      "ready=true、configurationCurrent=true 且 lifecycleReady=true",
    );
    expect(chineseConnectPrompt).not.toContain("codex://threads/new");
    expect(chineseConnectPrompt).toContain("移除本地 verification 字段");
    expect(chineseConnectPrompt).not.toContain("以下 JSON 是声明式期望状态");
    expect(chineseConnectPrompt).not.toContain("intero-mcp");
    expect(chineseConnectPrompt).not.toMatch(/\b(?:SDK|CLI|stdio)\b/i);
    expect(chineseConnectPrompt.length).toBeLessThan(6_000);
    const chineseRawTicket = (
      chineseTicket.json().connectPrompt as string
    ).match(/"ticket":\s*"(ticket_[A-Za-z0-9_-]+)"/)?.[1];
    expect(chineseRawTicket).toBeDefined();
    const chineseWorkspaceId = uuidv7();
    const chineseBinding = await app.inject({
      method: "POST",
      url: "/v1/pilot/agent/connect",
      payload: {
        ticket: chineseRawTicket,
        client: "codex",
        name: "Codex 中文连接",
        workspaceId: chineseWorkspaceId,
      },
    });
    expect(chineseBinding.statusCode).toBe(201);
    expect(chineseBinding.json().binding.preferredLanguage).toBe("zh-CN");
    const chineseRetry = await app.inject({
      method: "POST",
      url: "/v1/pilot/agent/connect",
      payload: {
        ticket: chineseRawTicket,
        client: "codex",
        name: "Codex 中文连接重试",
        workspaceId: chineseWorkspaceId,
      },
    });
    expect(chineseRetry.statusCode).toBe(201);
    expect(chineseRetry.json().binding.id).toBe(
      chineseBinding.json().binding.id,
    );
    expect(chineseRetry.json().credential).not.toBe(
      chineseBinding.json().credential,
    );
    expect(
      (await overview(app, project.id, A)).bindings.filter(
        (binding: { id: string }) =>
          binding.id === chineseBinding.json().binding.id,
      ),
    ).toHaveLength(1);

    await app.inject({
      method: "PATCH",
      url: "/v1/pilot/profile",
      headers: identity(A),
      payload: { preferredLanguage: "en-US" },
    });
    const englishTicket = await app.inject({
      method: "POST",
      url: `/v1/pilot/projects/${project.id}/agent-tickets`,
      headers: identity(A),
      payload: { client: "claude-code" },
    });
    expect(englishTicket.statusCode).toBe(201);
    expect(englishTicket.json().connectPrompt).toContain(
      "fresh Claude Code GUI validation session",
    );
    expect(englishTicket.json().connectPrompt).toContain(
      "pending_gui_validation",
    );
    expect(englishTicket.json().connectPrompt).toContain("en-US");
    expect(englishTicket.json().connectPrompt).toContain(".mcp.json");
    expect(englishTicket.json().connectPrompt).toContain(
      ".claude/settings.json",
    );
    expect(englishTicket.json().connectPrompt).toContain("CLAUDE.md");
    expect(englishTicket.json().connectPrompt).toContain(
      "The same ticket is retryable until connected or expiresAt",
    );
    expect(englishTicket.json().connectPrompt).toContain(
      "exactly four JSON keys: ticket, client, name, workspaceId",
    );
    expect((englishTicket.json().connectPrompt as string).length).toBeLessThan(
      4_800,
    );
    expect(englishTicket.json().connectPrompt).not.toContain("intero-mcp");

    const openCodeTicket = await app.inject({
      method: "POST",
      url: `/v1/pilot/projects/${project.id}/agent-tickets`,
      headers: identity(A),
      payload: { client: "opencode" },
    });
    expect(openCodeTicket.statusCode).toBe(201);
    expect(openCodeTicket.json().connectPrompt).toContain("opencode.json");
    expect(openCodeTicket.json().connectPrompt).toContain(
      ".opencode/plugins/intero.ts",
    );
    expect(openCodeTicket.json().connectPrompt).toContain("AGENTS.md");
    expect(openCodeTicket.json().connectPrompt).not.toContain("intero-mcp");
  });

  it("creates a project-scoped retryable Bearer connection task", async () => {
    const { project } = await readyProject(app);
    await app.inject({
      method: "PATCH",
      url: "/v1/pilot/profile",
      headers: identity(A),
      payload: { preferredLanguage: "zh-CN" },
    });

    const response = await app.inject({
      method: "POST",
      url: `/v1/pilot/projects/${project.id}/agent-connections`,
      headers: identity(A),
      payload: { client: "codex" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().ticket).toMatchObject({
      client: "codex",
    });
    expect(response.json().ticket).not.toHaveProperty("ticketHash");
    expect(response.json().mcpUrl).toBe("http://127.0.0.1:4310/v1/pilot/mcp");
    expect(response.json().connectPrompt).toContain(
      '"authorization":"Bearer credential returned by setup exchange"',
    );
    expect(response.json().connectPrompt).toContain(
      '"retryableUntil":"connected_or_expired"',
    );
    expect(response.json().connectPrompt).toContain(
      '"body":{"ticket":"ticket_',
    );
    expect(response.json().connectPrompt).toContain(
      `"configuration":{"version":${PILOT_AGENT_CONFIGURATION_VERSION}`,
    );
    expect(response.json().connectPrompt).toContain(
      "ready=true、configurationCurrent=true 且 lifecycleReady=true",
    );
    expect(response.json().connectPrompt).not.toContain('"clientId"');
    expect(response.json().connectPrompt).not.toContain('"repositoryName"');
    expect(response.json().connectPrompt).toContain("pending_gui_validation");
    expect(response.json().connectPrompt).not.toContain("required = false");
    expect(response.json().connectPrompt).not.toMatch(/\b(?:SDK|CLI|stdio)\b/i);
    expect(response.json().connectPrompt).not.toMatch(
      /不要|不得|禁止|never|do not/i,
    );
  });

  it("uses one configured public origin for bootstrap, invitations, and MCP links", async () => {
    await app.close();
    pilotStore = new InMemoryPilotStore();
    app = await buildTestApp({
      logger: false,
      pilotStore,
      pilotIdentities: [
        { id: A, displayName: "Alex Rivera", kind: "human" },
        { id: B, displayName: "Morgan Chen", kind: "human" },
      ],
      authPublicUrl: "http://10.20.30.40:4311",
      deploymentProbe: async () => true,
      providerEncryptionSecret: "test-provider-secret",
      pilotModelGateway: modelGateway,
    });

    const { project, teamId } = await readyProject(app);
    const bootstrap = await app.inject({
      method: "GET",
      url: "/v1/pilot/bootstrap",
      headers: identity(A),
    });
    expect(bootstrap.json()).toMatchObject({
      publicUrl: "http://10.20.30.40:4311",
      deploymentEndpointManaged: true,
      organization: {
        deploymentBaseUrl: "http://10.20.30.40:4311",
      },
    });

    const invitation = await app.inject({
      method: "POST",
      url: `/v1/pilot/teams/${teamId}/invitations`,
      headers: identity(A),
      payload: {
        email: "morgan.chen@intero.test",
      },
    });
    expect(invitation.statusCode).toBe(201);
    expect(invitation.json().activationUrl).toBe(
      `http://10.20.30.40:4311${invitation.json().activationPath}`,
    );

    const connection = await app.inject({
      method: "POST",
      url: `/v1/pilot/projects/${project.id}/agent-connections`,
      headers: identity(A),
      payload: { client: "codex" },
    });
    expect(connection.statusCode).toBe(201);
    expect(connection.json().mcpUrl).toBe(
      "http://10.20.30.40:4311/v1/pilot/mcp",
    );

    const conflictingUpdate = await app.inject({
      method: "PATCH",
      url: "/v1/pilot/settings/deployment",
      headers: identity(A),
      payload: { deploymentBaseUrl: "https://other.internal.example" },
    });
    expect(conflictingUpdate.statusCode).toBe(409);
    expect(conflictingUpdate.json().code).toBe("DEPLOYMENT_ENDPOINT_MANAGED");
  });

  it("requires a selected identity and keeps provider credentials server-only", async () => {
    const unauthorized = await app.inject({
      method: "POST",
      url: "/v1/pilot/setup",
      payload: setupPayload(),
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json().code).toBe("AUTHENTICATION_REQUIRED");

    const setup = await setupAsA(app);
    expect(setup.organization.provider.configured).toBe(false);

    const teamsBeforeProvider = await app.inject({
      method: "GET",
      url: "/v1/pilot/teams",
      headers: identity(A),
    });
    const teamId = teamsBeforeProvider.json().teams[0].id;
    const project = await createProject(app, teamId);
    const gated = await app.inject({
      method: "POST",
      url: `/v1/pilot/projects/${project.id}/agent-tickets`,
      headers: identity(A),
      payload: { client: "codex" },
    });
    expect(gated.statusCode).toBe(409);
    expect(gated.json().code).toBe("AI_PROVIDER_REQUIRED");

    const provider = await configureProvider(app);
    expect(provider.organization.provider).toEqual({
      configured: true,
      endpoint: "https://models.example.test/v1",
      defaultModel: "pilot-model",
    });
    expect(JSON.stringify(provider)).not.toContain("provider-secret-value");
  });

  it("uses the session principal and ignores a spoofed development identity", async () => {
    await app.close();
    app = await buildTestApp({
      logger: false,
      pilotStore: new InMemoryPilotStore(),
      pilotIdentities: [
        { id: A, displayName: "Alex Rivera", kind: "human" },
        { id: B, displayName: "Morgan Chen", kind: "human" },
      ],
      requestAuth: {
        mode: "session",
        developmentIdentities: [],
        async resolve(request, required = true) {
          if (request.headers.cookie === "intero-test-session=alex") {
            return {
              id: A,
              displayName: "Alex Rivera",
              kind: "human",
              email: "alex.rivera@intero.test",
              authUserId: "auth-alex",
            };
          }
          if (!required) return undefined;
          throw new PilotStoreError(
            "AUTHENTICATION_REQUIRED",
            401,
            "Authentication required",
          );
        },
      },
      deploymentProbe: async () => true,
      pilotModelGateway: modelGateway,
    });

    const spoofed = await app.inject({
      method: "POST",
      url: "/v1/pilot/setup",
      headers: identity(B),
      payload: setupPayload(),
    });
    expect(spoofed.statusCode).toBe(401);

    const authenticated = await app.inject({
      method: "POST",
      url: "/v1/pilot/setup",
      headers: {
        ...identity(B),
        cookie: "intero-test-session=alex",
      },
      payload: setupPayload(),
    });
    expect(authenticated.statusCode).toBe(201);
    const bootstrap = await app.inject({
      method: "GET",
      url: "/v1/pilot/bootstrap",
      headers: { cookie: "intero-test-session=alex" },
    });
    expect(bootstrap.json()).toMatchObject({
      authMode: "session",
      currentPrincipal: { id: A, email: "alex.rivera@intero.test" },
    });
    expect(bootstrap.json().identities).toEqual([]);
  });

  it("joins a reusable team link and enforces participant-only direct messages", async () => {
    await setupAsA(app);
    const teamId = await firstTeamId(app, A);
    const join = await createJoinLink(app, teamId);

    const redeemed = await app.inject({
      method: "POST",
      url: `/v1/pilot/join/${join.code}`,
      headers: identity(B),
    });
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json().team.id).toBe(teamId);

    const dm = await app.inject({
      method: "POST",
      url: "/v1/pilot/dms",
      headers: identity(A),
      payload: { teamId, peerId: B },
    });
    expect(dm.statusCode).toBe(201);
    const threadId = dm.json().thread.id;
    const sent = await app.inject({
      method: "POST",
      url: `/v1/pilot/dms/${threadId}/messages`,
      headers: identity(A),
      payload: { body: "The pilot project is ready for your checkpoint." },
    });
    expect(sent.statusCode).toBe(201);

    const standIn = await app.inject({
      method: "POST",
      url: `/v1/pilot/dms/${threadId}/stand-in`,
      headers: identity(B),
      payload: {},
    });
    expect(standIn.statusCode).toBe(200);
    expect(standIn.json().thread).toMatchObject({
      standInAddedAfterSequence: 1,
    });

    const visibleToB = await app.inject({
      method: "GET",
      url: "/v1/pilot/dms",
      headers: identity(B),
    });
    expect(visibleToB.json().items[0].messages[0].body).toContain(
      "pilot project",
    );
    expect(visibleToB.json().items[0].thread).toMatchObject({
      standInAddedAfterSequence: 1,
    });

    const invisibleToC = await app.inject({
      method: "GET",
      url: "/v1/pilot/dms",
      headers: identity(C),
    });
    expect(invisibleToC.json().items).toEqual([]);
    const forbiddenSend = await app.inject({
      method: "POST",
      url: `/v1/pilot/dms/${threadId}/messages`,
      headers: identity(C),
      payload: { body: "I should not be able to send this." },
    });
    // Inaccessible and missing conversations are intentionally indistinguishable.
    expect(forbiddenSend.statusCode).toBe(404);
    expect(forbiddenSend.json().code).toBe("DM_NOT_FOUND");
  });

  it("uses email-bound invitations and audits the member/leader/admin lifecycle", async () => {
    await setupAsA(app);
    const teamId = await firstTeamId(app, A);

    const nonAdminInvite = await app.inject({
      method: "POST",
      url: `/v1/pilot/teams/${teamId}/invitations`,
      headers: identity(B),
      payload: {
        email: "morgan.chen@intero.test",
      },
    });
    expect(nonAdminInvite.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: `/v1/pilot/teams/${teamId}/invitations`,
      headers: identity(A),
      payload: {
        email: "morgan.chen@intero.test",
      },
    });
    expect(created.statusCode).toBe(201);
    const invitation = created.json();
    expect(invitation.invitation).toMatchObject({
      email: "morgan.chen@intero.test",
      status: "pending",
    });
    expect(invitation.invitation).not.toHaveProperty("displayName");
    expect(JSON.stringify(invitation)).not.toContain("tokenHash");

    const mismatch = await app.inject({
      method: "POST",
      url: `/v1/pilot/invitations/${invitation.token}/accept`,
      headers: identity(C),
      payload: { displayName: "Taylor Singh" },
    });
    expect(mismatch.statusCode).toBe(403);
    expect(mismatch.json().code).toBe("INVITATION_EMAIL_MISMATCH");

    const accepted = await app.inject({
      method: "POST",
      url: `/v1/pilot/invitations/${invitation.token}/accept`,
      headers: identity(B),
      payload: { displayName: "Morgan Product" },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().profile.displayName).toBe("Morgan Product");
    expect(
      conversationStore.hasThreadAccess(
        teamConversationThreadId(teamId) as ThreadId,
        B,
      ),
    ).toBe(true);

    const promoted = await app.inject({
      method: "PATCH",
      url: `/v1/pilot/teams/${teamId}/members/${B}`,
      headers: identity(A),
      payload: { teamRole: "leader" },
    });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json().teamMembership.role).toBe("leader");

    const adminPromotion = await app.inject({
      method: "PATCH",
      url: `/v1/pilot/teams/${teamId}/members/${B}`,
      headers: identity(A),
      payload: { organizationRole: "admin" },
    });
    expect(adminPromotion.statusCode).toBe(200);
    const demoteA = await app.inject({
      method: "PATCH",
      url: `/v1/pilot/teams/${teamId}/members/${A}`,
      headers: identity(B),
      payload: { organizationRole: "member" },
    });
    expect(demoteA.statusCode).toBe(200);
    const lastAdmin = await app.inject({
      method: "PATCH",
      url: `/v1/pilot/teams/${teamId}/members/${B}`,
      headers: identity(B),
      payload: { organizationRole: "member" },
    });
    expect(lastAdmin.statusCode).toBe(409);
    expect(lastAdmin.json().code).toBe("LAST_ORGANIZATION_ADMIN");
  });

  it("creates one durable group chat per team and adds new team members at the access boundary", async () => {
    await setupAsA(app);
    const initialTeamId = await firstTeamId(app, A);
    const initialThreadId = teamConversationThreadId(initialTeamId);
    expect(
      conversationStore.getThread(initialThreadId as ThreadId, A)?.thread,
    ).toMatchObject({
      kind: "room",
      teamId: initialTeamId,
      participantIds: [A],
    });

    const created = await app.inject({
      method: "POST",
      url: "/v1/pilot/teams",
      headers: identity(A),
      payload: { name: "Developer Platform" },
    });
    expect(created.statusCode).toBe(201);
    const teamId = created.json().team.id as string;
    const threadId = teamConversationThreadId(teamId);
    expect(
      conversationStore.getThread(threadId as ThreadId, A)?.thread,
    ).toMatchObject({
      title: "Developer Platform",
      kind: "room",
      teamId,
      participantIds: [A],
    });

    const message = await app.inject({
      method: "POST",
      url: `/v1/threads/${threadId}/messages`,
      headers: identity(A),
      payload: {
        clientMessageId: uuidv7(),
        body: "This predates Morgan joining the team.",
      },
    });
    expect(message.statusCode).toBe(201);

    const join = await createJoinLink(app, initialTeamId);
    const joined = await app.inject({
      method: "POST",
      url: `/v1/pilot/join/${join.code}`,
      headers: identity(B),
    });
    expect(joined.statusCode).toBe(200);
    expect(
      conversationStore.hasThreadAccess(initialThreadId as ThreadId, B),
    ).toBe(true);

    const added = await app.inject({
      method: "POST",
      url: `/v1/pilot/teams/${teamId}/members`,
      headers: identity(A),
      payload: { memberId: B },
    });
    expect(added.statusCode).toBe(201);
    const newMemberView = conversationStore.getThread(threadId as ThreadId, B);
    expect(newMemberView?.thread.participantIds).toEqual([A, B]);
    expect(newMemberView?.messages).toEqual([
      expect.objectContaining({
        kind: "system_access_change",
        sequence: 2,
      }),
    ]);

    const renamed = await app.inject({
      method: "PATCH",
      url: `/v1/pilot/teams/${teamId}`,
      headers: identity(A),
      payload: { name: "Platform Tools" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(
      conversationStore.getThread(threadId as ThreadId, A)?.thread.title,
    ).toBe("Platform Tools");

    const customized = await app.inject({
      method: "PATCH",
      url: `/v1/threads/${threadId}`,
      headers: identity(A),
      payload: { title: "Platform Launch Room" },
    });
    expect(customized.statusCode).toBe(200);
    const renamedAgain = await app.inject({
      method: "PATCH",
      url: `/v1/pilot/teams/${teamId}`,
      headers: identity(A),
      payload: { name: "Infrastructure Platform" },
    });
    expect(renamedAgain.statusCode).toBe(200);
    expect(
      conversationStore.getThread(threadId as ThreadId, A)?.thread.title,
    ).toBe("Platform Launch Room");
  });

  it("backfills the deterministic group chat for teams created before the feature", async () => {
    await app.close();
    const organizationId = uuidv7() as OrganizationId;
    const teamId = uuidv7();
    const createdAt = new Date().toISOString();
    pilotStore = new InMemoryPilotStore();
    await pilotStore.setupOrganization({
      organization: {
        id: organizationId,
        name: "Existing organization",
        deploymentBaseUrl: "https://intero.example.test",
        deploymentValidatedAt: createdAt,
        provider: { configured: false },
      },
      administratorId: A,
      initialTeam: {
        id: teamId,
        organizationId,
        name: "Existing Team",
        createdAt,
      },
    });
    conversationStore = new InMemoryPlatformStore();
    app = await buildTestApp({
      logger: false,
      pilotStore,
      store: conversationStore,
      organization: { id: organizationId, name: "Existing organization" },
      pilotIdentities: [{ id: A, displayName: "Alex Rivera", kind: "human" }],
      deploymentProbe: async () => true,
      providerEncryptionSecret: "test-provider-secret",
      pilotModelGateway: modelGateway,
    });

    expect(
      conversationStore.getThread(
        teamConversationThreadId(teamId) as ThreadId,
        A,
      )?.thread,
    ).toMatchObject({
      title: "Existing Team",
      teamId,
      participantIds: [A],
    });
  });

  it("creates and renames teams, and only admins put existing people in them", async () => {
    await setupAsA(app);
    const firstTeam = await firstTeamId(app, A);
    const join = await createJoinLink(app, firstTeam);
    await app.inject({
      method: "POST",
      url: `/v1/pilot/join/${join.code}`,
      headers: identity(B),
    });

    const denied = await app.inject({
      method: "POST",
      url: "/v1/pilot/teams",
      headers: identity(B),
      payload: { name: "Developer Platform" },
    });
    expect(denied.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/v1/pilot/teams",
      headers: identity(A),
      payload: { name: "Developer Platform" },
    });
    expect(created.statusCode).toBe(201);
    const teamId = created.json().team.id as string;

    // The creator has to end up inside the team: team reads are scoped to
    // membership, so otherwise the admin could not see what they just made.
    const own = await app.inject({
      method: "GET",
      url: "/v1/pilot/teams",
      headers: identity(A),
    });
    const createdTeam = own
      .json()
      .teams.find((team: { id: string }) => team.id === teamId);
    expect(createdTeam.members).toHaveLength(1);
    expect(createdTeam.members[0]).toMatchObject({ id: A, teamRole: "leader" });

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/pilot/teams",
      headers: identity(A),
      payload: { name: "developer platform" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("TEAM_NAME_TAKEN");

    const renameDenied = await app.inject({
      method: "PATCH",
      url: `/v1/pilot/teams/${teamId}`,
      headers: identity(B),
      payload: { name: "Platform Tools" },
    });
    expect(renameDenied.statusCode).toBe(403);

    const renamed = await app.inject({
      method: "PATCH",
      url: `/v1/pilot/teams/${teamId}`,
      headers: identity(A),
      payload: { name: "Platform Tools" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().team.name).toBe("Platform Tools");

    // Someone with no organization membership cannot be added this way — that
    // is what an invitation is for.
    const stranger = await app.inject({
      method: "POST",
      url: `/v1/pilot/teams/${teamId}/members`,
      headers: identity(A),
      payload: { memberId: C },
    });
    expect(stranger.statusCode).toBe(404);

    const added = await app.inject({
      method: "POST",
      url: `/v1/pilot/teams/${teamId}/members`,
      headers: identity(A),
      payload: { memberId: B, role: "leader" },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().membership).toMatchObject({ teamId, role: "leader" });

    const again = await app.inject({
      method: "POST",
      url: `/v1/pilot/teams/${teamId}/members`,
      headers: identity(A),
      payload: { memberId: B },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("TEAM_MEMBERSHIP_EXISTS");

    const visible = await app.inject({
      method: "GET",
      url: "/v1/pilot/teams",
      headers: identity(B),
    });
    expect(
      visible.json().teams.map((team: { id: string }) => team.id),
    ).toContain(teamId);
  });

  it("lets an administrator delete an unused team but protects project teams", async () => {
    const { teamId } = await readyProject(app);
    const created = await app.inject({
      method: "POST",
      url: "/v1/pilot/teams",
      headers: identity(A),
      payload: { name: "Disposable Team" },
    });
    const disposableTeamId = created.json().team.id as string;

    const denied = await app.inject({
      method: "DELETE",
      url: `/v1/pilot/teams/${disposableTeamId}`,
      headers: identity(B),
    });
    expect(denied.statusCode).toBe(403);

    const blocked = await app.inject({
      method: "DELETE",
      url: `/v1/pilot/teams/${teamId}`,
      headers: identity(A),
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("TEAM_HAS_PROJECTS");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/pilot/teams/${disposableTeamId}`,
      headers: identity(A),
    });
    expect(deleted.statusCode).toBe(204);

    const visible = await app.inject({
      method: "GET",
      url: "/v1/pilot/teams",
      headers: identity(A),
    });
    expect(
      visible.json().teams.map((team: { id: string }) => team.id),
    ).not.toContain(disposableTeamId);
  });

  it("renames and re-scopes a project, keeping the owner inside its primary team", async () => {
    const { teamId, project } = await readyProject(app);
    const second = await app.inject({
      method: "POST",
      url: "/v1/pilot/teams",
      headers: identity(A),
      payload: { name: "Developer Platform" },
    });
    const secondTeamId = second.json().team.id as string;

    const outsider = await app.inject({
      method: "PATCH",
      url: `/v1/pilot/projects/${project.id}`,
      headers: identity(B),
      payload: { name: "Not yours" },
    });
    expect(outsider.statusCode).toBe(403);

    const rescoped = await app.inject({
      method: "PATCH",
      url: `/v1/pilot/projects/${project.id}`,
      headers: identity(A),
      payload: {
        name: "Collaboration Chain",
        participatingTeamIds: [teamId, secondTeamId],
        posture: "paused",
      },
    });
    expect(rescoped.statusCode).toBe(200);
    expect(rescoped.json().project).toMatchObject({
      name: "Collaboration Chain",
      posture: "paused",
      primaryTeamId: teamId,
    });
    expect(rescoped.json().project.participatingTeamIds).toEqual([
      teamId,
      secondTeamId,
    ]);

    // Taking a team back off the project has to stick, not just be ignored.
    const narrowed = await app.inject({
      method: "PATCH",
      url: `/v1/pilot/projects/${project.id}`,
      headers: identity(A),
      payload: { participatingTeamIds: [teamId] },
    });
    expect(narrowed.json().project.participatingTeamIds).toEqual([teamId]);

    const orphaned = await app.inject({
      method: "PATCH",
      url: `/v1/pilot/projects/${project.id}`,
      headers: identity(A),
      payload: { participatingTeamIds: [secondTeamId] },
    });
    expect(orphaned.statusCode).toBe(400);
    expect(orphaned.json().code).toBe("PRIMARY_TEAM_NOT_ASSOCIATED");

    // A owns the project but leaves the second team, so it can no longer be
    // the primary team — the owner has to be a member of that one.
    await app.inject({
      method: "POST",
      url: `/v1/pilot/teams/${secondTeamId}/members`,
      headers: identity(A),
      payload: { memberId: B, role: "leader" },
    });
    await app.inject({
      method: "DELETE",
      url: `/v1/pilot/teams/${secondTeamId}/members/${A}`,
      headers: identity(A),
    });
    const handover = await app.inject({
      method: "PATCH",
      url: `/v1/pilot/projects/${project.id}`,
      headers: identity(A),
      payload: {
        primaryTeamId: secondTeamId,
        participatingTeamIds: [teamId, secondTeamId],
      },
    });
    expect(handover.statusCode).toBe(409);
    expect(handover.json().code).toBe("PROJECT_OWNER_NOT_IN_TEAM");

    const invalidOwner = await app.inject({
      method: "PATCH",
      url: `/v1/pilot/projects/${project.id}`,
      headers: identity(A),
      payload: { ownerId: C },
    });
    expect(invalidOwner.statusCode).toBe(409);
    expect(invalidOwner.json().code).toBe("PROJECT_OWNER_NOT_IN_TEAM");

    const transferred = await app.inject({
      method: "PATCH",
      url: `/v1/pilot/projects/${project.id}`,
      headers: identity(A),
      payload: {
        ownerId: B,
        primaryTeamId: secondTeamId,
        participatingTeamIds: [teamId, secondTeamId],
      },
    });
    expect(transferred.statusCode).toBe(200);
    expect(transferred.json().project).toMatchObject({
      ownerId: B,
      primaryTeamId: secondTeamId,
    });
  });

  it("serves the organization directory and org-wide roles to administrators only", async () => {
    const { teamId, project } = await readyProject(app);

    const denied = await app.inject({
      method: "GET",
      url: "/v1/pilot/organization/directory",
      headers: identity(B),
    });
    expect(denied.statusCode).toBe(403);

    const directory = await app.inject({
      method: "GET",
      url: "/v1/pilot/organization/directory",
      headers: identity(A),
    });
    expect(directory.statusCode).toBe(200);
    const body = directory.json();
    expect(body.teams.map((team: { id: string }) => team.id)).toContain(teamId);
    expect(body.projects.map((entry: { id: string }) => entry.id)).toContain(
      project.id,
    );
    expect(
      body.members.find((member: { id: string }) => member.id === A),
    ).toMatchObject({ organizationRole: "admin", teamIds: [teamId] });

    const renameDenied = await app.inject({
      method: "PATCH",
      url: "/v1/pilot/organization",
      headers: identity(B),
      payload: { name: "Intero Labs" },
    });
    expect(renameDenied.statusCode).toBe(403);

    const renamed = await app.inject({
      method: "PATCH",
      url: "/v1/pilot/organization",
      headers: identity(A),
      payload: { name: "Intero Labs" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().organization.name).toBe("Intero Labs");

    const promoted = await app.inject({
      method: "PATCH",
      url: `/v1/pilot/organization/members/${B}`,
      headers: identity(A),
      payload: { organizationRole: "admin" },
    });
    expect(promoted.statusCode).toBe(200);
    const afterPromotion = await app.inject({
      method: "GET",
      url: "/v1/pilot/organization/directory",
      headers: identity(B),
    });
    expect(afterPromotion.statusCode).toBe(200);
  });

  it("rejects revoked invitations and does not expose their bearer token", async () => {
    await setupAsA(app);
    const teamId = await firstTeamId(app, A);
    const created = await app.inject({
      method: "POST",
      url: `/v1/pilot/teams/${teamId}/invitations`,
      headers: identity(A),
      payload: {
        email: "taylor.singh@intero.test",
      },
    });
    const body = created.json();
    const revoked = await app.inject({
      method: "POST",
      url: `/v1/pilot/invitations/${body.invitation.id}/revoke`,
      headers: identity(A),
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().invitation.status).toBe("revoked");
    expect(JSON.stringify(revoked.json())).not.toContain("tokenHash");

    const accept = await app.inject({
      method: "POST",
      url: `/v1/pilot/invitations/${body.token}/accept`,
      headers: identity(C),
      payload: { displayName: "Taylor Singh" },
    });
    expect(accept.statusCode).toBe(410);
    expect(accept.json().code).toBe("INVITATION_REVOKED");
  });

  it("rejects an expired recipient invitation", async () => {
    await setupAsA(app);
    const teamId = await firstTeamId(app, A);
    const token = "invite_expired_recipient_test_token";
    await pilotStore.createInvitation(
      {
        id: uuidv7(),
        organizationId:
          "019b5ac0-7600-7000-8000-000000000001" as OrganizationId,
        teamId,
        email: "taylor.singh@intero.test",
        tokenHash: createHash("sha256").update(token).digest("hex"),
        createdBy: A,
        expiresAt: "2026-07-25T00:00:00.000Z",
        createdAt: "2026-07-24T00:00:00.000Z",
        updatedAt: "2026-07-24T00:00:00.000Z",
      },
      A,
    );
    const accept = await app.inject({
      method: "POST",
      url: `/v1/pilot/invitations/${token}/accept`,
      headers: identity(C),
      payload: { displayName: "Taylor Singh" },
    });
    expect(accept.statusCode).toBe(410);
    expect(accept.json().code).toBe("INVITATION_EXPIRED");
  });

  it("shows awaiting validation until a real remote MCP handshake succeeds", async () => {
    const fixture = await readyProject(app);
    const ticketResponse = await app.inject({
      method: "POST",
      url: `/v1/pilot/projects/${fixture.project.id}/agent-tickets`,
      headers: identity(A),
      payload: { client: "codex" },
    });
    const prompt = ticketResponse.json().connectPrompt as string;
    const ticket = prompt.match(/"ticket":\s*"(ticket_[A-Za-z0-9_-]+)"/)?.[1];
    const connected = await app.inject({
      method: "POST",
      url: "/v1/pilot/agent/connect",
      payload: {
        ticket,
        client: "codex",
        name: "Codex · remote-mcp-test",
        workspaceId: uuidv7(),
      },
    });
    expect(connected.statusCode).toBe(201);
    expect(connected.json().binding.validatedAt).toBeUndefined();
    expect(connected.json().binding.verificationCodeHash).toBeUndefined();
    expect(connected.json().verification.code).toMatch(/^verify_/);

    const before = await overview(app, fixture.project.id, A);
    expect(before.bindings[0]).toMatchObject({
      client: "codex",
      name: "Codex · remote-mcp-test",
    });
    expect(before.bindings[0].validatedAt).toBeUndefined();
    expect(before.bindings[0].verificationCodeHash).toBeUndefined();

    const rejectedBeforeValidation = await sendCheckpoint(
      app,
      connected.json().credential,
      checkpoint(fixture.project.id),
    );
    expect(rejectedBeforeValidation.statusCode).toBe(409);
    expect(rejectedBeforeValidation.json().code).toBe(
      "AGENT_VALIDATION_REQUIRED",
    );

    const prematureValidation = await app.inject({
      method: "POST",
      url: "/v1/pilot/mcp",
      headers: {
        authorization: `Bearer ${connected.json().credential as string}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      payload: {
        jsonrpc: "2.0",
        id: "premature-validation",
        method: "tools/call",
        params: {
          name: "intero.validate_connection",
          arguments: {
            verificationCode: connected.json().verification.code,
          },
        },
      },
    });
    expect(prematureValidation.statusCode).toBe(200);
    expect(prematureValidation.json().result.isError).toBe(true);
    expect(prematureValidation.json().result.content[0].text).toContain(
      "native MCP initialization",
    );

    const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    const mcpClient = new Client({
      name: "codex-native-connection-test",
      version: "1.0.0",
    });
    const transport = new StreamableHTTPClientTransport(
      new URL("/v1/pilot/mcp", baseUrl),
      {
        requestInit: {
          headers: {
            authorization: `Bearer ${connected.json().credential as string}`,
          },
        },
      },
    );
    await mcpClient.connect(transport as unknown as Transport);
    const initializedContext = (await mcpClient.callTool({
      name: "stand_in.current_context",
      arguments: {},
    })) as { content: Array<{ type: string; text?: string }> };
    const initializedText = initializedContext.content.find(
      (item) => item.type === "text",
    )?.text;
    expect(
      initializedText ? JSON.parse(initializedText).status : undefined,
    ).toBe("mcp_initialized");
    const tools = await mcpClient.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "intero.connection_status",
        "intero.validate_connection",
        "stand_in.current_context",
        "stand_in.report_checkpoint",
        "stand_in.checkpoint_status",
      ]),
    );
    const pendingStatus = (await mcpClient.callTool({
      name: "intero.connection_status",
      arguments: {},
    })) as { content: Array<{ type: string; text?: string }> };
    const pendingStatusText = pendingStatus.content.find(
      (item) => item.type === "text",
    )?.text;
    expect(
      pendingStatusText ? JSON.parse(pendingStatusText) : undefined,
    ).toMatchObject({
      status: "mcp_initialized",
      connected: false,
      projectId: fixture.project.id,
    });
    const validation = await mcpClient.callTool({
      name: "intero.validate_connection",
      arguments: {
        verificationCode: connected.json().verification.code,
        configurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
      },
    });
    const validationContent = (
      validation as {
        content: Array<{ type: string; text?: string }>;
      }
    ).content;
    const validationText = validationContent.find(
      (item) => item.type === "text",
    );
    expect(validationText?.type).toBe("text");
    expect(
      validationText?.type === "text" && validationText.text
        ? JSON.parse(validationText.text)
        : undefined,
    ).toMatchObject({
      status: "lifecycle_pending",
      ready: false,
      configurationCurrent: true,
      configurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
      requiredConfigurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
    });
    const firstValidatedAt =
      validationText?.type === "text" && validationText.text
        ? JSON.parse(validationText.text).validatedAt
        : undefined;
    const repeatedValidation = (await mcpClient.callTool({
      name: "intero.validate_connection",
      arguments: {
        verificationCode: connected.json().verification.code,
        configurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
      },
    })) as { content: Array<{ type: string; text?: string }> };
    const repeatedText = repeatedValidation.content.find(
      (item) => item.type === "text",
    )?.text;
    expect(
      repeatedText ? JSON.parse(repeatedText).validatedAt : undefined,
    ).toBe(firstValidatedAt);
    const connectedStatus = (await mcpClient.callTool({
      name: "intero.connection_status",
      arguments: {},
    })) as { content: Array<{ type: string; text?: string }> };
    const connectedStatusText = connectedStatus.content.find(
      (item) => item.type === "text",
    )?.text;
    expect(
      connectedStatusText ? JSON.parse(connectedStatusText) : undefined,
    ).toMatchObject({
      status: "lifecycle_pending",
      connected: false,
      mcpConnected: true,
      lifecycleReady: false,
      ready: false,
      configurationCurrent: true,
      projectId: fixture.project.id,
      validatedAt: firstValidatedAt,
    });
    await mcpClient.close();

    const retryAfterValidation = await app.inject({
      method: "POST",
      url: "/v1/pilot/agent/connect",
      payload: {
        ticket,
        client: "codex",
        name: "Codex · remote-mcp-test retry",
        workspaceId: connected.json().binding.workspaceId,
      },
    });
    expect(retryAfterValidation.statusCode).toBe(401);
    expect(retryAfterValidation.json().code).toBe("AGENT_TICKET_INVALID");

    const after = await overview(app, fixture.project.id, A);
    expect(after.bindings[0]).toMatchObject({
      mcpClientName: "codex-native-connection-test",
      mcpClientVersion: "1.0.0",
      mcpInitializedAt: expect.any(String),
    });
    expect(after.bindings[0].validatedAt).toEqual(expect.any(String));
    expect(Date.parse(after.bindings[0].lastSeenAt)).toBeGreaterThanOrEqual(
      Date.parse(after.bindings[0].validatedAt),
    );
    expect(after.bindings[0]).toMatchObject({
      configurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
      configurationUpdatedAt: expect.any(String),
    });

    const hook = await app.inject({
      method: "POST",
      url: "/v1/pilot/agent/hooks",
      headers: {
        authorization: `Bearer ${connected.json().credential as string}`,
      },
      payload: {
        clientEventId: "hook-session-start-0001",
        lifecycle: "session_started",
        workstreamKey: "remote-mcp-test",
        workstreamTitle: "Remote MCP test",
      },
    });
    expect(hook.statusCode).toBe(202);
    expect(hook.json()).toMatchObject({
      accepted: true,
      published: false,
      activity: {
        status: "active",
        updatedAt: expect.any(String),
      },
    });

    const afterStarted = await overview(app, fixture.project.id, A);
    expect(afterStarted.privateWorkState).toEqual(before.privateWorkState);
    expect(afterStarted.pulse).toEqual(before.pulse);
    expect(afterStarted.bindings[0]).toMatchObject({
      activityStatus: "active",
      activityUpdatedAt: expect.any(String),
    });
    const lifecycleReady = await app.inject({
      method: "POST",
      url: "/v1/pilot/mcp",
      headers: {
        authorization: `Bearer ${connected.json().credential as string}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      payload: {
        jsonrpc: "2.0",
        id: "lifecycle-ready",
        method: "tools/call",
        params: {
          name: "intero.connection_status",
          arguments: {},
        },
      },
    });
    expect(
      JSON.parse(lifecycleReady.json().result.content[0].text),
    ).toMatchObject({
      status: "connected",
      connected: true,
      mcpConnected: true,
      lifecycleReady: true,
      ready: true,
      configurationCurrent: true,
      projectId: fixture.project.id,
    });

    const endedAt = new Date(
      Date.parse(afterStarted.bindings[0].activityUpdatedAt) + 1_000,
    ).toISOString();
    const endedHook = await app.inject({
      method: "POST",
      url: "/v1/pilot/agent/hooks",
      headers: {
        authorization: `Bearer ${connected.json().credential as string}`,
      },
      payload: {
        clientEventId: "hook-session-end-0001",
        lifecycle: "session_ended",
        occurredAt: endedAt,
        workstreamKey: "remote-mcp-test",
        workstreamTitle: "Remote MCP test",
      },
    });
    expect(endedHook.statusCode).toBe(202);
    expect(endedHook.json()).toMatchObject({
      accepted: true,
      published: false,
      activity: {
        status: "idle",
        updatedAt: endedAt,
      },
    });

    const afterEnded = await overview(app, fixture.project.id, A);
    expect(afterEnded.privateWorkState).toEqual(before.privateWorkState);
    expect(afterEnded.pulse).toEqual(before.pulse);
    expect(afterEnded.bindings[0]).toMatchObject({
      activityStatus: "idle",
      activityUpdatedAt: endedAt,
    });

    const delayedStartedHook = await app.inject({
      method: "POST",
      url: "/v1/pilot/agent/hooks",
      headers: {
        authorization: `Bearer ${connected.json().credential as string}`,
      },
      payload: {
        clientEventId: "hook-delayed-session-start-0001",
        lifecycle: "session_started",
        occurredAt: afterStarted.bindings[0].activityUpdatedAt,
        workstreamKey: "remote-mcp-test",
        workstreamTitle: "Remote MCP test",
      },
    });
    expect(delayedStartedHook.statusCode).toBe(202);
    expect(delayedStartedHook.json().activity).toEqual({
      status: "idle",
      updatedAt: endedAt,
    });

    const disconnected = await app.inject({
      method: "POST",
      url: `/v1/pilot/agent-bindings/${connected.json().binding.id}/disconnect`,
      headers: identity(A),
      payload: {},
    });
    expect(disconnected.statusCode).toBe(200);

    const disconnectedClient = new Client({
      name: "codex-disconnected-connection-test",
      version: "1.0.0",
    });
    const disconnectedTransport = new StreamableHTTPClientTransport(
      new URL(
        `/v1/pilot/projects/${fixture.project.id}/agent-connections/${connected.json().binding.id}/mcp`,
        baseUrl,
      ),
      {
        requestInit: {
          headers: {
            authorization: `Bearer ${connected.json().credential as string}`,
          },
        },
      },
    );
    await disconnectedClient.connect(
      disconnectedTransport as unknown as Transport,
    );
    const disconnectedTools = await disconnectedClient.listTools();
    expect(disconnectedTools.tools.map((tool) => tool.name)).toEqual([
      "intero.connection_status",
    ]);
    const disconnectedStatus = (await disconnectedClient.callTool({
      name: "intero.connection_status",
      arguments: {},
    })) as { content: Array<{ type: string; text?: string }> };
    const disconnectedStatusText = disconnectedStatus.content.find(
      (item) => item.type === "text",
    )?.text;
    expect(
      disconnectedStatusText
        ? JSON.parse(disconnectedStatusText).status
        : undefined,
    ).toBe("disconnected");
    await disconnectedClient.close();

    const rejectedCheckpointAfterDisconnect = await sendCheckpoint(
      app,
      connected.json().credential,
      checkpoint(fixture.project.id, {
        clientEventId: "checkpoint-after-disconnect",
      }),
    );
    expect(rejectedCheckpointAfterDisconnect.statusCode).toBe(401);
  });

  it("repairs an outdated Project configuration on the existing binding and credential", async () => {
    const fixture = await readyProject(app);
    const legacy = await connectAgent(app, fixture.project.id, A, "codex", {
      configurationVersion: false,
    });
    const hook = await app.inject({
      method: "POST",
      url: "/v1/pilot/agent/hooks",
      headers: { authorization: `Bearer ${legacy.credential}` },
      payload: {
        clientEventId: "legacy-config-session-start",
        lifecycle: "session_started",
        workstreamKey: "legacy-config",
        workstreamTitle: "Legacy configuration repair",
      },
    });
    expect(hook.statusCode).toBe(202);

    await expect(
      callMcpTool(app, legacy.credential, "intero.connection_status", {}),
    ).resolves.toMatchObject({
      status: "configuration_outdated",
      connected: true,
      ready: false,
      configurationCurrent: false,
      requiredConfigurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
      bindingId: legacy.binding.id,
    });

    const foreignRepair = await app.inject({
      method: "POST",
      url: `/v1/pilot/projects/${fixture.project.id}/agent-connections`,
      headers: identity(B),
      payload: {
        client: "codex",
        bindingId: legacy.binding.id,
      },
    });
    expect(foreignRepair.statusCode).toBe(404);
    expect(foreignRepair.json().code).toBe("AGENT_CONNECTION_NOT_FOUND");

    const repair = await app.inject({
      method: "POST",
      url: `/v1/pilot/projects/${fixture.project.id}/agent-connections`,
      headers: identity(A),
      payload: {
        client: "codex",
        bindingId: legacy.binding.id,
      },
    });
    expect(repair.statusCode).toBe(201);
    expect(repair.json().bindingId).toBe(legacy.binding.id);
    expect(repair.json().connectPrompt).toContain(
      `"expectedBindingId":"${legacy.binding.id}"`,
    );
    expect(repair.json().connectPrompt).toContain(
      `"configuration":{"version":${PILOT_AGENT_CONFIGURATION_VERSION}`,
    );

    await expect(
      callMcpTool(app, legacy.credential, "intero.validate_connection", {
        configurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
      }),
    ).resolves.toMatchObject({
      status: "connected",
      connected: true,
      ready: true,
      configurationCurrent: true,
      configurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
      bindingId: legacy.binding.id,
    });
    await expect(
      callMcpTool(app, legacy.credential, "intero.connection_status", {}),
    ).resolves.toMatchObject({
      status: "connected",
      ready: true,
      configurationCurrent: true,
      bindingId: legacy.binding.id,
    });

    const after = await overview(app, fixture.project.id, A);
    expect(
      after.bindings.filter(
        (binding: { id: string; disconnectedAt?: string }) =>
          binding.id === legacy.binding.id && !binding.disconnectedAt,
      ),
    ).toEqual([
      expect.objectContaining({
        configurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
        configurationUpdatedAt: expect.any(String),
      }),
    ]);
  });

  it("accepts a scoped idempotent Agent checkpoint and separates private state from Team Pulse", async () => {
    const fixture = await readyProject(app);
    const connection = await connectAgent(app, fixture.project.id);
    expect(connection.connectReuse.statusCode).toBe(401);

    const unauthorized = await app.inject({
      method: "POST",
      url: "/v1/pilot/agent/checkpoints",
      payload: checkpoint(fixture.project.id),
    });
    expect(unauthorized.statusCode).toBe(401);

    const checkpointInput = checkpoint(fixture.project.id);
    const accepted = await sendCheckpoint(
      app,
      connection.credential,
      checkpointInput,
    );
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toMatchObject({
      accepted: true,
      duplicate: false,
      published: true,
    });
    expect(
      await callMcpTool(
        app,
        connection.credential,
        "stand_in.checkpoint_status",
        { workStateId: accepted.json().workStateId },
      ),
    ).toMatchObject({
      workStateId: accepted.json().workStateId,
      status: "published",
      terminal: true,
      published: true,
      pulseEntryId: expect.any(String),
    });
    expect(
      await callMcpTool(
        app,
        connection.credential,
        "stand_in.report_checkpoint",
        {
          eventType: checkpointInput.eventType,
          narrative: checkpointInput.narrative,
          evidenceRefs: checkpointInput.evidenceRefs,
          clientEventId: checkpointInput.clientEventId,
          workstreamKey: checkpointInput.workstream.key,
          workstreamTitle: checkpointInput.workstream.title,
          phase: checkpointInput.workstream.phase,
        },
      ),
    ).toMatchObject({
      accepted: true,
      duplicate: true,
      published: true,
      status: "published",
      terminal: true,
      workStateId: accepted.json().workStateId,
      statusTool: "stand_in.checkpoint_status",
    });
    const duplicate = await sendCheckpoint(
      app,
      connection.credential,
      checkpointInput,
    );
    expect(duplicate.json().duplicate).toBe(true);

    const overviewA = await overview(app, fixture.project.id, A);
    const overviewB = await overview(app, fixture.project.id, B);
    expect(overviewA.privateWorkState[0].claims[0]).toMatchObject({
      source: "direct_cloud_mcp",
      value: "Implemented scoped checkpoint ingestion.",
      narrative: {
        currentFocus: "Implemented scoped checkpoint ingestion.",
        completedOutcome: "Implemented scoped checkpoint ingestion.",
        nextStep: "Verify the team projection.",
      },
    });
    expect(overviewA.privateWorkState[0].narrative.evidence).toEqual([
      "The pilot route contract test passed.",
    ]);
    expect(overviewB.privateWorkState).toEqual([]);
    expect(overviewB.pulse[0]).toMatchObject({
      summary: "Implemented scoped checkpoint ingestion.",
      narrative: {
        currentFocus: "Implemented scoped checkpoint ingestion.",
        completedOutcome: "Implemented scoped checkpoint ingestion.",
        evidence: ["The pilot route contract test passed."],
        nextStep: "Verify the team projection.",
        collaboration: {
          needed: false,
          request: "",
          requestedFrom: "",
        },
      },
      provenance: {
        source: "direct_cloud_mcp",
        client: "codex",
        connectionName: "Codex Pilot",
      },
    });
    expect(JSON.stringify(overviewB.pulse)).not.toContain("evidenceRefs");
    expect(JSON.stringify(overviewB.pulse)).not.toContain("claims");
  });

  it("opens one evidence-backed coordination thread only for a deterministic shared-boundary conflict", async () => {
    const fixture = await readyProject(app);
    const observerJoin = await createJoinLink(app, fixture.teamId);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/pilot/join/${observerJoin.code}`,
          headers: identity(C),
        })
      ).statusCode,
    ).toBe(200);
    const alex = await connectAgent(app, fixture.project.id, A, "codex");
    const priya = await connectAgent(app, fixture.project.id, B, "claude-code");
    const roomThreadId = uuidv7() as ThreadId;
    conversationStore.createThread(
      {
        id: roomThreadId,
        kind: "room",
        projectId: fixture.project.id,
        title: "R1 R2 evaluation room",
        participantIds: [A, B],
        standInIds: [],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        sequence: 0,
        createdAt: new Date().toISOString(),
      },
      A,
    );
    const assumption = "v1 response keeps account_id";
    const boundaryCheckpoint = (
      clientEventId: string,
      relation: "changing" | "depending_on",
      change: "compatible" | "breaking" | "unknown",
      preserves: string[],
    ): PilotCheckpointInput => ({
      ...checkpoint(fixture.project.id, {
        clientEventId,
        summary: "Evaluating the account API boundary.",
      }),
      occurredAt: new Date().toISOString(),
      sharedBoundaries: [
        {
          key: "api/accounts.v1",
          kind: "api",
          relation,
          assumption,
          change,
          preserves,
        },
      ],
    });
    const reportBoundary = (credential: string, input: PilotCheckpointInput) =>
      callMcpTool(app, credential, "stand_in.report_checkpoint", {
        eventType: input.eventType,
        narrative: input.narrative,
        evidenceRefs: input.evidenceRefs,
        clientEventId: input.clientEventId,
        workstreamKey: input.workstream.key,
        workstreamTitle: input.workstream.title,
        phase: input.workstream.phase,
        sharedBoundaries: input.sharedBoundaries,
      });

    const compatibleProducer = boundaryCheckpoint(
      "r1-compatible-producer-0001",
      "changing",
      "compatible",
      [assumption],
    );
    const compatibleConsumer = boundaryCheckpoint(
      "r1-compatible-consumer-0001",
      "depending_on",
      "unknown",
      [],
    );
    await expect(
      reportBoundary(alex.credential, compatibleProducer),
    ).resolves.toMatchObject({ accepted: true, duplicate: false });
    await expect(
      reportBoundary(priya.credential, compatibleConsumer),
    ).resolves.toMatchObject({ accepted: true, duplicate: false });
    expect((await overview(app, fixture.project.id, A)).coordination).toEqual(
      [],
    );
    expect(conversationStore.listInbox(A)).toEqual([]);
    expect(
      conversationStore
        .getThread(roomThreadId, A)
        ?.messages.filter((message) => message.kind === "coordination_summary"),
    ).toEqual([]);

    const breakingProducer = boundaryCheckpoint(
      "r1-breaking-producer-0001",
      "changing",
      "breaking",
      [],
    );
    await expect(
      reportBoundary(alex.credential, breakingProducer),
    ).resolves.toMatchObject({ accepted: true, duplicate: false });
    await expect(
      reportBoundary(alex.credential, breakingProducer),
    ).resolves.toMatchObject({ accepted: true, duplicate: true });

    const overviewA = await overview(app, fixture.project.id, A);
    const overviewB = await overview(app, fixture.project.id, B);
    const overviewC = await overview(app, fixture.project.id, C);
    expect(overviewA.coordination).toHaveLength(1);
    expect(overviewB.coordination).toHaveLength(1);
    const coordination = overviewA.coordination[0];
    expect(coordination).toMatchObject({
      trigger: "work_state_conflict",
      boundaryKey: "api/accounts.v1",
      status: "open",
      participantIds: expect.arrayContaining([A, B]),
      sourceWorkStateIds: [expect.any(String), expect.any(String)],
      sourceClaimIds: [expect.any(String), expect.any(String)],
      conversationThreadId: expect.any(String),
      sourceRoomThreadId: roomThreadId,
      summaryMessageId: expect.any(String),
    });
    expect(overviewA.coordinationRelevance).toHaveLength(1);
    expect(overviewB.coordinationRelevance).toHaveLength(1);
    expect(overviewC.coordination).toEqual([]);
    expect(overviewC.coordinationRelevance).toEqual([]);
    expect(conversationStore.listInbox(A)).toEqual([]);
    expect(conversationStore.listInbox(B)).toEqual([]);

    const canonicalThreadId = coordination.conversationThreadId as ThreadId;
    const canonicalThreads = conversationStore.listThreads("coordination", A);
    expect(canonicalThreads).toHaveLength(1);
    expect(canonicalThreads[0]!.thread.id).toBe(canonicalThreadId);
    expect(conversationStore.getThread(canonicalThreadId, C)).toBeUndefined();
    const roomBeforeConclusion = conversationStore.getThread(roomThreadId, A)!;
    const summariesBeforeConclusion = roomBeforeConclusion.messages.filter(
      (message) => message.kind === "coordination_summary",
    );
    expect(summariesBeforeConclusion).toHaveLength(1);
    expect(summariesBeforeConclusion[0]!.coordinationSummary).toMatchObject({
      coordinationThreadId: canonicalThreadId,
      status: "open",
      boundaryKey: "api/accounts.v1",
      actionRequired: false,
      sourceCount: 2,
    });
    const observerProposal = await app.inject({
      method: "POST",
      url: `/v1/pilot/coordination/${coordination.id}/conclusion`,
      headers: identity(C),
      payload: {
        conclusion: "An unaffected observer must not resolve this boundary.",
        responsibleParticipantId: A,
      },
    });
    expect(observerProposal.statusCode).toBe(403);
    expect(observerProposal.json().code).toBe(
      "COORDINATION_PARTICIPANT_REQUIRED",
    );

    const proposed = await app.inject({
      method: "POST",
      url: `/v1/pilot/coordination/${coordination.id}/conclusion`,
      headers: identity(A),
      payload: {
        conclusion: "Keep account_id through the compatibility window.",
        responsibleParticipantId: B,
      },
    });
    expect(proposed.statusCode).toBe(200);
    const roomAfterProposal = conversationStore.getThread(roomThreadId, A)!;
    expect(roomAfterProposal.thread.sequence).toBe(
      roomBeforeConclusion.thread.sequence,
    );
    expect(roomAfterProposal.messages).toHaveLength(
      roomBeforeConclusion.messages.length,
    );
    expect(
      roomAfterProposal.messages.find(
        (message) => message.kind === "coordination_summary",
      )?.coordinationSummary,
    ).toMatchObject({
      status: "needs_action",
      actionRequired: true,
    });

    const bypassed = await app.inject({
      method: "POST",
      url: `/v1/threads/${canonicalThreadId}/conclusion`,
      headers: identity(A),
      payload: {
        conclusion: "Bypass the responsible participant.",
        clientMessageId: uuidv7(),
      },
    });
    expect(bypassed.statusCode).toBe(409);
    expect(bypassed.json().error.code).toBe(
      "managed_coordination_requires_confirmation",
    );

    const confirmed = await app.inject({
      method: "POST",
      url: `/v1/pilot/coordination/${coordination.id}/confirm`,
      headers: identity(B),
    });
    expect(confirmed.statusCode).toBe(200);
    const confirmedAgain = await app.inject({
      method: "POST",
      url: `/v1/pilot/coordination/${coordination.id}/confirm`,
      headers: identity(B),
    });
    expect(confirmedAgain.statusCode).toBe(200);
    const roomAfterConfirmation = conversationStore.getThread(roomThreadId, A)!;
    expect(roomAfterConfirmation.thread.sequence).toBe(
      roomBeforeConclusion.thread.sequence,
    );
    expect(roomAfterConfirmation.messages).toHaveLength(
      roomBeforeConclusion.messages.length,
    );
    expect(
      roomAfterConfirmation.messages.find(
        (message) => message.kind === "coordination_summary",
      )?.coordinationSummary,
    ).toMatchObject({
      status: "resolved",
      actionRequired: false,
      conclusion: "Keep account_id through the compatibility window.",
    });
    expect(
      conversationStore.getThread(canonicalThreadId, A)?.thread.concludedAt,
    ).toBeDefined();

    const dismissed = await app.inject({
      method: "POST",
      url: `/v1/pilot/coordination/${coordination.id}/relevance`,
      headers: identity(A),
      payload: { action: "dismiss" },
    });
    expect(dismissed.statusCode).toBe(200);
    expect(dismissed.json().relevance.dismissedAt).toBeDefined();
    const revisited = await app.inject({
      method: "POST",
      url: `/v1/pilot/coordination/${coordination.id}/relevance`,
      headers: identity(A),
      payload: { action: "revisit" },
    });
    expect(revisited.statusCode).toBe(200);
    expect(revisited.json().relevance.dismissedAt).toBeUndefined();
  });

  it("keeps each producer's language in shared checkpoint records", async () => {
    const fixture = await readyProject(app);
    await app.inject({
      method: "PATCH",
      url: "/v1/pilot/profile",
      headers: identity(A),
      payload: { preferredLanguage: "zh-CN" },
    });
    await app.inject({
      method: "PATCH",
      url: "/v1/pilot/profile",
      headers: identity(B),
      payload: { preferredLanguage: "en-US" },
    });
    const chineseConnection = await connectAgent(
      app,
      fixture.project.id,
      A,
      "codex",
    );
    const englishConnection = await connectAgent(
      app,
      fixture.project.id,
      B,
      "claude-code",
    );

    const chineseCheckpoint = checkpoint(fixture.project.id, {
      clientEventId: "language-checkpoint-zh-0001",
    });
    chineseCheckpoint.narrative = {
      currentFocus: "正在完善项目搜索。",
      completedOutcome: "已完成授权范围过滤。",
      evidence: ["搜索契约测试已通过。"],
      nextStep: "验证跨团队项目结果。",
      collaboration: {
        needed: false,
        request: "",
        requestedFrom: "",
      },
    };
    const englishCheckpoint = checkpoint(fixture.project.id, {
      clientEventId: "language-checkpoint-en-0001",
    });
    englishCheckpoint.narrative = {
      currentFocus: "Refining project search.",
      completedOutcome: "Authorization scope filtering is complete.",
      evidence: ["The search contract suite passed."],
      nextStep: "Validate cross-team project results.",
      collaboration: {
        needed: false,
        request: "",
        requestedFrom: "",
      },
    };

    expect(
      (
        await sendCheckpoint(
          app,
          chineseConnection.credential,
          chineseCheckpoint,
        )
      ).statusCode,
    ).toBe(202);
    expect(
      (
        await sendCheckpoint(
          app,
          englishConnection.credential,
          englishCheckpoint,
        )
      ).statusCode,
    ).toBe(202);

    const shared = (await overview(app, fixture.project.id, B)).pulse;
    expect(
      shared.find(
        (entry: { provenance: { clientEventId: string } }) =>
          entry.provenance.clientEventId === "language-checkpoint-zh-0001",
      ),
    ).toMatchObject({
      summary: "已完成授权范围过滤。",
      narrative: {
        evidence: ["搜索契约测试已通过。"],
        nextStep: "验证跨团队项目结果。",
      },
    });
    expect(
      shared.find(
        (entry: { provenance: { clientEventId: string } }) =>
          entry.provenance.clientEventId === "language-checkpoint-en-0001",
      ),
    ).toMatchObject({
      summary: "Authorization scope filtering is complete.",
      narrative: {
        evidence: ["The search contract suite passed."],
        nextStep: "Validate cross-team project results.",
      },
    });
  });

  it("rejects malformed, raw-content, and cross-project writes", async () => {
    const fixture = await readyProject(app);
    const connection = await connectAgent(app, fixture.project.id);

    const malformed = await sendCheckpoint(app, connection.credential, {
      ...checkpoint(fixture.project.id),
      eventType: "file_touched",
    });
    expect(malformed.statusCode).toBe(400);

    const raw = await sendCheckpoint(app, connection.credential, {
      ...checkpoint(fixture.project.id),
      terminalOutput: "npm test output",
    });
    expect(raw.statusCode).toBe(400);

    const second = await createProject(app, fixture.teamId, "Other Project");
    const crossProject = await sendCheckpoint(
      app,
      connection.credential,
      checkpoint(second.id),
    );
    expect(crossProject.statusCode).toBe(403);
    expect(crossProject.json().code).toBe("CROSS_PROJECT_WRITE");
  });

  it("routes structured collaboration only to an authorized Project member", async () => {
    const fixture = await readyProject(app);
    const connection = await connectAgent(app, fixture.project.id);
    const missingTarget = checkpoint(fixture.project.id, {
      eventType: "dependency_declared",
      summary: "Waiting for a structured dependency owner.",
      clientEventId: "client-event-targeted-dependency-missing-0001",
      phase: "blocked",
    });
    missingTarget.narrative.collaboration = {
      needed: true,
      request: "Confirm the integration contract.",
      requestedFrom: "display-only owner",
    };
    const missing = await sendCheckpoint(
      app,
      connection.credential,
      missingTarget,
    );
    expect(missing.statusCode).toBe(400);
    expect(missing.json().code).toBe("COLLABORATION_TARGET_REQUIRED");

    const targeted = checkpoint(fixture.project.id, {
      eventType: "dependency_declared",
      summary: "Waiting for the integration contract owner.",
      clientEventId: "client-event-targeted-dependency-0001",
      phase: "blocked",
    });
    targeted.narrative.collaboration = {
      needed: true,
      request: "Confirm the integration contract.",
      requestedFrom: "Morgan Chen",
      targetPrincipalId: B,
    };

    const accepted = await sendCheckpoint(app, connection.credential, targeted);
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().coordinationThread.participantIds).toEqual([A, B]);

    const crossProjectTarget = structuredClone(targeted);
    crossProjectTarget.clientEventId =
      "client-event-targeted-dependency-unauthorized-0001";
    crossProjectTarget.narrative.collaboration.requestedFrom = "Taylor Singh";
    crossProjectTarget.narrative.collaboration.targetPrincipalId = C;
    const rejected = await sendCheckpoint(
      app,
      connection.credential,
      crossProjectTarget,
    );
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().code).toBe("COLLABORATION_TARGET_NOT_AUTHORIZED");

    const inactiveRequest = structuredClone(targeted);
    inactiveRequest.clientEventId =
      "client-event-targeted-dependency-inactive-0001";
    inactiveRequest.narrative.collaboration.needed = false;
    const inactive = await sendCheckpoint(
      app,
      connection.credential,
      inactiveRequest,
    );
    expect(inactive.statusCode).toBe(400);
    expect(inactive.json().code).toBe("COLLABORATION_TARGET_WITHOUT_REQUEST");
  });

  it("routes a personal Stand-in to its owner's shared Project Work State only", async () => {
    const fixture = await readyProject(app);
    const connection = await connectAgent(app, fixture.project.id);
    await sendCheckpoint(
      app,
      connection.credential,
      checkpoint(fixture.project.id),
    );

    const asked = await app.inject({
      method: "POST",
      url: `/v1/pilot/projects/${fixture.project.id}/stand-in`,
      headers: identity(B),
      payload: {
        question: "What is the current implementation status?",
        standInOwnerId: A,
      },
    });
    expect(asked.statusCode).toBe(201);
    expect(asked.json().exchange).toMatchObject({
      principalId: A,
      askedByPrincipalId: B,
      question: "What is the current implementation status?",
      answer: "Grounded in: Implemented scoped checkpoint ingestion.",
      structuredAnswer: {
        currentStatus: "Implemented scoped checkpoint ingestion.",
        completedOutcome: "Implemented scoped checkpoint ingestion.",
        evidence: ["The pilot route contract test passed."],
        nextStep: "Verify the team projection.",
        neededCollaboration: "",
      },
      sources: [
        {
          title: "Pilot vertical slice",
          summary: "Implemented scoped checkpoint ingestion.",
          narrative: {
            currentFocus: "Implemented scoped checkpoint ingestion.",
            evidence: ["The pilot route contract test passed."],
          },
          provenance: {
            source: "direct_cloud_mcp",
            client: "codex",
            connectionName: "Codex Pilot",
          },
        },
      ],
    });

    const visibleToB = await app.inject({
      method: "GET",
      url: `/v1/pilot/projects/${fixture.project.id}/stand-in?standInOwnerId=${A}`,
      headers: identity(B),
    });
    expect(visibleToB.json().exchanges).toHaveLength(1);
    expect(visibleToB.json()).toMatchObject({
      standInOwner: { id: A, kind: "human" },
      standIn: { kind: "stand_in" },
    });
    expect(visibleToB.json().standIn.id).not.toBe(A);

    const stillOnlyPersonalExchange = await app.inject({
      method: "GET",
      url: `/v1/pilot/projects/${fixture.project.id}/stand-in?standInOwnerId=${A}`,
      headers: identity(B),
    });
    expect(stillOnlyPersonalExchange.json().exchanges).toHaveLength(1);
    expect(stillOnlyPersonalExchange.json().exchanges[0].question).toBe(
      "What is the current implementation status?",
    );

    const privateToAsker = await app.inject({
      method: "GET",
      url: `/v1/pilot/projects/${fixture.project.id}/stand-in?standInOwnerId=${A}`,
      headers: identity(A),
    });
    expect(privateToAsker.json().exchanges).toEqual([]);

    const noSharedStateForB = await app.inject({
      method: "POST",
      url: `/v1/pilot/projects/${fixture.project.id}/stand-in`,
      headers: identity(A),
      payload: {
        question: "What private work is Morgan doing?",
        standInOwnerId: B,
      },
    });
    expect(noSharedStateForB.statusCode).toBe(201);
    expect(noSharedStateForB.json().exchange).toMatchObject({
      principalId: B,
      answer: "No structured Work State has been published for this member.",
      sources: [],
    });

    const unauthorizedTarget = await app.inject({
      method: "POST",
      url: `/v1/pilot/projects/${fixture.project.id}/stand-in`,
      headers: identity(B),
      payload: {
        question: "What is Taylor doing?",
        standInOwnerId: C,
      },
    });
    expect(unauthorizedTarget.statusCode).toBe(403);
  });

  it("accepts a Stand-in question without waiting for the model in product job mode", async () => {
    const fixture = await readyProject(app);
    const connection = await connectAgent(app, fixture.project.id);
    await sendCheckpoint(
      app,
      connection.credential,
      checkpoint(fixture.project.id),
    );
    await app.close();
    const answerStandInQuestion = vi.fn(async () => {
      throw new Error("The API process must not invoke the model.");
    });
    app = await buildTestApp({
      logger: false,
      store: new InMemoryPlatformStore(),
      pilotStore,
      pilotJobs: new TransactionalOutboxJobRunner(),
      pilotIdentities: [
        { id: A, displayName: "Alex Rivera", kind: "human" },
        { id: B, displayName: "Morgan Chen", kind: "human" },
        { id: C, displayName: "Taylor Singh", kind: "human" },
      ],
      deploymentProbe: async () => true,
      providerEncryptionSecret: "test-provider-secret",
      pilotModelGateway: {
        ...modelGateway,
        answerStandInQuestion,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/v1/pilot/projects/${fixture.project.id}/stand-in`,
      headers: identity(B),
      payload: {
        clientMessageId: uuidv7(),
        question: "What is the current implementation status?",
        standInOwnerId: A,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: "pending",
      questionMessage: {
        body: "What is the current implementation status?",
        senderId: B,
        sequence: 1,
      },
    });
    expect(answerStandInQuestion).not.toHaveBeenCalled();
    const thread = await app.inject({
      method: "GET",
      url: `/v1/threads/${response.json().threadId}`,
      headers: identity(B),
    });
    expect(thread.statusCode).toBe(200);
    expect(thread.json().messages).toEqual([
      expect.objectContaining({
        body: "What is the current implementation status?",
        sequence: 1,
      }),
      expect.objectContaining({
        body: "",
        sequence: 2,
        streamState: "pending",
        revision: 1,
      }),
    ]);
  });

  it("queues addressed teammate and own Stand-in replies in their originating group Threads", async () => {
    const fixture = await readyProject(app);
    await app.close();
    const answerStandInQuestion = vi.fn(async () => {
      throw new Error("The API process must not invoke the model.");
    });
    conversationStore = new InMemoryPlatformStore();
    app = await buildTestApp({
      logger: false,
      store: conversationStore,
      pilotStore,
      pilotJobs: new TransactionalOutboxJobRunner(),
      pilotIdentities: [
        { id: A, displayName: "Alex Rivera", kind: "human" },
        { id: B, displayName: "Morgan Chen", kind: "human" },
        { id: C, displayName: "Taylor Singh", kind: "human" },
      ],
      deploymentProbe: async () => true,
      providerEncryptionSecret: "test-provider-secret",
      pilotModelGateway: {
        ...modelGateway,
        answerStandInQuestion,
      },
    });
    const threadId = uuidv7() as ThreadId;
    const messageId = uuidv7() as MessageId;
    const standInId = personalStandInId(A);
    conversationStore.createThread(
      {
        id: threadId,
        kind: "human_group",
        title: "Delivery",
        participantIds: [A, B, standInId],
        standInIds: [standInId],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        sequence: 0,
        accessVersion: 1,
        createdAt: new Date().toISOString(),
      },
      B,
    );
    conversationStore.appendMessage(threadId, {
      id: messageId,
      senderId: B,
      body: "@Alex Rivera 的替身 当前进度如何？",
      mentionedPrincipalIds: [standInId],
      createdAt: new Date().toISOString(),
    });

    const queued = await app.inject({
      method: "POST",
      url: `/v1/threads/${threadId}/messages/${messageId}/stand-in-replies`,
      headers: identity(B),
      payload: { standInOwnerId: A },
    });

    expect(queued.statusCode).toBe(202);
    expect(queued.json()).toMatchObject({
      status: "pending",
      threadId,
      questionMessageId: messageId,
    });
    expect(answerStandInQuestion).not.toHaveBeenCalled();
    expect(
      (await conversationStore.getThread(threadId, B))?.thread.projectId,
    ).toBeUndefined();
    expect((await conversationStore.getThread(threadId, B))?.messages).toEqual([
      expect.objectContaining({ id: messageId, sequence: 1 }),
      expect.objectContaining({
        senderId: standInId,
        sequence: 2,
        body: "",
        streamState: "pending",
      }),
    ]);

    const ownThreadId = uuidv7() as ThreadId;
    const ownMessageId = uuidv7() as MessageId;
    conversationStore.createThread(
      {
        id: ownThreadId,
        kind: "human_group",
        title: "My delivery",
        participantIds: [A, B, standInId],
        standInIds: [standInId],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        sequence: 0,
        accessVersion: 1,
        createdAt: new Date().toISOString(),
      },
      A,
    );
    conversationStore.appendMessage(ownThreadId, {
      id: ownMessageId,
      senderId: A,
      body: "@Alex Rivera 的替身 我当前有什么可共享的进度？",
      mentionedPrincipalIds: [standInId],
      createdAt: new Date().toISOString(),
    });

    const queuedOwn = await app.inject({
      method: "POST",
      url: `/v1/threads/${ownThreadId}/messages/${ownMessageId}/stand-in-replies`,
      headers: identity(A),
      payload: { standInOwnerId: A },
    });

    expect(queuedOwn.statusCode).toBe(202);
    expect(queuedOwn.json()).toMatchObject({
      status: "pending",
      threadId: ownThreadId,
      questionMessageId: ownMessageId,
    });
    expect(
      (await conversationStore.getThread(ownThreadId, A))?.thread.projectId,
    ).toBeUndefined();
    expect(
      (await conversationStore.getThread(ownThreadId, A))?.messages,
    ).toEqual([
      expect.objectContaining({ id: ownMessageId, senderId: A }),
      expect.objectContaining({
        senderId: standInId,
        body: "",
        streamState: "pending",
      }),
    ]);
  });

  it("persists private Work State when the model provider is unavailable", async () => {
    const fixture = await readyProject(app);
    const connection = await connectAgent(app, fixture.project.id);
    const failed = await sendCheckpoint(
      app,
      connection.credential,
      checkpoint(fixture.project.id, {
        clientEventId: "client-event-model-failure-0001",
        summary: "Structured checkpoint with provider unavailable.",
      }),
    );

    expect(failed.statusCode).toBe(202);
    expect(failed.json()).toMatchObject({
      accepted: true,
      published: false,
      standIn: {
        status: "unavailable",
        errorCode: "MODEL_GATEWAY_UNAVAILABLE",
      },
    });
    expect(
      await callMcpTool(
        app,
        connection.credential,
        "stand_in.checkpoint_status",
        { workStateId: failed.json().workStateId },
      ),
    ).toMatchObject({
      workStateId: failed.json().workStateId,
      status: "failed",
      terminal: true,
      published: false,
      lastErrorCode: "MODEL_GATEWAY_UNAVAILABLE",
      deadLetteredAt: expect.any(String),
    });
    expect(
      (await overview(app, fixture.project.id, A)).privateWorkState,
    ).toHaveLength(1);
    expect((await overview(app, fixture.project.id, B)).pulse).toEqual([]);
  });

  it("propagates coordination and privacy posture to another team member", async () => {
    const fixture = await readyProject(app);
    const connection = await connectAgent(app, fixture.project.id);
    const input = checkpoint(fixture.project.id, {
      eventType: "blocker_raised",
      summary: "Waiting for schema ownership confirmation.",
      clientEventId: "client-event-blocker-0001",
      phase: "blocked",
    });
    const accepted = await sendCheckpoint(app, connection.credential, input);
    expect(accepted.json().coordinationThread).toMatchObject({
      trigger: "blocker_raised",
      status: "open",
      safeContext: "Waiting for schema ownership confirmation.",
    });

    const visibleToB = await overview(app, fixture.project.id, B);
    expect(visibleToB.coordination).toHaveLength(1);
    expect(visibleToB.pulse).toHaveLength(1);

    const paused = await app.inject({
      method: "PATCH",
      url: `/v1/pilot/projects/${fixture.project.id}/posture`,
      headers: identity(A),
      payload: { posture: "paused" },
    });
    expect(paused.statusCode).toBe(200);
    expect((await overview(app, fixture.project.id, B)).pulse).toEqual([]);

    await app.inject({
      method: "PATCH",
      url: `/v1/pilot/projects/${fixture.project.id}/posture`,
      headers: identity(A),
      payload: { posture: "collaborative" },
    });
    const workStateId = accepted.json().workStateId;
    const withdrawn = await app.inject({
      method: "POST",
      url: `/v1/pilot/projects/${fixture.project.id}/pulse/${workStateId}/withdraw`,
      headers: {
        ...identity(A),
        "idempotency-key": `withdraw:${fixture.project.id}:${workStateId}`,
      },
    });
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json().duplicate).toBe(false);
    const retried = await app.inject({
      method: "POST",
      url: `/v1/pilot/projects/${fixture.project.id}/pulse/${workStateId}/withdraw`,
      headers: {
        ...identity(A),
        "idempotency-key": `withdraw:${fixture.project.id}:${workStateId}`,
      },
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json().duplicate).toBe(true);
    expect((await overview(app, fixture.project.id, B)).pulse).toEqual([]);
  });
});

function setupPayload() {
  return {
    organizationName: "Intero Pilot",
    teamName: "Platform",
    deploymentBaseUrl: "http://127.0.0.1:4310",
  };
}

async function setupAsA(app: FastifyInstance) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/pilot/setup",
    headers: identity(A),
    payload: setupPayload(),
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

async function configureProvider(app: FastifyInstance) {
  const response = await app.inject({
    method: "PUT",
    url: "/v1/pilot/setup/provider",
    headers: identity(A),
    payload: {
      endpoint: "https://models.example.test/v1",
      apiKey: "provider-secret-value",
      defaultModel: "pilot-model",
    },
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

async function firstTeamId(app: FastifyInstance, principalId: PrincipalId) {
  const response = await app.inject({
    method: "GET",
    url: "/v1/pilot/teams",
    headers: identity(principalId),
  });
  return response.json().teams[0].id as string;
}

async function createJoinLink(app: FastifyInstance, teamId: string) {
  const response = await app.inject({
    method: "POST",
    url: `/v1/pilot/teams/${teamId}/join-links`,
    headers: identity(A),
    payload: {},
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { code: string };
}

async function createProject(
  app: FastifyInstance,
  teamId: string,
  name = "Intero Pilot",
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/pilot/projects",
    headers: identity(A),
    payload: {
      name,
      primaryTeamId: teamId,
      participatingTeamIds: [teamId],
      posture: "collaborative",
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json().project;
}

async function readyProject(app: FastifyInstance) {
  await setupAsA(app);
  await configureProvider(app);
  const teamId = await firstTeamId(app, A);
  const join = await createJoinLink(app, teamId);
  await app.inject({
    method: "POST",
    url: `/v1/pilot/join/${join.code}`,
    headers: identity(B),
  });
  return { teamId, project: await createProject(app, teamId) };
}

async function connectAgent(
  app: FastifyInstance,
  projectId: string,
  owner: PrincipalId = A,
  client: "codex" | "claude-code" | "opencode" = "codex",
  options: { configurationVersion?: number | false } = {},
) {
  const ticketResponse = await app.inject({
    method: "POST",
    url: `/v1/pilot/projects/${projectId}/agent-tickets`,
    headers: identity(owner),
    payload: { client },
  });
  expect(ticketResponse.statusCode).toBe(201);
  const prompt = ticketResponse.json().connectPrompt as string;
  const ticket = prompt.match(/"ticket":\s*"(ticket_[A-Za-z0-9_-]+)"/)?.[1];
  expect(ticket).toBeDefined();
  const payload = {
    ticket,
    client,
    name: client === "codex" ? "Codex Pilot" : `${client} Pilot`,
    workspaceId: uuidv7(),
  };
  const connected = await app.inject({
    method: "POST",
    url: "/v1/pilot/agent/connect",
    payload,
  });
  expect(connected.statusCode).toBe(201);
  const initialization = await app.inject({
    method: "POST",
    url: "/v1/pilot/mcp",
    headers: {
      authorization: `Bearer ${connected.json().credential as string}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    payload: {
      jsonrpc: "2.0",
      id: "initialize-agent-connection",
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: client,
          version: "test",
        },
      },
    },
  });
  expect(initialization.statusCode).toBe(200);
  const validation = await app.inject({
    method: "POST",
    url: "/v1/pilot/mcp",
    headers: {
      authorization: `Bearer ${connected.json().credential as string}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    payload: {
      jsonrpc: "2.0",
      id: "validate-connection",
      method: "tools/call",
      params: {
        name: "intero.validate_connection",
        arguments: {
          verificationCode: connected.json().verification.code,
          ...(options.configurationVersion === false
            ? {}
            : {
                configurationVersion:
                  options.configurationVersion ??
                  PILOT_AGENT_CONFIGURATION_VERSION,
              }),
        },
      },
    },
  });
  expect(validation.statusCode).toBe(200);
  expect(JSON.parse(validation.json().result.content[0].text)).toMatchObject({
    status: "lifecycle_pending",
    connected: false,
    mcpConnected: true,
    lifecycleReady: false,
    ready: false,
    configurationCurrent: options.configurationVersion !== false,
  });
  const connectReuse = await app.inject({
    method: "POST",
    url: "/v1/pilot/agent/connect",
    payload,
  });
  return {
    credential: connected.json().credential as string,
    binding: connected.json().binding,
    verificationCode: connected.json().verification.code as string,
    connectReuse,
  };
}

function checkpoint(
  projectId: string,
  overrides: {
    eventType?: PilotCheckpointInput["eventType"];
    summary?: string;
    clientEventId?: string;
    phase?: PilotCheckpointInput["workstream"]["phase"];
  } = {},
): PilotCheckpointInput {
  return {
    schemaVersion: 2,
    clientEventId: overrides.clientEventId ?? "client-event-progress-0001",
    projectId: projectId as PilotCheckpointInput["projectId"],
    occurredAt: "2026-07-25T10:00:00.000Z",
    eventType: overrides.eventType ?? "work_progressed",
    workstream: {
      key: "pilot-slice",
      title: "Pilot vertical slice",
      phase: overrides.phase ?? "implementing",
    },
    narrative: {
      currentFocus:
        overrides.summary ?? "Implemented scoped checkpoint ingestion.",
      completedOutcome:
        overrides.summary ?? "Implemented scoped checkpoint ingestion.",
      evidence: ["The pilot route contract test passed."],
      nextStep: "Verify the team projection.",
      collaboration: {
        needed: overrides.eventType === "blocker_raised",
        request:
          overrides.eventType === "blocker_raised"
            ? (overrides.summary ?? "Confirm the blocked contract.")
            : "",
        requestedFrom:
          overrides.eventType === "blocker_raised" ? "Project owner" : "",
        ...(overrides.eventType === "blocker_raised"
          ? { targetPrincipalId: B }
          : {}),
      },
    },
    evidenceRefs: ["test:pilot"],
  };
}

async function sendCheckpoint(
  app: FastifyInstance,
  credential: string,
  payload: object,
) {
  return await app.inject({
    method: "POST",
    url: "/v1/pilot/agent/checkpoints",
    headers: { authorization: `Bearer ${credential}` },
    payload,
  });
}

async function callMcpTool(
  app: FastifyInstance,
  credential: string,
  name: string,
  args: object,
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/pilot/mcp",
    headers: {
      authorization: `Bearer ${credential}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    payload: {
      jsonrpc: "2.0",
      id: `tool-${name}`,
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    },
  });
  expect(response.statusCode).toBe(200);
  const result = response.json().result;
  expect(result?.isError).not.toBe(true);
  return JSON.parse(result.content[0].text);
}

async function overview(
  app: FastifyInstance,
  projectId: string,
  principalId: PrincipalId,
) {
  const response = await app.inject({
    method: "GET",
    url: `/v1/pilot/projects/${projectId}/overview`,
    headers: identity(principalId),
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}
