import type { PrincipalId } from "@intero/domain";
import { describe, expect, it } from "vitest";

import type { PilotTeamPayload } from "../pilot/api.js";
import { findContactTeam } from "./PersonView.js";
import { searchTeamContacts } from "./SearchView.js";

const currentId = "019f9ba4-3108-7000-8000-000000000001" as PrincipalId;
const contactId = "019f9ba4-3108-7000-8000-000000000002" as PrincipalId;

const teams = [
  {
    id: "019f9ba4-3108-7000-8000-000000000091",
    organizationId: "019f9ba4-3108-7000-8000-000000000090",
    name: "产品团队",
    createdAt: "2026-07-28T00:00:00.000Z",
    members: [
      {
        id: currentId,
        displayName: "当前用户",
        email: "me@example.com",
        kind: "human",
        teamRole: "member",
      },
      {
        id: contactId,
        displayName: "林晓",
        email: "lin@example.com",
        kind: "human",
        teamRole: "member",
      },
    ],
  },
] as PilotTeamPayload[];

describe("contact entry points", () => {
  it("searches human contacts by name, email, or team and excludes self", () => {
    expect(searchTeamContacts(teams, currentId, "林晓")).toEqual([
      {
        id: contactId,
        displayName: "林晓",
        email: "lin@example.com",
        teamName: "产品团队",
      },
    ]);
    expect(searchTeamContacts(teams, currentId, "lin@")).toHaveLength(1);
    expect(searchTeamContacts(teams, currentId, "产品")).toHaveLength(1);
    expect(searchTeamContacts(teams, currentId, "当前")).toEqual([]);
  });

  it("requires enough text before returning contacts", () => {
    expect(searchTeamContacts(teams, currentId, "林")).toEqual([]);
  });

  it("resolves the shared team used to create a direct message", () => {
    expect(findContactTeam(teams, contactId)?.id).toBe(teams[0]!.id);
    expect(
      findContactTeam(teams, "019f9ba4-3108-7000-8000-000000000099"),
    ).toBeUndefined();
  });
});
