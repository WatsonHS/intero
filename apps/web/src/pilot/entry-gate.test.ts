import { describe, expect, it } from "vitest";

import { resolvePilotEntryGate } from "./entry-gate.js";

const ready = {
  pilotEnabled: true,
  bootstrapActive: false,
  bootstrapLoaded: true,
  organizationConfigured: true,
  teamsLoaded: true,
  teamCount: 1,
  canGovern: false,
};

describe("resolvePilotEntryGate", () => {
  it("uses Bootstrap only while the deployment has no Organization", () => {
    expect(
      resolvePilotEntryGate({
        ...ready,
        organizationConfigured: false,
      }),
    ).toBe("admin_bootstrap");
    expect(resolvePilotEntryGate(ready)).toBe("application");
  });

  it("sends an ordinary member without a Team to access guidance", () => {
    expect(
      resolvePilotEntryGate({
        ...ready,
        teamCount: 0,
      }),
    ).toBe("no_team");
  });

  it("lets an Organization administrator without a Team reach Admin", () => {
    expect(
      resolvePilotEntryGate({
        ...ready,
        teamCount: 0,
        canGovern: true,
      }),
    ).toBe("application");
  });
});
