import { OrganizationId, uuidv7 } from "@intero/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "./database/migrate.js";
import { PostgresRealtimeRateLimiter } from "./realtime-routes.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const databaseSuite = databaseUrl && databaseAppUrl ? describe : describe.skip;

databaseSuite("PostgreSQL realtime production boundaries", () => {
  const organizationId = OrganizationId.parse(uuidv7());
  const admin = new Pool({ connectionString: databaseUrl });
  const appPoolA = new Pool({ connectionString: databaseAppUrl });
  const appPoolB = new Pool({ connectionString: databaseAppUrl });

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    await admin.query(
      "INSERT INTO organizations (id,name) VALUES ($1,'Realtime limiter fixture')",
      [organizationId],
    );
  });

  afterAll(async () => {
    await admin.query(
      "DELETE FROM realtime_rate_limits WHERE organization_id=$1",
      [organizationId],
    );
    await admin.query("DELETE FROM organizations WHERE id=$1", [
      organizationId,
    ]);
    await Promise.all([appPoolA.end(), appPoolB.end(), admin.end()]);
  });

  it("shares one atomic rate-limit bucket across independent API pools", async () => {
    const limiterA = new PostgresRealtimeRateLimiter(appPoolA, organizationId);
    const limiterB = new PostgresRealtimeRateLimiter(appPoolB, organizationId);
    const now = Date.now();

    await expect(
      Promise.all([
        limiterA.consume("session:principal", 2, 60_000, now),
        limiterB.consume("session:principal", 2, 60_000, now + 1),
      ]),
    ).resolves.toEqual([undefined, undefined]);
    await expect(
      limiterA.consume("session:principal", 2, 60_000, now + 2),
    ).resolves.toBe(60);
    await expect(
      limiterB.consume("session:principal", 2, 60_000, now + 60_001),
    ).resolves.toBeUndefined();
  });
});
