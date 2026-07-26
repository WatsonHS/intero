import { loadMigratorServiceConfig } from "@intero/config";
import { readFile } from "node:fs/promises";

import { migrateDatabase } from "../../server-api/src/database/migrate.js";
import { SpiceDbAuthorization } from "../../server-api/src/spicedb-authorization.js";
import { migrateWorker } from "./migrate.js";

const config = loadMigratorServiceConfig();

await migrateDatabase(config.databaseUrl);
await migrateWorker(config.workerDatabaseUrl);
if (config.spiceDb) {
  const authorization = new SpiceDbAuthorization({
    endpoint: config.spiceDb.endpoint,
    token: config.spiceDb.token,
    insecureLocalhost: config.spiceDb.insecure,
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
    graphile: true,
    spicedb: Boolean(config.spiceDb),
  })}\n`,
);
