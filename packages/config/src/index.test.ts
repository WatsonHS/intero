import { describe, expect, it } from "vitest";

import { loadPilotAdapterConfig, safeTelemetryAttributes } from "./index.js";

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
    expect(loadPilotAdapterConfig({})).toEqual({
      persistence: "memory",
      authorization: "membership",
      realtime: "polling",
      standInJobs: "inline",
    });
  });

  it("selects normalized PostgreSQL and requires server-only encryption", () => {
    expect(
      loadPilotAdapterConfig({
        INTERO_DATABASE_URL: "postgres://intero.test/intero",
        INTERO_PROVIDER_ENCRYPTION_KEY: "server-only-encryption-secret",
      }),
    ).toEqual({
      persistence: "postgres",
      authorization: "membership",
      realtime: "polling",
      standInJobs: "transactional-outbox",
      databaseUrl: "postgres://intero.test/intero",
      providerEncryptionKey: "server-only-encryption-secret",
    });
  });

  it("rejects incomplete PostgreSQL adapter configuration", () => {
    expect(() =>
      loadPilotAdapterConfig({
        INTERO_PILOT_PERSISTENCE: "postgres",
        INTERO_DATABASE_URL: "postgres://intero.test/intero",
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
      realtime: "centrifugo",
      standInJobs: "transactional-outbox",
      spiceDbEndpoint: "spicedb.internal:50051",
      centrifugoApiUrl: "https://centrifugo.internal",
    });
  });

  it("rejects incomplete Phase 2 adapter configuration", () => {
    expect(() =>
      loadPilotAdapterConfig({
        INTERO_PILOT_AUTHORIZATION: "spicedb",
      }),
    ).toThrow("INTERO_SPICEDB_ENDPOINT");
    expect(() =>
      loadPilotAdapterConfig({
        INTERO_PILOT_REALTIME: "centrifugo",
      }),
    ).toThrow("INTERO_CENTRIFUGO_API_URL");
    expect(() =>
      loadPilotAdapterConfig({
        INTERO_PILOT_STAND_IN_JOBS: "transactional-outbox",
      }),
    ).toThrow("PostgreSQL");
  });
});
