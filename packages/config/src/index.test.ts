import { describe, expect, it } from "vitest";

import { safeTelemetryAttributes } from "./index.js";

describe("telemetry allowlist", () => {
  it("drops content and secret fields", () => {
    expect(
      safeTelemetryAttributes({
        operation: "claim.resolve",
        durationMs: 12,
        prompt: "private",
        message: "private",
        accessToken: "secret",
      }),
    ).toEqual({ operation: "claim.resolve", durationMs: 12 });
  });
});
