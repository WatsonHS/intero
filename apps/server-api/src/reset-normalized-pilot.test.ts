import { describe, expect, it } from "vitest";

import {
  expectedNormalizedProviderDestructionConfirmation,
  expectedValidationResetTargetConfirmation,
  requireDisposableValidationResetTarget,
  requireNormalizedProviderDestructionConfirmation,
  requireResetConfirmation,
} from "./reset-normalized-pilot.js";

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

  it("only accepts an explicitly named disposable validation database", () => {
    const databaseUrl =
      "postgresql://intero@127.0.0.1:5432/intero_agent_connection_test_019f9f";
    const confirmation =
      "INTERO_VALIDATION_DISPOSABLE:127.0.0.1:5432/intero_agent_connection_test_019f9f";
    expect(expectedValidationResetTargetConfirmation(databaseUrl)).toBe(
      confirmation,
    );
    expect(() =>
      requireDisposableValidationResetTarget(databaseUrl, confirmation),
    ).not.toThrow();
    expect(() =>
      requireDisposableValidationResetTarget(
        "postgresql://intero@127.0.0.1:5432/intero_demo_personal_validation",
        "INTERO_VALIDATION_DISPOSABLE:127.0.0.1:5432/intero_demo_personal_validation",
      ),
    ).toThrow("database names");
    expect(() =>
      requireDisposableValidationResetTarget(
        databaseUrl,
        "INTERO_VALIDATION_DISPOSABLE:127.0.0.1:5432/other_test_db",
      ),
    ).toThrow("INTERO_RESET_DISPOSABLE_CONFIRM");
  });

  it("requires a separate database-and-organization Provider destruction phrase", () => {
    const databaseUrl =
      "postgresql://intero@127.0.0.1:5432/intero_pilot_test_019f9f";
    const parsedOrganizationId = requireResetConfirmation(
      organizationId,
      `DELETE_NORMALIZED_PILOT_DATA:${organizationId}`,
    );
    const expected =
      "DESTROY_INTERO_CONFIGURED_PROVIDER:127.0.0.1:5432/intero_pilot_test_019f9f:019b5ac0-7600-7000-8000-000000000001";
    expect(
      expectedNormalizedProviderDestructionConfirmation(
        databaseUrl,
        parsedOrganizationId,
      ),
    ).toBe(expected);
    expect(() =>
      requireNormalizedProviderDestructionConfirmation({
        databaseUrl,
        organizationId: parsedOrganizationId,
        hasConfiguredProvider: true,
      }),
    ).toThrow("existing configured Provider");
    expect(() =>
      requireNormalizedProviderDestructionConfirmation({
        databaseUrl,
        organizationId: parsedOrganizationId,
        hasConfiguredProvider: true,
        confirmation: expected,
      }),
    ).not.toThrow();
  });
});
