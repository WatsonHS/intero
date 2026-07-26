import type { AuthorizationPort } from "./ports.js";
import { MembershipAuthorizationAdapter } from "./pilot-ports.js";
import type { PilotStore } from "./pilot-store.js";
import { SpiceDbAuthorization } from "./spicedb-authorization.js";

/**
 * SpiceDB is the enforcement engine; normalized membership remains the
 * relationship source of truth during Phase 2.
 *
 * A source check prevents stale tuples from widening access. Allowed
 * relationships are touched idempotently before the fully-consistent SpiceDB
 * check, which also makes recovery after a SpiceDB restart self-healing.
 */
export class SpiceDbPilotAuthorization implements AuthorizationPort {
  private readonly source: MembershipAuthorizationAdapter;

  constructor(
    store: PilotStore,
    private readonly spiceDb: SpiceDbAuthorization,
  ) {
    this.source = new MembershipAuthorizationAdapter(store);
  }

  async check(input: {
    principalId: string;
    permission: string;
    resourceType: string;
    resourceId: string;
    consistencyToken?: string;
  }): Promise<{ allowed: boolean; consistencyToken?: string }> {
    const source = await this.source.check(input);
    if (!source.allowed) return { allowed: false };
    const mapping = relationshipFor(input);
    if (!mapping) return { allowed: false };
    try {
      const consistencyToken = await this.spiceDb.touchRelationship({
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        relation: mapping.relation,
        principalId: input.principalId,
      });
      return this.spiceDb.check({
        ...input,
        permission: mapping.permission,
        ...(consistencyToken ? { consistencyToken } : {}),
      });
    } catch {
      return { allowed: false };
    }
  }
}

function relationshipFor(input: {
  permission: string;
  resourceType: string;
}): { relation: string; permission: string } | undefined {
  if (input.resourceType === "organization" && input.permission === "admin") {
    return { relation: "admin", permission: "manage" };
  }
  if (input.resourceType === "team" && input.permission === "participate") {
    return { relation: "member", permission: "participate" };
  }
  if (input.resourceType === "team" && input.permission === "manage_members") {
    return { relation: "manager", permission: "manage_members" };
  }
  if (input.resourceType === "project" && input.permission === "participate") {
    return { relation: "member", permission: "participate" };
  }
  if (
    input.resourceType === "project" &&
    input.permission === "manage_collaboration"
  ) {
    return { relation: "owner", permission: "manage_collaboration" };
  }
  return undefined;
}
