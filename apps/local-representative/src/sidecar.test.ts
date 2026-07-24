import type { DaemonClient } from "@intero/local-ipc";
import { uuidv7 } from "@intero/domain";
import { afterEach, describe, expect, it } from "vitest";

import { LocalRepresentativeRuntime } from "./runtime";
import { processQueuedRequest } from "./sidecar";

class MemoryDaemon implements DaemonClient {
  readonly events: unknown[] = [];
  readonly completions: unknown[] = [];

  async call(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === "system.health") {
      return { status: "ok", version: "0.1.0", protocolVersion: 1 };
    }
    if (method === "representative.complete_request") {
      this.completions.push(params.result);
      return { completed: true };
    }
    if (method !== "state.persist_event")
      throw new Error(`Unexpected method ${method}`);
    this.events.push(params.event);
    return { inserted: this.events.length === 1 };
  }
}

afterEach(() => {
  delete process.env.INTERO_API_URL;
});

describe("Local Representative sidecar", () => {
  it("persists a semantic checkpoint before reducing it and ignores replay", async () => {
    const daemon = new MemoryDaemon();
    const runtime = new LocalRepresentativeRuntime("disabled");
    const request = {
      requestId: uuidv7(),
      method: "representative.report_checkpoint",
      params: {
        workspaceId: uuidv7(),
        workstreamId: uuidv7(),
        kind: "decision",
        summary: "Keep the public projection versioned.",
      },
    };

    await processQueuedRequest(daemon, runtime, request);
    await processQueuedRequest(daemon, runtime, request);

    expect(daemon.events).toHaveLength(2);
    expect(runtime.workstreams.size).toBe(1);
    expect(runtime.claims.values().next().value).toHaveLength(1);
    expect(runtime.projections).toHaveLength(1);
    expect(daemon.completions).toHaveLength(2);
    expect(daemon.completions[1]).toMatchObject({ duplicate: true });
  });
});
