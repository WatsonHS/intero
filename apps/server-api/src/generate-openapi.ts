import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  BootstrapResponse,
  CreateCapabilityGrantRequest,
  CreateClaimRequest,
  CreateDecisionRequest,
  CreateKanbanCardRequest,
  CreateSpecRequest,
  CreateWorkstreamRequest,
  EditThreadMessageRequest,
  KanbanBoardResponse,
  KanbanCardResponse,
  PresenceHeartbeatRequest,
  PresenceResponse,
  LinkPreviewsResponse,
  SpecListResponse,
  SearchQuery,
  SearchResponse,
  TeamPulseResponse,
  ThreadResponse,
  UpdateKanbanCardRequest,
  UpdateThreadRequest,
  UpsertWebPushSubscriptionRequest,
  DeleteWebPushSubscriptionRequest,
  WebPushConfigResponse,
  WebPushSubscriptionResponse,
} from "@intero/api-contracts";
import openapiTS, { astToString } from "openapi-typescript";
import { format } from "prettier";
import { z } from "zod";

const schemas = {
  BootstrapResponse,
  CreateCapabilityGrantRequest,
  CreateClaimRequest,
  CreateDecisionRequest,
  CreateKanbanCardRequest,
  CreateSpecRequest,
  CreateWorkstreamRequest,
  KanbanBoardResponse,
  KanbanCardResponse,
  LinkPreviewsResponse,
  SpecListResponse,
  SearchQuery,
  SearchResponse,
  TeamPulseResponse,
  ThreadResponse,
  UpdateKanbanCardRequest,
  UpdateThreadRequest,
  EditThreadMessageRequest,
  PresenceHeartbeatRequest,
  PresenceResponse,
  UpsertWebPushSubscriptionRequest,
  DeleteWebPushSubscriptionRequest,
  WebPushConfigResponse,
  WebPushSubscriptionResponse,
};

const document = {
  openapi: "3.0.3",
  info: { title: "Intero API", version: "0.1.0" },
  servers: [{ url: "http://localhost:4310" }],
  security: [{ sessionCookie: [] }],
  paths: {
    "/health": {
      get: {
        operationId: "health",
        security: [],
        responses: { "200": { description: "Healthy" } },
      },
    },
    "/v1/bootstrap": {
      get: {
        operationId: "getBootstrap",
        security: [],
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
    "/v1/threads/{threadId}": {
      patch: {
        operationId: "updateThread",
        parameters: [
          {
            in: "path",
            name: "threadId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateThreadRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated group conversation",
          },
          "404": {
            description: "Thread not found or inaccessible",
          },
        },
      },
    },
    "/v1/threads/{threadId}/messages/{messageId}": {
      patch: {
        operationId: "editThreadMessage",
        parameters: [
          {
            in: "path",
            name: "threadId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            in: "path",
            name: "messageId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EditThreadMessageRequest" },
            },
          },
        },
        responses: {
          "200": { description: "Edited message" },
          "403": { description: "Caller is not the sender" },
          "409": { description: "Message cannot be edited" },
        },
      },
      delete: {
        operationId: "deleteThreadMessage",
        parameters: [
          {
            in: "path",
            name: "threadId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            in: "path",
            name: "messageId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "204": { description: "Message deleted" },
          "403": { description: "Caller is not the sender" },
          "409": { description: "Message cannot be deleted" },
        },
      },
    },
    "/v1/threads/{threadId}/typing": {
      post: {
        operationId: "publishTyping",
        parameters: [
          {
            in: "path",
            name: "threadId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "204": { description: "Typing hint accepted" },
        },
      },
    },
    "/v1/presence/heartbeat": {
      post: {
        operationId: "presenceHeartbeat",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PresenceHeartbeatRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Current presence for the caller",
          },
        },
      },
    },
    "/v1/presence": {
      get: {
        operationId: "listPresence",
        parameters: [
          {
            in: "query",
            name: "principalIds",
            required: true,
            schema: {
              type: "array",
              items: { type: "string", format: "uuid" },
            },
          },
        ],
        responses: {
          "200": {
            description: "Presence visible to the caller",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PresenceResponse" },
              },
            },
          },
        },
      },
    },
    "/v1/link-previews": {
      get: {
        operationId: "listLinkPreviews",
        parameters: [
          {
            in: "query",
            name: "url",
            required: true,
            schema: {
              oneOf: [
                { type: "string", format: "uri" },
                {
                  type: "array",
                  items: { type: "string", format: "uri" },
                  maxItems: 20,
                },
              ],
            },
          },
        ],
        responses: {
          "200": {
            description: "Cached public link preview metadata",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LinkPreviewsResponse" },
              },
            },
          },
        },
      },
    },
    "/v1/threads/{threadId}/messages/{messageId}/preview": {
      delete: {
        operationId: "hideThreadMessagePreview",
        parameters: [
          {
            in: "path",
            name: "threadId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            in: "path",
            name: "messageId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "Message with link previews hidden",
          },
          "403": {
            description: "Only the sender can hide previews",
          },
          "404": {
            description: "Message not found or inaccessible",
          },
        },
      },
    },
    "/v1/config/web-push": {
      get: {
        operationId: "getWebPushConfig",
        responses: {
          "200": {
            description: "Whether Web Push is enabled and the VAPID public key",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebPushConfigResponse" },
              },
            },
          },
        },
      },
    },
    "/v1/me/push-subscriptions": {
      post: {
        operationId: "upsertPushSubscription",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/UpsertWebPushSubscriptionRequest",
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Stored Web Push subscription",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/WebPushSubscriptionResponse",
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: "deletePushSubscription",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/DeleteWebPushSubscriptionRequest",
              },
            },
          },
        },
        responses: {
          "200": { description: "Subscription removed" },
          "404": { description: "Subscription not found" },
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
    "/v1/search": {
      get: {
        operationId: "search",
        parameters: [
          {
            in: "query",
            name: "q",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Authorized search results, including messages",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SearchResponse" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "better-auth.session_token",
      },
    },
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
