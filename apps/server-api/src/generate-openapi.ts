import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  BootstrapResponse,
  CoordinateRequest,
  CreateCapabilityGrantRequest,
  CreateClaimRequest,
  CreateDecisionRequest,
  CreateKanbanCardRequest,
  CreateSpecRequest,
  CreateWorkstreamRequest,
  IngestEventRequest,
  KanbanBoardResponse,
  KanbanCardResponse,
  SpecListResponse,
  TeamPulseResponse,
  ThreadResponse,
  UpdateKanbanCardRequest,
} from "@intero/api-contracts";
import openapiTS, { astToString } from "openapi-typescript";
import { format } from "prettier";
import { z } from "zod";

const schemas = {
  BootstrapResponse,
  CoordinateRequest,
  CreateCapabilityGrantRequest,
  CreateClaimRequest,
  CreateDecisionRequest,
  CreateKanbanCardRequest,
  CreateSpecRequest,
  CreateWorkstreamRequest,
  IngestEventRequest,
  KanbanBoardResponse,
  KanbanCardResponse,
  SpecListResponse,
  TeamPulseResponse,
  ThreadResponse,
  UpdateKanbanCardRequest,
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
    "/v1/bootstrap": {
      get: {
        operationId: "getBootstrap",
        responses: {
          "200": {
            description: "Current organization and principal",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BootstrapResponse" },
              },
            },
          },
        },
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
    "/v1/kanban": {
      get: {
        operationId: "getKanbanBoard",
        responses: {
          "200": {
            description: "Project Kanban cards with optional Workstream links",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/KanbanBoardResponse" },
              },
            },
          },
        },
      },
    },
    "/v1/kanban/cards": {
      post: {
        operationId: "createKanbanCard",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateKanbanCardRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Created Kanban card",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/KanbanCardResponse" },
              },
            },
          },
        },
      },
    },
    "/v1/kanban/cards/{cardId}": {
      patch: {
        operationId: "updateKanbanCard",
        parameters: [
          {
            in: "path",
            name: "cardId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateKanbanCardRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated Kanban card",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/KanbanCardResponse" },
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
    "/v1/threads": {
      get: {
        operationId: "listThreads",
        responses: {
          "200": {
            description: "Durable conversation threads",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/ThreadResponse" },
                    },
                  },
                  required: ["items"],
                },
              },
            },
          },
        },
      },
    },
    "/v1/specs": {
      get: {
        operationId: "listSpecs",
        responses: {
          "200": {
            description: "Versioned Specs and review state",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SpecListResponse" },
              },
            },
          },
        },
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
