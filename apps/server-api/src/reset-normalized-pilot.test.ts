import { describe, expect, it } from "vitest";

import { requireResetConfirmation } from "./reset-normalized-pilot.js";

describe("normalized Pilot development reset guard", () => {
  const organizationId = "019b5ac0-7600-7000-8000-000000000001";

  it("requires the exact target Organization in the confirmation phrase", () => {
    expect(
      requireResetConfirmation(
        organizationId,
        `DELETE_NORMALIZED_PILOT_DATA:${organizationId}`,
      ),
    ).toBe(organizationId);
    expect(() =>
      requireResetConfirmation(organizationId, "DELETE_NORMALIZED_PILOT_DATA"),
    ).toThrow("Refusing reset");
  });
});
