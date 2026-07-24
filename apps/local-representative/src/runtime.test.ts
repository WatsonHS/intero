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

  it("publishes the first lifecycle projection and later intent changes", async () => {
    const runtime = new LocalRepresentativeRuntime("disabled");
    const workspaceId = uuidv7() as Workstream["workspaceId"];
    const workstreamId = uuidv7() as Workstream["id"];
    const started: CanonicalWorkEvent = {
      id: uuidv7() as CanonicalWorkEvent["id"],
      operationId: uuidv7() as CanonicalWorkEvent["operationId"],
      schemaVersion: 1,
      source: "codex",
      type: "SessionStarted",
      occurredAt: "2026-07-25T00:00:00.000Z",
      receivedAt: "2026-07-25T00:00:00.100Z",
      workspaceId,
      workstreamId,
      privacy: "P1_REPRESENTATIVE_PRIVATE",
      payload: { phase: "SessionStart" },
      idempotencyKey: "codex:SessionStart:session-1:event-1",
    };
    const first = await runtime.handle(started);
    expect(first.projection?.title).toBe("Coding Agent work");

    const intent: CanonicalWorkEvent = {
      ...started,
      id: uuidv7() as CanonicalWorkEvent["id"],
      operationId: uuidv7() as CanonicalWorkEvent["operationId"],
      type: "CheckpointReported",
      payload: {
        checkpointKind: "intent",
        summary: "Wire the Coding Agent integration.",
      },
      idempotencyKey: "mcp:checkpoint-1",
    };
    const updated = await runtime.handle(intent);
    expect(updated.projection?.title).toBe(
      "Wire the Coding Agent integration.",
    );
    expect(updated.projection?.changedFields).toContain("intent");
  });

  it("clears a paused phase when semantic work resumes", async () => {
    const runtime = new LocalRepresentativeRuntime("disabled");
    const workspaceId = uuidv7() as Workstream["workspaceId"];
    const workstreamId = uuidv7() as Workstream["id"];
    const base: CanonicalWorkEvent = {
      id: uuidv7() as CanonicalWorkEvent["id"],
      operationId: uuidv7() as CanonicalWorkEvent["operationId"],
      schemaVersion: 1,
      source: "opencode",
      type: "SessionPaused",
      occurredAt: "2026-07-25T00:00:00.000Z",
      receivedAt: "2026-07-25T00:00:00.100Z",
      workspaceId,
      workstreamId,
      privacy: "P1_REPRESENTATIVE_PRIVATE",
      payload: { checkpointKind: "pause", phase: "session.idle" },
      idempotencyKey: "opencode:idle:session-1",
    };
    const paused = await runtime.handle(base);
    expect(paused.workstream.phase).toBe("paused");

    const resumed = await runtime.handle({
      ...base,
      id: uuidv7() as CanonicalWorkEvent["id"],
      operationId: uuidv7() as CanonicalWorkEvent["operationId"],
      type: "CheckpointReported",
      occurredAt: "2026-07-25T00:01:00.000Z",
      payload: {
        checkpointKind: "validation",
        summary: "Integration smoke passed.",
      },
      idempotencyKey: "opencode:checkpoint:session-1",
    });
    expect(resumed.workstream.phase).toBe("implementing");
    const latestPauseClaim = runtime.claims
      .get(workstreamId)
      ?.filter((claim) => claim.predicate === "paused")
      .at(-1);
    expect(latestPauseClaim?.value).toBe("false");
    expect(resumed.workstream.contradictionClaimIds).toEqual([]);
  });
});
