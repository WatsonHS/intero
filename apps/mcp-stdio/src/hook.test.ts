import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudPilotClient } from "./cloud-client.js";
import {
  handleHookEvent,
  hashedSessionClientEventId,
  hookShouldCollect,
} from "./hook.js";

describe("hook privacy boundary", () => {
  it("ignores Agent sessions created by Intero configuration probes", () => {
    expect(hookShouldCollect({ INTERO_INTEGRATION_PROBE: "1" })).toBe(false);
    expect(hookShouldCollect({})).toBe(true);
  });
});

describe("lifecycle hook reporting", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("posts SessionStart to the lifecycle endpoint instead of a checkpoint", async () => {
    vi.stubEnv("INTERO_OUTBOX_KEY", "hook-lifecycle-test-key");
    const hooks: Array<Record<string, unknown>> = [];
    const checkpoints: Array<Record<string, unknown>> = [];
    const configDirectory = mkdtempSync(join(tmpdir(), "intero-hook-"));
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
            credential: "hook-credential",
            projectId: "project-1",
            binding: {
              id: "019f9b01-1111-7111-8111-111111111111",
              client: "codex",
              name: "Codex · hook",
              workspaceId: body.workspaceId,
              preferredLanguage: "zh-CN",
            },
            verification: { code: "verification-code-hook-test" },
          }),
        );
        return;
      }
      if (request.url === "/v1/pilot/agent/hooks") {
        expect(request.headers.authorization).toBe("Bearer hook-credential");
        hooks.push(body);
        response.statusCode = 202;
        response.end(
          JSON.stringify({
            accepted: true,
            duplicate: false,
            published: false,
            activity: {
              status: "active",
              updatedAt: "2026-09-04T00:00:00.000Z",
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
      await CloudPilotClient.connect({
        baseUrl: `http://127.0.0.1:${address.port}`,
        ticket: "ticket-hook",
        client: "codex",
        cwd: configDirectory,
        configDirectory,
      });

      await handleHookEvent(
        "codex",
        {
          hook_event_name: "SessionStart",
          cwd: configDirectory,
          session_id: "sess-native-0001",
        },
        { configDirectory },
      );

      expect(checkpoints).toEqual([]);
      expect(hooks).toEqual([
        {
          clientEventId: hashedSessionClientEventId("sess-native-0001"),
          lifecycle: "session_started",
          workstreamKey: "repository",
          workstreamTitle: "repository",
        },
      ]);
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("maps OpenCode session.created to session_started", async () => {
    vi.stubEnv("INTERO_OUTBOX_KEY", "hook-opencode-test-key");
    const hooks: Array<Record<string, unknown>> = [];
    const configDirectory = mkdtempSync(join(tmpdir(), "intero-hook-oc-"));
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
            credential: "hook-credential",
            projectId: "project-1",
            binding: {
              id: "019f9b01-2222-7222-8222-222222222222",
              client: "opencode",
              name: "OpenCode · hook",
              workspaceId: body.workspaceId,
              preferredLanguage: "en-US",
            },
            verification: { code: "verification-code-opencode-hook" },
          }),
        );
        return;
      }
      if (request.url === "/v1/pilot/agent/hooks") {
        hooks.push(body);
        response.statusCode = 202;
        response.end(JSON.stringify({ accepted: true }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ message: "Not found" }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const address = server.address() as AddressInfo;
      await CloudPilotClient.connect({
        baseUrl: `http://127.0.0.1:${address.port}`,
        ticket: "ticket-hook-oc",
        client: "opencode",
        cwd: configDirectory,
        configDirectory,
      });

      await handleHookEvent(
        "opencode",
        {
          hook_event_name: "session.created",
          cwd: configDirectory,
          session_id: "oc-session-9",
        },
        { configDirectory },
      );

      expect(hooks[0]).toMatchObject({
        clientEventId: hashedSessionClientEventId("oc-session-9"),
        lifecycle: "session_started",
      });
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
