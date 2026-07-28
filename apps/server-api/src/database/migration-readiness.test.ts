import { describe, expect, it } from "vitest";

import {
  assertDatabaseMigrationReadiness,
  checkDatabaseMigrationReadiness,
  REQUIRED_DATABASE_MIGRATION_AT,
  waitForDatabaseMigrationReadiness,
} from "./migration-readiness.js";

describe("database migration readiness", () => {
  it("reports ready only when the latest required migration is applied", async () => {
    await expect(
      checkDatabaseMigrationReadiness({
        query: async <T extends Record<string, unknown>>() => ({
          rows: [
            {
              created_at: String(REQUIRED_DATABASE_MIGRATION_AT),
            } as unknown as T,
          ],
        }),
      }),
    ).resolves.toEqual({ status: "ready" });
  });

  it("reports pending for an older or empty migration ledger", async () => {
    await expect(
      checkDatabaseMigrationReadiness({
        query: async <T extends Record<string, unknown>>() => ({
          rows: [
            {
              created_at: String(REQUIRED_DATABASE_MIGRATION_AT - 1),
            } as unknown as T,
          ],
        }),
      }),
    ).resolves.toEqual({
      status: "unavailable",
      detail: "database_migrations_pending",
    });

    await expect(
      checkDatabaseMigrationReadiness({
        query: async <T extends Record<string, unknown>>() => ({
          rows: [{ created_at: null } as unknown as T],
        }),
      }),
    ).resolves.toEqual({
      status: "unavailable",
      detail: "database_migrations_pending",
    });
  });

  it("reports an unavailable ledger instead of claiming readiness", async () => {
    await expect(
      checkDatabaseMigrationReadiness({
        query: async () => {
          throw new Error("permission denied");
        },
      }),
    ).resolves.toEqual({
      status: "unavailable",
      detail: "database_migration_ledger_unavailable",
    });
  });

  it("fails service startup with an actionable error when migrations are pending", async () => {
    await expect(
      assertDatabaseMigrationReadiness({
        query: async <T extends Record<string, unknown>>() => ({
          rows: [
            {
              created_at: String(REQUIRED_DATABASE_MIGRATION_AT - 1),
            } as unknown as T,
          ],
        }),
      }),
    ).rejects.toThrow(
      "database_migrations_pending: run the database migrator before starting persistent services",
    );
  });

  it("lets a dev worker wait for the migrator boundary", async () => {
    let attempts = 0;
    await expect(
      waitForDatabaseMigrationReadiness(
        {
          query: async <T extends Record<string, unknown>>() => ({
            rows: [
              {
                created_at: String(
                  ++attempts === 1
                    ? REQUIRED_DATABASE_MIGRATION_AT - 1
                    : REQUIRED_DATABASE_MIGRATION_AT,
                ),
              } as unknown as T,
            ],
          }),
        },
        { timeoutMs: 100, pollIntervalMs: 1 },
      ),
    ).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });
});
