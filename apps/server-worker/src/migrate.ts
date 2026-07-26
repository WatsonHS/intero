import { loadMigratorServiceConfig } from "@intero/config";
import { runMigrations } from "graphile-worker";

export async function migrateWorker(
  migrationDatabaseUrl: string,
): Promise<void> {
  await runMigrations({ connectionString: migrationDatabaseUrl });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migrateWorker(loadMigratorServiceConfig().workerDatabaseUrl);
}
