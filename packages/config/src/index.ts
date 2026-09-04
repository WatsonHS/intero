import pino, { type LoggerOptions } from "pino";
import { z } from "zod";

export const RuntimeConfig = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().min(1).max(65_535).default(4310),
  logLevel: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfig>;

export const PilotPersistenceMode = z.enum(["memory", "postgres"]);
export type PilotPersistenceMode = z.infer<typeof PilotPersistenceMode>;
export const PilotAuthorizationMode = z.enum(["membership", "spicedb"]);
export type PilotAuthorizationMode = z.infer<typeof PilotAuthorizationMode>;
export const PilotJobMode = z.enum(["inline", "transactional-outbox"]);
export type PilotJobMode = z.infer<typeof PilotJobMode>;

export const PilotAdapterConfig = z
  .object({
    persistence: PilotPersistenceMode,
    authorization: PilotAuthorizationMode,
    standInJobs: PilotJobMode,
    databaseUrl: z.string().min(1).optional(),
    providerEncryptionKey: z.string().min(16).optional(),
    spiceDbEndpoint: z.string().min(1).optional(),
    spiceDbToken: z.string().min(1).optional(),
    centrifugoApiUrl: z.string().url(),
    centrifugoApiKey: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.persistence === "postgres") {
      if (!value.databaseUrl) {
        context.addIssue({
          code: "custom",
          path: ["databaseUrl"],
          message: "PostgreSQL persistence requires INTERO_DATABASE_URL.",
        });
      }
      if (!value.providerEncryptionKey) {
        context.addIssue({
          code: "custom",
          path: ["providerEncryptionKey"],
          message:
            "PostgreSQL persistence requires INTERO_PROVIDER_ENCRYPTION_KEY.",
        });
      }
    }
    if (
      value.standInJobs === "transactional-outbox" &&
      value.persistence !== "postgres"
    ) {
      context.addIssue({
        code: "custom",
        path: ["standInJobs"],
        message: "Transactional Stand-in jobs require PostgreSQL persistence.",
      });
    }
    if (value.authorization === "spicedb") {
      if (!value.spiceDbEndpoint || !value.spiceDbToken) {
        context.addIssue({
          code: "custom",
          path: ["authorization"],
          message:
            "INTERO_SPICEDB_ENDPOINT and INTERO_SPICEDB_TOKEN must be configured together.",
        });
      }
    }
  });
export type PilotAdapterConfig = z.infer<typeof PilotAdapterConfig>;

export function loadRuntimeConfig(): RuntimeConfig {
  return RuntimeConfig.parse({});
}

export function loadPilotAdapterConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PilotAdapterConfig {
  const databaseUrl = environment.INTERO_DATABASE_URL;
  const persistence = databaseUrl ? "postgres" : "memory";
  const spiceDbEndpoint = environment.INTERO_SPICEDB_ENDPOINT;
  const spiceDbToken = environment.INTERO_SPICEDB_TOKEN;
  const centrifugoApiUrl = environment.INTERO_CENTRIFUGO_API_URL;
  return PilotAdapterConfig.parse({
    persistence,
    authorization: spiceDbEndpoint || spiceDbToken ? "spicedb" : "membership",
    standInJobs: persistence === "postgres" ? "transactional-outbox" : "inline",
    databaseUrl,
    providerEncryptionKey: environment.INTERO_PROVIDER_ENCRYPTION_KEY,
    spiceDbEndpoint,
    spiceDbToken,
    centrifugoApiUrl,
    centrifugoApiKey: environment.INTERO_CENTRIFUGO_API_KEY,
  });
}

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers.set-cookie",
  "*.prompt",
  "*.message",
  "*.body",
  "*.fileContent",
  "*.toolInput",
  "*.toolOutput",
  "*.terminalOutput",
  "*.accessToken",
  "*.apiKey",
  "*.secret",
  "*.privateClaims",
];

export function loggerOptions(level = "info"): LoggerOptions {
  return {
    level,
    base: { service: "intero" },
    redact: {
      paths: REDACT_PATHS,
      censor: "[REDACTED]",
    },
    serializers: {
      req(request) {
        return { id: request.id, method: request.method, url: request.url };
      },
      res(response) {
        return { statusCode: response.statusCode };
      },
    },
  };
}

export function createLogger(level = "info") {
  return pino(loggerOptions(level));
}

export const telemetryAllowlist = new Set([
  "service",
  "operation",
  "durationMs",
  "status",
  "eventType",
  "source",
  "runtime",
  "retryCount",
  "modelProvider",
  "tokenCount",
]);

export function safeTelemetryAttributes(
  attributes: Record<string, unknown>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(attributes).filter(
      (entry): entry is [string, string | number | boolean] =>
        telemetryAllowlist.has(entry[0]) &&
        ["string", "number", "boolean"].includes(typeof entry[1]),
    ),
  );
}

export * from "./metrics.js";
export * from "./service-config.js";
