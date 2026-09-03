import type { PresenceState, PrincipalId } from "@intero/domain";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { getPresence } from "../api.js";

const PRESENCE_REFRESH_MS = 30_000;

export function usePresence(
  principalIds: readonly string[],
): Map<string, PresenceState> {
  const uniqueIds = [
    ...new Set(principalIds.filter((principalId) => principalId.length > 0)),
  ].toSorted();
  const query = useQuery({
    queryKey: ["presence", uniqueIds],
    queryFn: ({ signal }) => getPresence(uniqueIds, signal),
    enabled: uniqueIds.length > 0,
    refetchInterval: PRESENCE_REFRESH_MS,
    staleTime: PRESENCE_REFRESH_MS,
  });
  return useMemo(() => {
    const states = new Map<string, PresenceState>();
    for (const item of query.data?.items ?? []) {
      states.set(item.principalId, item.state);
    }
    return states;
  }, [query.data]);
}

export function presenceOf(
  states: Map<string, PresenceState>,
  principalId: string | PrincipalId | undefined,
): PresenceState {
  if (!principalId) return "offline";
  return states.get(principalId) ?? "offline";
}
