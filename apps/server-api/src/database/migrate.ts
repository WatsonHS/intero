import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export async function migrateDatabase(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: new URL("../../drizzle", import.meta.url).pathname,
    });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migrateDatabase(loadMigratorServiceConfig().databaseUrl);
}
import { loadMigratorServiceConfig } from "@intero/config";
