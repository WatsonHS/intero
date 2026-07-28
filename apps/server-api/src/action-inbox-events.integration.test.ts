import { OrganizationId, PrincipalId, uuidv7 } from "@intero/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type ActionInboxChangedEvent,
  PostgresActionInboxEventSource,
} from "./action-inbox-events.js";
import { migrateDatabase } from "./database/migrate.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAppUrl = process.env.DATABASE_APP_URL;
const databaseSuite = databaseUrl && databaseAppUrl ? describe : describe.skip;

databaseSuite("Action Inbox PostgreSQL notifications", () => {
  const admin = new Pool({ connectionString: databaseUrl });
  const appPool = new Pool({ connectionString: databaseAppUrl });
  const organizationId = OrganizationId.parse(uuidv7());
  const principalId = PrincipalId.parse(uuidv7());
  const events = new PostgresActionInboxEventSource(appPool, organizationId);

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    await admin.query(`INSERT INTO organizations (id,name) VALUES ($1,$2)`, [
      organizationId,
      "SSE notification test",
    ]);
    await admin.query(
      `INSERT INTO principals (id,display_name,kind)
       VALUES ($1,'SSE recipient','human')`,
      [principalId],
    );
    await admin.query(
      `INSERT INTO memberships (organization_id,principal_id,role)
       VALUES ($1,$2,'admin')`,
      [organizationId, principalId],
    );
    await events.start();
  });

  afterAll(async () => {
    await events.close();
    await admin.query(`DELETE FROM action_inbox WHERE organization_id=$1`, [
      organizationId,
    ]);
    await admin.query(`DELETE FROM memberships WHERE organization_id=$1`, [
      organizationId,
    ]);
    await admin.query(`DELETE FROM principals WHERE id=$1`, [principalId]);
    await admin.query(`DELETE FROM organizations WHERE id=$1`, [
      organizationId,
    ]);
    await appPool.end();
    await admin.end();
  });

  it("delivers a committed row change to the targeted principal", async () => {
    const received = new Promise<ActionInboxChangedEvent>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for PostgreSQL NOTIFY.")),
        2_000,
      );
      timeout.unref();
      const unsubscribe = events.subscribe(principalId, (event) => {
        clearTimeout(timeout);
        unsubscribe();
        resolve(event);
      });
    });

    await admin.query(
      `INSERT INTO action_inbox
        (id,organization_id,principal_id,kind,title,detail,source_ref,dedupe_key)
       VALUES ($1,$2,$3,'review_request','Review','Wake-up only',$4,$5)`,
      [
        uuidv7(),
        organizationId,
        principalId,
        `spec:${uuidv7()}`,
        `sse:${uuidv7()}`,
      ],
    );

    await expect(received).resolves.toMatchObject({
      organizationId,
      principalId,
      reason: "action_inbox",
    });
  });
});
