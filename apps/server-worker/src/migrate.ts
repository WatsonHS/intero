import { runMigrations } from "graphile-worker";

export async function migrateWorker(
  migrationDatabaseUrl: string,
): Promise<void> {
  await runMigrations({ connectionString: migrationDatabaseUrl });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl =
    process.env.INTERO_WORKER_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("INTERO_WORKER_DATABASE_URL is required.");
  await migrateWorker(databaseUrl);
}
