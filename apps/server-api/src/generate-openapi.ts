import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  CoordinateRequest,
  CreateCapabilityGrantRequest,
  CreateClaimRequest,
  CreateDecisionRequest,
  CreateSpecRequest,
  CreateWorkstreamRequest,
  IngestEventRequest,
  TeamPulseResponse,
} from "@intero/api-contracts";
import openapiTS, { astToString } from "openapi-typescript";
import { format } from "prettier";
import { z } from "zod";

const schemas = {
  CoordinateRequest,
  CreateCapabilityGrantRequest,
  CreateClaimRequest,
  CreateDecisionRequest,
  CreateSpecRequest,
  CreateWorkstreamRequest,
  IngestEventRequest,
  TeamPulseResponse,
};

const document = {
  openapi: "3.0.3",
  info: { title: "Intero API", version: "0.1.0" },
  servers: [{ url: "http://localhost:4310" }],
  paths: {
    "/health": {
      get: {
        operationId: "health",
        responses: { "200": { description: "Healthy" } },
      },
    },
    "/v1/events": {
      post: {
        operationId: "ingestCanonicalWorkEvent",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/IngestEventRequest" },
            },
          },
        },
        responses: { "202": { description: "Accepted" } },
      },
    },
    "/v1/team-pulse": {
      get: {
        operationId: "getTeamPulse",
        responses: {
          "200": {
            description: "Current public Work Projections",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TeamPulseResponse" },
              },
            },
          },
        },
      },
    },
    "/v1/coordination": {
      post: {
        operationId: "requestCoordination",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CoordinateRequest" },
            },
          },
        },
        responses: { "200": { description: "Structured coordination result" } },
      },
    },
  },
  components: {
    schemas: Object.fromEntries(
      Object.entries(schemas).map(([name, schema]) => [
        name,
        toOpenApi30Schema(z.toJSONSchema(schema)),
      ]),
    ),
  },
};

const destination = fileURLToPath(
  new URL(
    "../../../packages/api-contracts/generated/openapi.json",
    import.meta.url,
  ),
);
const typesDestination = fileURLToPath(
  new URL(
    "../../../packages/api-contracts/generated/openapi.ts",
    import.meta.url,
  ),
);
await mkdir(
  fileURLToPath(
    new URL("../../../packages/api-contracts/generated", import.meta.url),
  ),
  {
    recursive: true,
  },
);
await writeFile(
  destination,
  await format(JSON.stringify(document), { parser: "json" }),
);
const types = await openapiTS(new URL(`file://${destination}`));
await writeFile(
  typesDestination,
  await format(astToString(types), { parser: "typescript" }),
);

function toOpenApi30Schema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toOpenApi30Schema);
  if (value === null || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (key === "$schema") continue;
    if (key === "const") {
      result.enum = [child];
      continue;
    }
    if (key === "exclusiveMinimum" && typeof child === "number") {
      result.minimum = child;
      result.exclusiveMinimum = true;
      continue;
    }
    if (key === "exclusiveMaximum" && typeof child === "number") {
      result.maximum = child;
      result.exclusiveMaximum = true;
      continue;
    }
    result[key] = toOpenApi30Schema(child);
  }
  return result;
}
