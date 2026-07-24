import type {
  ActionEnvelope,
  CapabilityAction,
  CapabilityGrant,
  CoordinationActionType,
} from "@intero/domain";

const REQUIRED_CAPABILITY: Record<CoordinationActionType, CapabilityAction> = {
  status_query: "read_public_state",
  status_response: "answer_status",
  ownership_declaration: "declare_ownership",
  dependency_request: "register_dependency",
  conflict_notice: "request_coordination",
  coordination_request: "request_coordination",
  correction: "publish_state",
  withdrawal: "publish_state",
  human_escalation: "request_coordination",
};

export type AuthorizationDecision =
  | { allowed: true; requiresConfirmation: boolean }
  | { allowed: false; reason: string };

export function authorizeEnvelope(
  envelope: ActionEnvelope,
  grant: CapabilityGrant,
  now = new Date(),
): AuthorizationDecision {
  if (grant.id !== envelope.authorityGrantId) {
    return {
      allowed: false,
      reason: "The referenced Capability Grant does not match.",
    };
  }
  if (grant.principalId !== envelope.actorId) {
    return {
      allowed: false,
      reason: "The actor is not the Capability Grant principal.",
    };
  }
  if (grant.revokedAt) {
    return { allowed: false, reason: "The Capability Grant has been revoked." };
  }
  if (Date.parse(grant.expiresAt) <= now.getTime()) {
    return { allowed: false, reason: "The Capability Grant has expired." };
  }
  if (grant.policyVersion !== envelope.policyVersion) {
    return {
      allowed: false,
      reason: "The action was compiled against a stale policy version.",
    };
  }

  const required = REQUIRED_CAPABILITY[envelope.action];
  if (!grant.actions.includes(required)) {
    return {
      allowed: false,
      reason: `The Capability Grant does not allow ${required}.`,
    };
  }
  if (
    envelope.workstreamId &&
    grant.workstreamIds.length > 0 &&
    !grant.workstreamIds.includes(envelope.workstreamId)
  ) {
    return {
      allowed: false,
      reason: "The Workstream is outside the granted scope.",
    };
  }
  if (
    envelope.resourceScope.some(
      (resource) =>
        grant.resourceScopes.length > 0 &&
        !grant.resourceScopes.some(
          (allowed) =>
            resource === allowed || resource.startsWith(`${allowed}/`),
        ),
    )
  ) {
    return {
      allowed: false,
      reason: "A requested resource is outside the granted scope.",
    };
  }
  if (
    envelope.requestedActions.some((action) => !grant.actions.includes(action))
  ) {
    return {
      allowed: false,
      reason: "The envelope requests an action outside the grant.",
    };
  }

  return {
    allowed: true,
    requiresConfirmation: grant.requiresConfirmation.includes(required),
  };
}
