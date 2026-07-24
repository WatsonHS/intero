import {
  type OrganizationId,
  type PrincipalId,
  type WorkspaceId,
  type WorkstreamId,
  uuidv7,
} from "@intero/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CentrifugoRealtime,
  OutboxDispatcher,
  PostgresOutboxRepository,
} from "./outbox.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const centrifugoUrl = process.env.INTERO_CENTRIFUGO_API_URL;
const integrationSuite =
  databaseUrl && databaseAppUrl && centrifugoUrl ? describe : describe.skip;

integrationSuite("PostgreSQL outbox to Centrifugo", () => {
  const organizationId = uuidv7() as OrganizationId;
  const ownerId = uuidv7() as PrincipalId;
  const workstreamId = uuidv7() as WorkstreamId;
  const outboxPool = new Pool({ connectionString: databaseAppUrl });
  const adminPool = new Pool({ connectionString: databaseUrl });
  const repository = new PostgresOutboxRepository(outboxPool, organizationId);
  const operationId = uuidv7();

  beforeAll(async () => {
    await adminPool.query(
      "INSERT INTO organizations (id, name) VALUES ($1, 'Outbox integration fixture')",
      [organizationId],
    );
    await adminPool.query(
      "INSERT INTO principals (id, display_name, kind) VALUES ($1, 'Outbox owner', 'human')",
      [ownerId],
    );
    const workspaceId = uuidv7() as WorkspaceId;
    await adminPool.query(
      `INSERT INTO workstreams
        (id, organization_id, owner_id, title, phase, resolved_state,
         freshness_at, confidence_basis_points, version)
       VALUES ($1, $2, $3, 'Centrifugo outbox fixture', 'planning', $4,
               now(), 8000, 0)`,
      [
        workstreamId,
        organizationId,
        ownerId,
        {
          id: workstreamId,
          workspaceId,
          ownerId,
          title: "Centrifugo outbox fixture",
          phase: "planning",
        },
      ],
    );
    const activity = await adminPool.query<{ sequence: number }>(
      `INSERT INTO activity_events
        (organization_id, operation_id, actor_id, aggregate_type, aggregate_id,
         event_type, metadata)
       VALUES ($1, $2, $3, 'workstream', $4, 'workstream.created', '{}')
       RETURNING sequence`,
      [organizationId, operationId, ownerId, workstreamId],
    );
    await adminPool.query(
      `INSERT INTO outbox
        (operation_id, organization_id, topic, payload, attempts, available_at)
       VALUES ($1, $2, 'workstream.created', $3, 0, now())`,
      [
        operationId,
        organizationId,
        {
          aggregateId: workstreamId,
          sequence: activity.rows[0]!.sequence,
          eventType: "workstream.created",
        },
      ],
    );
  });

  afterAll(async () => {
    await repository.close();
    await adminPool.query("DELETE FROM outbox WHERE organization_id = $1", [
      organizationId,
    ]);
    await adminPool.query(
      "DELETE FROM activity_events WHERE organization_id = $1",
      [organizationId],
    );
    await adminPool.query(
      "DELETE FROM workstreams WHERE organization_id = $1",
      [organizationId],
    );
    await adminPool.query("DELETE FROM principals WHERE id = $1", [ownerId]);
    await adminPool.query("DELETE FROM organizations WHERE id = $1", [
      organizationId,
    ]);
    await adminPool.end();
  });

  it("delivers once and leaves cursor repair data in Centrifugo history", async () => {
    const dispatcher = new OutboxDispatcher(
      organizationId,
      repository,
      new CentrifugoRealtime(centrifugoUrl!),
    );
    await expect(dispatcher.dispatch()).resolves.toBe(1);
    const completed = await adminPool.query<{
      completed_at: Date;
      payload: { sequence: number };
    }>("SELECT completed_at, payload FROM outbox WHERE operation_id = $1", [
      operationId,
    ]);
    expect(completed.rows[0]?.completed_at).toBeInstanceOf(Date);
    expect(completed.rows[0]?.payload.sequence).toBeGreaterThan(0);

    const history = (await fetch(`${centrifugoUrl}/api/history`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-centrifugo-error-mode": "transport",
      },
      body: JSON.stringify({ channel: `intero:${organizationId}`, limit: 10 }),
    }).then((response) => response.json())) as {
      result: {
        publications: Array<{
          data: { operationId: string; sequence: number };
        }>;
      };
    };
    expect(
      history.result.publications.map((item) => item.data.operationId),
    ).toContain(operationId);
  });
});
