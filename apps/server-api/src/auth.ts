import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { deviceAuthorization, magicLink } from "better-auth/plugins";
import type { PrincipalId } from "@intero/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import type { PrincipalSummary } from "./platform-store.js";
import { PilotStoreError } from "./pilot-store.js";

const DEVELOPMENT_IDENTITY_HEADER = "x-intero-dev-principal-id";

export interface MagicLinkSender {
  send(input: {
    email: string;
    url: string;
    expiresInSeconds: number;
  }): Promise<void>;
}

export interface AuthConfig {
  publicUrl: string;
  secret: string;
  rpId: string;
  database?: Pool;
  githubClientId?: string;
  githubClientSecret?: string;
  trustedOrigins?: string[];
  authorizeMagicLink?: (input: {
    email: string;
    invitationToken?: string;
  }) => Promise<boolean>;
}

export function createInteroAuth(config: AuthConfig, sender: MagicLinkSender) {
  const github =
    config.githubClientId && config.githubClientSecret
      ? {
          github: {
            clientId: config.githubClientId,
            clientSecret: config.githubClientSecret,
          },
        }
      : undefined;

  return betterAuth({
    baseURL: config.publicUrl,
    trustedOrigins: config.trustedOrigins ?? [config.publicUrl],
    secret: config.secret,
    ...(config.database ? { database: config.database } : {}),
    ...(github ? { socialProviders: github } : {}),
    ...(config.authorizeMagicLink
      ? {
          hooks: {
            before: createAuthMiddleware(async (context) => {
              if (context.path !== "/sign-in/magic-link") return;
              const body = context.body as {
                email?: unknown;
                metadata?: { invitationToken?: unknown };
              };
              if (
                typeof body.email !== "string" ||
                !(await config.authorizeMagicLink!({
                  email: normalizeEmail(body.email),
                  ...(typeof body.metadata?.invitationToken === "string"
                    ? { invitationToken: body.metadata.invitationToken }
                    : {}),
                }))
              ) {
                throw new APIError("FORBIDDEN", {
                  message:
                    "This email does not have an accepted membership or a matching invitation.",
                });
              }
            }),
          },
        }
      : {}),
    plugins: [
      magicLink({
        expiresIn: 600,
        storeToken: "hashed",
        rateLimit: { window: 60, max: 5 },
        sendMagicLink: async ({ email, url }) => {
          await sender.send({ email, url, expiresInSeconds: 600 });
        },
      }),
      passkey({
        rpID: config.rpId,
        rpName: "Intero",
        origin: config.publicUrl,
      }),
      deviceAuthorization({
        verificationUri: `${config.publicUrl}/device`,
        validateClient: (clientId) => clientId.startsWith("intero-desktop:"),
      }),
    ],
  });
}

export type InteroAuth = ReturnType<typeof createInteroAuth>;

export interface AuthenticatedPrincipal extends PrincipalSummary {
  email: string;
  authUserId?: string;
}

export interface PrincipalDirectory {
  get(principalId: PrincipalId): Promise<AuthenticatedPrincipal | undefined>;
  list(principalIds: PrincipalId[]): Promise<AuthenticatedPrincipal[]>;
  updateDisplayName(
    principalId: PrincipalId,
    displayName: string,
  ): Promise<AuthenticatedPrincipal>;
}

export class DatabasePrincipalDirectory implements PrincipalDirectory {
  constructor(private readonly database: Pool) {}

  async get(
    principalId: PrincipalId,
  ): Promise<AuthenticatedPrincipal | undefined> {
    return (await this.list([principalId]))[0];
  }

  async list(principalIds: PrincipalId[]): Promise<AuthenticatedPrincipal[]> {
    if (principalIds.length === 0) return [];
    const result = await this.database.query<{
      id: PrincipalId;
      display_name: string;
      kind: PrincipalSummary["kind"];
      email: string | null;
      auth_user_id: string | null;
    }>(
      `SELECT p.id, p.display_name, p.kind, u.email,
              ap.auth_user_id
       FROM principals p
       LEFT JOIN auth_principals ap ON ap.principal_id = p.id
       LEFT JOIN "user" u ON u.id = ap.auth_user_id
       WHERE p.id = ANY($1::uuid[])
       ORDER BY p.display_name, p.id`,
      [principalIds],
    );
    return result.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      kind: row.kind,
      email: row.email ?? "",
      ...(row.auth_user_id ? { authUserId: row.auth_user_id } : {}),
    }));
  }

  async updateDisplayName(
    principalId: PrincipalId,
    displayName: string,
  ): Promise<AuthenticatedPrincipal> {
    const normalized = displayName.trim();
    await this.database.query(
      `UPDATE principals
       SET display_name = $2, updated_at = now()
       WHERE id = $1`,
      [principalId, normalized],
    );
    const principal = await this.get(principalId);
    if (!principal) {
      throw new PilotStoreError(
        "PRINCIPAL_NOT_FOUND",
        404,
        "The signed-in Intero profile was not found.",
      );
    }
    return principal;
  }
}

export class InMemoryPrincipalDirectory implements PrincipalDirectory {
  private readonly principals = new Map<PrincipalId, AuthenticatedPrincipal>();

  constructor(identities: PrincipalSummary[]) {
    for (const identity of identities) {
      this.principals.set(identity.id, {
        ...identity,
        email: `${identity.displayName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ".")
          .replace(/^\.|\.$/g, "")}@intero.test`,
      });
    }
  }

  async get(
    principalId: PrincipalId,
  ): Promise<AuthenticatedPrincipal | undefined> {
    const principal = this.principals.get(principalId);
    return principal ? structuredClone(principal) : undefined;
  }

  async list(principalIds: PrincipalId[]): Promise<AuthenticatedPrincipal[]> {
    return principalIds.flatMap((principalId) => {
      const principal = this.principals.get(principalId);
      return principal ? [structuredClone(principal)] : [];
    });
  }

  async updateDisplayName(
    principalId: PrincipalId,
    displayName: string,
  ): Promise<AuthenticatedPrincipal> {
    const principal = this.principals.get(principalId);
    if (!principal) {
      throw new PilotStoreError(
        "PRINCIPAL_NOT_FOUND",
        404,
        "The signed-in Intero profile was not found.",
      );
    }
    const updated = { ...principal, displayName: displayName.trim() };
    this.principals.set(principalId, updated);
    return structuredClone(updated);
  }
}

export interface RequestAuth {
  readonly mode: "session" | "development_identity" | "unavailable";
  readonly developmentIdentityHeader?: string;
  readonly developmentIdentities: PrincipalSummary[];
  resolve(
    request: FastifyRequest,
    required?: boolean,
  ): Promise<AuthenticatedPrincipal | undefined>;
}

export function createRequestAuth(input: {
  auth?: InteroAuth;
  database?: Pool;
  allowDevelopmentIdentity: boolean;
  developmentIdentities: PrincipalSummary[];
  directory: PrincipalDirectory;
}): RequestAuth {
  const sessionEnabled = Boolean(input.auth && input.database);
  return {
    mode: sessionEnabled
      ? "session"
      : input.allowDevelopmentIdentity
        ? "development_identity"
        : "unavailable",
    ...(input.allowDevelopmentIdentity
      ? { developmentIdentityHeader: DEVELOPMENT_IDENTITY_HEADER }
      : {}),
    developmentIdentities: input.allowDevelopmentIdentity
      ? input.developmentIdentities
      : [],
    async resolve(request, required = true) {
      if (input.auth && input.database) {
        const session = await input.auth.api.getSession({
          headers: toHeaders(request),
        });
        if (session?.user) {
          const principalId = (await resolvePrincipalForAuthUser(
            input.database,
            {
              authUserId: session.user.id,
              displayName:
                session.user.name?.trim() || session.user.email.split("@")[0]!,
            },
          )) as PrincipalId;
          const principal = await input.directory.get(principalId);
          if (principal) {
            return {
              ...principal,
              email: normalizeEmail(session.user.email),
              authUserId: session.user.id,
            };
          }
        }
      }

      if (input.allowDevelopmentIdentity) {
        const raw = request.headers[DEVELOPMENT_IDENTITY_HEADER];
        const id = (Array.isArray(raw) ? raw[0] : raw) as
          PrincipalId | undefined;
        if (id) {
          const principal = await input.directory.get(id);
          if (principal) return principal;
        }
      }

      if (!required) return undefined;
      throw new PilotStoreError(
        "AUTHENTICATION_REQUIRED",
        401,
        input.auth
          ? "Sign in to continue."
          : "Authentication is not configured for this Intero deployment.",
      );
    },
  };
}

export async function resolvePrincipalForAuthUser(
  database: Pool,
  input: { authUserId: string; displayName: string },
): Promise<string> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      input.authUserId,
    ]);
    const existing = await client.query<{ principal_id: string }>(
      "SELECT principal_id FROM auth_principals WHERE auth_user_id = $1",
      [input.authUserId],
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return existing.rows[0].principal_id;
    }
    const principal = await client.query<{ id: string }>(
      `INSERT INTO principals (id, display_name, kind)
       VALUES (gen_random_uuid(), $1, 'human')
       RETURNING id`,
      [input.displayName],
    );
    const principalId = principal.rows[0]?.id;
    if (!principalId)
      throw new Error("Unable to create a stable Intero principal.");
    await client.query(
      `INSERT INTO auth_principals (auth_user_id, principal_id)
       VALUES ($1, $2)`,
      [input.authUserId, principalId],
    );
    await client.query("COMMIT");
    return principalId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function mountAuth(
  app: FastifyInstance,
  auth: InteroAuth,
  corsOrigins: readonly string[] = [],
): void {
  app.all("/api/auth/*", async (request, reply) => {
    const headers = toHeaders(request);
    headers.delete("content-length");
    const host = request.headers.host ?? "localhost";
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : serializeAuthBody(request.body);
    const response = await auth.handler(
      new Request(
        new URL(request.url, `${request.protocol}://${host}`).toString(),
        {
          method: request.method,
          headers,
          ...(body === undefined ? {} : { body }),
        },
      ),
    );
    for (const [name, value] of response.headers.entries()) {
      if (name.toLowerCase() !== "set-cookie") reply.header(name, value);
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) reply.header("set-cookie", cookies);
    const origin = request.headers.origin;
    if (origin && corsOrigins.includes(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("access-control-allow-credentials", "true");
      reply.header("vary", "Origin");
    }
    return reply
      .status(response.status)
      .send(
        response.body ? Buffer.from(await response.arrayBuffer()) : undefined,
      );
  });
}

function serializeAuthBody(body: unknown): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString();
  return JSON.stringify(body);
}

function toHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(",") : String(value));
  }
  return headers;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
