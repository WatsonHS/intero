import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { refreshGovernanceMembers } from "./query-cache.js";

describe("refreshGovernanceMembers", () => {
  it("invalidates every cached view that contains membership roles", async () => {
    const queryClient = new QueryClient();
    const identityId = "principal-a";
    const affectedKeys = [
      ["pilot", "bootstrap"],
      ["pilot", "teams", identityId],
      ["pilot", "organization-directory", identityId],
      ["governance-audit"],
    ] as const;
    const unaffectedKey = ["pilot", "projects", identityId] as const;

    for (const queryKey of [...affectedKeys, unaffectedKey]) {
      queryClient.setQueryData(queryKey, {});
    }

    await refreshGovernanceMembers(queryClient);

    for (const queryKey of affectedKeys) {
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
    expect(queryClient.getQueryState(unaffectedKey)?.isInvalidated).toBe(false);
  });
});
