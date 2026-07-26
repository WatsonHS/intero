import { describe, expect, it } from "vitest";

import { PilotCheckpointInput, uuidv7 } from "./index.js";

const checkpoint = {
  schemaVersion: 2,
  clientEventId: "billing-export-checkpoint-0001",
  projectId: uuidv7(),
  occurredAt: "2026-07-26T01:00:00.000Z",
  eventType: "review_requested",
  workstream: {
    key: "billing-export",
    title: "Billing CSV export",
    phase: "validating",
  },
  narrative: {
    currentFocus: "Preparing the billing export for finance review.",
    completedOutcome: "Generated the first complete billing CSV.",
    evidence: [
      "12,480 invoice rows exported in staging.",
      "18 billing export integration cases passed.",
    ],
    nextStep: "Confirm the reconciliation column names.",
    collaboration: {
      needed: true,
      request: "Review the tax region and invoice status columns.",
      requestedFrom: "Finance",
    },
  },
  evidenceRefs: ["validation:billing-export"],
} as const;

describe("pilot checkpoint narrative contract", () => {
  it("accepts the five-part human-readable work narrative", () => {
    expect(PilotCheckpointInput.parse(checkpoint).narrative).toEqual(
      checkpoint.narrative,
    );
  });

  it("rejects legacy summary-only checkpoints", () => {
    const { narrative: _, ...withoutNarrative } = checkpoint;
    expect(() =>
      PilotCheckpointInput.parse({
        ...withoutNarrative,
        schemaVersion: 1,
        summary: "Billing export validation passed.",
      }),
    ).toThrow();
  });

  it("rejects raw execution payloads outside the structured contract", () => {
    expect(() =>
      PilotCheckpointInput.parse({
        ...checkpoint,
        terminalOutput: "pnpm test --filter billing",
      }),
    ).toThrow();
  });
});
