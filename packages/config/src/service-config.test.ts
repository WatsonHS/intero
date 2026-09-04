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
  INTERO_OBJECT_STORAGE_ENDPOINT: "http://minio.internal:9000",
  INTERO_OBJECT_STORAGE_ACCESS_KEY_ID: "intero",
  INTERO_OBJECT_STORAGE_SECRET_ACCESS_KEY: "server-only-minio-secret",
  INTERO_OBJECT_STORAGE_BUCKET: "intero-objects",
} as const;

const productEnvironment = {
  ...postgresEnvironment,
  NODE_ENV: "production",
  INTERO_PUBLIC_URL: "https://intero.example.com",
  INTERO_AUTH_SECRET: "intero-auth-secret-that-is-at-least-thirty-two-bytes",
  INTERO_CENTRIFUGO_API_URL: "http://centrifugo.internal:8000",
  INTERO_CENTRIFUGO_API_KEY: "centrifugo-publish-api-key",
  INTERO_CENTRIFUGO_TOKEN_SECRET:
    "realtime-token-secret-at-least-thirty-two-bytes",
} as const;

describe("service environment schemas", () => {
  it("requires MinIO connection settings and fixes storage policy", () => {
    expect(() => loadObjectStorageConfig({})).toThrow();
    expect(() =>
      loadObjectStorageConfig({
        INTERO_OBJECT_STORAGE_ENDPOINT: "http://minio.internal:9000",
      }),
    ).toThrow();
    expect(loadObjectStorageConfig(postgresEnvironment)).toMatchObject({
      bucket: "intero-objects",
      region: "us-east-1",
      encryption: "AES256",
      tenantPrefix: "tenants",
      maxObjectBytes: 25 * 1024 * 1024,
      pendingUploadTtlSeconds: 3_600,
      quarantineRetentionDays: 30,
      abortIncompleteMultipartDays: 1,
    });
  });

  it("derives development services from available connections", () => {
    expect(loadApiServiceConfig(postgresEnvironment)).toMatchObject({
      runtime: { host: "0.0.0.0", port: 4310, logLevel: "info" },
      runtimeMode: "development",
      allowDevelopmentIdentity: true,
      pilot: {
        persistence: "postgres",
        authorization: "membership",
        standInJobs: "transactional-outbox",
        centrifugoApiUrl: "http://localhost:8000",
        centrifugoApiKey: "intero-development-realtime-api-key-v1",
      },
      realtime: {
        publicUrl: "http://localhost:4310",
        tokenSecret: "intero-development-realtime-token-secret-v1",
      },
      calls: {
        serverUrl: "ws://localhost:7880",
        apiKey: "devkey",
        apiSecret: "secret",
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
    });
  });

  it("derives browser-facing auth settings from the public URL", () => {
    const loopback = loadApiServiceConfig({
      ...postgresEnvironment,
      INTERO_AUTH_SECRET:
        "intero-auth-secret-that-is-at-least-thirty-two-bytes",
      INTERO_PUBLIC_URL: "http://127.0.0.1:4310",
    });
    expect(loopback).toMatchObject({
      allowDevelopmentIdentity: false,
      auth: {
        publicUrl: "http://127.0.0.1:4310",
        passkeyRpId: "localhost",
        trustedOrigins: expect.arrayContaining([
          "http://127.0.0.1:4310",
          "http://127.0.0.1:4311",
          "http://127.0.0.1:5173",
        ]),
      },
    });

    const publicDeployment = loadApiServiceConfig({
      ...postgresEnvironment,
      INTERO_AUTH_SECRET:
        "intero-auth-secret-that-is-at-least-thirty-two-bytes",
      INTERO_PUBLIC_URL: "https://intero.example.com",
    });
    expect(publicDeployment.auth?.trustedOrigins).toEqual([
      "https://intero.example.com",
    ]);
    expect(publicDeployment.auth?.passkeyRpId).toBe("intero.example.com");
  });

  it("requires the product secrets and canonical HTTPS origin", () => {
    const { INTERO_AUTH_SECRET: _authSecret, ...withoutAuthSecret } =
      productEnvironment;
    expect(() => loadApiServiceConfig(withoutAuthSecret)).toThrow(
      "INTERO_AUTH_SECRET",
    );

    expect(() =>
      loadApiServiceConfig({
        ...productEnvironment,
        INTERO_PUBLIC_URL: "http://intero.example.com",
      }),
    ).toThrow("HTTPS INTERO_PUBLIC_URL");
  });

  it("derives the production topology without feature selectors", () => {
    const config = loadApiServiceConfig({
      ...productEnvironment,
      INTERO_SPICEDB_ENDPOINT: "spicedb.internal:50051",
      INTERO_SPICEDB_TOKEN: "server-only-spicedb-token",
      INTERO_LIVEKIT_API_SECRET: "livekit-secret",
    });

    expect(config).toMatchObject({
      runtimeMode: "product",
      allowDevelopmentIdentity: false,
      spiceDbInsecure: false,
      pilot: {
        persistence: "postgres",
        authorization: "spicedb",
        standInJobs: "transactional-outbox",
      },
      realtime: { publicUrl: "https://intero.example.com" },
      calls: {
        serverUrl: "wss://intero.example.com/rtc",
        apiKey: "intero",
        apiSecret: "livekit-secret",
      },
    });

    expect(
      loadWorkerServiceConfig({
        ...productEnvironment,
        INTERO_WORKER_DATABASE_URL:
          "postgres://intero_worker:secret@db.internal/intero",
      }),
    ).toMatchObject({
      runtimeMode: "product",
      concurrency: 8,
      metricsHost: "0.0.0.0",
      metricsPort: 9464,
      spiceDbInsecure: false,
    });
  });

  it("carries a private SpiceDB CA path into every service", () => {
    const caPath = "/run/intero/spicedb/ca.crt";
    expect(
      loadApiServiceConfig({
        ...postgresEnvironment,
        INTERO_SPICEDB_CA_PATH: caPath,
      }),
    ).toMatchObject({ spiceDbCaPath: caPath, spiceDbInsecure: false });
    expect(
      loadMigratorServiceConfig({
        DATABASE_URL: "postgres://admin:secret@db.internal/intero",
        INTERO_SPICEDB_ENDPOINT: "spicedb.internal:50051",
        INTERO_SPICEDB_TOKEN: "server-only-spicedb-token",
        INTERO_SPICEDB_CA_PATH: caPath,
      }),
    ).toMatchObject({ spiceDb: { caPath, insecure: false } });
  });

  it("requires both Centrifugo credentials in product mode", () => {
    const { INTERO_CENTRIFUGO_API_KEY: _apiKey, ...withoutApiKey } =
      productEnvironment;
    expect(() => loadApiServiceConfig(withoutApiKey)).toThrow(
      "INTERO_CENTRIFUGO_API_KEY",
    );

    const {
      INTERO_CENTRIFUGO_TOKEN_SECRET: _tokenSecret,
      ...withoutTokenSecret
    } = productEnvironment;
    expect(() => loadApiServiceConfig(withoutTokenSecret)).toThrow(
      "INTERO_CENTRIFUGO_TOKEN_SECRET",
    );
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
      spiceDb: { endpoint: "spicedb.internal:50051", insecure: true },
    });
    expect(() =>
      loadMigratorServiceConfig({
        DATABASE_URL: "postgres://admin:secret@db.internal/intero",
        INTERO_SPICEDB_ENDPOINT: "spicedb.internal:50051",
      }),
    ).toThrow("configured together");
  });
});
