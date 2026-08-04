import type { ProjectSpecPayload } from "../../api.js";
import type {
  PilotOverviewPayload,
  PilotTeamPayload,
} from "../../pilot/api.js";
import { agentBindingIsConnected } from "../agent/connection-state.js";

export interface FirstUseProgress {
  invitedMember: boolean;
  connectedAgent: boolean;
  receivedCheckpoint: boolean;
  teamPulseVisible: boolean;
  completedSpecReview: boolean;
  completed: number;
  total: 5;
}

/**
 * The checklist is a projection of durable product state. Keeping this pure
 * makes it impossible for a local checkbox to claim that a product loop has
 * completed when the server has no matching member, Agent, checkpoint, or
 * Spec review.
 */
export function deriveFirstUseProgress(input: {
  teams: PilotTeamPayload[];
  overviews: PilotOverviewPayload[];
  specs: ProjectSpecPayload[];
}): FirstUseProgress {
  const invitedMember = input.teams.some((team) => team.members.length > 1);
  const activeBindings = input.overviews.flatMap((overview) =>
    overview.bindings.filter((binding) => !binding.disconnectedAt),
  );
  const connectedAgent = activeBindings.some(agentBindingIsConnected);
  const receivedCheckpoint = input.overviews.some(
    (overview) =>
      overview.privateWorkState.length > 0 || overview.pulse.length > 0,
  );
  const teamPulseVisible = input.overviews.some(
    (overview) => overview.pulse.length > 0,
  );
  const completedSpecReview = input.specs.some(
    (item) =>
      item.spec.status === "approved" ||
      item.spec.status === "changes_requested" ||
      item.confirmations.length > 0,
  );
  const states = [
    invitedMember,
    connectedAgent,
    receivedCheckpoint,
    teamPulseVisible,
    completedSpecReview,
  ];
  return {
    invitedMember,
    connectedAgent,
    receivedCheckpoint,
    teamPulseVisible,
    completedSpecReview,
    completed: states.filter(Boolean).length,
    total: 5,
  };
}
