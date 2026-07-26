import { describe, expect, it } from "vitest";

import { hookShouldCollect } from "./hook.js";

describe("hook privacy boundary", () => {
  it("ignores Agent sessions created by Intero configuration probes", () => {
    expect(hookShouldCollect({ INTERO_INTEGRATION_PROBE: "1" })).toBe(false);
    expect(hookShouldCollect({})).toBe(true);
  });
});
