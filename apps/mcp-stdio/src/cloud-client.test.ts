import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PILOT_AGENT_CONFIGURATION_VERSION } from "@intero/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CloudPilotClient,
  EncryptedOutbox,
  defaultCloudDirectoryForWorkspace,
} from "./cloud-client.js";

describe("cloud MCP client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("encrypts queued payloads at rest", () => {
    const directory = mkdtempSync(join(tmpdir(), "intero-outbox-"));
    const path = join(directory, "events.enc");
    const outbox = new EncryptedOutbox(path, randomBytes(32));

    outbox.enqueue({
      clientEventId: "event-secure-0001",
      summary: "Sensitive safe summary that must still be encrypted at rest.",
    });

    const stored = readFileSync(path, "utf8");
    expect(stored).not.toContain("Sensitive safe summary");
    expect(stored).not.toContain("event-secure-0001");
    expect(outbox.size()).toBe(1);
  });

  it("isolates default encrypted state by local workspace without storing its path", () => {
    const home = "/Users/alex";
    const first = defaultCloudDirectoryForWorkspace(
      "/workspaces/project-a",
      home,
    );
    const repeated = defaultCloudDirectoryForWorkspace(
      "/workspaces/project-a",
      home,
    );
    const second = defaultCloudDirectoryForWorkspace(
      "/workspaces/project-b",
      home,
    );

    expect(first).toBe(repeated);
    expect(first).not.toBe(second);
    expect(first).not.toContain("project-a");
    expect(second).not.toContain("project-b");
  });

  it("persists the workspace identity before exchange and reuses it on retry", async () => {
    vi.stubEnv("INTERO_OUTBOX_KEY", "stable-workspace-test-key");
    const workspaceIds: string[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        workspaceId: string;
      };
      workspaceIds.push(body.workspaceId);
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          credential: "stable-workspace-credential",
          projectId: "project-1",
          binding: {
            id: "019f9b01-1111-7111-8111-111111111111",
            client: "cursor",
            name: "Cursor · project-a",
            workspaceId: body.workspaceId,
            preferredLanguage: "en-US",
          },
          verification: { code: "verification-code-stable-workspace" },
        }),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const address = server.address() as AddressInfo;
      const configDirectory = mkdtempSync(
        join(tmpdir(), "intero-stable-workspace-"),
      );
      for (const ticket of ["ticket-first", "ticket-retry"]) {
        await CloudPilotClient.connect({
          baseUrl: `http://127.0.0.1:${address.port}`,
          ticket,
          client: "cursor",
          cwd: "/workspaces/project-a",
          configDirectory,
        });
      }

      expect(workspaceIds).toHaveLength(2);
      expect(workspaceIds[0]).toMatch(/^[0-9a-f-]{36}$/);
      expect(workspaceIds[1]).toBe(workspaceIds[0]);
      expect(
        CloudPilotClient.load({
          client: "cursor",
          configDirectory,
          cwd: "/workspaces/project-a",
        }).context(),
      ).toMatchObject({
        projectId: "project-1",
        client: "cursor",
        workspaceId: workspaceIds[0],
      });
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("refuses a Desktop-approved ticket in a different local workspace before credential exchange", async () => {
    vi.stubEnv("INTERO_OUTBOX_KEY", "desktop-workspace-test-key");
    let exchanges = 0;
    const server = createServer((_request, response) => {
      exchanges += 1;
      response.end(JSON.stringify({ credential: "must-not-be-issued" }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const directory = mkdtempSync(
        join(tmpdir(), "intero-desktop-workspace-"),
      );
      const approvedWorkspaceId = "019fcdb4-a6da-7332-8e7e-d907b98d02f1";
      const repositoryBWorkspaceId = "019fcdb4-a6da-7332-8e7e-d907b98d02f2";
      writeFileSync(
        join(directory, "workspace-id"),
        `${repositoryBWorkspaceId}\n`,
      );
      const address = server.address() as AddressInfo;

      await expect(
        CloudPilotClient.connect({
          baseUrl: `http://127.0.0.1:${address.port}`,
          ticket: "desktop-ticket-for-repository-a",
          client: "cursor",
          cwd: "/workspaces/repository-b",
          configDirectory: directory,
          expectedWorkspaceId: approvedWorkspaceId,
        }),
      ).rejects.toThrow("different local repository workspace");
      expect(exchanges).toBe(0);
      expect(readFileSync(join(directory, "workspace-id"), "utf8")).toBe(
        `${repositoryBWorkspaceId}\n`,
      );
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("bounds count/bytes and records overflow gaps", () => {
    const directory = mkdtempSync(join(tmpdir(), "intero-outbox-"));
    const outbox = new EncryptedOutbox(
      join(directory, "events.enc"),
      randomBytes(32),
      { maxEvents: 2, maxBytes: 450, maxAgeMs: 60_000 },
    );

    outbox.enqueue({ clientEventId: "event-0001", summary: "a".repeat(100) });
    outbox.enqueue({ clientEventId: "event-0002", summary: "b".repeat(100) });
    outbox.enqueue({ clientEventId: "event-0003", summary: "c".repeat(100) });

    const diagnostics = outbox.diagnostics();
    expect(diagnostics.pendingEvents).toBeLessThanOrEqual(2);
    expect(diagnostics.gapMarkers).toContainEqual(
      expect.objectContaining({ reason: "overflow" }),
    );
  });

  it("expires events after the seven-day-equivalent TTL and records a gap", () => {
    const directory = mkdtempSync(join(tmpdir(), "intero-outbox-"));
    const outbox = new EncryptedOutbox(
      join(directory, "events.enc"),
      randomBytes(32),
      { maxEvents: 10, maxBytes: 10_000, maxAgeMs: 1_000 },
    );
    const start = new Date("2026-07-25T00:00:00.000Z");
    outbox.enqueue(
      { clientEventId: "event-expiring-0001", summary: "queued" },
      start,
    );

    expect(outbox.peek(new Date("2026-07-25T00:00:02.000Z"))).toBeUndefined();
    expect(outbox.diagnostics().gapMarkers).toContainEqual(
      expect.objectContaining({ reason: "expired", droppedCount: 1 }),
    );
  });

  it("performs the real MCP handshake before the compatibility validation checkpoint", async () => {
    vi.stubEnv("INTERO_OUTBOX_KEY", "connection-test-key");
    const checkpoints: Array<Record<string, unknown>> = [];
    const validations: Array<{
      authorization: string | undefined;
      body: Record<string, unknown>;
    }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
        string,
        unknown
      >;

      response.setHeader("content-type", "application/json");
      if (request.url === "/v1/pilot/agent/connect") {
        response.end(
          JSON.stringify({
            credential: "agent-credential",
            projectId: "project-1",
            binding: {
              id: "019f9b01-1111-7111-8111-111111111111",
              client: "codex",
              name: "Codex · pilot",
              workspaceId: body.workspaceId,
              preferredLanguage: "zh-CN",
            },
            verification: {
              code: "verification-code-connection-test",
            },
          }),
        );
        return;
      }
      if (request.url === "/v1/pilot/mcp") {
        validations.push({
          authorization: request.headers.authorization,
          body,
        });
        if (body.method === "initialize") {
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                protocolVersion: "2025-06-18",
                capabilities: {},
                serverInfo: { name: "intero-project-cloud", version: "0.2.0" },
              },
            }),
          );
          return;
        }
        const toolName = (body.params as { name?: string } | undefined)?.name;
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ...(toolName === "stand_in.current_context"
                      ? {
                          projectId: "project-1",
                          confirmedCoordination: [
                            {
                              coordinationThreadId:
                                "019f9b01-3333-7333-8333-333333333333",
                              decisionId:
                                "019f9b01-4444-7444-8444-444444444444",
                              conclusion: "Keep the compatibility window.",
                            },
                          ],
                        }
                      : {
                          status: "lifecycle_pending",
                          mcpConnected: true,
                          configurationCurrent: true,
                        }),
                  }),
                },
              ],
            },
          }),
        );
        return;
      }
      if (request.url === "/v1/pilot/agent/checkpoints") {
        checkpoints.push(body);
        response.end(JSON.stringify({ accepted: true, published: true }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ message: "Not found" }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const address = server.address() as AddressInfo;
      const client = await CloudPilotClient.connect({
        baseUrl: `http://127.0.0.1:${address.port}`,
        ticket: "ticket-test",
        client: "codex",
        cwd: "/workspace/pilot",
        configDirectory: mkdtempSync(join(tmpdir(), "intero-connect-")),
      });

      await client.validateConnection();
      await client.reportConnectionCheck();
      const currentContext = await client.currentContext();

      expect(client.context().preferredLanguage).toBe("zh-CN");
      expect(validations).toEqual([
        {
          authorization: "Bearer agent-credential",
          body: expect.objectContaining({
            jsonrpc: "2.0",
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: {
                name: "codex",
                version: "0.1.0",
              },
            },
          }),
        },
        {
          authorization: "Bearer agent-credential",
          body: expect.objectContaining({
            jsonrpc: "2.0",
            method: "tools/call",
            params: {
              name: "intero.validate_connection",
              arguments: {
                configurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
                verificationCode: "verification-code-connection-test",
              },
            },
          }),
        },
        {
          authorization: "Bearer agent-credential",
          body: expect.objectContaining({
            jsonrpc: "2.0",
            method: "tools/call",
            params: {
              name: "stand_in.current_context",
              arguments: {},
            },
          }),
        },
      ]);
      expect(currentContext).toEqual({
        projectId: "project-1",
        confirmedCoordination: [
          {
            coordinationThreadId: "019f9b01-3333-7333-8333-333333333333",
            decisionId: "019f9b01-4444-7444-8444-444444444444",
            conclusion: "Keep the compatibility window.",
          },
        ],
      });
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0]).toMatchObject({
        schemaVersion: 2,
        eventType: "validation_completed",
        clientEventId: "connection-check-019f9b01-1111-7111-8111-111111111111",
        workstream: {
          key: "intero-agent-connection-check",
          title: "Agent 连接验证",
          phase: "validating",
        },
        narrative: {
          currentFocus: "验证 Coding Agent 与当前 Intero 项目的连接。",
          completedOutcome: "Codex 已完成项目绑定。",
          collaboration: {
            needed: false,
            request: "",
            requestedFrom: "",
          },
        },
      });
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("keeps Project work mutations scoped to the bound Agent connection", async () => {
    vi.stubEnv("INTERO_OUTBOX_KEY", "phase5-project-test-key");
    const requests: Array<{
      url: string;
      authorization: string | undefined;
      idempotencyKey: string | undefined;
      body: Record<string, unknown>;
    }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = chunks.length
        ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
            string,
            unknown
          >)
        : {};
      response.setHeader("content-type", "application/json");
      if (request.url === "/v1/pilot/agent/connect") {
        response.end(
          JSON.stringify({
            credential: "project-agent-credential",
            projectId: "019b5ac0-7600-7000-8000-000000000011",
            binding: {
              id: "019f9b01-1111-7111-8111-111111111111",
              client: "codex",
              name: "Codex · delivery",
              workspaceId: body.workspaceId,
              preferredLanguage: "en-US",
            },
            verification: {
              code: "verification-code-project-test",
            },
          }),
        );
        return;
      }
      requests.push({
        url: request.url ?? "",
        authorization: request.headers.authorization,
        idempotencyKey: request.headers["idempotency-key"] as
          string | undefined,
        body,
      });
      response.end(
        JSON.stringify({
          id: "019f9b01-3333-7333-8333-333333333333",
          title: body.title,
        }),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const address = server.address() as AddressInfo;
      const client = await CloudPilotClient.connect({
        baseUrl: `http://127.0.0.1:${address.port}`,
        ticket: "single-use-ticket",
        client: "codex",
        cwd: "/workspace/delivery",
        configDirectory: mkdtempSync(join(tmpdir(), "intero-phase5-")),
      });

      await client.projectRequest({
        path: "/items",
        method: "POST",
        body: {
          title: "Validate refund export",
          status: "ready_for_test",
        },
        clientMutationId: "phase5-client-mutation",
      });

      expect(requests).toEqual([
        {
          url: "/v1/project-work/019b5ac0-7600-7000-8000-000000000011/items",
          authorization: "Bearer project-agent-credential",
          idempotencyKey: "phase5-client-mutation",
          body: {
            title: "Validate refund export",
            status: "ready_for_test",
          },
        },
      ]);
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
