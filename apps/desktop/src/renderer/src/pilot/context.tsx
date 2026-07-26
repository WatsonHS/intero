import type { PrincipalId } from "@intero/domain";
import {
  type UseQueryResult,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  getPilotBootstrap,
  getPilotProjects,
  getPilotTeams,
  isPilotBrowser,
  PILOT_IDENTITY_STORAGE_KEY,
  PILOT_PROJECT_STORAGE_KEY,
  PILOT_TEAM_STORAGE_KEY,
} from "./api.js";

interface PilotContextValue {
  enabled: boolean;
  bootstrap: UseQueryResult<Awaited<ReturnType<typeof getPilotBootstrap>>>;
  identityId: PrincipalId | undefined;
  setIdentityId: (identityId: PrincipalId | undefined) => void;
  teams: UseQueryResult<Awaited<ReturnType<typeof getPilotTeams>>>;
  projects: UseQueryResult<Awaited<ReturnType<typeof getPilotProjects>>>;
  /** The team the shell is scoped to. Narrows which projects are reachable. */
  selectedTeamId: string | undefined;
  setSelectedTeamId: (teamId: string | undefined) => void;
  selectedProjectId: string | undefined;
  setSelectedProjectId: (projectId: string | undefined) => void;
  refresh: () => Promise<void>;
}

const PilotContext = createContext<PilotContextValue | undefined>(undefined);

/**
 * A project is reachable from a team when the team owns it or takes part in
 * it — participating teams see the same project surfaces as the owning one.
 */
export function projectInTeam(
  project: { primaryTeamId: string; participatingTeamIds: string[] },
  teamId: string,
): boolean {
  return (
    project.primaryTeamId === teamId ||
    project.participatingTeamIds.includes(teamId)
  );
}

export function PilotProvider({ children }: { children: ReactNode }) {
  const enabled = isPilotBrowser();
  const queryClient = useQueryClient();
  const [identityId, setIdentityState] = useState<PrincipalId | undefined>(
    () =>
      enabled
        ? ((window.localStorage.getItem(PILOT_IDENTITY_STORAGE_KEY) ??
            undefined) as PrincipalId | undefined)
        : undefined,
  );
  const [selectedProjectId, setProjectState] = useState<string | undefined>(
    () =>
      enabled
        ? (window.localStorage.getItem(PILOT_PROJECT_STORAGE_KEY) ?? undefined)
        : undefined,
  );
  const [selectedTeamId, setTeamState] = useState<string | undefined>(() =>
    enabled
      ? (window.localStorage.getItem(PILOT_TEAM_STORAGE_KEY) ?? undefined)
      : undefined,
  );

  const bootstrap = useQuery({
    queryKey: ["pilot", "bootstrap"],
    queryFn: ({ signal }) => getPilotBootstrap(signal),
    enabled,
    refetchInterval: 5_000,
  });
  const teams = useQuery({
    queryKey: ["pilot", "teams", identityId],
    queryFn: ({ signal }) => getPilotTeams(identityId!, signal),
    enabled: enabled && Boolean(identityId),
    refetchInterval: 2_000,
  });
  const projects = useQuery({
    queryKey: ["pilot", "projects", identityId],
    queryFn: ({ signal }) => getPilotProjects(identityId!, signal),
    enabled: enabled && Boolean(identityId),
    refetchInterval: 2_000,
  });

  useEffect(() => {
    if (bootstrap.data?.authMode !== "session") return;
    const principalId = bootstrap.data.currentPrincipal?.id as
      PrincipalId | undefined;
    setIdentityState(principalId);
    if (!principalId) setProjectState(undefined);
  }, [bootstrap.data?.authMode, bootstrap.data?.currentPrincipal?.id]);

  useEffect(() => {
    if (!identityId) return;
    const available = projects.data?.projects ?? [];
    const teamList = teams.data?.teams ?? [];
    // The team scope leads: it decides which projects are reachable. Resolve it
    // first, falling back to the current project's team so a stored project
    // never lands the shell on a team that cannot reach it.
    const team =
      teamList.find((candidate) => candidate.id === selectedTeamId) ??
      teamList.find(
        (candidate) =>
          candidate.id ===
          available.find((project) => project.id === selectedProjectId)
            ?.primaryTeamId,
      ) ??
      teamList[0];
    if (team && team.id !== selectedTeamId) setTeamState(team.id);
    const reachable = team
      ? available.filter((project) => projectInTeam(project, team.id))
      : available;
    if (
      reachable.length > 0 &&
      !reachable.some((project) => project.id === selectedProjectId)
    ) {
      setProjectState(reachable[0]!.id);
    }
  }, [
    identityId,
    projects.data,
    selectedProjectId,
    selectedTeamId,
    teams.data,
  ]);

  function setIdentityId(next: PrincipalId | undefined) {
    if (bootstrap.data?.authMode === "session") return;
    setIdentityState(next);
    setProjectState(undefined);
    if (next) window.localStorage.setItem(PILOT_IDENTITY_STORAGE_KEY, next);
    else window.localStorage.removeItem(PILOT_IDENTITY_STORAGE_KEY);
    window.localStorage.removeItem(PILOT_PROJECT_STORAGE_KEY);
    void queryClient.invalidateQueries({ queryKey: ["pilot"] });
  }

  function setSelectedProjectId(next: string | undefined) {
    setProjectState(next);
    if (next) window.localStorage.setItem(PILOT_PROJECT_STORAGE_KEY, next);
    else window.localStorage.removeItem(PILOT_PROJECT_STORAGE_KEY);
  }

  function setSelectedTeamId(next: string | undefined) {
    setTeamState(next);
    if (next) window.localStorage.setItem(PILOT_TEAM_STORAGE_KEY, next);
    else window.localStorage.removeItem(PILOT_TEAM_STORAGE_KEY);
    // Switching teams invalidates the project scope; the reconciling effect
    // picks the first reachable project on the next render.
    const reachable = (projects.data?.projects ?? []).filter(
      (project) => !next || projectInTeam(project, next),
    );
    if (!reachable.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(reachable[0]?.id);
    }
  }

  const value = useMemo<PilotContextValue>(
    () => ({
      enabled,
      bootstrap,
      identityId,
      setIdentityId,
      teams,
      projects,
      selectedTeamId,
      setSelectedTeamId,
      selectedProjectId,
      setSelectedProjectId,
      refresh: async () => {
        await queryClient.invalidateQueries({ queryKey: ["pilot"] });
      },
    }),
    [
      bootstrap,
      enabled,
      identityId,
      projects,
      queryClient,
      selectedProjectId,
      selectedTeamId,
      teams,
    ],
  );

  return (
    <PilotContext.Provider value={value}>{children}</PilotContext.Provider>
  );
}

export function usePilot(): PilotContextValue {
  const value = useContext(PilotContext);
  if (!value) throw new Error("PilotProvider is missing.");
  return value;
}

export function usePilotOptional(): PilotContextValue | undefined {
  return useContext(PilotContext);
}

export interface Governance {
  /** Can change organization-wide policy, seats and roles. */
  isOrgAdmin: boolean;
  /** Leads the team currently in scope. */
  isTeamLead: boolean;
  /** Leads any team at all — enough to reach the governance surface. */
  isAnyTeamLead: boolean;
  canGovern: boolean;
  /** True until memberships have loaded; callers should not deny yet. */
  pending: boolean;
}

/**
 * Who you are allowed to govern, resolved from team memberships rather than the
 * bootstrap payload — `organizationRole` is only present there in session auth,
 * but every membership row carries it in both auth modes.
 */
export function useGovernance(): Governance {
  const pilot = usePilotOptional();
  const teams = pilot?.teams.data?.teams ?? [];
  const identityId = pilot?.identityId;
  const memberships = teams.flatMap((team) =>
    team.members
      .filter((member) => member.id === identityId)
      .map((member) => ({ teamId: team.id, ...member })),
  );
  const isOrgAdmin =
    pilot?.bootstrap.data?.organizationRole === "admin" ||
    memberships.some((member) => member.organizationRole === "admin");
  const isAnyTeamLead = memberships.some(
    (member) => member.teamRole === "leader",
  );
  const isTeamLead = memberships.some(
    (member) =>
      member.teamId === pilot?.selectedTeamId && member.teamRole === "leader",
  );
  return {
    isOrgAdmin,
    isTeamLead,
    isAnyTeamLead,
    canGovern: isOrgAdmin || isAnyTeamLead,
    pending: Boolean(pilot?.enabled) && pilot!.teams.isPending,
  };
}
