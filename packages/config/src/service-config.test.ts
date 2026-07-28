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
  INTERO_OBJECT_STORAGE: "minio",
  INTERO_OBJECT_STORAGE_ENDPOINT: "http://minio.internal:9000",
  INTERO_OBJECT_STORAGE_ACCESS_KEY_ID: "intero",
  INTERO_OBJECT_STORAGE_SECRET_ACCESS_KEY: "server-only-minio-secret",
  INTERO_OBJECT_STORAGE_BUCKET: "intero-objects",
} as const;

describe("service environment schemas", () => {
  it("requires MinIO object storage", () => {
    expect(() => loadObjectStorageConfig({})).toThrow();
    expect(() =>
      loadObjectStorageConfig({ INTERO_OBJECT_STORAGE: "disabled" }),
    ).toThrow();
  });

  it("requires all server-only MinIO settings", () => {
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
      objectStorage: { mode: "minio", bucket: "intero-objects" },
      metricsEnabled: true,
      pilot: {
        persistence: "postgres",
        centrifugoApiUrl: "http://localhost:8000",
        centrifugoApiKey: "intero-development-realtime-api-key-v1",
      },
      realtime: {
        publicUrl: "http://localhost:4311",
        tokenSecret: "intero-development-realtime-token-secret-v1",
      },
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
      pilot: {
        centrifugoApiUrl: "http://localhost:8000",
        centrifugoApiKey: "intero-development-realtime-api-key-v1",
      },
    });
  });

  it("rejects the removed realtime mode switch", () => {
    expect(() =>
      loadApiServiceConfig({
        ...postgresEnvironment,
        INTERO_PILOT_REALTIME: "polling",
      }),
    ).toThrow("INTERO_PILOT_REALTIME no longer selects an adapter");
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
        trustedOrigins: expect.arrayContaining([
          "http://127.0.0.1:4310",
          "http://127.0.0.1:5183",
          "http://127.0.0.1:5173",
        ]),
      },
    });
  });

  it("keeps the public auth URL on localhost when binding all interfaces", () => {
    expect(
      loadApiServiceConfig({
        ...postgresEnvironment,
        INTERO_AUTH_SECRET:
          "intero-auth-secret-that-is-at-least-thirty-two-bytes",
      }),
    ).toMatchObject({
      runtime: { host: "0.0.0.0", port: 4310 },
      auth: {
        publicUrl: "http://localhost:4310",
        trustedOrigins: expect.arrayContaining([
          "http://localhost:4310",
          "http://localhost:4311",
          "http://127.0.0.1:5173",
          "http://127.0.0.1:4311",
          "http://0.0.0.0:4311",
        ]),
      },
    });
  });

  it("does not add local development origins to a public deployment", () => {
    const config = loadApiServiceConfig({
      ...postgresEnvironment,
      INTERO_AUTH_SECRET:
        "intero-auth-secret-that-is-at-least-thirty-two-bytes",
      INTERO_PUBLIC_URL: "https://intero.example.com",
    });
    expect(config.auth?.trustedOrigins).toEqual(["https://intero.example.com"]);
    expect(config.auth?.passkeyRpId).toBe("intero.example.com");
  });

  it("allows a LAN HTTP address as the canonical pilot origin", () => {
    expect(
      loadApiServiceConfig({
        ...postgresEnvironment,
        INTERO_AUTH_SECRET:
          "intero-auth-secret-that-is-at-least-thirty-two-bytes",
        INTERO_PUBLIC_URL: "http://10.20.30.40:4311/",
      }),
    ).toMatchObject({
      auth: {
        publicUrl: "http://10.20.30.40:4311",
        passkeyRpId: "10.20.30.40",
        trustedOrigins: ["http://10.20.30.40:4311"],
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
        INTERO_CENTRIFUGO_API_URL: "https://centrifugo.internal",
        INTERO_PUBLIC_URL: "https://intero.example.com",
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
        INTERO_CENTRIFUGO_API_URL: "https://centrifugo.internal",
        INTERO_PUBLIC_URL: "https://intero.example.com",
        INTERO_SEED_DEMO: "true",
      }),
    ).toThrow("Product runtime requires INTERO_AUTH_SECRET");

    expect(
      loadApiServiceConfig({
        ...postgresEnvironment,
        INTERO_RUNTIME_MODE: "product",
        INTERO_CENTRIFUGO_API_URL: "https://centrifugo.internal",
        INTERO_SEED_DEMO: "true",
        INTERO_AUTH_SECRET:
          "intero-auth-secret-that-is-at-least-thirty-two-bytes",
        INTERO_PUBLIC_URL: "https://intero.internal.example",
        INTERO_CENTRIFUGO_TOKEN_SECRET:
          "realtime-token-secret-at-least-thirty-two-bytes",
        INTERO_CENTRIFUGO_API_KEY: "centrifugo-publish-api-key",
      }),
    ).toMatchObject({
      runtimeMode: "product",
      allowDevelopmentIdentity: false,
      auth: {},
    });
  });

  it("rejects plaintext browser and SpiceDB transport in product mode", () => {
    const product = {
      ...postgresEnvironment,
      INTERO_RUNTIME_MODE: "product",
      INTERO_AUTH_SECRET:
        "intero-auth-secret-that-is-at-least-thirty-two-bytes",
      INTERO_CENTRIFUGO_TOKEN_SECRET:
        "realtime-token-secret-at-least-thirty-two-bytes",
      INTERO_CENTRIFUGO_API_KEY: "centrifugo-publish-api-key",
    } as const;

    expect(() =>
      loadApiServiceConfig({
        ...product,
        INTERO_PUBLIC_URL: "http://intero.example.com",
      }),
    ).toThrow("Product runtime requires an HTTPS INTERO_PUBLIC_URL");

    expect(() =>
      loadApiServiceConfig({
        ...product,
        INTERO_PUBLIC_URL: "https://intero.example.com",
        INTERO_SPICEDB_INSECURE: "true",
      }),
    ).toThrow("Product runtime cannot enable INTERO_SPICEDB_INSECURE");

    expect(() =>
      loadWorkerServiceConfig({
        ...postgresEnvironment,
        INTERO_RUNTIME_MODE: "product",
        INTERO_WORKER_DATABASE_URL:
          "postgres://intero_worker:secret@db.internal/intero",
        INTERO_CENTRIFUGO_API_KEY: "centrifugo-publish-api-key",
        INTERO_SPICEDB_INSECURE: "true",
      }),
    ).toThrow("Product runtime cannot enable INTERO_SPICEDB_INSECURE");
  });

  it("carries a private SpiceDB CA path into service and migrator config", () => {
    const caPath = "/run/intero/spicedb/ca.crt";
    expect(
      loadApiServiceConfig({
        ...postgresEnvironment,
        INTERO_SPICEDB_CA_PATH: caPath,
      }),
    ).toMatchObject({ spiceDbCaPath: caPath });
    expect(
      loadMigratorServiceConfig({
        DATABASE_URL: "postgres://admin:secret@db.internal/intero",
        INTERO_SPICEDB_ENDPOINT: "spicedb.internal:50051",
        INTERO_SPICEDB_TOKEN: "server-only-spicedb-token",
        INTERO_SPICEDB_CA_PATH: caPath,
      }),
    ).toMatchObject({ spiceDb: { caPath } });
  });

  it("requires both browser-token and publish credentials for product realtime", () => {
    const productRealtime = {
      ...postgresEnvironment,
      INTERO_RUNTIME_MODE: "product",
      INTERO_AUTH_SECRET:
        "intero-auth-secret-that-is-at-least-thirty-two-bytes",
      INTERO_PUBLIC_URL: "https://intero.example.com",
      INTERO_CENTRIFUGO_API_URL: "https://centrifugo.internal",
    } as const;
    expect(() => loadApiServiceConfig(productRealtime)).toThrow(
      "INTERO_CENTRIFUGO_TOKEN_SECRET",
    );
    expect(() =>
      loadApiServiceConfig({
        ...productRealtime,
        INTERO_CENTRIFUGO_TOKEN_SECRET:
          "realtime-token-secret-at-least-thirty-two-bytes",
      }),
    ).toThrow("INTERO_CENTRIFUGO_API_KEY");
    expect(
      loadApiServiceConfig({
        ...productRealtime,
        INTERO_CENTRIFUGO_TOKEN_SECRET:
          "realtime-token-secret-at-least-thirty-two-bytes",
        INTERO_CENTRIFUGO_API_KEY: "centrifugo-publish-api-key",
      }).realtime,
    ).toMatchObject({
      publicUrl: "https://intero.example.com",
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
