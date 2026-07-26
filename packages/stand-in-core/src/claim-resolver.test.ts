import { claimFixture, workstreamFixture } from "@intero/test-support";
import { describe, expect, it } from "vitest";

import { resolveWorkstream } from "./claim-resolver.js";
import { buildPublicProjection } from "./public-projection.js";

describe("resolveWorkstream", () => {
  it("preserves conflict when completion is contradicted by direct validation", () => {
    const workstream = workstreamFixture({ phase: "validating" });
    const completed = claimFixture(workstream, {
      predicate: "completed",
      value: "true",
      sourceType: "coding_agent_report",
      sourceRef: "checkpoint:done",
    });
    const validation = claimFixture(workstream, {
      predicate: "completed",
      value: "false",
      sourceType: "direct_observation",
      sourceRef: "validation:failed",
      confidence: 1,
    });

    const resolved = resolveWorkstream({
      workstream,
      claims: [completed, validation],
    });
    expect(resolved.phase).toBe("validating");
    expect(resolved.contradictionClaimIds).toEqual(
      expect.arrayContaining([completed.id, validation.id]),
    );
  });

  it("lets explicit human correction outrank later inference", () => {
    const workstream = workstreamFixture();
    const correction = claimFixture(workstream, {
      predicate: "phase",
      value: "reviewing",
      sourceType: "human_correction",
      observedAt: "2026-07-24T09:00:00.000Z",
      confidence: 1,
    });
    const inference = claimFixture(workstream, {
      predicate: "phase",
      value: "implementing",
      sourceType: "stand_in_inference",
      observedAt: "2026-07-24T11:00:00.000Z",
      confidence: 1,
    });

    expect(
      resolveWorkstream({ workstream, claims: [correction, inference] }).phase,
    ).toBe("reviewing");
  });
});

describe("buildPublicProjection", () => {
  it("does not publish non-organizational file churn", () => {
    const previous = workstreamFixture({ version: 2 });
    const next = {
      ...previous,
      freshnessAt: "2026-07-24T10:01:00.000Z",
      version: 3,
    };
    expect(buildPublicProjection(previous, next)).toBeUndefined();
  });
});
