import { describe, expect, it } from "vitest";

import {
  CanonicalWorkEvent,
  containsForbiddenEventField,
  uuidv7,
} from "./index.js";

describe("CanonicalWorkEvent", () => {
  it("accepts bounded semantic metadata", () => {
    const event = CanonicalWorkEvent.parse({
      id: uuidv7(),
      operationId: uuidv7(),
      schemaVersion: 1,
      source: "codex",
      type: "CheckpointReported",
      occurredAt: "2026-07-24T10:00:00.000Z",
      receivedAt: "2026-07-24T10:00:01.000Z",
      workspaceId: uuidv7(),
      privacy: "P1_REPRESENTATIVE_PRIVATE",
      payload: {
        checkpointKind: "decision",
        summary: "Keep authorization behind a port.",
      },
      idempotencyKey: "codex:checkpoint:01",
    });

    expect(event.payload.checkpointKind).toBe("decision");
  });

  it("rejects raw or sensitive event fields", () => {
    expect(
      containsForbiddenEventField({
        payload: {
          summary: "safe",
          nested: { toolOutput: "entire terminal transcript" },
        },
      }),
    ).toBe(true);
    expect(() =>
      CanonicalWorkEvent.parse({
        id: uuidv7(),
        operationId: uuidv7(),
        schemaVersion: 1,
        source: "codex",
        type: "CheckpointReported",
        occurredAt: "2026-07-24T10:00:00.000Z",
        receivedAt: "2026-07-24T10:00:01.000Z",
        workspaceId: uuidv7(),
        privacy: "P1_REPRESENTATIVE_PRIVATE",
        payload: { prompt: "private" },
        idempotencyKey: "codex:checkpoint:02",
      }),
    ).toThrow();
  });

  it("normalizes forbidden field aliases and rejects likely credential values", () => {
    for (const payload of [
      { prompt_text: "private" },
      { tool_response: "private" },
      { terminal_output: "private" },
      { stdout: "private" },
      { nested: { authorization: "private" } },
      { summary: "sk-private-canary-12345678901234567890" },
    ]) {
      expect(containsForbiddenEventField(payload)).toBe(true);
    }
    expect(
      containsForbiddenEventField({
        summary: "Validated the capability matrix.",
      }),
    ).toBe(false);
  });
});

describe("uuidv7", () => {
  it("is valid and time-sortable", () => {
    const earlier = uuidv7(1_700_000_000_000);
    const later = uuidv7(1_700_000_000_001);
    expect(earlier).toMatch(/^[0-9a-f-]{36}$/);
    expect(earlier < later).toBe(true);
  });
});
