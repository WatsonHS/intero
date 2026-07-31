import {
  containsForbiddenEventField,
  PILOT_AGENT_CONFIGURATION_VERSION,
  PILOT_DATA_POLICY,
  PilotAgentClient,
  PilotCheckpointInput,
  PilotCollaborationPosture,
  type ConversationThread,
  type PilotAgentBinding,
  type PilotAgentTicket,
  type PilotDirectMessage,
  type PilotDirectMessageThread,
  type PilotJoinLink,
  type PilotOrganization,
  type PilotProject,
  type PilotPulseEntry,
  type PilotStandInAnswer,
  type PilotStandInSource,
  type PilotTeam,
  type PilotTeamInvitation,
  PilotTeamRole,
  PilotOrganizationRole,
  PreferredLanguage,
  personalStandInId,
  PrincipalId,
  ProjectId,
  type ThreadId,
  type ThreadMessage,
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
import type { CoordinationKernel } from "./coordination-kernel.js";
import { ACTIVATION_BOOTSTRAP_HEADER } from "./auth.js";
import type { CoordinationTransport, ModelGateway } from "./pilot-ports.js";
import type { PostgresInformationStore } from "./information-store.js";
import type { PilotCheckpointService } from "./pilot-service.js";
import type { PilotStore } from "./pilot-store.js";
import { PilotStoreError } from "./pilot-store.js";
import type { PlatformStore } from "./platform-store.js";
import type { ProviderSecretCipher } from "./provider-secrets.js";
import { normalizeStandInQuestion } from "./stand-in-question-context.js";

export interface PilotRoutesOptions {
  store: PilotStore;
  conversations: PlatformStore;
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
  coordinationKernel?: CoordinationKernel;
  modelGateway: ModelGateway;
  adapters: {
    realtime?: "centrifugo";
    objectStorage: "minio";
    jobs: "inline" | "transactional-outbox";
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
  await reconcileTeamConversationThreads(options);
  app.get("/v1/pilot/bootstrap", async (request) => {
    const currentPrincipal = await options.requestAuth.resolve(request, false);
    const storedOrganization = await options.store.getOrganization();
    const organization = storedOrganization
      ? {
          ...storedOrganization,
          deploymentBaseUrl: effectiveDeploymentBaseUrl(
            options,
            storedOrganization,
          ),
        }
      : undefined;
    return {
      authMode: options.requestAuth.mode,
      ...(options.authPublicUrl
        ? {
            publicUrl: normalizedBaseUrl(options.authPublicUrl),
            deploymentEndpointManaged: true,
          }
        : { deploymentEndpointManaged: false }),
      ...(options.requestAuth.developmentIdentityHeader
        ? { identityHeader: options.requestAuth.developmentIdentityHeader }
        : {}),
      identities: options.requestAuth.developmentIdentities,
      ...(currentPrincipal ? { currentPrincipal } : {}),
      standIn: currentPrincipal
        ? personalStandInPrincipal(currentPrincipal)
        : options.standIn,
      organization,
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
    const baseUrl = normalizedBaseUrl(
      options.authPublicUrl ?? input.deploymentBaseUrl,
    );
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
    await ensureTeamConversationForTeam(options, team, principal.id);
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
    const requestedBaseUrl = normalizedBaseUrl(input.deploymentBaseUrl);
    const baseUrl = normalizedBaseUrl(
      options.authPublicUrl ?? requestedBaseUrl,
    );
    if (options.authPublicUrl && requestedBaseUrl !== baseUrl) {
      throw new PilotStoreError(
        "DEPLOYMENT_ENDPOINT_MANAGED",
        409,
        "The deployment address is managed by INTERO_PUBLIC_URL.",
      );
    }
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
          await ensureTeamConversationForTeam(options, team, principal.id);
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

  app.post("/v1/pilot/teams", async (request, reply) => {
    const principal = await requireIdentity(request, options.requestAuth);
    const input = z
      .object({ name: z.string().trim().min(1).max(160) })
      .strict()
      .parse(request.body);
    const team: PilotTeam = {
      id: uuidv7(),
      organizationId: options.organizationId,
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    const created = await options.store.createTeam({
      team,
      principalId: principal.id,
    });
    await ensureTeamConversationForTeam(options, created, principal.id);
    return reply.status(201).send({
      team: created,
    });
  });

  app.patch<{ Params: { teamId: string } }>(
    "/v1/pilot/teams/:teamId",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const input = z
        .object({ name: z.string().trim().min(1).max(160) })
        .strict()
        .parse(request.body);
      const previousTeam = await options.store.getTeam(request.params.teamId);
      const team = await options.store.renameTeam({
        teamId: request.params.teamId,
        name: input.name,
        principalId: principal.id,
      });
      await ensureTeamConversationForTeam(
        options,
        team,
        principal.id,
        previousTeam?.name,
      );
      return { team };
    },
  );

  app.delete<{ Params: { teamId: string } }>(
    "/v1/pilot/teams/:teamId",
    async (request, reply) => {
      const principal = await requireIdentity(request, options.requestAuth);
      await options.store.deleteTeam({
        teamId: request.params.teamId,
        principalId: principal.id,
      });
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { teamId: string } }>(
    "/v1/pilot/teams/:teamId/members",
    async (request, reply) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const input = z
        .object({
          memberId: PrincipalId,
          role: PilotTeamRole.default("member"),
        })
        .strict()
        .parse(request.body);
      const membership = await options.store.addTeamMember({
        teamId: request.params.teamId,
        memberId: input.memberId,
        role: input.role,
        principalId: principal.id,
        now: new Date().toISOString(),
      });
      const team = await options.store.getTeam(request.params.teamId);
      if (!team) throw new Error("Team was not found.");
      await ensureTeamConversationForTeam(options, team, principal.id);
      return reply.status(201).send({ membership });
    },
  );

  app.patch("/v1/pilot/organization", async (request) => {
    const principal = await requireIdentity(request, options.requestAuth);
    const input = z
      .object({ name: z.string().trim().min(1).max(160) })
      .strict()
      .parse(request.body);
    return {
      organization: await options.store.renameOrganization({
        name: input.name,
        principalId: principal.id,
      }),
    };
  });

  app.patch<{ Params: { memberId: string } }>(
    "/v1/pilot/organization/members/:memberId",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const input = z
        .object({ organizationRole: PilotOrganizationRole })
        .strict()
        .parse(request.body);
      return {
        organizationMembership: await options.store.updateOrganizationRole({
          memberId: request.params.memberId as PrincipalId,
          role: input.organizationRole,
          principalId: principal.id,
          now: new Date().toISOString(),
        }),
      };
    },
  );

  /**
   * The whole organization, for the people who govern it. Every other team read
   * is scoped to the caller's memberships; an administrator has to see the
   * teams and projects they do not belong to in order to manage them.
   */
  app.get("/v1/pilot/organization/directory", async (request) => {
    const principal = await requireIdentity(request, options.requestAuth);
    const directory = await options.store.getOrganizationDirectory(
      principal.id,
    );
    const people = await options.principalDirectory.list([
      ...new Set([
        ...directory.organizationMemberships.map(
          (membership) => membership.principalId,
        ),
        ...directory.teamMemberships.map(
          (membership) => membership.principalId,
        ),
        ...directory.projects.map((project) => project.ownerId),
      ]),
    ]);
    const personById = new Map(people.map((person) => [person.id, person]));
    const organizationRoleById = new Map(
      directory.organizationMemberships.map((membership) => [
        membership.principalId,
        membership.role,
      ]),
    );
    return {
      teams: directory.teams.map((team) => ({
        ...team,
        members: directory.teamMemberships
          .filter((membership) => membership.teamId === team.id)
          .flatMap((membership) => {
            const person = personById.get(membership.principalId);
            return person
              ? [
                  {
                    ...person,
                    teamRole: membership.role,
                    organizationRole: organizationRoleById.get(person.id),
                  },
                ]
              : [];
          }),
      })),
      projects: directory.projects,
      members: directory.organizationMemberships.flatMap((membership) => {
        const person = personById.get(membership.principalId);
        return person
          ? [
              {
                ...person,
                organizationRole: membership.role,
                teamIds: directory.teamMemberships
                  .filter((team) => team.principalId === membership.principalId)
                  .map((team) => team.teamId),
              },
            ]
          : [];
      }),
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
        preferredLanguage: principal.preferredLanguage,
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
        preferredLanguage: PreferredLanguage.optional(),
      })
      .strict()
      .refine(
        (value) =>
          value.displayName !== undefined ||
          value.avatarTone !== undefined ||
          value.preferredLanguage !== undefined,
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
        ...(input.preferredLanguage !== undefined
          ? { preferredLanguage: input.preferredLanguage }
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
      const activationPath = `/accept-invitation?token=${encodeURIComponent(token)}`;
      return reply.status(201).send({
        invitation: presentInvitation(invitation, now.toISOString()),
        token,
        activationPath,
        activationUrl: await absolutePublicUrl(options, activationPath),
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
      const activationPath = `/accept-invitation?token=${encodeURIComponent(token)}`;
      return {
        invitation: presentInvitation(invitation, now.toISOString()),
        token,
        activationPath,
        activationUrl: await absolutePublicUrl(options, activationPath),
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
          displayName: z.string().trim().min(1).max(160),
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
              name: input.displayName,
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
      const input = z
        .object({
          displayName: z.string().trim().min(1).max(160),
        })
        .strict()
        .parse(request.body);
      const accepted = await options.store.acceptInvitation({
        tokenHash: sha256(request.params.token),
        email: principal.email,
        principalId: principal.id,
        now: new Date().toISOString(),
      });
      const profile = await options.principalDirectory.updateProfile(
        principal.id,
        { displayName: input.displayName },
      );
      await ensureTeamConversationForTeam(options, accepted.team, principal.id);
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
      const joinPath = `/join/${encodeURIComponent(code)}`;
      return reply.status(201).send({
        link,
        code,
        joinPath,
        joinUrl: await absolutePublicUrl(options, joinPath),
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
      await ensureTeamConversationForTeam(options, team, principal.id);
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
    "/v1/pilot/projects/:projectId",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const input = z
        .object({
          name: z.string().trim().min(1).max(160).optional(),
          ownerId: PrincipalId.optional(),
          primaryTeamId: z.uuid().optional(),
          participatingTeamIds: z.array(z.uuid()).min(1).max(50).optional(),
          posture: PilotCollaborationPosture.optional(),
        })
        .strict()
        .refine(
          (value) =>
            value.name !== undefined ||
            value.ownerId !== undefined ||
            value.primaryTeamId !== undefined ||
            value.participatingTeamIds !== undefined ||
            value.posture !== undefined,
          "At least one project field must be provided.",
        )
        .parse(request.body);
      return {
        project: await options.store.updateProject({
          projectId: ProjectId.parse(request.params.projectId),
          principalId: principal.id,
          now: new Date().toISOString(),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
          ...(input.primaryTeamId !== undefined
            ? { primaryTeamId: input.primaryTeamId }
            : {}),
          ...(input.participatingTeamIds !== undefined
            ? { participatingTeamIds: input.participatingTeamIds }
            : {}),
          ...(input.posture !== undefined ? { posture: input.posture } : {}),
        }),
      };
    },
  );

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
      items: await listCanonicalDirectMessages(options, principal.id),
      principals: await visiblePrincipals(options, principal.id),
    };
  });

  app.post("/v1/pilot/dms", async (request, reply) => {
    const principal = await requireIdentity(request, options.requestAuth);
    const input = z
      .object({ teamId: z.uuid(), peerId: z.uuid() })
      .strict()
      .parse(request.body);
    const memberships = await options.store.listTeamMembers(
      input.teamId,
      principal.id,
    );
    if (
      input.peerId === principal.id ||
      !memberships.some((membership) => membership.principalId === input.peerId)
    ) {
      throw new PilotStoreError(
        "DM_PEER_NOT_AVAILABLE",
        404,
        "The direct-message peer was not found in this team.",
      );
    }
    const participants = [
      principal.id,
      input.peerId as PrincipalId,
    ].toSorted() as [PrincipalId, PrincipalId];
    const existing = (
      await options.conversations.listThreads("human_direct", principal.id)
    ).find((item) => {
      const existingParticipants = directMessageHumanParticipants(item.thread);
      return (
        item.thread.teamId === input.teamId &&
        existingParticipants.length === participants.length &&
        existingParticipants.every(
          (participantId, index) => participantId === participants[index],
        )
      );
    });
    if (existing) {
      return reply
        .status(200)
        .send({ thread: canonicalDirectMessageThread(existing.thread) });
    }
    const peer = await requireDirectoryPrincipal(
      options,
      input.peerId as PrincipalId,
    );
    const thread: ConversationThread = {
      id: directMessageThreadId(input.teamId, participants) as ThreadId,
      kind: "human_direct",
      title: peer.displayName,
      participantIds: participants,
      standInIds: [],
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      sequence: 0,
      accessVersion: 1,
      teamId: input.teamId,
      createdAt: new Date().toISOString(),
    };
    return reply.status(201).send({
      thread: canonicalDirectMessageThread(
        await options.conversations.createThread(thread, principal.id),
      ),
    });
  });

  app.post<{ Params: { threadId: string } }>(
    "/v1/pilot/dms/:threadId/messages",
    async (request, reply) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const input = z
        .object({
          clientMessageId: z.uuid().optional(),
          body: z.string().min(1).max(4_000),
        })
        .strict()
        .parse(request.body);
      const threadId = request.params.threadId as ThreadId;
      const visible = await options.conversations.getThread(
        threadId,
        principal.id,
      );
      if (!visible || visible.thread.kind !== "human_direct") {
        throw new PilotStoreError(
          "DM_NOT_FOUND",
          404,
          "Direct message was not found.",
        );
      }
      const message = await options.conversations.appendMessage(threadId, {
        id: (input.clientMessageId ?? uuidv7()) as ThreadMessage["id"],
        senderId: principal.id,
        body: input.body,
        createdAt: new Date().toISOString(),
      });
      return reply
        .status(201)
        .send({ message: canonicalDirectMessage(message) });
    },
  );

  app.post<{ Params: { threadId: string } }>(
    "/v1/pilot/dms/:threadId/stand-in",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const threadId = request.params.threadId as ThreadId;
      const visible = await options.conversations.getThread(
        threadId,
        principal.id,
      );
      if (!visible || visible.thread.kind !== "human_direct") {
        throw new PilotStoreError(
          "DM_NOT_FOUND",
          404,
          "Direct message was not found.",
        );
      }
      return {
        thread: canonicalDirectMessageThread(
          (
            await options.conversations.addStandInToThread(
              threadId,
              principal.id,
            )
          ).thread,
        ),
      };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/pilot/projects/:projectId/overview",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const projectId = ProjectId.parse(request.params.projectId);
      const [
        projects,
        bindings,
        privateWorkState,
        pulse,
        coordination,
        coordinationRelevance,
      ] = await Promise.all([
        options.store.listProjects(principal.id),
        options.store.listAgentBindings(projectId, principal.id),
        options.store.listPrivateWorkState(projectId, principal.id),
        options.store.listTeamPulse(projectId, principal.id),
        options.coordination.list(projectId, principal.id),
        options.store.listCoordinationRelevance(projectId, principal.id),
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
        coordinationRelevance,
        principals: await visiblePrincipals(options, principal.id),
        organization: await options.store.getOrganization(),
      };
    },
  );

  app.get<{
    Params: { projectId: string };
    Querystring: { standInOwnerId?: string };
  }>("/v1/pilot/projects/:projectId/stand-in", async (request) => {
    const principal = await requireIdentity(request, options.requestAuth);
    const projectId = ProjectId.parse(request.params.projectId);
    const standInOwnerId = PrincipalId.parse(
      request.query.standInOwnerId ?? principal.id,
    );
    const exchanges = await options.store.listStandInExchanges(
      projectId,
      principal.id,
      standInOwnerId,
    );
    const standInOwner = await requireDirectoryPrincipal(
      options,
      standInOwnerId,
    );
    return {
      exchanges,
      threadId: standInConversationThreadId(
        projectId,
        principal.id,
        standInOwnerId,
      ),
      standInOwner,
      standIn: personalStandInPrincipal(standInOwner),
    };
  });

  app.post<{ Params: { projectId: string } }>(
    "/v1/pilot/projects/:projectId/stand-in",
    async (request, reply) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const projectId = ProjectId.parse(request.params.projectId);
      const input = z
        .object({
          clientMessageId: z.uuid().optional(),
          question: z.string().min(1).max(2_000),
          standInOwnerId: z.uuid().optional(),
        })
        .strict()
        .parse(request.body);
      const standInOwnerId = PrincipalId.parse(
        input.standInOwnerId ?? principal.id,
      );
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
      await options.store.listStandInExchanges(
        projectId,
        principal.id,
        standInOwnerId,
      );
      const standInOwner = await requireDirectoryPrincipal(
        options,
        standInOwnerId,
      );
      const pulse = (
        await options.store.listTeamPulse(projectId, principal.id)
      ).filter((entry) => entry.ownerId === standInOwnerId);
      if (options.adapters.jobs === "transactional-outbox") {
        const now = new Date().toISOString();
        const questionMessageId = input.clientMessageId ?? uuidv7();
        const threadId = standInConversationThreadId(
          projectId,
          principal.id,
          standInOwnerId,
        ) as ThreadId;
        const standInId = personalStandInId(standInOwnerId);
        const questionMessage =
          await options.conversations.enqueueStandInQuestion({
            jobId: derivedUuid(
              "intero-stand-in-question-job-v1",
              questionMessageId,
            ) as import("@intero/domain").OperationId,
            projectId,
            standInOwnerId,
            askedByPrincipalId: principal.id,
            answerMessageId: derivedUuid(
              "intero-stand-in-question-answer-v1",
              questionMessageId,
            ) as import("@intero/domain").MessageId,
            preferredLanguage: standInOwner.preferredLanguage ?? "en-US",
            recordExchange: true,
            source: {
              kind: "new_message",
              thread: {
                id: threadId,
                kind: "stand_in",
                title: `${standInOwner.displayName} 的替身`,
                participantIds: [principal.id, standInId],
                standInIds: [standInId],
                accessMode: "agent_readable",
                priorHistoryGranted: false,
                sequence: 0,
                accessVersion: 1,
                createdAt: now,
              },
              messageId:
                questionMessageId as import("@intero/domain").MessageId,
              body: input.question,
              createdAt: now,
            },
          });
        return reply.status(202).send({
          status: "pending",
          threadId,
          questionMessage,
          standInOwner,
          standIn: personalStandInPrincipal(standInOwner),
        });
      }
      const generated = await generateStandInAnswer(options, {
        organizationId: project.organizationId,
        project,
        standInOwnerId,
        standInOwnerDisplayName: standInOwner.displayName,
        askedByPrincipalId: principal.id,
        preferredLanguage: standInOwner.preferredLanguage ?? "en-US",
        question: input.question,
        pulse,
      });
      const { answer, sources } = generated;
      const structuredAnswer = {
        answer: answer.answer,
        currentStatus: answer.currentStatus,
        completedOutcome: answer.completedOutcome,
        evidence: answer.evidence,
        nextStep: answer.nextStep,
        neededCollaboration: answer.neededCollaboration,
      };
      const exchange = await options.store.recordStandInExchange({
        projectId,
        standInOwnerId,
        askedByPrincipalId: principal.id,
        question: input.question,
        answer: answer.answer,
        structuredAnswer,
        sources,
        now: new Date().toISOString(),
      });
      return reply.status(201).send({
        exchange,
        standInOwner,
        standIn: personalStandInPrincipal(standInOwner),
      });
    },
  );

  app.post<{
    Params: { projectId: string; threadId: string; messageId: string };
  }>(
    "/v1/pilot/projects/:projectId/threads/:threadId/messages/:messageId/stand-in-replies",
    async (request, reply) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const input = z
        .object({ standInOwnerId: z.uuid() })
        .strict()
        .parse(request.body);
      const result = await handleGroupStandInReply(options, {
        principal,
        threadId: request.params.threadId as ThreadId,
        messageId: request.params.messageId as ThreadMessage["id"],
        standInOwnerId: PrincipalId.parse(input.standInOwnerId),
        requestedProjectId: ProjectId.parse(request.params.projectId),
      });
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post<{ Params: { threadId: string; messageId: string } }>(
    "/v1/threads/:threadId/messages/:messageId/stand-in-replies",
    async (request, reply) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const input = z
        .object({ standInOwnerId: z.uuid() })
        .strict()
        .parse(request.body);
      const result = await handleGroupStandInReply(options, {
        principal,
        threadId: request.params.threadId as ThreadId,
        messageId: request.params.messageId as ThreadMessage["id"],
        standInOwnerId: PrincipalId.parse(input.standInOwnerId),
      });
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/v1/pilot/projects/:projectId/agent-connections",
    async (request, reply) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const input = z
        .object({
          client: PilotAgentClient,
          bindingId: z.uuid().optional(),
        })
        .strict()
        .parse(request.body);
      const projectId = ProjectId.parse(request.params.projectId);
      const repairBinding = input.bindingId
        ? (await options.store.listAgentBindings(projectId, principal.id)).find(
            (binding) =>
              binding.id === input.bindingId &&
              binding.ownerId === principal.id &&
              binding.client === input.client &&
              !binding.disconnectedAt,
          )
        : undefined;
      if (input.bindingId && !repairBinding) {
        throw new PilotStoreError(
          "AGENT_CONNECTION_NOT_FOUND",
          404,
          "The active Agent connection to repair was not found.",
        );
      }
      const issued = await issueAgentTicket(
        options,
        principal,
        projectId,
        input.client,
      );
      return reply.status(201).send({
        ticket: presentAgentTicket(issued.ticket),
        bindingId: repairBinding?.id ?? issued.ticket.id,
        mcpUrl: `${issued.baseUrl}/v1/pilot/mcp`,
        connectPrompt: buildConnectPrompt(
          input.client,
          issued.baseUrl,
          issued.rawTicket,
          issued.ticket.expiresAt,
          issued.project,
          issued.ticket.preferredLanguage,
          repairBinding?.id,
        ),
      });
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
      const issued = await issueAgentTicket(
        options,
        principal,
        ProjectId.parse(request.params.projectId),
        input.client,
      );
      return reply.status(201).send({
        ticket: presentAgentTicket(issued.ticket),
        connectPrompt: buildConnectPrompt(
          input.client,
          issued.baseUrl,
          issued.rawTicket,
          issued.ticket.expiresAt,
          issued.project,
          issued.ticket.preferredLanguage,
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
    const verificationCode = `verify_${randomBytes(24).toString("base64url")}`;
    const verificationExpiresAt = new Date(
      Date.parse(now) + 10 * 60_000,
    ).toISOString();
    const pending = await findTicketContext(
      options.store,
      input.ticket,
      input.client,
      input.name,
      input.workspaceId,
      credential,
      verificationCode,
      verificationExpiresAt,
      now,
    );
    return reply.status(201).send({
      credential,
      verification: {
        code: verificationCode,
        expiresAt: verificationExpiresAt,
      },
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
    const collaboration = input.narrative.collaboration;
    if (
      (input.eventType === "dependency_declared" || collaboration.needed) &&
      !collaboration.targetPrincipalId
    ) {
      throw new PilotStoreError(
        "COLLABORATION_TARGET_REQUIRED",
        400,
        "Routed collaboration requires a structured targetPrincipalId.",
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
      const clientMutationId = z
        .string()
        .min(8)
        .max(200)
        .parse(request.headers["idempotency-key"]);
      return options.store.withdrawPulseEntry(
        ProjectId.parse(request.params.projectId),
        request.params.workStateId,
        principal.id,
        clientMutationId,
        new Date().toISOString(),
      );
    },
  );

  app.post<{ Params: { threadId: string } }>(
    "/v1/pilot/coordination/:threadId/conclusion",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const now = new Date().toISOString();
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
        now,
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
      await options.coordinationKernel?.refresh(thread, now);
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
      await options.coordinationKernel?.refresh(thread, now, principal.id);
      return { thread };
    },
  );

  app.post<{ Params: { threadId: string } }>(
    "/v1/pilot/coordination/:threadId/relevance",
    async (request) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const input = z
        .object({
          action: z.enum(["dismiss", "mute", "revisit"]),
        })
        .strict()
        .parse(request.body);
      return {
        relevance: await options.store.updateCoordinationRelevance({
          coordinationThreadId: request.params.threadId,
          principalId: principal.id,
          action: input.action,
          now: new Date().toISOString(),
        }),
      };
    },
  );
}

async function handleGroupStandInReply(
  options: PilotRoutesOptions,
  input: {
    principal: AuthenticatedPrincipal;
    threadId: ThreadId;
    messageId: ThreadMessage["id"];
    standInOwnerId: PrincipalId;
    requestedProjectId?: ProjectId;
  },
): Promise<{ statusCode: 201 | 202; body: Record<string, unknown> }> {
  const standInOwner = await requireDirectoryPrincipal(
    options,
    input.standInOwnerId,
  );
  const standInId = personalStandInId(input.standInOwnerId);
  const visibleThread = await options.conversations.getThread(
    input.threadId,
    input.principal.id,
  );
  if (
    !visibleThread ||
    visibleThread.thread.accessMode !== "agent_readable" ||
    !visibleThread.thread.standInIds.includes(standInId)
  ) {
    throw new PilotStoreError(
      "STAND_IN_REPLY_THREAD_NOT_FOUND",
      404,
      "The Stand-in reply Thread was not found.",
    );
  }
  if (
    input.requestedProjectId &&
    visibleThread.thread.projectId &&
    visibleThread.thread.projectId !== input.requestedProjectId
  ) {
    throw new PilotStoreError(
      "STAND_IN_REPLY_PROJECT_MISMATCH",
      409,
      "The Thread belongs to a different Project.",
    );
  }
  const contextualProjectId =
    input.requestedProjectId ?? visibleThread.thread.projectId;
  const project = contextualProjectId
    ? (await options.store.listProjects(input.principal.id)).find(
        (candidate) => candidate.id === contextualProjectId,
      )
    : undefined;
  if (input.requestedProjectId && !project) {
    throw new PilotStoreError(
      "PROJECT_NOT_FOUND",
      404,
      "Project was not found.",
    );
  }
  if (project) {
    await options.store.listStandInExchanges(
      project.id,
      input.principal.id,
      input.standInOwnerId,
    );
  }
  const questionMessage = await options.conversations.getThreadMessage(
    input.threadId,
    input.principal.id,
    input.messageId,
  );
  if (
    !questionMessage?.body ||
    questionMessage.senderId !== input.principal.id ||
    !questionMessage.mentionedPrincipalIds?.includes(standInId)
  ) {
    throw new PilotStoreError(
      "STAND_IN_REPLY_MESSAGE_NOT_FOUND",
      404,
      "The message that addressed this Stand-in was not found.",
    );
  }
  const answerMessageId = derivedUuid(
    "intero-group-stand-in-answer-v1",
    `${input.messageId}:${input.standInOwnerId}`,
  ) as ThreadMessage["id"];
  const pulse = project
    ? (
        await options.store.listTeamPulse(project.id, input.principal.id)
      ).filter((entry) => entry.ownerId === input.standInOwnerId)
    : [];
  if (options.adapters.jobs === "transactional-outbox") {
    await options.conversations.enqueueStandInQuestion({
      jobId: derivedUuid(
        "intero-group-stand-in-question-job-v1",
        `${input.messageId}:${input.standInOwnerId}`,
      ) as import("@intero/domain").OperationId,
      ...(project ? { projectId: project.id } : {}),
      standInOwnerId: input.standInOwnerId,
      askedByPrincipalId: input.principal.id,
      answerMessageId,
      preferredLanguage: standInOwner.preferredLanguage ?? "en-US",
      recordExchange: false,
      source: {
        kind: "existing_message",
        threadId: input.threadId,
        messageId: input.messageId,
        createdAt: new Date().toISOString(),
      },
    });
    return {
      statusCode: 202,
      body: {
        status: "pending",
        threadId: input.threadId,
        questionMessageId: input.messageId,
        answerMessageId,
        standInOwner,
        standIn: personalStandInPrincipal(standInOwner),
      },
    };
  }
  const preferredLanguage = standInOwner.preferredLanguage ?? "en-US";
  const generated = await generateStandInAnswer(options, {
    organizationId: options.organizationId,
    ...(project ? { project } : {}),
    standInOwnerId: input.standInOwnerId,
    standInOwnerDisplayName: standInOwner.displayName,
    askedByPrincipalId: input.principal.id,
    preferredLanguage,
    question: normalizeStandInQuestion({
      question: questionMessage.body,
      standInOwnerDisplayName: standInOwner.displayName,
      preferredLanguage,
    }),
    pulse,
  });
  const answerMessage = await options.conversations.appendMessage(
    input.threadId,
    {
      id: answerMessageId,
      senderId: standInId,
      body: generated.answer.answer,
      createdAt: new Date().toISOString(),
    },
  );
  return {
    statusCode: 201,
    body: {
      status: "complete",
      threadId: input.threadId,
      questionMessageId: input.messageId,
      answerMessage,
      sources: generated.sources,
      standInOwner,
      standIn: personalStandInPrincipal(standInOwner),
    },
  };
}

async function generateStandInAnswer(
  options: PilotRoutesOptions,
  input: {
    organizationId: PilotOrganization["id"];
    project?: PilotProject;
    standInOwnerId: PrincipalId;
    standInOwnerDisplayName: string;
    askedByPrincipalId: PrincipalId;
    preferredLanguage: "zh-CN" | "en-US";
    question: string;
    pulse: PilotPulseEntry[];
  },
): Promise<{ answer: PilotStandInAnswer; sources: PilotStandInSource[] }> {
  const answer = await options.modelGateway.answerStandInQuestion({
    organizationId: input.organizationId,
    ...(input.project
      ? {
          project: {
            id: input.project.id,
            name: input.project.name,
            posture: input.project.posture,
          },
        }
      : {}),
    standInOwnerId: input.standInOwnerId,
    standInOwnerDisplayName: input.standInOwnerDisplayName,
    askedByPrincipalId: input.askedByPrincipalId,
    preferredLanguage: input.preferredLanguage,
    question: input.question,
    sources: input.pulse,
  });
  const byWorkStateId = new Map(
    input.pulse.map((source) => [source.workStateId, source]),
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
  return { answer, sources };
}

async function findTicketContext(
  store: PilotStore,
  rawTicket: string,
  client: PilotAgentBinding["client"],
  name: string,
  workspaceId: string,
  credential: string,
  verificationCode: string,
  verificationExpiresAt: string,
  now: string,
): Promise<PilotAgentBinding> {
  const ticketHash = sha256(rawTicket);
  const ticket = await store.resolveAgentTicket(ticketHash, now);
  const binding: PilotAgentBinding = {
    id: ticket.id,
    projectId: ticket.projectId,
    ownerId: ticket.ownerId,
    client,
    name,
    workspaceId,
    preferredLanguage: ticket.preferredLanguage,
    authMode: "project_bearer",
    credentialHash: sha256(credential),
    verificationCodeHash: sha256(verificationCode),
    verificationExpiresAt,
    createdAt: now,
  };
  return store.exchangeAgentTicket(ticketHash, binding, now);
}

async function issueAgentTicket(
  options: PilotRoutesOptions,
  principal: AuthenticatedPrincipal,
  projectId: ProjectId,
  client: PilotAgentBinding["client"],
): Promise<{
  ticket: PilotAgentTicket;
  rawTicket: string;
  project: PilotProject;
  baseUrl: string;
}> {
  const [organization, project] = await Promise.all([
    options.store.getOrganization(),
    options.store
      .listProjects(principal.id)
      .then((projects) => projects.find((item) => item.id === projectId)),
  ]);
  if (!organization) {
    throw new PilotStoreError(
      "SETUP_REQUIRED",
      409,
      "Intero setup must be completed first.",
    );
  }
  if (!project) {
    throw new PilotStoreError(
      "PROJECT_NOT_FOUND",
      404,
      "Project was not found.",
    );
  }
  const rawTicket = `ticket_${randomBytes(24).toString("base64url")}`;
  const now = new Date();
  const ticket: PilotAgentTicket = {
    id: uuidv7(),
    projectId,
    ownerId: principal.id,
    client,
    preferredLanguage: principal.preferredLanguage ?? "en-US",
    ticketHash: sha256(rawTicket),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
  };
  await options.store.createAgentTicket(ticket);
  return {
    ticket,
    rawTicket,
    project,
    baseUrl: effectiveDeploymentBaseUrl(options, organization),
  };
}

function authHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(",") : String(value));
  }
  return headers;
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
  return [
    ...principals,
    ...principals
      .filter((principal) => principal.kind === "human")
      .map(personalStandInPrincipal),
  ];
}

async function requireDirectoryPrincipal(
  options: PilotRoutesOptions,
  principalId: PrincipalId,
): Promise<AuthenticatedPrincipal> {
  const principal = (await options.principalDirectory.list([principalId]))[0];
  if (!principal || principal.kind !== "human") {
    throw new PilotStoreError(
      "STAND_IN_OWNER_NOT_FOUND",
      404,
      "The personal Stand-in owner was not found.",
    );
  }
  return principal;
}

function personalStandInPrincipal(
  owner: Pick<AuthenticatedPrincipal, "id" | "displayName">,
): Omit<AuthenticatedPrincipal, "email"> {
  return {
    id: personalStandInId(owner.id),
    displayName: `${owner.displayName} 的替身`,
    kind: "stand_in",
  };
}

async function listCanonicalDirectMessages(
  options: PilotRoutesOptions,
  principalId: PrincipalId,
): Promise<
  Array<{
    thread: PilotDirectMessageThread;
    messages: PilotDirectMessage[];
  }>
> {
  const items = await options.conversations.listThreads(
    "human_direct",
    principalId,
  );
  return items
    .filter(
      (item) =>
        item.thread.teamId !== undefined &&
        directMessageHumanParticipants(item.thread).length === 2,
    )
    .map((item) => ({
      thread: canonicalDirectMessageThread(item.thread),
      messages: item.messages
        .filter(
          (message) =>
            message.kind === "message" &&
            message.serverReadable &&
            message.body.length > 0,
        )
        .map(canonicalDirectMessage),
    }));
}

function canonicalDirectMessageThread(
  thread: ConversationThread,
): PilotDirectMessageThread {
  const participants = directMessageHumanParticipants(thread);
  if (!thread.teamId || participants.length !== 2) {
    throw new Error("Canonical direct message is missing its team or peers.");
  }
  const standInId = thread.standInIds[0];
  return {
    id: thread.id,
    teamId: thread.teamId,
    participantIds: participants as [PrincipalId, PrincipalId],
    ...(standInId ? { standInId } : {}),
    ...(thread.accessChangedAtSequence !== undefined
      ? {
          standInAddedAfterSequence: Math.max(
            0,
            thread.accessChangedAtSequence - 1,
          ),
        }
      : {}),
    sequence: thread.sequence,
    createdAt: thread.createdAt,
  };
}

function canonicalDirectMessage(message: ThreadMessage): PilotDirectMessage {
  if (!message.body) {
    throw new Error("Canonical direct message body was empty.");
  }
  return {
    id: message.id,
    threadId: message.threadId,
    senderId: message.senderId,
    sequence: message.sequence,
    body: message.body,
    createdAt: message.createdAt,
  };
}

function directMessageHumanParticipants(
  thread: ConversationThread,
): PrincipalId[] {
  return thread.participantIds
    .filter((participantId) => !thread.standInIds.includes(participantId))
    .toSorted();
}

export function directMessageThreadId(
  teamId: string,
  participants: readonly [PrincipalId, PrincipalId],
): string {
  return derivedUuid(
    "intero-dm-v1",
    `${teamId}:${participants.toSorted().join(":")}`,
  );
}

export function standInConversationThreadId(
  projectId: string,
  viewerId: PrincipalId,
  standInOwnerId: PrincipalId,
): string {
  return derivedUuid(
    "intero-stand-in-thread-v1",
    `${projectId}:${viewerId}:${standInOwnerId}`,
  );
}

export function teamConversationThreadId(teamId: string): string {
  return derivedUuid("intero-team-thread-v1", teamId);
}

async function reconcileTeamConversationThreads(
  options: PilotRoutesOptions,
): Promise<void> {
  // Some bounded route-test stores intentionally implement only the policy
  // methods under test. Reconciliation is additive and can safely wait until
  // a full PilotStore is mounted.
  const store = options.store as Partial<PilotStore>;
  if (
    typeof store.getAdministratorId !== "function" ||
    typeof store.getOrganizationDirectory !== "function"
  ) {
    return;
  }
  const administratorId = await store.getAdministratorId();
  if (!administratorId) return;
  const directory = await store.getOrganizationDirectory(administratorId);
  for (const team of directory.teams) {
    await ensureTeamConversation(options, {
      team,
      memberIds: directory.teamMemberships
        .filter((membership) => membership.teamId === team.id)
        .map((membership) => membership.principalId),
      preferredActorId: administratorId,
    });
  }
}

async function ensureTeamConversationForTeam(
  options: PilotRoutesOptions,
  team: PilotTeam,
  actorId: PrincipalId,
  syncTitleFrom?: string,
): Promise<ConversationThread> {
  const organizationRole = await options.store.getOrganizationRole(actorId);
  const memberships =
    organizationRole === "admin"
      ? (await options.store.getOrganizationDirectory(actorId)).teamMemberships
      : await options.store.listTeamMembers(team.id, actorId);
  return ensureTeamConversation(options, {
    team,
    memberIds: memberships
      .filter((membership) => membership.teamId === team.id)
      .map((membership) => membership.principalId),
    preferredActorId: actorId,
    ...(syncTitleFrom ? { syncTitleFrom } : {}),
  });
}

async function ensureTeamConversation(
  options: PilotRoutesOptions,
  input: {
    team: PilotTeam;
    memberIds: PrincipalId[];
    preferredActorId: PrincipalId;
    syncTitleFrom?: string;
  },
): Promise<ConversationThread> {
  const participantIds = [...new Set(input.memberIds)];
  const firstParticipantId = participantIds[0];
  if (!firstParticipantId) {
    throw new Error("A Team conversation requires at least one member.");
  }
  const threadId = teamConversationThreadId(input.team.id) as ThreadId;
  let current = (await options.conversations.getThread(threadId))?.thread;
  if (!current) {
    try {
      return await options.conversations.createThread(
        {
          id: threadId,
          kind: "room",
          title: input.team.name,
          participantIds,
          standInIds: [],
          accessMode: "agent_readable",
          priorHistoryGranted: false,
          sequence: 0,
          teamId: input.team.id,
          createdAt: input.team.createdAt,
        },
        firstParticipantId,
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "Thread ID was already used."
      ) {
        throw error;
      }
      current = (await options.conversations.getThread(threadId))?.thread;
    }
  }
  if (!current) throw new Error("Team conversation was not found.");
  const actorId = current.participantIds.includes(input.preferredActorId)
    ? input.preferredActorId
    : current.participantIds.find(
        (principalId) => !current!.standInIds.includes(principalId),
      );
  if (!actorId) {
    throw new Error("Team conversation has no human manager.");
  }
  const addParticipantIds = participantIds.filter(
    (principalId) => !current!.participantIds.includes(principalId),
  );
  const titleShouldFollowTeam =
    input.syncTitleFrom !== undefined &&
    current.title === input.syncTitleFrom &&
    current.title !== input.team.name;
  if (!titleShouldFollowTeam && addParticipantIds.length === 0) {
    return current;
  }
  return (
    await options.conversations.updateThread(
      threadId,
      {
        ...(titleShouldFollowTeam ? { title: input.team.name } : {}),
        addParticipantIds,
      },
      actorId,
    )
  ).thread;
}

function derivedUuid(namespace: string, value: string): string {
  const hex = createHash("sha256")
    .update(`${namespace}:${value}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex
    .slice(12, 16)
    .join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
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
  if (!binding.validatedAt) {
    throw new PilotStoreError(
      "AGENT_VALIDATION_REQUIRED",
      409,
      "Call intero.validate_connection before using Project APIs.",
    );
  }
  return binding;
}

function normalizedBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function effectiveDeploymentBaseUrl(
  options: Pick<PilotRoutesOptions, "authPublicUrl">,
  organization: Pick<PilotOrganization, "deploymentBaseUrl">,
): string {
  return normalizedBaseUrl(
    options.authPublicUrl ?? organization.deploymentBaseUrl,
  );
}

async function absolutePublicUrl(
  options: Pick<PilotRoutesOptions, "authPublicUrl" | "store">,
  path: string,
): Promise<string> {
  const organization = options.authPublicUrl
    ? undefined
    : await options.store.getOrganization();
  const baseUrl = options.authPublicUrl
    ? normalizedBaseUrl(options.authPublicUrl)
    : organization
      ? effectiveDeploymentBaseUrl(options, organization)
      : undefined;
  if (!baseUrl) {
    throw new PilotStoreError(
      "SETUP_REQUIRED",
      409,
      "The Intero deployment address is not configured.",
    );
  }
  return new URL(path, `${baseUrl}/`).toString();
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
  const {
    credentialHash: _credentialHash,
    verificationCodeHash: _verificationCodeHash,
    ...safe
  } = binding;
  return safe;
}

function presentAgentTicket(ticket: PilotAgentTicket) {
  return {
    id: ticket.id,
    client: ticket.client,
    expiresAt: ticket.expiresAt,
  };
}

function buildConnectPrompt(
  client: PilotAgentBinding["client"],
  deploymentBaseUrl: string,
  ticket: string,
  expiresAt: string,
  project: Pick<PilotProject, "id" | "name">,
  preferredLanguage: PilotAgentBinding["preferredLanguage"],
  repairBindingId?: string,
): string {
  const baseUrl = deploymentBaseUrl.replace(/\/+$/, "");
  const clientLabel =
    client === "claude-code"
      ? "Claude Code"
      : client === "opencode"
        ? "OpenCode"
        : "Codex";
  const artifacts =
    client === "codex"
      ? {
          mcp: ".codex/config.toml",
          hooks: ".codex/hooks.json",
          instructions: "AGENTS.md",
          hookImplementation: ".intero/hook.mjs",
          worktreeInclude: ".worktreeinclude",
          worktreePatterns: [
            ".codex/config.toml",
            ".codex/hooks.json",
            ".intero/connection.json",
            ".intero/hook.mjs",
            "AGENTS.md",
          ],
        }
      : client === "claude-code"
        ? {
            mcp: ".mcp.json",
            hooks: ".claude/settings.json",
            instructions: "CLAUDE.md",
            hookImplementation: ".intero/hook.mjs",
          }
        : {
            mcp: "opencode.json",
            hooks: ".opencode/plugins/intero.ts",
            instructions: "AGENTS.md",
            hookImplementation: ".opencode/plugins/intero.ts",
          };
  const nativeConfiguration =
    client === "codex"
      ? {
          mcp: "Merge Intero url, enabled, and Authorization http_headers into [mcp_servers.intero].",
          hooks:
            'Merge privacy-filtered SessionStart/SessionEnd hooks. Resolve the implementation from the active Git root: node "$(git rev-parse --show-toplevel)/.intero/hook.mjs" <lifecycle>.',
          worktrees:
            "Merge artifacts.worktreePatterns into the repository-root .worktreeinclude so Codex managed worktrees receive the project connection files.",
          trust:
            "Use the Codex GUI Hook review flow for the exact repository hook. A fresh task after review must make intero.connection_status.lifecycleReady true.",
        }
      : client === "claude-code"
        ? {
            mcp: "Merge remote HTTP mcpServers.intero with Authorization.",
            hooks: "Merge privacy-filtered SessionStart/SessionEnd hooks.",
          }
        : {
            mcp: "Merge enabled remote mcp.intero with url and Authorization.",
            hooks: "Merge the privacy-filtered session lifecycle plugin.",
          };
  const setup = {
    protocol: "intero-agent-setup/v1",
    project: { id: project.id, name: project.name },
    client: { id: client, label: clientLabel },
    authorization: {
      exchangeUrl: `${baseUrl}/v1/pilot/agent/connect`,
      reuseProbeUrl: `${baseUrl}/v1/pilot/agent/context`,
      ticket,
      expiresAt,
      retryableUntil: "connected_or_expired",
      ...(repairBindingId ? { expectedBindingId: repairBindingId } : {}),
      exchangeRequest: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: {
          ticket,
          client,
          name: `${clientLabel} · <repository-name>`,
          workspaceId: "<stable-workspace-uuid>",
        },
      },
    },
    mcp: {
      name: "intero",
      transport: "streamable-http",
      url: `${baseUrl}/v1/pilot/mcp`,
      authorization: "Bearer credential returned by setup exchange",
    },
    configuration: {
      version: PILOT_AGENT_CONFIGURATION_VERSION,
      localMarker: "artifacts.localCredential.configurationVersion",
      validationArgument: "intero.validate_connection.configurationVersion",
    },
    artifacts: {
      ...artifacts,
      localCredential: ".intero/connection.json",
      credentialFileMode: "0600",
      credentialGitVisibility: "excluded",
    },
    hooks: {
      endpoint: `${baseUrl}/v1/pilot/agent/hooks`,
      events:
        client === "opencode"
          ? ["session.created", "session.idle", "session.deleted"]
          : ["SessionStart", "SessionEnd"],
      allowedPayload: [
        "clientEventId",
        "lifecycle",
        "occurredAt",
        "workstreamKey",
        "workstreamTitle",
        "evidenceRefs",
      ],
      readinessSignal: "intero.connection_status.lifecycleReady",
    },
    projectInstructions: {
      preferredLanguage,
      checkpointTool: "stand_in.report_checkpoint",
      checkpointStatusTool: "stand_in.checkpoint_status",
      checkpointTerminalStatuses: ["published", "private", "failed"],
      initialIntent: {
        trigger: "first_user_request_understood",
        timing: "before_substantive_work",
        eventType: "work_started",
        fields: ["workstreamKey", "workstreamTitle", "narrative.currentFocus"],
      },
      semanticBranchPoints: [
        "intent",
        "decision",
        "blocker",
        "dependency",
        "scope_change",
        "artifact",
        "validation",
        "pause",
        "completion",
      ],
    },
    nativeConfiguration,
  };
  const serializedSetup = JSON.stringify(setup);
  return preferredLanguage === "zh-CN"
    ? [
        `请在当前仓库中完成 ${clientLabel} 到 Intero 项目“${project.name}”的项目级原生连接。`,
        "",
        "连接参数：",
        "```json",
        serializedSetup,
        "```",
        "",
        "按顺序执行：",
        "1. 定位仓库根目录并保留现有非 Intero 配置；从 .intero/connection.json 读取候选 credential 与稳定 workspaceId。",
        "2. 用候选 credential 请求 authorization.reuseProbeUrl；HTTP 200 且 projectId、client、workspaceId 以及可选 authorization.expectedBindingId 匹配时复用，否则进入兑换。",
        "3. 按 authorization.exchangeRequest 发送请求，JSON body 精确使用 ticket、client、name、workspaceId 四个键，依次取 authorization.ticket、client.id、仓库标识、稳定 UUID。同一 ticket 在 connected 或 expiresAt 前可重试；每次 HTTP 201 以最新 credential、verification 为准。把 configuration.version 与凭据原子写入 artifacts.localCredential 并设置 0600。",
        `4. 按 nativeConfiguration 最小合并 ${clientLabel} 原生 MCP 与 Hook；Authorization 使用已保存 credential。SessionStart Hook 发送 hooks.allowedPayload，以原生 session ID 的本地哈希生成 clientEventId 并上报 active 状态；Hook 采用 fail-open。${client === "codex" ? " Hook 命令从 git rev-parse --show-toplevel 定位实现，并把 artifacts.worktreePatterns 合并到仓库根目录 .worktreeinclude。" : ""}`,
        "5. 在项目 instructions 维护 intero-managed 规则：每个新对话理解首条用户请求后、开始实质工作前，按 projectInstructions.initialIntent 调用 stand_in.report_checkpoint，用安全摘要上报正在做的工作；保存返回的 workStateId，并按 statusTool 查询直到 projectInstructions.checkpointTerminalStatuses 之一，依据 action 处理重试或失败。后续 semanticBranchPoints 继续上报，定向协作填写当前项目成员 ID。",
        `6. 校验配置语法与 ${clientLabel} 原生 MCP 注册状态。`,
        client === "codex"
          ? "7. 凭据与 configuration.version 落盘后，直接使用 Codex 内置的新任务/对话能力，在当前仓库发起独立验证对话并跟进结果。按 Codex GUI 的 Hook 审核提示确认当前仓库的 Intero Hook；确认后新建任务。验证任务依次调用 intero.connection_status、用本地 verification.code（已有已验证连接可省略）和 configuration.version 调用 intero.validate_connection、再次调用 intero.connection_status；以 ready=true、configurationCurrent=true 且 lifecycleReady=true 为完成信号，随后移除本地 verification 字段。若状态为 lifecycle_pending，再新建一次任务并回读。本配置任务报告 pending_gui_validation，新对话报告 MCP、配置版本与 Hook 验证结果。"
          : `7. 配置变化时在 ${clientLabel} GUI 启动新验证会话：读取状态、用本地 verification.code 调用 intero.validate_connection、回读 connected 并移除 verification。本任务报告 pending_gui_validation。`,
        "8. 报告 changed、unchanged、preserved、conflicts、verification、connected project/agent，以及 MCP/Hook 两项 readiness；凭证脱敏。验证前状态为 pending_gui_validation。",
      ].join("\n")
    : [
        `Complete the Project-scoped native ${clientLabel} connection from this repository to the Intero Project "${project.name}".`,
        "",
        "Connection parameters:",
        "```json",
        serializedSetup,
        "```",
        "",
        "Execute in order:",
        "1. Locate the repository root and preserve non-Intero settings. Read the candidate credential and stable workspaceId from .intero/connection.json.",
        "2. Probe authorization.reuseProbeUrl with the candidate credential. Reuse an HTTP 200 binding matching projectId, client, workspaceId, and optional authorization.expectedBindingId; otherwise exchange.",
        "3. Send authorization.exchangeRequest with exactly four JSON keys: ticket, client, name, workspaceId, sourced from authorization.ticket, client.id, the repository label, and a stable UUID. The same ticket is retryable until connected or expiresAt; each HTTP 201 makes its latest credential and verification authoritative. Atomically save configuration.version with them in artifacts.localCredential using mode 0600.",
        `4. Minimally merge native ${clientLabel} MCP and hooks per nativeConfiguration. Use the saved credential for Authorization. The SessionStart hook sends hooks.allowedPayload, hashes the native session ID into clientEventId, reports active status, and fails open.${client === "codex" ? " Resolve the hook implementation from git rev-parse --show-toplevel and merge artifacts.worktreePatterns into the repository-root .worktreeinclude." : ""}`,
        "5. Maintain intero-managed Project instructions: after understanding the first user request in every new conversation and before substantive work, follow projectInstructions.initialIntent and call stand_in.report_checkpoint with a safe summary of the current work. Save the returned workStateId and use statusTool until reaching a projectInstructions.checkpointTerminalStatuses value, following action for retries or failures. Continue reporting later semanticBranchPoints and route collaboration to a current Project member.",
        `6. Validate syntax and ${clientLabel} native MCP registration.`,
        client === "codex"
          ? "7. Once the credential and configuration.version are persisted, use Codex's built-in new-task/conversation capability to start an independent validation conversation in this repository and follow its result. Confirm the repository Intero Hook in the Codex GUI review flow, then start a fresh task. The validation task calls intero.connection_status, intero.validate_connection with local verification.code (optional for an already validated connection) plus configuration.version, then intero.connection_status again; ready=true, configurationCurrent=true, and lifecycleReady=true are the completion signal, after which it removes the local verification field. If status is lifecycle_pending, start one more task and read status again. This setup task reports pending_gui_validation, and the new conversation reports MCP, configuration-version, and Hook verification."
          : `7. After a config change, start a fresh ${clientLabel} GUI validation session: read status, call intero.validate_connection with local verification.code, read connected, then remove verification. This task reports pending_gui_validation.`,
        "8. Report changed, unchanged, preserved, conflicts, verification, connected Project/Agent, and both MCP/Hook readiness with redacted credentials; validation starts as pending_gui_validation.",
      ].join("\n");
}
