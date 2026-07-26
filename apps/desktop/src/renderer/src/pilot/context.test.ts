import type { PrincipalId } from "@intero/domain";
import { describe, expect, it } from "vitest";

import { resolveGovernance } from "./context.js";

const principalId = "019f9a00-0000-7000-8000-000000000103" as PrincipalId;

function governance(input: {
  organizationRole?: "admin" | "member";
  selectedTeamId?: string;
  productRole?: "member" | "leader";
  platformRole?: "member" | "leader";
}) {
  return resolveGovernance({
    identityId: principalId,
    selectedTeamId: input.selectedTeamId ?? "product",
    organizationRole: input.organizationRole,
    pending: false,
    teams: [
      {
        id: "product",
        members: [
          {
            id: principalId,
            teamRole: input.productRole ?? "member",
            organizationRole: input.organizationRole ?? "member",
          },
        ],
      },
      {
        id: "platform",
        members: [
          {
            id: principalId,
            teamRole: input.platformRole ?? "member",
            organizationRole: input.organizationRole ?? "member",
          },
        ],
      },
    ],
  });
}

describe("team-management visibility governance", () => {
  it("does not render governance for an ordinary member", () => {
    expect(governance({}).canGovern).toBe(false);
  });

  it("does not carry leadership from another Team into the current Team", () => {
    const result = governance({ platformRole: "leader" });

    expect(result.isAnyTeamLead).toBe(true);
    expect(result.isTeamLead).toBe(false);
    expect(result.canGovern).toBe(false);
  });

  it("keeps governance visible for the current Team Leader", () => {
    expect(governance({ productRole: "leader" }).canGovern).toBe(true);
  });

  it("keeps governance visible for an organization admin", () => {
    expect(governance({ organizationRole: "admin" }).canGovern).toBe(true);
  });
});
