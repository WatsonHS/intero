import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import { deviceAuthorization, magicLink } from "better-auth/plugins";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

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
    secret: config.secret,
    ...(config.database ? { database: config.database } : {}),
    ...(github ? { socialProviders: github } : {}),
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

export function mountAuth(app: FastifyInstance, auth: InteroAuth): void {
  const handler = toNodeHandler(auth);
  app.all("/api/auth/*", async (request, reply) => {
    await handler(request.raw, reply.raw);
    reply.hijack();
  });
}
