import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "./migrate";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const databaseSuite = databaseUrl && databaseAppUrl ? describe : describe.skip;

databaseSuite("PostgreSQL tenant isolation", () => {
  const admin = new Client({ connectionString: databaseUrl });
  const client = new Client({ connectionString: databaseAppUrl });
  const organizationA = randomUUID();
  const organizationB = randomUUID();
  const principal = randomUUID();

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    await admin.connect();
    await admin.query("GRANT USAGE ON SCHEMA public TO intero_app");
    await admin.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO intero_app",
    );
    await admin.query(
      "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO intero_app",
    );
    await client.connect();
    await client.query("BEGIN");
    await admin.query(
      "INSERT INTO principals (id, display_name, kind) VALUES ($1, 'Tenant fixture', 'human')",
      [principal],
    );
    for (const [organizationId, title] of [
      [organizationA, "Visible workstream"],
      [organizationB, "Hidden workstream"],
    ]) {
      await client.query(
        "SELECT set_config('intero.organization_id', $1, true)",
        [organizationId],
      );
      await client.query(
        "INSERT INTO organizations (id, name) VALUES ($1, $2)",
        [organizationId, title],
      );
      await client.query(
        `INSERT INTO workstreams
          (id, organization_id, owner_id, title, phase, resolved_state,
           freshness_at, confidence_basis_points)
         VALUES ($1, $2, $3, $4, 'implementing', '{}', now(), 9000)`,
        [randomUUID(), organizationId, principal, title],
      );
    }
  });

  afterAll(async () => {
    await client.query("ROLLBACK");
    await client.end();
    await admin.query("DELETE FROM principals WHERE id = $1", [principal]);
    await admin.end();
  });

  it("returns only rows for the current organization", async () => {
    await client.query(
      "SELECT set_config('intero.organization_id', $1, true)",
      [organizationA],
    );
    const result = await client.query<{ title: string }>(
      "SELECT title FROM workstreams ORDER BY title",
    );
    expect(result.rows).toEqual([{ title: "Visible workstream" }]);
  });

  it("rejects cross-organization writes", async () => {
    await client.query("SAVEPOINT before_cross_tenant_write");
    await expect(
      client.query(
        `INSERT INTO workstreams
          (id, organization_id, owner_id, title, phase, resolved_state,
           freshness_at, confidence_basis_points)
         VALUES ($1, $2, $3, 'Denied', 'planning', '{}', now(), 5000)`,
        [randomUUID(), organizationB, principal],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await client.query("ROLLBACK TO SAVEPOINT before_cross_tenant_write");
  });
});
