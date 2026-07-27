import { PrincipalId } from "@intero/domain";
import { describe, expect, it } from "vitest";

import { resolvePilotCommunicationPrincipal } from "./CommunicationsView.js";

const sessionPrincipal = {
  id: PrincipalId.parse("019f9ba4-3108-7000-8000-000000000001"),
  displayName: "会话用户",
  kind: "human" as const,
  status: "online" as const,
  timezone: "Asia/Shanghai",
  capabilities: [],
};

describe("CommunicationsView Pilot principal discovery", () => {
  it("uses the authenticated current principal when dev identities are absent", () => {
    expect(
      resolvePilotCommunicationPrincipal(
        sessionPrincipal.id,
        { currentPrincipal: sessionPrincipal, identities: [] },
      ),
    ).toEqual(sessionPrincipal);
  });

  it("keeps development identity discovery as an explicit fallback", () => {
    expect(
      resolvePilotCommunicationPrincipal(
        sessionPrincipal.id,
        { identities: [sessionPrincipal] },
      ),
    ).toEqual(sessionPrincipal);
  });

  it("does not substitute a different session principal", () => {
    expect(
      resolvePilotCommunicationPrincipal(
        sessionPrincipal.id,
        {
          currentPrincipal: {
            ...sessionPrincipal,
            id: PrincipalId.parse("019f9ba4-3108-7000-8000-000000000002"),
          },
          identities: [],
        },
      ),
    ).toBeUndefined();
  });
});
