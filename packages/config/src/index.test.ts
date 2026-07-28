import { describe, expect, it } from "vitest";

import {
  loadPilotAdapterConfig,
  loadRuntimeConfig,
  safeTelemetryAttributes,
} from "./index.js";

describe("runtime configuration", () => {
  it("listens on every IPv4 interface by default", () => {
    expect(loadRuntimeConfig({})).toMatchObject({
      host: "0.0.0.0",
      port: 4310,
    });
  });

  it("keeps an explicit loopback binding available", () => {
    expect(loadRuntimeConfig({ INTERO_API_HOST: "127.0.0.1" }).host).toBe(
      "127.0.0.1",
    );
  });
});

describe("telemetry allowlist", () => {
  it("drops content and secret fields", () => {
    expect(
      safeTelemetryAttributes({
        operation: "claim.resolve",
        durationMs: 12,
        prompt: "private",
        message: "private",
        accessToken: "secret",
      }),
    ).toEqual({ operation: "claim.resolve", durationMs: 12 });
  });
});

describe("pilot adapter configuration", () => {
  it("uses memory only when no database is configured", () => {
    expect(
      loadPilotAdapterConfig({
        INTERO_CENTRIFUGO_API_URL: "http://localhost:8000",
      }),
    ).toEqual({
      persistence: "memory",
      authorization: "membership",
      standInJobs: "inline",
      centrifugoApiUrl: "http://localhost:8000",
    });
  });

  it("selects normalized PostgreSQL and requires server-only encryption", () => {
    expect(
      loadPilotAdapterConfig({
        INTERO_DATABASE_URL: "postgres://intero.test/intero",
        INTERO_PROVIDER_ENCRYPTION_KEY: "server-only-encryption-secret",
        INTERO_CENTRIFUGO_API_URL: "http://localhost:8000",
      }),
    ).toEqual({
      persistence: "postgres",
      authorization: "membership",
      standInJobs: "transactional-outbox",
      databaseUrl: "postgres://intero.test/intero",
      providerEncryptionKey: "server-only-encryption-secret",
      centrifugoApiUrl: "http://localhost:8000",
    });
  });

  it("rejects incomplete PostgreSQL adapter configuration", () => {
    expect(() =>
      loadPilotAdapterConfig({
        INTERO_PILOT_PERSISTENCE: "postgres",
        INTERO_DATABASE_URL: "postgres://intero.test/intero",
        INTERO_CENTRIFUGO_API_URL: "http://localhost:8000",
      }),
    ).toThrow("INTERO_PROVIDER_ENCRYPTION_KEY");
  });

  it("selects and validates Phase 2 infrastructure adapters", () => {
    expect(
      loadPilotAdapterConfig({
        INTERO_DATABASE_URL: "postgres://intero.test/intero",
        INTERO_PROVIDER_ENCRYPTION_KEY: "server-only-encryption-secret",
        INTERO_SPICEDB_ENDPOINT: "spicedb.internal:50051",
        INTERO_SPICEDB_TOKEN: "spicedb-token",
        INTERO_CENTRIFUGO_API_URL: "https://centrifugo.internal",
      }),
    ).toMatchObject({
      authorization: "spicedb",
      standInJobs: "transactional-outbox",
      spiceDbEndpoint: "spicedb.internal:50051",
      centrifugoApiUrl: "https://centrifugo.internal",
    });
  });

  it("rejects incomplete Phase 2 adapter configuration", () => {
    expect(() =>
      loadPilotAdapterConfig({
        INTERO_PILOT_AUTHORIZATION: "spicedb",
        INTERO_CENTRIFUGO_API_URL: "http://localhost:8000",
      }),
    ).toThrow("INTERO_SPICEDB_ENDPOINT");
    expect(() => loadPilotAdapterConfig({})).toThrow();
    expect(() =>
      loadPilotAdapterConfig({
        INTERO_PILOT_STAND_IN_JOBS: "transactional-outbox",
        INTERO_CENTRIFUGO_API_URL: "http://localhost:8000",
      }),
    ).toThrow("PostgreSQL");
  });
});
