import {
  containsForbiddenEventField,
  PILOT_DATA_POLICY,
  PilotAgentClient,
  PilotCheckpointInput,
  PilotCollaborationPosture,
  type PilotAgentBinding,
  type PilotAgentTicket,
  type PilotDirectMessage,
  type PilotJoinLink,
  type PilotOrganization,
  type PilotProject,
  type PilotTeam,
  type PilotTeamInvitation,
  PilotTeamRole,
  PilotOrganizationRole,
  type PrincipalId,
  ProjectId,
  uuidv7,
} from "@intero/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import type {
  AuthenticatedPrincipal,
  InteroAuth,
  PrincipalDirectory,
  RequestAuth,
} from "./auth.js";
import type { PostgresAutomationStore } from "./automation-store.js";
import { ACTIVATION_BOOTSTRAP_HEADER } from "./auth.js";
import type { CoordinationTransport, ModelGateway } from "./pilot-ports.js";
import type { PostgresInformationStore } from "./information-store.js";
import type { PilotCheckpointService } from "./pilot-service.js";
import type { PilotStore } from "./pilot-store.js";
import { PilotStoreError } from "./pilot-store.js";
import type { ProviderSecretCipher } from "./provider-secrets.js";

export interface PilotRoutesOptions {
  store: PilotStore;
  organizationId: PilotOrganization["id"];
  requestAuth: RequestAuth;
  principalDirectory: PrincipalDirectory;
  auth?: InteroAuth;
  authDatabase?: import("pg").Pool;
  authActivationSecret?: string;
  authPublicUrl?: string;
  informationStore?: PostgresInformationStore;
  automationStore?: PostgresAutomationStore;
  standIn: AuthenticatedPrincipal | Omit<AuthenticatedPrincipal, "email">;
  deploymentProbe?: (baseUrl: string) => Promise<boolean>;
  providerSecretCipher: ProviderSecretCipher;
  checkpointService: PilotCheckpointService;
  coordination: CoordinationTransport;
  modelGateway: ModelGateway;
  adapters: {
    realtime: "polling";
    objectStorage: "disabled";
    jobs: "inline";
    coordination: "project-internal-v1";
    projectWork: "postgres" | "unavailable";
  };
}

export async function registerPilotRoutes(
  app: FastifyInstance,
  options: PilotRoutesOptions,
): Promise<void> {
  const activationLimiter = options.authDatabase
    ? new PostgresActivationRateLimiter(
        options.authDatabase,
        options.organizationId,
      )
    : new InMemoryActivationRateLimiter();
  app.get("/v1/pilot/bootstrap", async (request) => {
    const currentPrincipal = await options.requestAuth.resolve(request, false);
    return {
      authMode: options.requestAuth.mode,
      ...(options.requestAuth.developmentIdentityHeader
        ? { identityHeader: options.requestAuth.developmentIdentityHeader }
        : {}),
      identities: options.requestAuth.developmentIdentities,
      ...(currentPrincipal ? { currentPrincipal } : {}),
      standIn: options.standIn,
      organization: await options.store.getOrganization(),
      administratorId: await options.store.getAdministratorId(),
      organizationRole: currentPrincipal
        ? await options.store.getOrganizationRole(currentPrincipal.id)
        : undefined,
      dataPolicy: PILOT_DATA_POLICY,
      adapters: options.adapters,
    };
  });

  app.post("/v1/pilot/setup", async (request, reply) => {
    const principal = await requireIdentity(request, options.requestAuth);
    const input = z
      .object({
        organizationName: z.string().min(1).max(160),
        teamName: z.string().min(1).max(160),
        deploymentBaseUrl: z.url(),
      })
      .strict()
      .parse(request.body);
    const baseUrl = input.deploymentBaseUrl.replace(/\/+$/, "");
    const reachable = await (options.deploymentProbe ?? defaultDeploymentProbe)(
      baseUrl,
    );
    if (!reachable) {
      throw new PilotStoreError(
        "DEPLOYMENT_UNREACHABLE",
        400,
        "The Intero deployment health endpoint could not be validated.",
      );
    }
    const now = new Date().toISOString();
    const organization: PilotOrganization = {
      id: options.organizationId,
      name: input.organizationName,
      deploymentBaseUrl: baseUrl,
      deploymentValidatedAt: now,
      provider: { configured: false },
    };
    const team: PilotTeam = {
      id: uuidv7(),
      organizationId: options.organizationId,
      name: input.teamName,
      createdAt: now,
    };
    await options.store.setupOrganization({
      organization,
      administratorId: principal.id,
      initialTeam: team,
    });
    return reply.status(201).send({ organization, team });
  });

  app.put("/v1/pilot/setup/provider", async (request) => {
    const principal = await requireIdentity(request, options.requestAuth);
    const input = z
      .object({
        endpoint: z.url(),
        apiKey: z.string().min(1).max(4_000),
        defaultModel: z.string().min(1).max(160),
      })
      .strict()
      .parse(request.body);
    const organization = await options.store.configureProvider({
      administratorId: principal.id,
      endpoint: input.endpoint.replace(/\/+$/, ""),
      defaultModel: input.defaultModel,
      encryptedApiKey: options.providerSecretCipher.encrypt(input.apiKey),
    });
    return { organization };
  });

  app.patch("/v1/pilot/settings/deployment", async (request) => {
    const principal = await requireIdentity(request, options.requestAuth);
    const input = z
      .object({ deploymentBaseUrl: z.url() })
      .strict()
      .parse(request.body);
    const baseUrl = input.deploymentBaseUrl.replace(/\/+$/, "");
    const reachable = await (options.deploymentProbe ?? defaultDeploymentProbe)(
      baseUrl,
    );
    if (!reachable) {
      throw new PilotStoreError(
        "DEPLOYMENT_UNREACHABLE",
        400,
        "The Intero deployment health endpoint could not be validated.",
      );
    }
    return {
      organization: await options.store.updateDeploymentEndpoint({
        administratorId: principal.id,
        deploymentBaseUrl: baseUrl,
        deploymentValidatedAt: new Date().toISOString(),
      }),
    };
  });

  app.get("/v1/pilot/teams", async (request) => {
    const principal = await requireIdentity(request, options.requestAuth);
    const teams = await options.store.listTeams(principal.id);
    return {
      teams: await Promise.all(
        teams.map(async (team) => {
          const memberships = await options.store.listTeamMembers(
            team.id,
            principal.id,
          );
          const members = await options.principalDirectory.list(
            memberships.map((membership) => membership.principalId),
          );
          const memberById = new Map(
            members.map((member) => [member.id, member]),
          );
          return {
            ...team,
            members: await Promise.all(
              memberships.flatMap((membership) => {
                const member = memberById.get(membership.principalId);
                return member
                  ? [
                      (async () => ({
                        ...member,
                        teamRole: membership.role,
                        organizationRole:
                          await options.store.getOrganizationRole(member.id),
                      }))(),
                    ]
                  : [];
              }),
            ),
          };
        }),
      ),
    };
  });

  app.get("/v1/pilot/profile", async (request) => {
    const principal = await requireIdentity(request, options.requestAuth);
    return {
      profile: {
        id: principal.id,
        displayName: principal.displayName,
        email: principal.email,
        avatarTone: principal.avatarTone,
        organizationRole: await options.store.getOrganizationRole(principal.id),
      },
    };
  });

  app.patch("/v1/pilot/profile", async (request) => {
    const principal = await requireIdentity(request, options.requestAuth);
    const input = z
      .object({
        displayName: z.string().trim().min(1).max(160).optional(),
        avatarTone: z.enum(["accent", "green", "amber", "cool"]).optional(),
      })
      .strict()
      .refine(
        (value) =>
          value.displayName !== undefined || value.avatarTone !== undefined,
        "At least one profile field must be provided.",
      )
      .parse(request.body);
    return {
      profile: await options.principalDirectory.updateProfile(principal.id, {
        ...(input.displayName !== undefined
          ? { displayName: input.displayName }
          : {}),
        ...(input.avatarTone !== undefined
          ? { avatarTone: input.avatarTone }
          : {}),
      }),
    };
  });

  app.get<{ Params: { teamId: string } }>(
    "/v1/pilot/teams/:teamId/invitations",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const invitations = await options.store.listInvitations(
        request.params.teamId,
        principal.id,
      );
      return {
        invitations: invitations.map((invitation) =>
          presentInvitation(invitation, new Date().toISOString()),
        ),
      };
    },
  );

  app.post<{ Params: { teamId: string } }>(
    "/v1/pilot/teams/:teamId/invitations",
    async (request, reply) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const input = z
        .object({
          displayName: z.string().trim().min(1).max(160),
          email: z.email().max(320),
          expiresInDays: z.number().int().min(1).max(30).default(7),
        })
        .strict()
        .parse(request.body);
      const now = new Date();
      const token = createInvitationToken();
      const invitation: PilotTeamInvitation = {
        id: uuidv7(),
        organizationId: options.organizationId,
        teamId: request.params.teamId,
        displayName: input.displayName,
        email: normalizeEmail(input.email),
        tokenHash: sha256(token),
        createdBy: principal.id,
        expiresAt: new Date(
          now.getTime() + input.expiresInDays * 86_400_000,
        ).toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      await options.store.createInvitation(invitation, principal.id);
      return reply.status(201).send({
        invitation: presentInvitation(invitation, now.toISOString()),
        token,
        activationPath: `/accept-invitation?token=${encodeURIComponent(token)}`,
      });
    },
  );

  app.post<{ Params: { invitationId: string } }>(
    "/v1/pilot/invitations/:invitationId/regenerate",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const input = z
        .object({ expiresInDays: z.number().int().min(1).max(30).default(7) })
        .strict()
        .parse(request.body ?? {});
      const now = new Date();
      const token = createInvitationToken();
      const invitation = await options.store.regenerateInvitation({
        invitationId: request.params.invitationId,
        tokenHash: sha256(token),
        expiresAt: new Date(
          now.getTime() + input.expiresInDays * 86_400_000,
        ).toISOString(),
        principalId: principal.id,
        now: now.toISOString(),
      });
      return {
        invitation: presentInvitation(invitation, now.toISOString()),
        token,
        activationPath: `/accept-invitation?token=${encodeURIComponent(token)}`,
      };
    },
  );

  app.post<{ Params: { invitationId: string } }>(
    "/v1/pilot/invitations/:invitationId/revoke",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const now = new Date().toISOString();
      return {
        invitation: presentInvitation(
          await options.store.revokeInvitation(
            request.params.invitationId,
            principal.id,
            now,
          ),
          now,
        ),
      };
    },
  );

  app.get<{ Params: { token: string } }>(
    "/v1/pilot/invitations/:token",
    async (request) => {
      const invitation = await options.store.findInvitationByTokenHash(
        sha256(request.params.token),
      );
      if (!invitation) {
        throw new PilotStoreError(
          "INVITATION_INVALID",
          404,
          "This invitation is invalid.",
        );
      }
      const [organization, team] = await Promise.all([
        options.store.getOrganization(),
        options.store.getTeam(invitation.teamId),
      ]);
      if (!organization || !team) {
        throw new PilotStoreError(
          "INVITATION_INVALID",
          404,
          "This invitation is invalid.",
        );
      }
      const activationAccount = options.authDatabase
        ? await options.authDatabase.query(
            `SELECT 1 FROM "user" WHERE lower(email) = $1 LIMIT 1`,
            [invitation.email],
          )
        : undefined;
      return {
        invitation: presentInvitation(invitation, new Date().toISOString()),
        organization: { id: organization.id, name: organization.name },
        team: { id: team.id, name: team.name },
        activationRequired: !activationAccount?.rowCount,
      };
    },
  );

  app.post<{ Params: { token: string } }>(
    "/v1/pilot/invitations/:token/activate",
    async (request, reply) => {
      if (
        !options.auth ||
        !options.authDatabase ||
        !options.authActivationSecret ||
        !options.authPublicUrl
      ) {
        throw new PilotStoreError(
          "AUTHENTICATION_UNAVAILABLE",
          503,
          "Account activation is not configured for this deployment.",
        );
      }
      const input = z
        .object({
          credential: z.enum(["password", "passkey", "both"]),
          password: z.string().min(12).max(128).optional(),
        })
        .strict()
        .superRefine((value, context) => {
          if (value.credential !== "passkey" && value.password === undefined) {
            context.addIssue({
              code: "custom",
              path: ["password"],
              message: "A password is required for this credential choice.",
            });
          }
        })
        .parse(request.body);
      const tokenHash = sha256(request.params.token);
      const rateLimitKey = `${request.ip}:${tokenHash}`;
      const retryAfter = await activationLimiter.consume(rateLimitKey);
      if (retryAfter !== undefined) {
        return reply
          .header("retry-after", String(retryAfter))
          .status(429)
          .send({
            code: "ACTIVATION_RATE_LIMITED",
            message: "Too many activation attempts. Try again later.",
          });
      }
      const invitation =
        await options.store.findInvitationByTokenHash(tokenHash);
      const now = new Date().toISOString();
      if (
        !invitation ||
        invitation.acceptedAt ||
        invitation.revokedAt ||
        invitation.expiresAt <= now
      ) {
        throw new PilotStoreError(
          "INVITATION_INVALID",
          404,
          "This activation link is invalid, expired, revoked, or already used.",
        );
      }
      const existing = await options.authDatabase.query(
        `SELECT 1 FROM "user" WHERE lower(email) = $1 LIMIT 1`,
        [invitation.email],
      );
      if (existing.rowCount) {
        throw new PilotStoreError(
          "ACCOUNT_ALREADY_ACTIVATED",
          409,
          "This account is already activated. Sign in with a Passkey or password.",
        );
      }
      const password = input.password ?? randomBytes(32).toString("base64url");
      const authResponse = await options.auth.handler(
        new Request(
          new URL("/api/auth/sign-up/email", options.authPublicUrl).toString(),
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: options.authPublicUrl,
              [ACTIVATION_BOOTSTRAP_HEADER]: options.authActivationSecret,
            },
            body: JSON.stringify({
              name: invitation.displayName,
              email: invitation.email,
              password,
            }),
          },
        ),
      );
      if (!authResponse.ok) {
        const body = await authResponse
          .json()
          .catch(() => ({ message: "Credential activation failed." }));
        return reply.status(authResponse.status).send(body);
      }
      await options.authDatabase.query(
        `UPDATE "user" SET "emailVerified" = true, "updatedAt" = now()
         WHERE lower(email) = $1`,
        [invitation.email],
      );
      const cookies = authResponse.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);
      return reply.status(201).send({
        activated: true,
        credential: input.credential,
        passkeyEnrollmentRequired:
          input.credential === "passkey" || input.credential === "both",
      });
    },
  );

  app.post<{ Params: { token: string } }>(
    "/v1/pilot/invitations/:token/accept",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const accepted = await options.store.acceptInvitation({
        tokenHash: sha256(request.params.token),
        email: principal.email,
        principalId: principal.id,
        now: new Date().toISOString(),
      });
      const profile = await options.principalDirectory.updateProfile(
        principal.id,
        { displayName: accepted.invitation.displayName },
      );
      return {
        invitation: presentInvitation(
          accepted.invitation,
          new Date().toISOString(),
        ),
        team: accepted.team,
        profile,
        projects: await options.store.listProjects(principal.id),
      };
    },
  );

  app.patch<{
    Params: { teamId: string; memberId: string };
  }>("/v1/pilot/teams/:teamId/members/:memberId", async (request) => {
    const principal = await requireIdentity(request, options.requestAuth);
    const input = z
      .object({
        teamRole: PilotTeamRole.optional(),
        organizationRole: PilotOrganizationRole.optional(),
      })
      .strict()
      .refine(
        (value) =>
          value.teamRole !== undefined || value.organizationRole !== undefined,
        "At least one role must be provided.",
      )
      .parse(request.body);
    const now = new Date().toISOString();
    const memberId = request.params.memberId as PrincipalId;
    const teamMembership = input.teamRole
      ? await options.store.updateTeamMemberRole({
          teamId: request.params.teamId,
          memberId,
          role: input.teamRole,
          principalId: principal.id,
          now,
        })
      : undefined;
    const organizationMembership = input.organizationRole
      ? await options.store.updateOrganizationRole({
          memberId,
          role: input.organizationRole,
          principalId: principal.id,
          now,
        })
      : undefined;
    return { teamMembership, organizationMembership };
  });

  app.delete<{
    Params: { teamId: string; memberId: string };
  }>("/v1/pilot/teams/:teamId/members/:memberId", async (request, reply) => {
    const principal = await requireIdentity(request, options.requestAuth);
    await options.store.removeTeamMember({
      teamId: request.params.teamId,
      memberId: request.params.memberId as PrincipalId,
      principalId: principal.id,
    });
    return reply.status(204).send();
  });

  app.post<{ Params: { teamId: string } }>(
    "/v1/pilot/teams/:teamId/join-links",
    async (request, reply) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const input = z
        .object({
          expiresAt: z.iso.datetime().optional(),
          maxUses: z.number().int().positive().max(10_000).optional(),
        })
        .strict()
        .parse(request.body ?? {});
      const code = `join_${randomBytes(18).toString("base64url")}`;
      const now = new Date().toISOString();
      const link: PilotJoinLink = {
        id: uuidv7(),
        teamId: request.params.teamId,
        createdBy: principal.id,
        useCount: 0,
        createdAt: now,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        ...(input.maxUses !== undefined ? { maxUses: input.maxUses } : {}),
      };
      await options.store.createJoinLink(link, sha256(code), principal.id);
      return reply.status(201).send({
        link,
        code,
        joinPath: `/join/${encodeURIComponent(code)}`,
      });
    },
  );

  app.post<{ Params: { code: string } }>(
    "/v1/pilot/join/:code",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const team = await options.store.redeemJoinLink(
        sha256(request.params.code),
        principal.id,
        new Date().toISOString(),
      );
      return { team };
    },
  );

  app.post<{ Params: { linkId: string } }>(
    "/v1/pilot/join-links/:linkId/revoke",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      return {
        link: await options.store.revokeJoinLink(
          request.params.linkId,
          principal.id,
          new Date().toISOString(),
        ),
      };
    },
  );

  app.get("/v1/pilot/projects", async (request) => {
    const principal = await requireIdentity(request, options.requestAuth);
    return { projects: await options.store.listProjects(principal.id) };
  });

  app.post("/v1/pilot/projects", async (request, reply) => {
    const principal = await requireIdentity(request, options.requestAuth);
    const input = z
      .object({
        name: z.string().min(1).max(160),
        primaryTeamId: z.uuid(),
        participatingTeamIds: z.array(z.uuid()).min(1).max(50),
        posture: PilotCollaborationPosture.default("collaborative"),
      })
      .strict()
      .parse(request.body);
    const organization = await options.store.getOrganization();
    if (!organization) {
      throw new PilotStoreError(
        "SETUP_REQUIRED",
        409,
        "Intero setup must be completed first.",
      );
    }
    const now = new Date().toISOString();
    const project: PilotProject = {
      id: uuidv7() as ProjectId,
      organizationId: organization.id,
      name: input.name,
      ownerId: principal.id,
      primaryTeamId: input.primaryTeamId,
      participatingTeamIds: [...new Set(input.participatingTeamIds)],
      posture: input.posture,
      createdAt: now,
      updatedAt: now,
    };
    return reply
      .status(201)
      .send({ project: await options.store.createProject(project) });
  });

  app.patch<{ Params: { projectId: string } }>(
    "/v1/pilot/projects/:projectId/posture",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const input = z
        .object({ posture: PilotCollaborationPosture })
        .strict()
        .parse(request.body);
      return {
        project: await options.store.updateProjectPosture(
          ProjectId.parse(request.params.projectId),
          principal.id,
          input.posture,
          new Date().toISOString(),
        ),
      };
    },
  );

  app.get("/v1/pilot/dms", async (request) => {
    const principal = await requireIdentity(request, options.requestAuth);
    return {
      items: await options.store.listDirectMessageThreads(principal.id),
      principals: await visiblePrincipals(options, principal.id),
    };
  });

  app.post("/v1/pilot/dms", async (request, reply) => {
    const principal = await requireIdentity(request, options.requestAuth);
    const input = z
      .object({ teamId: z.uuid(), peerId: z.uuid() })
      .strict()
      .parse(request.body);
    return reply.status(201).send({
      thread: await options.store.getOrCreateDirectMessage({
        id: uuidv7(),
        teamId: input.teamId,
        principalId: principal.id,
        peerId: input.peerId as PrincipalId,
        now: new Date().toISOString(),
      }),
    });
  });

  app.post<{ Params: { threadId: string } }>(
    "/v1/pilot/dms/:threadId/messages",
    async (request, reply) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const input = z
        .object({ body: z.string().min(1).max(4_000) })
        .strict()
        .parse(request.body);
      const message: PilotDirectMessage = {
        id: uuidv7(),
        threadId: request.params.threadId,
        senderId: principal.id,
        sequence: 1,
        body: input.body,
        createdAt: new Date().toISOString(),
      };
      return reply
        .status(201)
        .send({ message: await options.store.sendDirectMessage(message) });
    },
  );

  app.post<{ Params: { threadId: string } }>(
    "/v1/pilot/dms/:threadId/stand-in",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      return {
        thread: await options.store.addStandInToDirectMessage({
          threadId: request.params.threadId,
          principalId: principal.id,
          standInId: options.standIn.id,
        }),
      };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/pilot/projects/:projectId/overview",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const projectId = ProjectId.parse(request.params.projectId);
      const [projects, bindings, privateWorkState, pulse, coordination] =
        await Promise.all([
          options.store.listProjects(principal.id),
          options.store.listAgentBindings(projectId, principal.id),
          options.store.listPrivateWorkState(projectId, principal.id),
          options.store.listTeamPulse(projectId, principal.id),
          options.coordination.list(projectId, principal.id),
        ]);
      const project = projects.find((item) => item.id === projectId);
      if (!project) {
        throw new PilotStoreError(
          "PROJECT_NOT_FOUND",
          404,
          "Project was not found.",
        );
      }
      return {
        project,
        bindings: bindings.map(presentBinding),
        privateWorkState,
        pulse,
        coordination,
        principals: await visiblePrincipals(options, principal.id),
        organization: await options.store.getOrganization(),
      };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/pilot/projects/:projectId/stand-in",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const projectId = ProjectId.parse(request.params.projectId);
      return {
        exchanges: await options.store.listStandInExchanges(
          projectId,
          principal.id,
        ),
      };
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/v1/pilot/projects/:projectId/stand-in",
    async (request, reply) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const projectId = ProjectId.parse(request.params.projectId);
      const input = z
        .object({ question: z.string().min(1).max(2_000) })
        .strict()
        .parse(request.body);
      const project = (await options.store.listProjects(principal.id)).find(
        (item) => item.id === projectId,
      );
      if (!project) {
        throw new PilotStoreError(
          "PROJECT_NOT_FOUND",
          404,
          "Project was not found.",
        );
      }
      const pulse = await options.store.listTeamPulse(projectId, principal.id);
      if (pulse.length === 0) {
        throw new PilotStoreError(
          "STAND_IN_CONTEXT_UNAVAILABLE",
          409,
          "No published structured Work State is available for this project.",
        );
      }
      const answer = await options.modelGateway.answerStandInQuestion({
        organizationId: project.organizationId,
        project: {
          id: project.id,
          name: project.name,
          posture: project.posture,
        },
        principalId: principal.id,
        question: input.question,
        sources: pulse,
      });
      const byWorkStateId = new Map(
        pulse.map((source) => [source.workStateId, source]),
      );
      const sources = answer.sourceWorkStateIds.map((workStateId) => {
        const source = byWorkStateId.get(workStateId);
        if (!source) {
          throw new PilotStoreError(
            "STAND_IN_SOURCE_INVALID",
            502,
            "The Stand-in cited a Work State outside the allowed context.",
          );
        }
        return {
          workStateId: source.workStateId,
          title: source.title,
          eventType: source.eventType,
          summary: source.summary,
          narrative: source.narrative,
          freshnessAt: source.freshnessAt,
          provenance: {
            source: source.provenance.source,
            client: source.provenance.client,
            connectionName: source.provenance.connectionName,
            occurredAt: source.provenance.occurredAt,
          },
        };
      });
      const exchange = await options.store.recordStandInExchange({
        projectId,
        principalId: principal.id,
        question: input.question,
        answer: answer.answer,
        structuredAnswer: {
          answer: answer.answer,
          currentStatus: answer.currentStatus,
          completedOutcome: answer.completedOutcome,
          evidence: answer.evidence,
          nextStep: answer.nextStep,
          neededCollaboration: answer.neededCollaboration,
        },
        sources,
        now: new Date().toISOString(),
      });
      return reply.status(201).send({ exchange });
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/v1/pilot/projects/:projectId/agent-tickets",
    async (request, reply) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const input = z
        .object({ client: PilotAgentClient })
        .strict()
        .parse(request.body);
      const rawTicket = `ticket_${randomBytes(24).toString("base64url")}`;
      const now = new Date();
      const ticket: PilotAgentTicket = {
        id: uuidv7(),
        projectId: ProjectId.parse(request.params.projectId),
        ownerId: principal.id,
        client: input.client,
        ticketHash: sha256(rawTicket),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      };
      await options.store.createAgentTicket(ticket);
      const organization = await options.store.getOrganization();
      if (!organization) {
        throw new PilotStoreError(
          "SETUP_REQUIRED",
          409,
          "Intero setup must be completed first.",
        );
      }
      return reply.status(201).send({
        ticket: {
          id: ticket.id,
          client: ticket.client,
          expiresAt: ticket.expiresAt,
        },
        connectPrompt: buildConnectPrompt(
          input.client,
          organization.deploymentBaseUrl,
          rawTicket,
        ),
      });
    },
  );

  app.post("/v1/pilot/agent/connect", async (request, reply) => {
    const input = z
      .object({
        ticket: z.string().min(20).max(200),
        client: PilotAgentClient,
        name: z.string().min(1).max(120),
        workspaceId: z.uuid(),
      })
      .strict()
      .parse(request.body);
    const now = new Date().toISOString();
    const credential = `agent_${randomBytes(32).toString("base64url")}`;
    const pending = await findTicketContext(
      options.store,
      input.ticket,
      input.client,
      input.name,
      input.workspaceId,
      credential,
      now,
    );
    return reply.status(201).send({
      credential,
      binding: presentBinding(pending),
      projectId: pending.projectId,
    });
  });

  app.post("/v1/pilot/agent/checkpoints", async (request, reply) => {
    const binding = await requireAgentBinding(request, options.store);
    const input = PilotCheckpointInput.parse(request.body);
    if (containsForbiddenEventField(request.body)) {
      throw new PilotStoreError(
        "RAW_CONTENT_FORBIDDEN",
        400,
        "Structured checkpoints cannot contain raw content or secrets.",
      );
    }
    const result = await options.checkpointService.submit(
      binding,
      input,
      new Date().toISOString(),
    );
    return reply.status(202).send({
      accepted: result.accepted,
      duplicate: result.duplicate,
      published: result.published,
      standIn: result.standIn,
      workStateId: result.workState.id,
      ...(result.pulseEntry ? { pulseEntry: result.pulseEntry } : {}),
      ...(result.coordinationThread
        ? { coordinationThread: result.coordinationThread }
        : {}),
    });
  });

  app.get("/v1/pilot/agent/context", async (request) => {
    const binding = await requireAgentBinding(request, options.store);
    return { binding: presentBinding(binding) };
  });

  app.post<{ Params: { bindingId: string } }>(
    "/v1/pilot/agent-bindings/:bindingId/disconnect",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      return {
        binding: presentBinding(
          await options.store.disconnectAgentBinding(
            request.params.bindingId,
            principal.id,
            new Date().toISOString(),
          ),
        ),
      };
    },
  );

  app.post<{
    Params: { projectId: string; workStateId: string };
  }>(
    "/v1/pilot/projects/:projectId/pulse/:workStateId/withdraw",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      return {
        entry: await options.store.withdrawPulseEntry(
          ProjectId.parse(request.params.projectId),
          request.params.workStateId,
          principal.id,
          new Date().toISOString(),
        ),
      };
    },
  );

  app.post<{ Params: { threadId: string } }>(
    "/v1/pilot/coordination/:threadId/conclusion",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const input = z
        .object({
          conclusion: z.string().min(1).max(600),
          responsibleParticipantId: z.uuid(),
        })
        .strict()
        .parse(request.body);
      const thread = await options.coordination.proposeConclusion({
        threadId: request.params.threadId,
        principalId: principal.id,
        conclusion: input.conclusion,
        responsibleParticipantId: input.responsibleParticipantId as PrincipalId,
        now: new Date().toISOString(),
      });
      await options.informationStore?.createAttention({
        principalId: input.responsibleParticipantId as PrincipalId,
        projectId: thread.projectId,
        kind: "human_decision",
        title: `Coordination confirmation · ${thread.trigger}`,
        detail: input.conclusion,
        sourceRef: `coordination:${thread.id}`,
        dedupeKey: `coordination-confirm:${thread.id}`,
      });
      return { thread };
    },
  );

  app.post<{ Params: { threadId: string } }>(
    "/v1/pilot/coordination/:threadId/confirm",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const now = new Date().toISOString();
      const thread = await options.coordination.confirm(
        request.params.threadId,
        principal.id,
        now,
      );
      const automationSignal =
        await options.automationStore?.findSignalByCoordinationThread(
          thread.id,
        );
      if (automationSignal) {
        await options.automationStore!.markConfirmed({
          signalId: automationSignal.id,
          actorId: principal.id,
          now,
        });
      }
      await options.informationStore?.resolveAttention(
        principal.id,
        `coordination-confirm:${thread.id}`,
      );
      return { thread };
    },
  );
}

async function findTicketContext(
  store: PilotStore,
  rawTicket: string,
  client: PilotAgentBinding["client"],
  name: string,
  workspaceId: string,
  credential: string,
  now: string,
): Promise<PilotAgentBinding> {
  const ticketHash = sha256(rawTicket);
  const ticket = await store.resolveAgentTicket(ticketHash, now);
  const binding: PilotAgentBinding = {
    id: uuidv7(),
    projectId: ticket.projectId,
    ownerId: ticket.ownerId,
    client,
    name,
    workspaceId,
    credentialHash: sha256(credential),
    createdAt: now,
  };
  return store.exchangeAgentTicket(ticketHash, binding, now);
}

async function requireIdentity(
  request: FastifyRequest,
  requestAuth: RequestAuth,
): Promise<AuthenticatedPrincipal> {
  const principal = await requestAuth.resolve(request);
  if (!principal) {
    throw new PilotStoreError(
      "AUTHENTICATION_REQUIRED",
      401,
      "Sign in to continue.",
    );
  }
  return principal;
}

async function visiblePrincipals(
  options: PilotRoutesOptions,
  principalId: PrincipalId,
): Promise<
  Array<AuthenticatedPrincipal | Omit<AuthenticatedPrincipal, "email">>
> {
  const teams = await options.store.listTeams(principalId);
  const memberships = (
    await Promise.all(
      teams.map((team) => options.store.listTeamMembers(team.id, principalId)),
    )
  ).flat();
  const ids = [
    ...new Set(memberships.map((membership) => membership.principalId)),
  ];
  const principals = await options.principalDirectory.list(ids);
  return principals.some((principal) => principal.id === options.standIn.id)
    ? principals
    : [...principals, options.standIn];
}

async function requireAgentBinding(
  request: FastifyRequest,
  store: PilotStore,
): Promise<PilotAgentBinding> {
  const authorization = request.headers.authorization;
  const credential = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  const binding = credential
    ? await store.findBindingByCredentialHash(sha256(credential))
    : undefined;
  if (!binding) {
    throw new PilotStoreError(
      "AGENT_AUTHENTICATION_REQUIRED",
      401,
      "A valid bound Agent credential is required.",
    );
  }
  return binding;
}

async function defaultDeploymentProbe(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { service?: string };
    return body.service === "intero-api";
  } catch {
    return false;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createInvitationToken(): string {
  return `invite_${randomBytes(24).toString("base64url")}`;
}

interface ActivationRateLimiter {
  consume(key: string, now?: number): Promise<number | undefined>;
}

class InMemoryActivationRateLimiter implements ActivationRateLimiter {
  private readonly attempts = new Map<
    string,
    { count: number; resetAt: number }
  >();

  async consume(key: string, now = Date.now()): Promise<number | undefined> {
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
      return undefined;
    }
    if (current.count >= 5) {
      return Math.max(1, Math.ceil((current.resetAt - now) / 1_000));
    }
    current.count += 1;
    return undefined;
  }
}

class PostgresActivationRateLimiter implements ActivationRateLimiter {
  constructor(
    private readonly database: import("pg").Pool,
    private readonly organizationId: PilotOrganization["id"],
  ) {}

  async consume(key: string, now = Date.now()): Promise<number | undefined> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('intero.organization_id',$1,true)",
        [this.organizationId],
      );
      const keyHash = sha256(key);
      const result = await client.query<{
        attempts: number;
        window_started_at: Date;
      }>(
        `INSERT INTO auth_activation_attempts
          (organization_id,key_hash,window_started_at,attempts)
         VALUES ($1,$2,to_timestamp($3 / 1000.0),1)
         ON CONFLICT (organization_id,key_hash) DO UPDATE SET
           attempts = CASE
             WHEN auth_activation_attempts.window_started_at
                    <= to_timestamp($3 / 1000.0) - interval '15 minutes'
               THEN 1
             ELSE auth_activation_attempts.attempts + 1
           END,
           window_started_at = CASE
             WHEN auth_activation_attempts.window_started_at
                    <= to_timestamp($3 / 1000.0) - interval '15 minutes'
               THEN to_timestamp($3 / 1000.0)
             ELSE auth_activation_attempts.window_started_at
           END,
           updated_at = now()
         RETURNING attempts,window_started_at`,
        [this.organizationId, keyHash, now],
      );
      await client.query(
        `DELETE FROM auth_activation_attempts
         WHERE updated_at < now() - interval '7 days'`,
      );
      await client.query("COMMIT");
      const row = result.rows[0]!;
      if (row.attempts <= 5) return undefined;
      return Math.max(
        1,
        Math.ceil(
          (row.window_started_at.getTime() + 15 * 60_000 - now) / 1_000,
        ),
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function presentInvitation(invitation: PilotTeamInvitation, now: string) {
  const { tokenHash: _tokenHash, ...safe } = invitation;
  return {
    ...safe,
    status: invitation.acceptedAt
      ? ("accepted" as const)
      : invitation.revokedAt
        ? ("revoked" as const)
        : invitation.expiresAt <= now
          ? ("expired" as const)
          : ("pending" as const),
  };
}

function presentBinding(binding: PilotAgentBinding) {
  const { credentialHash: _, ...safe } = binding;
  return safe;
}

function buildConnectPrompt(
  client: PilotAgentBinding["client"],
  deploymentBaseUrl: string,
  ticket: string,
): string {
  return [
    `Connect ${client} to this Intero project.`,
    `Run once: intero-mcp cloud connect --client ${client} --cloud-url ${deploymentBaseUrl} --connect-ticket ${ticket}`,
    "The connect command automatically sends one validation_completed checkpoint to verify the project binding.",
    `Then configure the Agent MCP command: intero-mcp --mcp-source ${client} --cloud`,
    "The ticket is project-scoped, expires in 10 minutes, and can be used once.",
    "Call stand_in.report_checkpoint only with one of the ten structured safe-summary event types.",
  ].join("\n");
}
