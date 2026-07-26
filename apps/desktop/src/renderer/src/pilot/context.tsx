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
} from "./api.js";

interface PilotContextValue {
  enabled: boolean;
  bootstrap: UseQueryResult<Awaited<ReturnType<typeof getPilotBootstrap>>>;
  identityId: PrincipalId | undefined;
  setIdentityId: (identityId: PrincipalId | undefined) => void;
  teams: UseQueryResult<Awaited<ReturnType<typeof getPilotTeams>>>;
  projects: UseQueryResult<Awaited<ReturnType<typeof getPilotProjects>>>;
  selectedProjectId: string | undefined;
  setSelectedProjectId: (projectId: string | undefined) => void;
  refresh: () => Promise<void>;
}

const PilotContext = createContext<PilotContextValue | undefined>(undefined);

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
      | PrincipalId
      | undefined;
    setIdentityState(principalId);
    if (!principalId) setProjectState(undefined);
  }, [bootstrap.data?.authMode, bootstrap.data?.currentPrincipal?.id]);

  useEffect(() => {
    if (!identityId) return;
    const available = projects.data?.projects ?? [];
    if (
      available.length > 0 &&
      !available.some((project) => project.id === selectedProjectId)
    ) {
      setProjectState(available[0]!.id);
    }
  }, [identityId, projects.data, selectedProjectId]);

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

  const value = useMemo<PilotContextValue>(
    () => ({
      enabled,
      bootstrap,
      identityId,
      setIdentityId,
      teams,
      projects,
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
