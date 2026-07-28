import { loadMigratorServiceConfig } from "@intero/config";

import { migrateDatabase } from "./database/migrate.js";

// This is the persistent dev-host entrypoint. Importing migrate.ts keeps the
// Drizzle journal in the watch graph through migration-readiness imports in
// index.ts, so a new journal entry restarts this supervisor. The application
// is imported only after the idempotent migrator has committed.
await migrateDatabase(loadMigratorServiceConfig().databaseUrl);
await import("./index.js");
