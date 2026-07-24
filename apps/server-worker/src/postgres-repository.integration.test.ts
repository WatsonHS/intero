import { uuidv7 } from "@intero/domain";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresPublicRepresentativeRepository } from "./postgres-repository";
import { PublicRepresentativeWorker } from "./runtime";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const databaseSuite = databaseUrl && databaseAppUrl ? describe : describe.skip;

databaseSuite("public Representative PostgreSQL repository", () => {
  const organizationId = uuidv7();
  const threadId = uuidv7();
  const workstreamId = uuidv7();
  const ownerId = uuidv7();
  const representativeId = uuidv7();
  const operationId = uuidv7();
  const admin = new Client({ connectionString: databaseUrl });
  let repository: PostgresPublicRepresentativeRepository;

  beforeAll(async () => {
    await admin.connect();
    await admin.query("GRANT USAGE ON SCHEMA public TO intero_app");
    await admin.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO intero_app",
    );
    await admin.query(
      "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO intero_app",
    );
    await admin.query(
      `INSERT INTO principals (id, display_name, kind)
       VALUES ($1, 'Owner', 'human'), ($2, 'Public Representative', 'representative')`,
      [ownerId, representativeId],
    );
    await admin.query(
      "INSERT INTO organizations (id, name) VALUES ($1, 'Worker fixture')",
      [organizationId],
    );
    await admin.query(
      `INSERT INTO workstreams
        (id, organization_id, owner_id, title, phase, resolved_state,
         freshness_at, confidence_basis_points)
       VALUES ($1, $2, $3, 'Worker state', 'implementing', '{}', $4, 9000)`,
      [workstreamId, organizationId, ownerId, "2026-07-24T10:00:00.000Z"],
    );
    await admin.query(
      `INSERT INTO public_work_projections
        (workstream_id, organization_id, projection, version, freshness_at)
       VALUES ($1, $2, '{}', 1, $3)`,
      [workstreamId, organizationId, "2026-07-24T10:00:00.000Z"],
    );
    await admin.query(
      `INSERT INTO threads
        (id, organization_id, kind, title, access_mode, prior_history_granted, sequence)
       VALUES ($1, $2, 'representative', 'Public fallback', 'agent_readable', false, 0)`,
      [threadId, organizationId],
    );
    repository = new PostgresPublicRepresentativeRepository(
      new Pool({ connectionString: databaseAppUrl }),
      organizationId,
      representativeId,
    );
  });

  afterAll(async () => {
    await repository.close();
    await admin.query(
      "DELETE FROM public_representative_runs WHERE organization_id = $1",
      [organizationId],
    );
    await admin.query("DELETE FROM messages WHERE organization_id = $1", [
      organizationId,
    ]);
    await admin.query("DELETE FROM threads WHERE organization_id = $1", [
      organizationId,
    ]);
    await admin.query(
      "DELETE FROM public_work_projections WHERE organization_id = $1",
      [organizationId],
    );
    await admin.query("DELETE FROM workstreams WHERE organization_id = $1", [
      organizationId,
    ]);
    await admin.query("DELETE FROM organizations WHERE id = $1", [
      organizationId,
    ]);
    await admin.query("DELETE FROM principals WHERE id = ANY($1::uuid[])", [
      [ownerId, representativeId],
    ]);
    await admin.end();
  });

  it("deduplicates concurrent delivery and records explicit fallback freshness", async () => {
    const first = new PublicRepresentativeWorker(repository);
    const second = new PublicRepresentativeWorker(repository);
    const job = {
      operationId,
      threadId,
      workstreamId,
      requestedAt: "2026-07-24T10:01:00.000Z",
    };
    await Promise.all([first.run(job), second.run(job)]);

    const result = await admin.query<{ body: string; status: string }>(
      `SELECT m.body, r.status
       FROM messages m
       JOIN public_representative_runs r ON r.operation_id = m.operation_id
       WHERE m.organization_id = $1 AND m.operation_id = $2`,
      [organizationId, operationId],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.body).toContain("2026-07-24T10:00:00.000Z");
    expect(result.rows[0]?.status).toBe("completed");
  });
});
