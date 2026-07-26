import { describe, expect, it } from "vitest";

import { evaluateReadiness } from "./ports.js";

describe("readiness dependency model", () => {
  it("fails readiness only for unavailable critical dependencies", async () => {
    await expect(
      evaluateReadiness([
        {
          name: "postgres",
          critical: true,
          check: async () => ({ status: "ready" }),
        },
        {
          name: "realtime",
          critical: false,
          check: async () => ({ status: "unavailable" }),
        },
      ]),
    ).resolves.toMatchObject({ status: "degraded" });

    await expect(
      evaluateReadiness([
        {
          name: "postgres",
          critical: true,
          check: async () => {
            throw new Error("connection refused");
          },
        },
      ]),
    ).resolves.toEqual({
      status: "unavailable",
      dependencies: [
        {
          name: "postgres",
          critical: true,
          status: "unavailable",
          detail: "dependency_check_failed",
        },
      ],
    });
  });
});
