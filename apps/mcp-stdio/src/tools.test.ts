import { describe, expect, it } from "vitest";

import type { DaemonClient } from "./daemon-client.js";
import { createToolHandlers } from "./tools.js";

class FakeDaemon implements DaemonClient {
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];

  async call(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    this.calls.push({ method, params });
    return { accepted: true };
  }
}

describe("MCP tool handlers", () => {
  it("forwards checkpoint semantics without execution transcript fields", async () => {
    const daemon = new FakeDaemon();
    const tools = createToolHandlers(daemon);
    await tools.reportCheckpoint({
      workspaceId: "019b5ac0-7600-7000-8000-000000000001",
      workstreamId: "019b5ac0-7600-7000-8000-000000000002",
      kind: "decision",
      summary: "Use explicit cursor repair.",
    });
    expect(daemon.calls).toEqual([
      {
        method: "representative.report_checkpoint",
        params: {
          workspaceId: "019b5ac0-7600-7000-8000-000000000001",
          workstreamId: "019b5ac0-7600-7000-8000-000000000002",
          kind: "decision",
          summary: "Use explicit cursor repair.",
        },
      },
    ]);
  });

  it("allows a bounded full Spec while retaining the smaller default limit", async () => {
    const daemon = new FakeDaemon();
    const tools = createToolHandlers(daemon);
    await expect(
      tools.requestSpecReview({
        workspaceId: "019b5ac0-7600-7000-8000-000000000001",
        workstreamId: "019b5ac0-7600-7000-8000-000000000002",
        title: "Large but bounded Spec",
        markdown: "x".repeat(400_000),
        affectedScopes: ["api"],
      }),
    ).resolves.toEqual({ accepted: true });
    expect(() =>
      tools.lookupTeamContext({
        workspaceId: "019b5ac0-7600-7000-8000-000000000001",
        query: "x".repeat(70_000),
      }),
    ).toThrow("64 KiB");
  });

  it("rejects forbidden raw fields recursively", async () => {
    const daemon = new FakeDaemon();
    const tools = createToolHandlers(daemon);
    expect(() =>
      tools.lookupTeamContext({
        workspaceId: "019b5ac0-7600-7000-8000-000000000001",
        query: "team status",
        scope: [{ toolOutput: "raw transcript" }] as unknown as string[],
      }),
    ).toThrow("forbidden raw-content");
  });

  it("waits for the Local Representative's structured result", async () => {
    class CompletingDaemon implements DaemonClient {
      calls = 0;

      async call(method: string): Promise<unknown> {
        if (method === "representative.lookup_decision") {
          return { accepted: true, queued: true, requestId: "request-1" };
        }
        this.calls += 1;
        return this.calls === 1
          ? { status: "processing" }
          : {
              status: "completed",
              result: { decisions: [{ title: "Use cursor repair" }] },
            };
      }
    }
    const daemon = new CompletingDaemon();
    const tools = createToolHandlers(daemon);
    await expect(
      tools.lookupDecision({
        workspaceId: "019b5ac0-7600-7000-8000-000000000001",
        query: "cursor",
      }),
    ).resolves.toEqual({ decisions: [{ title: "Use cursor repair" }] });
  });

  it("binds MCP calls to the current Agent session without public UUID inputs", async () => {
    class BoundDaemon implements DaemonClient {
      calls: Array<{ method: string; params: Record<string, unknown> }> = [];

      async call(
        method: string,
        params: Record<string, unknown>,
      ): Promise<unknown> {
        this.calls.push({ method, params });
        if (method === "integration.current_context") {
          return {
            workspaceId: "019b5ac0-7600-7000-8000-000000000001",
            workstreamId: "019b5ac0-7600-7000-8000-000000000002",
            source: "codex",
            sessionId: "session-1",
          };
        }
        return { accepted: true };
      }
    }
    const daemon = new BoundDaemon();
    const tools = createToolHandlers(daemon, {
      source: "codex",
      cwd: "/workspace",
      clientSessionId: "mcp-process-1",
    });

    await tools.reportCheckpoint({
      kind: "validation",
      summary: "All integration tests pass.",
    });

    expect(daemon.calls).toEqual([
      {
        method: "integration.current_context",
        params: {
          source: "codex",
          cwd: "/workspace",
          clientSessionId: "mcp-process-1",
        },
      },
      {
        method: "representative.report_checkpoint",
        params: {
          workspaceId: "019b5ac0-7600-7000-8000-000000000001",
          workstreamId: "019b5ac0-7600-7000-8000-000000000002",
          kind: "validation",
          summary: "All integration tests pass.",
        },
      },
    ]);
  });
});
