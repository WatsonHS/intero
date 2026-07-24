import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInteroAuth, resolvePrincipalForAuthUser } from "./auth.js";
import { migrateDatabase } from "./database/migrate.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const databaseSuite = databaseUrl && databaseAppUrl ? describe : describe.skip;

databaseSuite("Better Auth database integration", () => {
  const pool = new Pool({ connectionString: databaseAppUrl });
  const sent: Array<{ email: string; url: string }> = [];
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `auth-${suffix}@intero.test`;
  const authUserId = `auth-user-${suffix}`;
  const clientId = `intero-desktop:${suffix}`;
  let principalId: string | undefined;

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM "verification" WHERE "value" LIKE $1', [
      `%${email}%`,
    ]);
    await pool.query('DELETE FROM "deviceCode" WHERE "clientId" = $1', [
      clientId,
    ]);
    await pool.query('DELETE FROM "user" WHERE "id" = $1', [authUserId]);
    if (principalId)
      await pool.query("DELETE FROM principals WHERE id = $1", [principalId]);
    await pool.end();
  });

  it("persists a hashed magic-link verification and issues a desktop device code", async () => {
    const auth = createInteroAuth(
      {
        publicUrl: "http://localhost:4310",
        secret: "intero-auth-integration-secret-at-least-32-bytes",
        rpId: "localhost",
        database: pool,
      },
      {
        async send(input) {
          sent.push({ email: input.email, url: input.url });
        },
      },
    );
    await expect(
      auth.api.signInMagicLink({
        body: { email },
        headers: new Headers({ origin: "http://localhost:4310" }),
      }),
    ).resolves.toEqual({ status: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).not.toContain(email);
    const verification = await pool.query<{
      identifier: string;
      value: string;
    }>(
      'SELECT "identifier", "value" FROM "verification" WHERE "value" LIKE $1',
      [`%${email}%`],
    );
    const rawToken = new URL(sent[0]!.url).searchParams.get("token");
    expect(rawToken).toBeTruthy();
    expect(verification.rows[0]?.identifier).not.toBe(rawToken);
    expect(verification.rows[0]?.value).not.toContain(rawToken!);
    expect(verification.rows[0]?.value).toContain(email);

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
      [authUserId, email],
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
});
