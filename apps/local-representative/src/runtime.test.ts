import type { CanonicalWorkEvent, Workstream } from "@intero/domain";
import { uuidv7 } from "@intero/domain";
import { describe, expect, it } from "vitest";

import { LocalRepresentativeRuntime } from "./runtime.js";

describe("LocalRepresentativeRuntime", () => {
  it("continues deterministic reduction with network and model disabled", async () => {
    const runtime = new LocalRepresentativeRuntime("disabled");
    const workstream: Workstream = {
      id: uuidv7() as Workstream["id"],
      workspaceId: uuidv7() as Workstream["workspaceId"],
      ownerId: uuidv7() as Workstream["ownerId"],
      title: "Implement offline reduction",
      phase: "implementing",
      scope: [],
      blockers: [],
      dependencies: [],
      decisions: [],
      artifactIds: [],
      freshnessAt: "2026-07-24T10:00:00.000Z",
      confidence: 0.7,
      evidenceClaimIds: [],
      contradictionClaimIds: [],
      version: 0,
    };
    runtime.workstreams.set(workstream.id, workstream);
    const event: CanonicalWorkEvent = {
      id: uuidv7() as CanonicalWorkEvent["id"],
      operationId: uuidv7() as CanonicalWorkEvent["operationId"],
      schemaVersion: 1,
      source: "claude-code",
      type: "CheckpointReported",
      occurredAt: "2026-07-24T10:05:00.000Z",
      receivedAt: "2026-07-24T10:05:01.000Z",
      workspaceId: workstream.workspaceId,
      workstreamId: workstream.id,
      privacy: "P1_REPRESENTATIVE_PRIVATE",
      payload: {
        checkpointKind: "decision",
        summary: "Use cursor-based replay.",
      },
      idempotencyKey: "claude:decision:1",
    };

    const result = await runtime.handle(event);
    expect(result.workstream.decisions).toContain("Use cursor-based replay.");
    expect(runtime.modelEgressMode).toBe("disabled");
    expect(result.projection?.changedFields).toContain("decisions");
  });
});
