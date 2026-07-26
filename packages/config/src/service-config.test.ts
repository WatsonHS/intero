import { describe, expect, it } from "vitest";

import {
  loadApiServiceConfig,
  loadMigratorServiceConfig,
  loadObjectStorageConfig,
  loadWorkerServiceConfig,
} from "./service-config.js";

const postgresEnvironment = {
  INTERO_DATABASE_URL: "postgres://intero_app:secret@db.internal/intero",
  INTERO_PROVIDER_ENCRYPTION_KEY: "provider-encryption-secret",
  INTERO_PILOT_PERSISTENCE: "postgres",
  INTERO_PILOT_STAND_IN_JOBS: "transactional-outbox",
} as const;

describe("service environment schemas", () => {
  it("keeps object storage disabled without explicit policy", () => {
    expect(loadObjectStorageConfig({})).toEqual({ mode: "disabled" });
  });

  it("requires all server-only MinIO settings when enabled", () => {
    expect(() =>
      loadObjectStorageConfig({ INTERO_OBJECT_STORAGE: "minio" }),
    ).toThrow();
    expect(
      loadObjectStorageConfig({
        INTERO_OBJECT_STORAGE: "minio",
        INTERO_OBJECT_STORAGE_ENDPOINT: "http://minio.internal:9000",
        INTERO_OBJECT_STORAGE_ACCESS_KEY_ID: "intero",
        INTERO_OBJECT_STORAGE_SECRET_ACCESS_KEY: "server-only-minio-secret",
        INTERO_OBJECT_STORAGE_BUCKET: "intero-objects",
      }),
    ).toMatchObject({
      mode: "minio",
      bucket: "intero-objects",
      encryption: "AES256",
      tenantPrefix: "tenants",
    });
  });

  it("loads typed API and worker settings", () => {
    expect(loadApiServiceConfig(postgresEnvironment)).toMatchObject({
      objectStorage: { mode: "disabled" },
      metricsEnabled: true,
      pilot: { persistence: "postgres" },
    });
    expect(
      loadWorkerServiceConfig({
        ...postgresEnvironment,
        INTERO_WORKER_DATABASE_URL:
          "postgres://intero_worker:secret@db.internal/intero",
      }),
    ).toMatchObject({
      concurrency: 8,
      metricsHost: "127.0.0.1",
      metricsPort: 9464,
    });
  });

  it("configures invite-only credentials without a delivery provider", () => {
    expect(
      loadApiServiceConfig({
        ...postgresEnvironment,
        INTERO_AUTH_SECRET:
          "intero-auth-secret-that-is-at-least-thirty-two-bytes",
        INTERO_PUBLIC_URL: "http://127.0.0.1:4310",
        INTERO_AUTH_TRUSTED_ORIGINS: "http://127.0.0.1:5183",
        INTERO_PASSKEY_RP_ID: "127.0.0.1",
      }),
    ).toMatchObject({
      auth: {
        publicUrl: "http://127.0.0.1:4310",
        passkeyRpId: "127.0.0.1",
        trustedOrigins: ["http://127.0.0.1:5183"],
      },
    });
  });

  it("allows development identity simulation only in development mode", () => {
    expect(
      loadApiServiceConfig({
        ...postgresEnvironment,
        INTERO_RUNTIME_MODE: "development",
        INTERO_ALLOW_DEVELOPMENT_IDENTITY: "true",
      }),
    ).toMatchObject({
      runtimeMode: "development",
      allowDevelopmentIdentity: true,
    });
  });

  it("rejects development identity behavior in product mode", () => {
    expect(() =>
      loadApiServiceConfig({
        ...postgresEnvironment,
        INTERO_RUNTIME_MODE: "product",
        INTERO_ALLOW_DEVELOPMENT_IDENTITY: "true",
        INTERO_AUTH_SECRET:
          "intero-auth-secret-that-is-at-least-thirty-two-bytes",
      }),
    ).toThrow(
      "Product runtime cannot enable INTERO_ALLOW_DEVELOPMENT_IDENTITY.",
    );
  });

  it("requires persistent session authentication in product mode", () => {
    expect(() =>
      loadApiServiceConfig({
        ...postgresEnvironment,
        INTERO_RUNTIME_MODE: "product",
        INTERO_SEED_DEMO: "true",
      }),
    ).toThrow("Product runtime requires INTERO_AUTH_SECRET");

    expect(
      loadApiServiceConfig({
        ...postgresEnvironment,
        INTERO_RUNTIME_MODE: "product",
        INTERO_SEED_DEMO: "true",
        INTERO_AUTH_SECRET:
          "intero-auth-secret-that-is-at-least-thirty-two-bytes",
      }),
    ).toMatchObject({
      runtimeMode: "product",
      allowDevelopmentIdentity: false,
      auth: {},
    });
  });

  it("validates ordered migrator dependencies", () => {
    expect(
      loadMigratorServiceConfig({
        DATABASE_URL: "postgres://admin:secret@db.internal/intero",
        INTERO_SPICEDB_ENDPOINT: "spicedb.internal:50051",
        INTERO_SPICEDB_TOKEN: "server-only-spicedb-token",
      }),
    ).toMatchObject({
      workerDatabaseUrl: "postgres://admin:secret@db.internal/intero",
      spiceDb: { endpoint: "spicedb.internal:50051" },
    });
    expect(() =>
      loadMigratorServiceConfig({
        DATABASE_URL: "postgres://admin:secret@db.internal/intero",
        INTERO_SPICEDB_ENDPOINT: "spicedb.internal:50051",
      }),
    ).toThrow("configured together");
  });
});
