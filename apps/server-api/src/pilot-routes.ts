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
  PreferredLanguage,
  personalStandInId,
  PrincipalId,
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
    return reply.status(201).send({
      team: await options.store.createTeam({ team, principalId: principal.id }),
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
      return {
        team: await options.store.renameTeam({
          teamId: request.params.teamId,
          name: input.name,
          principalId: principal.id,
        }),
      };
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
      return reply.status(201).send({
        membership: await options.store.addTeamMember({
          teamId: request.params.teamId,
          memberId: input.memberId,
          role: input.role,
          principalId: principal.id,
          now: new Date().toISOString(),
        }),
      });
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
          standInId: personalStandInId(principal.id),
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
      if (pulse.length === 0) {
        throw new PilotStoreError(
          "STAND_IN_CONTEXT_UNAVAILABLE",
          409,
          "This member has no published structured Work State in the selected project.",
        );
      }
      const answer = await options.modelGateway.answerStandInQuestion({
        organizationId: project.organizationId,
        project: {
          id: project.id,
          name: project.name,
          posture: project.posture,
        },
        standInOwnerId,
        askedByPrincipalId: principal.id,
        preferredLanguage: standInOwner.preferredLanguage ?? "en-US",
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
        standInOwnerId,
        askedByPrincipalId: principal.id,
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
      return reply.status(201).send({
        exchange,
        standInOwner,
        standIn: personalStandInPrincipal(standInOwner),
      });
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/v1/pilot/projects/:projectId/agent-connections",
    async (request, reply) => {
      const principal = await requireIdentity(request, options.requestAuth);
      const input = z
        .object({ client: PilotAgentClient })
        .strict()
        .parse(request.body);
      const projectId = ProjectId.parse(request.params.projectId);
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
      const organization = await options.store.getOrganization();
      if (!organization) {
        throw new PilotStoreError(
          "SETUP_REQUIRED",
          409,
          "Intero setup must be completed first.",
        );
      }
      const now = new Date().toISOString();
      const connectionId = uuidv7();
      const clientLabel =
        input.client === "claude-code"
          ? "Claude Code"
          : input.client === "opencode"
            ? "OpenCode"
            : "Codex";
      const binding: PilotAgentBinding = {
        id: connectionId,
        projectId,
        ownerId: principal.id,
        client: input.client,
        name: `${clientLabel} repository`,
        workspaceId: uuidv7(),
        preferredLanguage: principal.preferredLanguage ?? "en-US",
        authMode: "oauth",
        credentialHash: sha256(randomBytes(32).toString("base64url")),
        createdAt: now,
      };
      await options.store.createAgentBinding(binding);
      const baseUrl = effectiveDeploymentBaseUrl(options, organization);
      const mcpUrl = `${baseUrl}/v1/pilot/projects/${project.id}/agent-connections/${connectionId}/mcp`;
      return reply.status(201).send({
        connection: presentBinding(binding),
        mcpUrl,
        connectPrompt: buildOAuthConnectPrompt(
          input.client,
          mcpUrl,
          project,
          binding.preferredLanguage,
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
      const rawTicket = `ticket_${randomBytes(24).toString("base64url")}`;
      const now = new Date();
      const ticket: PilotAgentTicket = {
        id: uuidv7(),
        projectId: ProjectId.parse(request.params.projectId),
        ownerId: principal.id,
        client: input.client,
        preferredLanguage: principal.preferredLanguage ?? "en-US",
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
      const project = (await options.store.listProjects(principal.id)).find(
        (item) => item.id === ticket.projectId,
      );
      if (!project) {
        throw new PilotStoreError(
          "PROJECT_NOT_FOUND",
          404,
          "Project was not found.",
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
          effectiveDeploymentBaseUrl(options, organization),
          rawTicket,
          ticket.expiresAt,
          project,
          ticket.preferredLanguage,
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
  verificationCode: string,
  verificationExpiresAt: string,
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
    preferredLanguage: ticket.preferredLanguage,
    credentialHash: sha256(credential),
    verificationCodeHash: sha256(verificationCode),
    verificationExpiresAt,
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

function buildOAuthConnectPrompt(
  client: PilotAgentBinding["client"],
  mcpUrl: string,
  project: Pick<PilotProject, "id" | "name">,
  preferredLanguage: PilotAgentBinding["preferredLanguage"],
): string {
  const clientLabel =
    client === "claude-code"
      ? "Claude Code"
      : client === "opencode"
        ? "OpenCode"
        : "Codex";
  const config =
    client === "codex"
      ? [
          "[mcp_servers.intero]",
          `url = "${mcpUrl}"`,
          "enabled = true",
        ].join("\n")
      : client === "claude-code"
        ? JSON.stringify(
            {
              mcpServers: {
                intero: {
                  type: "http",
                  url: mcpUrl,
                },
              },
            },
            null,
            2,
          )
        : JSON.stringify(
            {
              mcp: {
                intero: {
                  type: "remote",
                  url: mcpUrl,
                  enabled: true,
                },
              },
            },
            null,
            2,
          );
  const configFile =
    client === "codex"
      ? ".codex/config.toml"
      : client === "claude-code"
        ? ".mcp.json"
        : "opencode.json";
  const instructionFile = client === "claude-code" ? "CLAUDE.md" : "AGENTS.md";

  return preferredLanguage === "zh-CN"
    ? [
        `把当前仓库的 ${clientLabel} 原生 MCP 连接配置到 Intero Project“${project.name}”。`,
        "",
        `在仓库根目录检查并最小合并 ${configFile}，保留已有配置，将 intero 条目设为：`,
        "```",
        config,
        "```",
        "",
        `在 ${instructionFile} 的 intero-managed 小节中记录：当前 Intero Project ID 是 ${project.id}；在工作意图、重要决定、阻塞、依赖、阶段性产出、验证结果和完成时，通过 stand_in.report_checkpoint 上报结构化语义检查点。`,
        "",
        `校验 ${configFile} 的语法和最终 intero URL。完成状态写为 configured_waiting_for_oauth，并提示用户在 ${clientLabel} GUI 的 MCP 设置中对 Intero 执行 Authenticate。Intero 服务端收到绑定到该 connection URL 的 OAuth 身份和原生 MCP initialize 后，会自动完成真实连接验证。`,
      ].join("\n")
    : [
        `Configure this repository's native ${clientLabel} MCP connection for the Intero Project "${project.name}".`,
        "",
        `Inspect and minimally merge ${configFile} at the repository root, preserving existing settings and setting the intero entry to:`,
        "```",
        config,
        "```",
        "",
        `Add an intero-managed section to ${instructionFile}: the current Intero Project ID is ${project.id}; report structured semantic checkpoints with stand_in.report_checkpoint at work intent, important decisions, blockers, dependencies, milestone outputs, validation results, and completion.`,
        "",
        `Validate ${configFile} syntax and the final intero URL. Finish with configured_waiting_for_oauth and direct the user to Authenticate Intero in ${clientLabel}'s GUI MCP settings. Intero completes real connection verification after receiving OAuth identity and a native MCP initialize for this connection URL.`,
      ].join("\n");
}

function buildConnectPrompt(
  client: PilotAgentBinding["client"],
  deploymentBaseUrl: string,
  ticket: string,
  expiresAt: string,
  project: Pick<PilotProject, "id" | "name">,
  preferredLanguage: PilotAgentBinding["preferredLanguage"],
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
          mcp: "Merge [mcp_servers.intero] with url, enabled = true, and an Authorization http_headers entry into .codex/config.toml.",
          hooks:
            "Merge SessionStart and SessionEnd command hooks that invoke the Project-local privacy filter into .codex/hooks.json.",
        }
      : client === "claude-code"
        ? {
            mcp: "Merge mcpServers.intero as a remote HTTP server with an Authorization header into .mcp.json.",
            hooks:
              "Merge SessionStart and SessionEnd command hooks that invoke the Project-local privacy filter into .claude/settings.json.",
          }
        : {
            mcp: "Merge mcp.intero as an enabled remote server with url and Authorization headers into opencode.json.",
            hooks:
              "Merge a privacy-filtering session.created/session.idle/session.deleted plugin into .opencode/plugins/intero.ts.",
          };
  const manifest = {
    protocol: "intero-agent-setup/v1",
    desiredState: {
      project: { id: project.id, name: project.name },
      agent: { client, label: clientLabel },
      setupAuthorization: {
        exchangeUrl: `${baseUrl}/v1/pilot/agent/connect`,
        reuseProbeUrl: `${baseUrl}/v1/pilot/agent/context`,
        ticket,
        expiresAt,
        singleUse: true,
        reusableWhen:
          "The probe returns HTTP 200, the binding matches this Project and client, validatedAt is present, and the current native client can load the full Intero tool catalog.",
        reconnectWhen:
          "The probe is unauthorized, validation is pending, or intero.connection_status reports disconnected.",
      },
      mcp: {
        name: "intero",
        transport: "streamable-http",
        url: `${baseUrl}/v1/pilot/mcp`,
        authorization: "Bearer credential returned by setup exchange",
        connectionEvidence: [
          "authenticated MCP initialize",
          "intero.validate_connection result",
        ],
        requiredValidationTool: "intero.validate_connection",
      },
      validation: {
        owner: "a fresh native GUI task after Project configuration is saved",
        setupTaskTerminalStatus: "pending_gui_validation",
        temporaryCodePath: ".intero/connection.json#verification.code",
        removeTemporaryCodeAfterSuccess: true,
        connectedEvidence:
          "intero.validate_connection result returned as a native tool call in the fresh GUI task",
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
        idempotency:
          "Derive clientEventId deterministically from client, lifecycle event, and a local hash of the native event/session ID. Never transmit the raw session ID.",
      },
      projectInstructions: {
        preferredLanguage,
        checkpointTool: "stand_in.report_checkpoint",
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
        forbiddenContent: [
          "raw prompts",
          "file contents",
          "diffs",
          "terminal output",
          "tool logs",
          "secrets",
        ],
      },
      artifacts: {
        ...artifacts,
        localCredential: ".intero/connection.json",
      },
      nativeConfiguration,
    },
  };
  const serializedManifest = JSON.stringify(manifest, null, 2);
  return preferredLanguage === "zh-CN"
    ? [
        `请在当前仓库中完成 ${clientLabel} 到 Intero 项目“${project.name}”的原生连接。检查并维护项目级配置，再交给新的原生 GUI 任务完成真实 MCP 验证。`,
        "",
        "以下 JSON 是声明式期望状态。先检查现有配置并生成最小合并方案，只维护 Intero 项；保留所有无关配置。",
        "```json",
        serializedManifest,
        "```",
        "",
        "执行要求：",
        "1. 找到仓库根目录。现有本地文件只提供候选 workspaceId，不能单独证明连接有效。用 manifest.setupAuthorization.reuseProbeUrl 检查候选 credential；仅当响应为 HTTP 200、binding 与当前项目及 client 匹配、validatedAt 已存在，并且当前原生客户端能加载完整 Intero 工具目录时复用。若 probe 未授权、验证尚未完成，或 intero.connection_status 返回 disconnected，立即使用本次 ticket 兑换新 credential；沿用已有稳定 workspaceId。",
        "2. 将 credential 写入本机项目配置或原生凭证能力，权限设为 0600，并把所有含 credential 的文件加入 .git/info/exclude。新兑换的 verification.code 仅临时写入 manifest.validation.temporaryCodePath，交给新的 GUI 验证任务；不得提交、打印或在最终报告中回显 ticket、credential 或 verification code。",
        `3. 通过 ${clientLabel} 的原生项目配置合并 Streamable HTTP MCP。`,
        "4. 用原生 Hook 配置和项目内隐私过滤器上报生命周期。过滤器只能发送 manifest.allowedPayload，必须在本地哈希原生 event/session ID 生成稳定 clientEventId，并丢弃原始 hook payload、路径、prompt、文件、diff、终端和工具日志；Hook 失败不得阻塞 Coding Agent。",
        "5. 在项目 instructions 中添加带 intero-managed 标记的规则：仅在语义分支点调用 stand_in.report_checkpoint；依赖或定向协作必须提供当前项目成员的 collaboration.targetPrincipalId。",
        `6. 校验配置语法和 ${clientLabel} 的原生 MCP 注册状态。`,
        client === "codex"
          ? "7. 只要本次写入或修改了 credential 或原生配置，就生成一个 codex://threads/new 深链接，path 使用当前仓库根目录，prompt 要求新的 Codex App 任务从临时路径读取 verification.code，通过已加载的原生 Intero 工具调用 intero.validate_connection，并在成功后从本地文件删除 verification 字段。配置任务本身以 pending_gui_validation 结束；新的原生任务返回的工具结果才是 connected 证据。"
          : `7. 只要本次写入或修改了 credential 或原生配置，就在 ${clientLabel} GUI 中为当前本地项目启动新的验证会话。新会话从临时路径读取 verification.code，通过已加载的原生 Intero 工具调用 intero.validate_connection，并在成功后从本地文件删除 verification 字段；配置会话以 pending_gui_validation 结束。`,
        "8. 幂等地再次检查三类配置。只有未改配置且当前原生工具已返回 connected，或新的 GUI 验证任务已返回 intero.validate_connection 成功结果时，才能报告 connected；其他情况报告 pending_gui_validation。最终只报告 changed、unchanged、preserved、conflicts、verification 和 connected project/agent，并对所有凭证做脱敏。",
      ].join("\n")
    : [
        `Complete the native ${clientLabel} connection from this repository to the Intero Project "${project.name}". Inspect and maintain the Project-scoped configuration, then hand real MCP validation to a fresh native GUI task.`,
        "",
        "The JSON below is the declarative desired state. Inspect the existing configuration first and produce the smallest safe merge; own only Intero entries and preserve everything unrelated.",
        "```json",
        serializedManifest,
        "```",
        "",
        "Execution requirements:",
        "1. Locate the repository root. An existing local file supplies only a candidate workspaceId; it does not prove that the connection is active. Probe the candidate credential with manifest.setupAuthorization.reuseProbeUrl. Reuse it only when the response is HTTP 200, the binding matches this Project and client, validatedAt is present, and the current native client loads the full Intero tool catalog. If the probe is unauthorized, validation is pending, or intero.connection_status reports disconnected, immediately exchange this ticket for a new credential while preserving the stable workspaceId.",
        "2. Store the credential in native or local Project credential storage, mode 0600, and add every credential-bearing file to .git/info/exclude. Store a newly exchanged verification.code only temporarily at manifest.validation.temporaryCodePath for the fresh GUI validation task. Never commit, print, or echo the ticket, credential, or verification code in the final report.",
        `3. Merge the Streamable HTTP MCP server through ${clientLabel}'s native Project configuration.`,
        "4. Configure native lifecycle hooks plus a Project-local privacy filter. Send only manifest.allowedPayload, derive a stable clientEventId from a local hash of the native event/session ID, and discard raw hook payloads, paths, prompts, files, diffs, terminal output, and tool logs. Hooks must fail open.",
        "5. Add an intero-managed Project instruction: call stand_in.report_checkpoint only at semantic branch points. Dependencies and routed collaboration require a current Project member's collaboration.targetPrincipalId.",
        `6. Validate configuration syntax and ${clientLabel}'s native MCP registration.`,
        client === "codex"
          ? "7. Whenever this run writes or changes the credential or native configuration, generate a codex://threads/new deep link with path set to the current repository root. Its prompt tells the fresh Codex App task to read verification.code from the temporary path, call intero.validate_connection through the natively loaded Intero tool, and remove the verification field from the local file after success. This configuration task ends as pending_gui_validation; only the fresh native task's tool result is connected evidence."
          : `7. Whenever this run writes or changes the credential or native configuration, start a fresh ${clientLabel} GUI validation session for this local Project. It reads verification.code from the temporary path, calls intero.validate_connection through the natively loaded Intero tool, and removes the verification field after success. This configuration session ends as pending_gui_validation.`,
        "8. Re-check all three artifact classes idempotently. Report connected only when no configuration changed and a current native tool already returned connected, or when the fresh GUI task returned a successful intero.validate_connection result. Otherwise report pending_gui_validation. Report only changed, unchanged, preserved, conflicts, verification, and the connected Project/Agent, with all credentials redacted.",
      ].join("\n");
}
