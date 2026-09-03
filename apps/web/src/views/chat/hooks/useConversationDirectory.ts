import type { PrincipalId } from "@intero/domain";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  getBootstrap,
  getTeamPulse,
  getThreads,
  type PrincipalSummary,
} from "../../../api.js";
import {
  pilotDmToThreadPayload,
  pilotStandInToThreadPayload,
} from "../../../pilot/adapters.js";
import {
  getPilotDms,
  getPilotOverview,
  getPilotStandIn,
} from "../../../pilot/api.js";
import { usePilotOptional } from "../../../pilot/context.js";
import { DIRECTORY_REFRESH_INTERVAL_MS, RELEVANT_KINDS } from "../constants.js";
import {
  buildPrincipalNames,
  collectPrincipals,
  mergeCommunicationItems,
  ownStandInControlState,
  personalStandInPrincipalId,
  resolveConversationIdentity,
  resolveConversationProjectId,
  resolvePilotCommunicationPrincipal,
} from "../helpers.js";
import {
  conversationMentionCandidates,
  personalStandInMentionCandidates,
} from "../mentions.js";

export function useConversationDirectory({
  initialThreadId,
  initialStandInOwnerId,
  selectedProjectId,
  onOpenThread,
  onOpenStandIn,
  onThreadSelected,
}: {
  initialThreadId?: string | undefined;
  initialStandInOwnerId?: string | undefined;
  selectedProjectId?: string | undefined;
  onOpenThread?: ((threadId: string) => void) | undefined;
  onOpenStandIn?: ((ownerId: string) => void) | undefined;
  onThreadSelected?: ((threadId: string) => void) | undefined;
}) {
  const pilot = usePilotOptional();
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>(
    initialThreadId,
  );
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [selectedStandInOwnerId, setSelectedStandInOwnerId] = useState<
    PrincipalId | undefined
  >(initialStandInOwnerId as PrincipalId | undefined);

  const threads = useQuery({
    queryKey: ["threads"],
    queryFn: ({ signal }) => getThreads(undefined, signal),
    refetchOnWindowFocus: true,
  });
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });
  const pulse = useQuery({
    queryKey: ["team-pulse"],
    queryFn: ({ signal }) => getTeamPulse(signal),
    refetchInterval: DIRECTORY_REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
  const pilotDms = useQuery({
    queryKey: ["pilot", "dms", pilot?.identityId],
    queryFn: ({ signal }) => getPilotDms(pilot!.identityId!, signal),
    // Pilot DM routes now adapt onto canonical conversations. Reading them a
    // second time would create duplicate UI state.
    enabled: false,
    refetchOnWindowFocus: true,
  });
  const pilotProject = pilot?.projects.data?.projects.find(
    (project) => project.id === pilot.selectedProjectId,
  );
  const pilotPrincipal = resolvePilotCommunicationPrincipal(
    pilot?.identityId,
    pilot?.bootstrap.data,
  );
  const conversationIdentity = resolveConversationIdentity(
    bootstrap.data,
    pilot?.identityId,
  );
  const activeStandInOwnerId =
    selectedStandInOwnerId ?? (pilotPrincipal?.id as PrincipalId | undefined);
  const pilotStandIn = useQuery({
    queryKey: [
      "pilot",
      "stand_in",
      pilot?.identityId,
      pilot?.selectedProjectId,
      activeStandInOwnerId,
    ],
    queryFn: ({ signal }) =>
      getPilotStandIn(
        pilot!.identityId!,
        pilot!.selectedProjectId!,
        activeStandInOwnerId!,
        signal,
      ),
    enabled: Boolean(
      pilot?.enabled &&
      pilot.identityId &&
      pilot.selectedProjectId &&
      activeStandInOwnerId,
    ),
    refetchOnWindowFocus: true,
  });
  const pilotItems = (pilotDms.data?.items ?? []).map((item) =>
    pilotDmToThreadPayload(
      item,
      pilotDms.data?.principals ?? [],
      pilot?.identityId,
    ),
  );
  const activeStandInOwner =
    pilotStandIn.data?.standInOwner ??
    (pilotPrincipal?.id === activeStandInOwnerId
      ? pilotPrincipal
      : (pilot?.teams.data?.teams
          .flatMap((team) => team.members)
          .find((member) => member.id === activeStandInOwnerId) as
          PrincipalSummary | undefined));
  const activeStandInPrincipal =
    pilotStandIn.data?.standIn ??
    (activeStandInOwner
      ? {
          id: personalStandInPrincipalId(activeStandInOwner.id as PrincipalId),
          displayName: `${activeStandInOwner.displayName} 的替身`,
          kind: "stand_in" as const,
        }
      : undefined);
  const pilotStandInItem =
    pilotProject &&
    pilotPrincipal &&
    activeStandInOwner &&
    activeStandInPrincipal
      ? pilotStandInToThreadPayload(
          pilotProject,
          pilotStandIn.data?.exchanges ?? [],
          pilotPrincipal,
          activeStandInOwner,
          activeStandInPrincipal,
          pilotStandIn.data?.threadId,
        )
      : undefined;
  const allItems = mergeCommunicationItems(
    pilotStandInItem,
    threads.data?.items ?? [],
    pilotItems,
    Boolean(pilot?.enabled && pilotProject && pilotPrincipal),
  );
  const items = allItems.filter((item) => RELEVANT_KINDS.has(item.thread.kind));
  const query = search.trim().toLocaleLowerCase();
  const visibleItems = query
    ? items.filter(
        (item) =>
          item.thread.title.toLocaleLowerCase().includes(query) ||
          item.principals.some((principal) =>
            principal.displayName.toLocaleLowerCase().includes(query),
          ),
      )
    : items;
  const selectedItem = selectedThreadId
    ? items.find((item) => item.thread.id === selectedThreadId)
    : undefined;
  const selectedRecordMissing = Boolean(selectedThreadId && !selectedItem);
  const current = selectedRecordMissing
    ? undefined
    : (selectedItem ?? items[0]);
  const currentPilotItem = pilotDms.data?.items.find(
    (item) => item.thread.id === current?.thread.id,
  );
  const currentIsPilot = currentPilotItem !== undefined;
  const currentIsPilotStandIn =
    pilotStandInItem?.thread.id === current?.thread.id;
  const legacyStandInRecord = Boolean(
    current?.thread.kind === "stand_in" && !currentIsPilotStandIn,
  );
  const currentIsCanonicalGroup =
    !currentIsPilot &&
    !currentIsPilotStandIn &&
    (current?.thread.kind === "room" || current?.thread.kind === "human_group");
  const conversationProjectId = resolveConversationProjectId(
    current?.thread,
    selectedProjectId ?? pilot?.selectedProjectId,
  );
  const pilotOverview = useQuery({
    queryKey: ["pilot", "overview", pilot?.identityId, conversationProjectId],
    queryFn: ({ signal }) =>
      getPilotOverview(pilot!.identityId!, conversationProjectId!, signal),
    enabled: Boolean(
      pilot?.enabled && pilot.identityId && conversationProjectId,
    ),
    refetchOnWindowFocus: true,
  });
  const activeRelevanceContext =
    current?.thread.kind === "room"
      ? current.messages
          .toReversed()
          .flatMap((message) =>
            message.kind === "coordination_summary" &&
            message.coordinationSummary
              ? [message.coordinationSummary]
              : [],
          )
          .map((summary) => {
            const coordination = pilotOverview.data?.coordination.find(
              (thread) =>
                (thread.conversationThreadId ?? thread.id) ===
                summary.coordinationThreadId,
            );
            const relevance = coordination
              ? pilotOverview.data?.coordinationRelevance.find(
                  (item) =>
                    item.coordinationThreadId === coordination.id &&
                    item.sourceRoomThreadId === current.thread.id &&
                    !item.dismissedAt &&
                    !item.mutedAt,
                )
              : undefined;
            return coordination && relevance
              ? { coordination, relevance }
              : undefined;
          })
          .find((context) => context !== undefined)
      : undefined;
  const currentCoordination = activeRelevanceContext?.coordination;
  const activeRelevance = activeRelevanceContext?.relevance;
  const ownStandInState =
    currentIsCanonicalGroup && current
      ? ownStandInControlState(
          current.thread,
          conversationIdentity?.standInPrincipalId,
        )
      : undefined;
  const principals = collectPrincipals(allItems, pulse.data?.principals ?? [], [
    bootstrap.data?.currentPrincipal,
    bootstrap.data?.standInPrincipal,
    pilotStandIn.data?.standInOwner,
    pilotStandIn.data?.standIn,
    ...(pilotDms.data?.principals ?? []),
  ]);
  const principalNames = buildPrincipalNames(principals);
  for (const principal of principals) {
    if (principal.kind === "service" && principal.displayName === "Intero") {
      principalNames.set(principal.id, "Intero");
    }
  }
  const principalKinds = new Map(
    principals.map((principal) => [principal.id, principal.kind]),
  );
  const pilotTeamMembers =
    pilot?.teams.data?.teams.flatMap((team) => team.members) ?? [];
  const standInOwnerIds = new Map<PrincipalId, PrincipalId>();
  for (const principal of principals.filter(
    (candidate) => candidate.kind === "human",
  )) {
    const ownerId = principal.id as PrincipalId;
    standInOwnerIds.set(personalStandInPrincipalId(ownerId), ownerId);
  }
  for (const member of pilotTeamMembers.filter(
    (candidate) => candidate.kind === "human",
  )) {
    const standInId = personalStandInPrincipalId(member.id);
    standInOwnerIds.set(standInId, member.id);
    principalNames.set(standInId, `${member.displayName} 的替身`);
  }
  if (pilotPrincipal?.kind === "human") {
    const standInId = personalStandInPrincipalId(
      pilotPrincipal.id as PrincipalId,
    );
    standInOwnerIds.set(standInId, pilotPrincipal.id as PrincipalId);
    principalNames.set(standInId, `${pilotPrincipal.displayName} 的替身`);
  }
  const teamNames = new Map(
    (pilot?.teams.data?.teams ?? []).map((team) => [team.id, team.name]),
  );
  // Branch rows name their origin, so every thread title is looked up by id.
  const threadTitles = new Map(
    allItems.map((item) => [item.thread.id, item.thread.title]),
  );
  // Everyone you could put in a conversation, tagged with the team they came
  // from so the picker can narrow by team.
  const conversationCandidates = [
    ...new Map(
      (pilot?.teams.data?.teams ?? []).flatMap((team) =>
        team.members
          .filter(
            (member) =>
              member.kind === "human" && member.id !== pilot?.identityId,
          )
          .map(
            (member) =>
              [
                member.id,
                {
                  id: member.id,
                  displayName: member.displayName,
                  teamId: team.id,
                  teamName: team.name,
                },
              ] as const,
          ),
      ),
    ).values(),
  ];
  const standInMentionCandidates = personalStandInMentionCandidates({
    project: pilotProject,
    teams: pilot?.teams.data?.teams ?? [],
    currentPrincipalId: pilot?.identityId,
  });
  const mentionCandidates = current
    ? conversationMentionCandidates({
        participantIds: current.thread.participantIds,
        standInIds: current.thread.standInIds,
        principalNames,
        principalKinds,
        standInOwnerIds,
        additionalStandIns: currentIsPilotStandIn
          ? standInMentionCandidates
          : [],
      })
    : [];
  const currentSenderId = !current
    ? undefined
    : currentIsPilot || currentIsPilotStandIn
      ? pilot?.identityId
      : current.thread.participantIds.some(
            (id) => id === conversationIdentity?.currentPrincipalId,
          )
        ? conversationIdentity?.currentPrincipalId
        : current.thread.participantIds.find(
            (id) => !current.thread.standInIds.includes(id),
          );
  const canAttachImages = Boolean(
    current &&
    currentSenderId &&
    !currentIsPilot &&
    !currentIsPilotStandIn &&
    current.thread.accessMode === "agent_readable",
  );

  function selectThread(threadId: string) {
    onThreadSelected?.(threadId);
    setSelectedStandInOwnerId(undefined);
    setSelectedThreadId(threadId);
    onOpenThread?.(threadId);
  }

  function selectStandIn(ownerId: PrincipalId) {
    setSelectedStandInOwnerId(ownerId);
    if (pilotProject) setSelectedThreadId(pilotProject.id);
    onOpenStandIn?.(ownerId);
  }

  useEffect(() => {
    setSelectedStandInOwnerId(initialStandInOwnerId as PrincipalId | undefined);
    if (initialStandInOwnerId && pilotProject) {
      setSelectedThreadId(pilotProject.id);
    }
  }, [
    initialStandInOwnerId,
    pilot?.identityId,
    pilot?.selectedProjectId,
    pilotProject?.id,
  ]);

  useEffect(() => {
    if (initialThreadId) setSelectedThreadId(initialThreadId);
  }, [initialThreadId]);

  return {
    pilot,
    threads,
    bootstrap,
    search,
    setSearch,
    showSearch,
    setShowSearch,
    selectedThreadId,
    items,
    visibleItems,
    current,
    selectedRecordMissing,
    allItems,
    principals,
    principalNames,
    standInOwnerIds,
    teamNames,
    threadTitles,
    conversationCandidates,
    mentionCandidates,
    conversationIdentity,
    pilotStandIn,
    pilotStandInItem,
    activeStandInOwnerId,
    currentIsPilot,
    currentIsPilotStandIn,
    currentIsCanonicalGroup,
    legacyStandInRecord,
    currentPilotItem,
    currentSenderId,
    canAttachImages,
    conversationProjectId,
    ownStandInState,
    currentCoordination,
    activeRelevance,
    selectThread,
    selectStandIn,
  };
}
