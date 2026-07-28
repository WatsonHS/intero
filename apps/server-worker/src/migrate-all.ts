import { loadMigratorServiceConfig } from "@intero/config";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

import { migrateDatabase } from "../../server-api/src/database/migrate.js";
import {
  assertDatabaseMigrationReadiness,
  REQUIRED_DATABASE_MIGRATION_AT,
} from "../../server-api/src/database/migration-readiness.js";
import {
  loadSpiceDbCertificate,
  SpiceDbAuthorization,
} from "../../server-api/src/spicedb-authorization.js";
import { migrateWorker } from "./migrate.js";

const config = loadMigratorServiceConfig();

await migrateDatabase(config.databaseUrl);
const readinessPool = new Pool({
  connectionString: config.databaseUrl,
  max: 1,
});
try {
  await assertDatabaseMigrationReadiness(readinessPool);
} finally {
  await readinessPool.end();
}
await migrateWorker(config.workerDatabaseUrl);
if (config.spiceDb) {
  const certificate = await loadSpiceDbCertificate(config.spiceDb.caPath);
  const authorization = new SpiceDbAuthorization({
    endpoint: config.spiceDb.endpoint,
    token: config.spiceDb.token,
    insecureLocalhost: config.spiceDb.insecure,
    ...(certificate ? { certificate } : {}),
    timeoutMs: 5_000,
  });
  try {
    const schema = await readFile(
      new URL("../../../infra/spicedb/schema.zed", import.meta.url),
      "utf8",
    );
    await authorization.writeSchema(schema);
  } finally {
    authorization.close();
  }
}

process.stdout.write(
  `${JSON.stringify({
    migrated: true,
    postgres: true,
    requiredDatabaseMigrationAt: REQUIRED_DATABASE_MIGRATION_AT,
    graphile: true,
    spicedb: Boolean(config.spiceDb),
  })}\n`,
);
