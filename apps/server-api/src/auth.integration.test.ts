import Fastify from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ACTIVATION_BOOTSTRAP_HEADER,
  createInteroAuth,
  mountAuth,
  resolvePrincipalForAuthUser,
} from "./auth.js";
import { migrateDatabase } from "./database/migrate.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const databaseSuite = databaseUrl && databaseAppUrl ? describe : describe.skip;

databaseSuite("Better Auth database integration", () => {
  const pool = new Pool({ connectionString: databaseAppUrl });
  const authSecret = "intero-auth-integration-secret-at-least-32-bytes";
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `auth-${suffix}@intero.test`;
  const mappingEmail = `auth-mapping-${suffix}@intero.test`;
  const mountedEmail = `mounted-auth-${suffix}@intero.test`;
  const authUserId = `auth-user-${suffix}`;
  const clientId = `intero-desktop:${suffix}`;
  let principalId: string | undefined;

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
  });

  afterAll(async () => {
    await pool.query(
      'DELETE FROM "verification" WHERE "value" LIKE $1 OR "value" LIKE $2',
      [`%${email}%`, `%${mountedEmail}%`],
    );
    await pool.query('DELETE FROM "deviceCode" WHERE "clientId" = $1', [
      clientId,
    ]);
    await pool.query('DELETE FROM "user" WHERE "id" = $1 OR email = $2', [
      authUserId,
      email,
    ]);
    if (principalId)
      await pool.query("DELETE FROM principals WHERE id = $1", [principalId]);
    await pool.end();
  });

  it("only bootstraps a hashed password through the server-only activation boundary", async () => {
    const auth = createInteroAuth({
      publicUrl: "http://localhost:4310",
      secret: authSecret,
      rpId: "localhost",
      database: pool,
    });
    await expect(
      auth.api.signUpEmail({
        body: {
          name: "Activation fixture",
          email,
          password: "activation-password-123",
        },
        headers: new Headers({ origin: "http://localhost:4310" }),
      }),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
    await expect(
      auth.api.signUpEmail({
        body: {
          name: "Activation fixture",
          email,
          password: "activation-password-123",
        },
        headers: new Headers({
          origin: "http://localhost:4310",
          [ACTIVATION_BOOTSTRAP_HEADER]: authSecret,
        }),
      }),
    ).resolves.toMatchObject({ user: { email } });
    const account = await pool.query<{ password: string | null }>(
      `SELECT password FROM account
       WHERE "userId" = (SELECT id FROM "user" WHERE email = $1)
         AND "providerId" = 'credential'`,
      [email],
    );
    expect(account.rows[0]?.password).toBeTruthy();
    expect(account.rows[0]?.password).not.toBe("activation-password-123");
    await expect(
      auth.api.signInEmail({
        body: { email, password: "activation-password-123" },
        headers: new Headers({ origin: "http://localhost:4310" }),
      }),
    ).resolves.toMatchObject({ user: { email } });

    const device = await auth.api.deviceCode({
      body: { client_id: clientId, scope: "openid profile" },
    });
    expect(device.device_code).toBeTruthy();
    expect(device.verification_uri).toBe("http://localhost:4310/device");
  });

  it("maps provider users to one stable Intero principal", async () => {
    await pool.query(
      `INSERT INTO "user"
        ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, 'Auth fixture', $2, true, now(), now())`,
      [authUserId, mappingEmail],
    );
    principalId = await resolvePrincipalForAuthUser(pool, {
      authUserId,
      displayName: "Auth fixture",
    });
    const second = await resolvePrincipalForAuthUser(pool, {
      authUserId,
      displayName: "Renamed fixture",
    });
    expect(second).toBe(principalId);
    const links = await pool.query<{ count: string }>(
      "SELECT count(*) FROM auth_principals WHERE auth_user_id = $1",
      [authUserId],
    );
    expect(links.rows[0]?.count).toBe("1");
  });

  it("mounts Better Auth through Fastify with parsed JSON and credentialed CORS", async () => {
    const mounted = createInteroAuth({
      publicUrl: "http://localhost:4310",
      secret: authSecret,
      rpId: "localhost",
      database: pool,
    });
    const app = Fastify();
    mountAuth(app, mounted, ["http://127.0.0.1:5174"]);
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: {
        origin: "http://127.0.0.1:5174",
        "content-type": "application/json",
      },
      payload: {
        name: "Blocked registration",
        email: mountedEmail,
        password: "blocked-registration-123",
      },
    });
    const removedLinkLogin = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/magic-link",
      headers: {
        origin: "http://127.0.0.1:5174",
        "content-type": "application/json",
      },
      payload: { email: mountedEmail },
    });
    const unavailableRecovery = await app.inject({
      method: "POST",
      url: "/api/auth/forget-password",
      headers: {
        origin: "http://127.0.0.1:5174",
        "content-type": "application/json",
      },
      payload: { email: mountedEmail, redirectTo: "/" },
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(removedLinkLogin.statusCode).toBe(404);
    expect(unavailableRecovery.statusCode).toBe(404);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://127.0.0.1:5174",
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(
      await pool.query(`SELECT 1 FROM "user" WHERE email = $1`, [mountedEmail]),
    ).toHaveProperty("rowCount", 0);
  });
});
