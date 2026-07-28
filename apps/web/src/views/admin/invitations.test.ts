import { describe, expect, it } from "vitest";

import { latestInvitationsByEmail } from "./invitations.js";

describe("latestInvitationsByEmail", () => {
  it("hides a revoked invitation superseded by a new invitation", () => {
    const invitations = [
      invitation("new", "Everaways@example.com", "2026-07-28T05:30:00.000Z"),
      invitation("revoked", "everaways@example.com", "2026-07-27T05:30:00.000Z"),
    ];

    expect(latestInvitationsByEmail(invitations).map(({ id }) => id)).toEqual([
      "new",
    ]);
  });

  it("hides an expired invitation superseded by a new invitation", () => {
    const invitations = [
      invitation("expired", "member@example.com", "2026-07-20T05:30:00.000Z"),
      invitation("current", "member@example.com", "2026-07-28T05:30:00.000Z"),
      invitation("other", "other@example.com", "2026-07-26T05:30:00.000Z"),
    ];

    expect(latestInvitationsByEmail(invitations).map(({ id }) => id)).toEqual([
      "current",
      "other",
    ]);
  });

  it("continues to show a revoked invitation with no replacement", () => {
    const invitations = [
      invitation("revoked", "member@example.com", "2026-07-28T05:30:00.000Z"),
    ];

    expect(latestInvitationsByEmail(invitations)).toEqual(invitations);
  });
});

function invitation(id: string, email: string, createdAt: string) {
  return { id, email, createdAt };
}
