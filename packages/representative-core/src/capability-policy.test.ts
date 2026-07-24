import type { ActionEnvelope, CapabilityGrant } from "@intero/domain";
import { uuidv7 } from "@intero/domain";
import { describe, expect, it } from "vitest";

import { authorizeEnvelope } from "./capability-policy.js";

function fixtures(): { grant: CapabilityGrant; envelope: ActionEnvelope } {
  const actorId = uuidv7() as CapabilityGrant["principalId"];
  const grantId = uuidv7() as CapabilityGrant["id"];
  const workstreamId = uuidv7() as CapabilityGrant["workstreamIds"][number];
  const grant: CapabilityGrant = {
    id: grantId,
    principalId: actorId,
    actions: ["declare_ownership", "read_public_state"],
    organizationId: uuidv7() as CapabilityGrant["organizationId"],
    projectIds: [],
    workstreamIds: [workstreamId],
    resourceScopes: ["api/payments"],
    requiresConfirmation: [],
    expiresAt: "2027-07-24T00:00:00.000Z",
    policyVersion: "policy-1",
  };
  const envelope: ActionEnvelope = {
    schemaVersion: 1,
    operationId: uuidv7() as ActionEnvelope["operationId"],
    action: "ownership_declaration",
    actorId,
    authorityGrantId: grantId,
    policyVersion: "policy-1",
    threadId: uuidv7() as ActionEnvelope["threadId"],
    workstreamId,
    humanMessage: "I can own the existing payment API scope.",
    resourceScope: ["api/payments"],
    relatedClaimIds: [],
    evidenceRefs: [],
    requestedActions: [],
    createdAt: "2026-07-24T10:00:00.000Z",
  };
  return { grant, envelope };
}

describe("authorizeEnvelope", () => {
  it("allows ownership inside existing scope", () => {
    const { grant, envelope } = fixtures();
    expect(authorizeEnvelope(envelope, grant, new Date("2026-07-24"))).toEqual({
      allowed: true,
      requiresConfirmation: false,
    });
  });

  it("rejects silent scope expansion", () => {
    const { grant, envelope } = fixtures();
    expect(
      authorizeEnvelope(
        { ...envelope, resourceScope: ["api/identity"] },
        grant,
        new Date("2026-07-24"),
      ),
    ).toEqual({
      allowed: false,
      reason: "A requested resource is outside the granted scope.",
    });
  });
});
