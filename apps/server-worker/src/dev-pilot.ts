import { loadWorkerServiceConfig } from "@intero/config";
import { Pool } from "pg";

import { waitForDatabaseMigrationReadiness } from "../../server-api/src/database/migration-readiness.js";

const databaseUrl = loadWorkerServiceConfig().pilot.databaseUrl;
if (!databaseUrl) {
  throw new Error("INTERO_DATABASE_URL is required for server-worker.");
}

const readinessPool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  // The API dev supervisor owns DDL. Worker hot restarts wait for that
  // migration boundary instead of racing the new code against the old schema.
  await waitForDatabaseMigrationReadiness(readinessPool);
} finally {
  await readinessPool.end();
}

await import("./index.js");
