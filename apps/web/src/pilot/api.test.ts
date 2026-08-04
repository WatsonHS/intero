import { describe, expect, it } from "vitest";

import { pilotClientIsEnabled } from "./api.js";

describe("pilotClientIsEnabled", () => {
  it("keeps the cloud product enabled inside a packaged Desktop renderer", () => {
    expect(
      pilotClientIsEnabled({
        hasDesktopBridge: true,
        developmentBuild: false,
        pilotFlag: false,
      }),
    ).toBe(true);
  });

  it("keeps an ordinary production browser opt-in", () => {
    expect(
      pilotClientIsEnabled({
        hasDesktopBridge: false,
        developmentBuild: false,
        pilotFlag: true,
      }),
    ).toBe(true);
    expect(
      pilotClientIsEnabled({
        hasDesktopBridge: false,
        developmentBuild: false,
        pilotFlag: false,
      }),
    ).toBe(false);
  });
});
