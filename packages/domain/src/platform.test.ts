import { describe, expect, it } from "vitest";

import { DomainEventEnvelope } from "./platform.js";

describe("DomainEventEnvelope", () => {
  it("accepts only adapter-neutral identifiers and scalar metadata", () => {
    expect(
      DomainEventEnvelope.parse({
        schemaVersion: 1,
        operationId: "019b5ac0-7600-7000-8000-000000000001",
        organizationId: "019b5ac0-7600-7000-8000-000000000002",
        actorId: "019b5ac0-7600-7000-8000-000000000003",
        aggregateType: "pilot_project",
        aggregateId: "019b5ac0-7600-7000-8000-000000000004",
        eventType: "pilot.project.created",
        visibility: "project",
        projectId: "019b5ac0-7600-7000-8000-000000000004",
        sequence: 1,
        occurredAt: "2026-07-26T00:00:00.000Z",
        metadata: { adapter: "postgres", contractVersion: 1 },
      }),
    ).toMatchObject({ schemaVersion: 1, visibility: "project" });
  });

  it("rejects nested content-bearing metadata", () => {
    expect(() =>
      DomainEventEnvelope.parse({
        schemaVersion: 1,
        operationId: "019b5ac0-7600-7000-8000-000000000001",
        organizationId: "019b5ac0-7600-7000-8000-000000000002",
        actorId: "019b5ac0-7600-7000-8000-000000000003",
        aggregateType: "pilot_project",
        aggregateId: "019b5ac0-7600-7000-8000-000000000004",
        eventType: "pilot.project.created",
        visibility: "project",
        sequence: 1,
        occurredAt: "2026-07-26T00:00:00.000Z",
        metadata: { rawPrompt: { content: "not allowed" } },
      }),
    ).toThrow();
  });
});
