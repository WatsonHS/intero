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
export const PilotRealtimeMode = z.enum(["polling", "centrifugo"]);
export type PilotRealtimeMode = z.infer<typeof PilotRealtimeMode>;
export const PilotJobMode = z.enum(["inline", "transactional-outbox"]);
export type PilotJobMode = z.infer<typeof PilotJobMode>;

export const PilotAdapterConfig = z
  .object({
    persistence: PilotPersistenceMode,
    authorization: PilotAuthorizationMode,
    realtime: PilotRealtimeMode,
    standInJobs: PilotJobMode,
    databaseUrl: z.string().min(1).optional(),
    providerEncryptionKey: z.string().min(16).optional(),
    spiceDbEndpoint: z.string().min(1).optional(),
    spiceDbToken: z.string().min(1).optional(),
    centrifugoApiUrl: z.string().url().optional(),
    centrifugoApiKey: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.persistence === "postgres") {
      if (!value.databaseUrl) {
        context.addIssue({
          code: "custom",
          path: ["databaseUrl"],
          message:
            "INTERO_DATABASE_URL is required when INTERO_PILOT_PERSISTENCE=postgres.",
        });
      }
      if (!value.providerEncryptionKey) {
        context.addIssue({
          code: "custom",
          path: ["providerEncryptionKey"],
          message:
            "INTERO_PROVIDER_ENCRYPTION_KEY is required when INTERO_PILOT_PERSISTENCE=postgres.",
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
            "INTERO_SPICEDB_ENDPOINT and INTERO_SPICEDB_TOKEN are required when INTERO_PILOT_AUTHORIZATION=spicedb.",
        });
      }
    }
    if (value.realtime === "centrifugo" && !value.centrifugoApiUrl) {
      context.addIssue({
        code: "custom",
        path: ["realtime"],
        message:
          "INTERO_CENTRIFUGO_API_URL is required when INTERO_PILOT_REALTIME=centrifugo.",
      });
    }
  });
export type PilotAdapterConfig = z.infer<typeof PilotAdapterConfig>;

export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  return RuntimeConfig.parse({
    host: environment.INTERO_API_HOST,
    port: environment.INTERO_API_PORT,
    logLevel: environment.INTERO_LOG_LEVEL,
  });
}

export function loadPilotAdapterConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PilotAdapterConfig {
  const databaseUrl = environment.INTERO_DATABASE_URL;
  const persistence =
    environment.INTERO_PILOT_PERSISTENCE ??
    (databaseUrl ? "postgres" : "memory");
  const spiceDbEndpoint = environment.INTERO_SPICEDB_ENDPOINT;
  const spiceDbToken = environment.INTERO_SPICEDB_TOKEN;
  const centrifugoApiUrl = environment.INTERO_CENTRIFUGO_API_URL;
  return PilotAdapterConfig.parse({
    persistence,
    authorization:
      environment.INTERO_PILOT_AUTHORIZATION ??
      (spiceDbEndpoint || spiceDbToken ? "spicedb" : "membership"),
    realtime:
      environment.INTERO_PILOT_REALTIME ??
      (centrifugoApiUrl ? "centrifugo" : "polling"),
    standInJobs:
      environment.INTERO_PILOT_STAND_IN_JOBS ??
      (persistence === "postgres" ? "transactional-outbox" : "inline"),
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
