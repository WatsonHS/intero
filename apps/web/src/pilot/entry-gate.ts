export type PilotEntryGate = "application" | "admin_bootstrap" | "no_team";

export function resolvePilotEntryGate(input: {
  pilotEnabled: boolean;
  bootstrapActive: boolean;
  bootstrapLoaded: boolean;
  organizationConfigured: boolean;
  teamsLoaded: boolean;
  teamCount: number;
  canGovern: boolean;
}): PilotEntryGate {
  if (
    input.pilotEnabled &&
    (input.bootstrapActive ||
      (input.bootstrapLoaded && !input.organizationConfigured))
  ) {
    return "admin_bootstrap";
  }
  if (
    input.pilotEnabled &&
    input.teamsLoaded &&
    input.teamCount === 0 &&
    !input.canGovern
  ) {
    return "no_team";
  }
  return "application";
}
