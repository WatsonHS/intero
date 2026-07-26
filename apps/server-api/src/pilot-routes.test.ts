import {
  type PilotCheckpointInput,
  type OrganizationId,
  type PrincipalId,
  uuidv7,
} from "@intero/domain";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import type { ModelGateway } from "./pilot-ports.js";
import { ModelGatewayUnavailableError } from "./pilot-ports.js";
import { InMemoryPilotStore, PilotStoreError } from "./pilot-store.js";

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
    const source = sources[0]!;
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

  beforeEach(async () => {
    pilotStore = new InMemoryPilotStore();
    app = await buildApp({
      logger: false,
      pilotStore,
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
    expect(chineseTicket.json().connectPrompt).toContain(
      "最后必须实际调用 intero.validate_connection",
    );
    expect(chineseTicket.json().connectPrompt).toContain("zh-CN");
    expect(chineseTicket.json().connectPrompt).toContain(".codex/config.toml");
    expect(chineseTicket.json().connectPrompt).toContain(".codex/hooks.json");
    expect(chineseTicket.json().connectPrompt).toContain("AGENTS.md");
    expect(chineseTicket.json().connectPrompt).toContain("/v1/pilot/mcp");
    expect(chineseTicket.json().connectPrompt).not.toContain("intero-mcp");
    const chineseRawTicket = (
      chineseTicket.json().connectPrompt as string
    ).match(/"ticket":\s*"(ticket_[A-Za-z0-9_-]+)"/)?.[1];
    expect(chineseRawTicket).toBeDefined();
    const chineseBinding = await app.inject({
      method: "POST",
      url: "/v1/pilot/agent/connect",
      payload: {
        ticket: chineseRawTicket,
        client: "codex",
        name: "Codex 中文连接",
        workspaceId: uuidv7(),
      },
    });
    expect(chineseBinding.statusCode).toBe(201);
    expect(chineseBinding.json().binding.preferredLanguage).toBe("zh-CN");

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
      "make one real intero.validate_connection tool call",
    );
    expect(englishTicket.json().connectPrompt).toContain("en-US");
    expect(englishTicket.json().connectPrompt).toContain(".mcp.json");
    expect(englishTicket.json().connectPrompt).toContain(
      ".claude/settings.json",
    );
    expect(englishTicket.json().connectPrompt).toContain("CLAUDE.md");
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
    app = await buildApp({
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
    expect(forbiddenSend.statusCode).toBe(403);
    expect(forbiddenSend.json().code).toBe("DM_PARTICIPANT_REQUIRED");
  });

  it("uses email-bound invitations and audits the member/leader/admin lifecycle", async () => {
    await setupAsA(app);
    const teamId = await firstTeamId(app, A);

    const nonAdminInvite = await app.inject({
      method: "POST",
      url: `/v1/pilot/teams/${teamId}/invitations`,
      headers: identity(B),
      payload: {
        displayName: "Morgan Product",
        email: "morgan.chen@intero.test",
      },
    });
    expect(nonAdminInvite.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: `/v1/pilot/teams/${teamId}/invitations`,
      headers: identity(A),
      payload: {
        displayName: "Morgan Product",
        email: "morgan.chen@intero.test",
      },
    });
    expect(created.statusCode).toBe(201);
    const invitation = created.json();
    expect(invitation.invitation).toMatchObject({
      displayName: "Morgan Product",
      email: "morgan.chen@intero.test",
      status: "pending",
    });
    expect(JSON.stringify(invitation)).not.toContain("tokenHash");

    const mismatch = await app.inject({
      method: "POST",
      url: `/v1/pilot/invitations/${invitation.token}/accept`,
      headers: identity(C),
    });
    expect(mismatch.statusCode).toBe(403);
    expect(mismatch.json().code).toBe("INVITATION_EMAIL_MISMATCH");

    const accepted = await app.inject({
      method: "POST",
      url: `/v1/pilot/invitations/${invitation.token}/accept`,
      headers: identity(B),
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().profile.displayName).toBe("Morgan Product");

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
        displayName: "Taylor Singh",
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
        displayName: "Taylor Singh",
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

    const before = await overview(app, fixture.project.id, A);
    expect(before.bindings[0]).toMatchObject({
      client: "codex",
      name: "Codex · remote-mcp-test",
    });
    expect(before.bindings[0].validatedAt).toBeUndefined();

    const rejectedBeforeValidation = await sendCheckpoint(
      app,
      connected.json().credential,
      checkpoint(fixture.project.id),
    );
    expect(rejectedBeforeValidation.statusCode).toBe(409);
    expect(rejectedBeforeValidation.json().code).toBe(
      "AGENT_VALIDATION_REQUIRED",
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
    const tools = await mcpClient.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "intero.validate_connection",
        "stand_in.current_context",
        "stand_in.report_checkpoint",
      ]),
    );
    const validation = await mcpClient.callTool({
      name: "intero.validate_connection",
      arguments: {},
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
        ? JSON.parse(validationText.text).status
        : undefined,
    ).toBe("connected");
    const firstValidatedAt =
      validationText?.type === "text" && validationText.text
        ? JSON.parse(validationText.text).validatedAt
        : undefined;
    const repeatedValidation = (await mcpClient.callTool({
      name: "intero.validate_connection",
      arguments: {},
    })) as { content: Array<{ type: string; text?: string }> };
    const repeatedText = repeatedValidation.content.find(
      (item) => item.type === "text",
    )?.text;
    expect(
      repeatedText ? JSON.parse(repeatedText).validatedAt : undefined,
    ).toBe(firstValidatedAt);
    await mcpClient.close();

    const after = await overview(app, fixture.project.id, A);
    expect(after.bindings[0].validatedAt).toEqual(expect.any(String));
    expect(after.bindings[0].lastSeenAt).toBe(after.bindings[0].validatedAt);

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
    expect(hook.json().accepted).toBe(true);

    const disconnected = await app.inject({
      method: "POST",
      url: `/v1/pilot/agent-bindings/${connected.json().binding.id}/disconnect`,
      headers: identity(A),
      payload: {},
    });
    expect(disconnected.statusCode).toBe(200);

    const rejectedAfterDisconnect = await app.inject({
      method: "POST",
      url: "/v1/pilot/mcp",
      headers: {
        authorization: `Bearer ${connected.json().credential as string}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      payload: {
        jsonrpc: "2.0",
        id: "revalidate",
        method: "tools/call",
        params: {
          name: "intero.validate_connection",
          arguments: {},
        },
      },
    });
    expect(rejectedAfterDisconnect.statusCode).toBe(401);
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

    const accepted = await sendCheckpoint(
      app,
      connection.credential,
      checkpoint(fixture.project.id),
    );
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toMatchObject({
      accepted: true,
      duplicate: false,
      published: true,
    });
    const duplicate = await sendCheckpoint(
      app,
      connection.credential,
      checkpoint(fixture.project.id),
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
    expect(noSharedStateForB.statusCode).toBe(409);
    expect(noSharedStateForB.json().code).toBe("STAND_IN_CONTEXT_UNAVAILABLE");

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
        arguments: {},
      },
    },
  });
  expect(validation.statusCode).toBe(200);
  expect(JSON.parse(validation.json().result.content[0].text).status).toBe(
    "connected",
  );
  const connectReuse = await app.inject({
    method: "POST",
    url: "/v1/pilot/agent/connect",
    payload,
  });
  return {
    credential: connected.json().credential as string,
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
