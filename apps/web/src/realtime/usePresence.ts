import type { PresenceState, PrincipalId } from "@intero/domain";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { getPresence } from "../api.js";

// Peers heartbeat every 30 s; polling faster than that keeps a freshly
// opened page from showing a teammate offline for a full refresh cycle.
const PRESENCE_REFRESH_MS = 10_000;
/** GET /v1/presence accepts at most this many principal ids per request. */
export const PRESENCE_REQUEST_LIMIT = 50;

export function chunkPresenceIds(
  principalIds: readonly string[],
  limit = PRESENCE_REQUEST_LIMIT,
): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < principalIds.length; index += limit) {
    chunks.push(principalIds.slice(index, index + limit));
  }
  return chunks;
}

export function usePresence(
  principalIds: readonly string[],
): Map<string, PresenceState> {
  const uniqueIds = [
    ...new Set(principalIds.filter((principalId) => principalId.length > 0)),
  ].toSorted();
  const query = useQuery({
    queryKey: ["presence", uniqueIds],
    queryFn: async ({ signal }) => {
      const pages = await Promise.all(
        chunkPresenceIds(uniqueIds).map((chunk) => getPresence(chunk, signal)),
      );
      return { items: pages.flatMap((page) => page.items) };
    },
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
