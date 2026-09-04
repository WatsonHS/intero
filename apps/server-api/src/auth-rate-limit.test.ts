import { describe, expect, it } from "vitest";

import { interoAuthRateLimit } from "./auth.js";

describe("interoAuthRateLimit", () => {
  it("keeps the strict per-IP sign-in budget in product mode", () => {
    const limits = interoAuthRateLimit("product");
    expect(limits.customRules["/sign-in/email"]).toEqual({
      window: 60,
      max: 5,
    });
    expect(limits.max).toBe(20);
  });

  it("defaults to the product profile", () => {
    expect(interoAuthRateLimit()).toEqual(interoAuthRateLimit("product"));
  });

  it("relaxes the budget in development so browser suites from one address are not rejected", () => {
    const limits = interoAuthRateLimit("development");
    expect(limits.enabled).toBe(true);
    expect(limits.customRules["/sign-in/email"]!.max).toBeGreaterThanOrEqual(
      60,
    );
    expect(limits.max).toBeGreaterThanOrEqual(300);
  });
});
