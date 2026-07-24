import pino, { type LoggerOptions } from "pino";
import { z } from "zod";

export const RuntimeConfig = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.coerce.number().int().min(1).max(65_535).default(4310),
  logLevel: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfig>;

export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  return RuntimeConfig.parse({
    host: environment.INTERO_API_HOST,
    port: environment.INTERO_API_PORT,
    logLevel: environment.INTERO_LOG_LEVEL,
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
