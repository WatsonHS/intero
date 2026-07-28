import migrationJournal from "../../drizzle/meta/_journal.json" with { type: "json" };

type MigrationQuery = {
  query<T extends Record<string, unknown>>(
    text: string,
  ): Promise<{ rows: T[] }>;
};

type MigrationReadiness =
  | { status: "ready" }
  | {
      status: "unavailable";
      detail:
        "database_migration_ledger_unavailable" | "database_migrations_pending";
    };

const latestRequiredMigration = migrationJournal.entries.at(-1);

if (!latestRequiredMigration) {
  throw new Error("database_migration_journal_empty");
}

export const REQUIRED_DATABASE_MIGRATION_AT = latestRequiredMigration.when;

export async function checkDatabaseMigrationReadiness(
  client: MigrationQuery,
): Promise<MigrationReadiness> {
  try {
    const result = await client.query<{ created_at: string | null }>(
      `SELECT max(created_at)::text AS created_at
       FROM drizzle.__drizzle_migrations`,
    );
    const appliedAt = Number(result.rows[0]?.created_at);
    if (
      !Number.isFinite(appliedAt) ||
      appliedAt < REQUIRED_DATABASE_MIGRATION_AT
    ) {
      return {
        status: "unavailable",
        detail: "database_migrations_pending",
      };
    }
    return { status: "ready" };
  } catch {
    return {
      status: "unavailable",
      detail: "database_migration_ledger_unavailable",
    };
  }
}

export async function assertDatabaseMigrationReadiness(
  client: MigrationQuery,
): Promise<void> {
  const readiness = await checkDatabaseMigrationReadiness(client);
  if (readiness.status === "ready") return;

  throw new Error(
    `${readiness.detail}: run the database migrator before starting persistent services`,
  );
}

export async function waitForDatabaseMigrationReadiness(
  client: MigrationQuery,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const readiness = await checkDatabaseMigrationReadiness(client);
    if (readiness.status === "ready") return;
    if (Date.now() >= deadline) {
      throw new Error(
        `${readiness.detail}: timed out waiting for the database migrator`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
