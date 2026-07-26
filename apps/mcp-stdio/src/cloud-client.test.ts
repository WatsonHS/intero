import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudPilotClient, EncryptedOutbox } from "./cloud-client.js";

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

  it("submits one idempotent validation checkpoint after connecting", async () => {
    vi.stubEnv("INTERO_OUTBOX_KEY", "connection-test-key");
    const checkpoints: Array<Record<string, unknown>> = [];
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
              workspaceId: "019f9b01-2222-7222-8222-222222222222",
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

      await client.reportConnectionCheck();

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
              workspaceId: "019f9b01-2222-7222-8222-222222222222",
            },
          }),
        );
        return;
      }
      requests.push({
        url: request.url ?? "",
        authorization: request.headers.authorization,
        idempotencyKey: request.headers["idempotency-key"] as
          | string
          | undefined,
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
