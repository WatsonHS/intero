import type { PrincipalId } from "@intero/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { MUTED_INDEFINITELY_UNTIL } from "@intero/domain";

import {
  addStandInToThread,
  archiveThread,
  concludeThread,
  createConversationThread,
  setThreadNotificationPreference,
  unarchiveThread,
  updateConversationThread,
} from "../../../api.js";
import type { PrincipalSummary, ThreadPayload } from "../../../api.js";
import { useNotifications } from "../../../design/notifications.js";
import { useI18n } from "../../../i18n/index.js";
import type { ThreadListCache } from "../constants.js";
import {
  removeThreadFromCache,
  restoreUnarchivedThreadInCache,
} from "../helpers.js";
import {
  addPilotStandIn,
  createPilotDm,
  updatePilotCoordinationRelevance,
} from "../../../pilot/api.js";
import { usePilotOptional } from "../../../pilot/context.js";
import {
  buildGroupChatThreadInput,
  findExistingDirectMessageThread,
} from "../helpers.js";

export function useThreadActions({
  conversationIdentity,
  selectedProjectId,
  currentIsPilot,
  current,
  allItems,
  principalNames,
  profilePrincipal,
  selectThread,
  pilot,
  onUnarchiveSuccess,
}: {
  conversationIdentity:
    | { currentPrincipalId: PrincipalId; standInPrincipalId: PrincipalId }
    | undefined;
  selectedProjectId?: string | undefined;
  currentIsPilot: boolean;
  current: ThreadPayload | undefined;
  allItems: ThreadPayload[];
  principalNames: Map<string, string>;
  profilePrincipal: PrincipalSummary | undefined;
  selectThread(threadId: string): void;
  pilot: ReturnType<typeof usePilotOptional>;
  onUnarchiveSuccess?: () => void;
}) {
  const { t } = useI18n();
  const notifications = useNotifications();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [profilePrincipalId, setProfilePrincipalId] = useState<
    PrincipalId | undefined
  >();
  const [concluding, setConcluding] = useState(false);
  const [conclusion, setConclusion] = useState("");

  useEffect(() => {
    setShowManage(false);
  }, [current?.thread.id]);

  const conclude = useMutation({
    mutationFn: (input: { threadId: string; conclusion: string }) =>
      conversationIdentity
        ? concludeThread({
            threadId: input.threadId,
            conclusion: input.conclusion,
          })
        : Promise.reject(new Error(t("chat.identityUnavailable"))),
    onSuccess: async ({ thread }) => {
      setConcluding(false);
      setConclusion("");
      if (thread.parentThreadId) selectThread(thread.parentThreadId);
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });
  const coordinationRelevance = useMutation({
    mutationFn: (input: {
      coordinationThreadId: string;
      action: "dismiss" | "mute" | "revisit";
    }) =>
      updatePilotCoordinationRelevance(
        pilot!.identityId!,
        input.coordinationThreadId,
        input.action,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["pilot", "overview"] }),
  });
  const create = useMutation({
    mutationFn: async (input: {
      title: string;
      memberIds: string[];
      teamId?: string;
    }) => {
      const identity = conversationIdentity;
      if (!identity) throw new Error(t("chat.identityUnavailable"));
      const teamId = input.teamId ?? (pilot?.teams.data?.teams ?? [])[0]?.id;
      const thread = await createConversationThread(
        buildGroupChatThreadInput({
          ...identity,
          title: input.title || t("chat.defaultRoomTitle"),
          memberIds: input.memberIds,
          ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
          ...(teamId ? { teamId } : {}),
        }),
      );
      return { threadId: thread.id };
    },
    onSuccess: async ({ threadId }) => {
      setShowCreate(false);
      selectThread(threadId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["threads"] }),
        queryClient.invalidateQueries({ queryKey: ["pilot", "dms"] }),
      ]);
    },
    onError: (error) => {
      notifications.error(
        error instanceof Error ? error.message : t("chat.createFailed"),
        { title: t("chat.createFailed") },
      );
    },
  });
  const updateGroupChat = useMutation({
    mutationFn: (input: {
      threadId: string;
      title?: string;
      visibility?: "private" | "team";
      addParticipantIds: string[];
      removeParticipantIds: string[];
    }) => updateConversationThread(input),
    onSuccess: async () => {
      setShowManage(false);
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
    onError: (error) => {
      notifications.error(
        error instanceof Error ? error.message : t("chat.manageFailed"),
        { title: t("chat.manageFailed") },
      );
    },
  });
  const addStandIn = useMutation({
    mutationFn: async (threadId: string) => {
      if (currentIsPilot) {
        await addPilotStandIn(pilot!.identityId!, threadId);
      } else {
        await addStandInToThread({ threadId });
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["threads"] }),
        queryClient.invalidateQueries({ queryKey: ["pilot", "dms"] }),
      ]);
    },
    onError: (error) => {
      notifications.error(
        error instanceof Error ? error.message : t("chat.sendFailed"),
        { title: t("chat.sendFailed") },
      );
    },
  });
  const createStandIn = useMutation({
    mutationFn: async () => {
      const identity = conversationIdentity;
      if (!identity) throw new Error(t("chat.identityUnavailable"));
      return createConversationThread({
        kind: "stand_in",
        title:
          principalNames.get(identity.standInPrincipalId) ??
          t("chat.group.standIn"),
        ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
        participantIds: [
          identity.currentPrincipalId,
          identity.standInPrincipalId,
        ],
        standInIds: [identity.standInPrincipalId],
      });
    },
    onSuccess: async (thread) => {
      selectThread(thread.id);
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
    onError: (error) => {
      notifications.error(
        error instanceof Error ? error.message : t("chat.createFailed"),
        { title: t("chat.createFailed") },
      );
    },
  });
  const startProfileDirectMessage = useMutation({
    mutationFn: async (peerId: PrincipalId) => {
      const identity = conversationIdentity;
      if (!identity || peerId === identity.currentPrincipalId) {
        throw new Error(t("person.dmUnavailable"));
      }
      const existing = findExistingDirectMessageThread(
        allItems,
        identity.currentPrincipalId,
        peerId,
      );
      if (existing) return existing.thread.id;

      const sharedTeam = (pilot?.teams.data?.teams ?? []).find(
        (team) =>
          team.members.some(
            (member) => member.id === identity.currentPrincipalId,
          ) && team.members.some((member) => member.id === peerId),
      );
      if (pilot?.identityId && sharedTeam) {
        const result = await createPilotDm(pilot.identityId, {
          teamId: sharedTeam.id,
          peerId,
        });
        return result.thread.id;
      }

      const thread = await createConversationThread({
        kind: "human_direct",
        title:
          principalNames.get(peerId) ??
          profilePrincipal?.displayName ??
          peerId.slice(0, 8),
        participantIds: [identity.currentPrincipalId, peerId],
        standInIds: [],
      });
      return thread.id;
    },
    onSuccess: async (threadId) => {
      setProfilePrincipalId(undefined);
      selectThread(threadId);
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
    onError: (error) => {
      notifications.error(
        error instanceof Error ? error.message : t("person.dmFailed"),
        { title: t("person.dmFailed") },
      );
    },
  });
  const mute = useMutation({
    mutationFn: (input: {
      hours?: number;
      indefinitely?: boolean;
      includingMentions?: boolean;
    }) => {
      if (!current) throw new Error(t("chat.identityUnavailable"));
      const mutedUntil = input.indefinitely
        ? MUTED_INDEFINITELY_UNTIL
        : new Date(
            Date.now() + (input.hours ?? 1) * 60 * 60 * 1000,
          ).toISOString();
      return setThreadNotificationPreference(current.thread.id, {
        mutedUntil,
        muteIncludingMentions: Boolean(input.includingMentions),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["threads"] }),
  });
  const unmute = useMutation({
    mutationFn: () => {
      if (!current) throw new Error(t("chat.identityUnavailable"));
      return setThreadNotificationPreference(current.thread.id, {
        mutedUntil: null,
        muteIncludingMentions: false,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["threads"] }),
  });
  const archive = useMutation({
    mutationFn: () => {
      if (!current) throw new Error(t("chat.identityUnavailable"));
      return archiveThread(current.thread.id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["threads"] }),
  });
  const unarchive = useMutation({
    mutationFn: () => {
      if (!current) throw new Error(t("chat.identityUnavailable"));
      return unarchiveThread(current.thread.id);
    },
    onSuccess: (result) => {
      if (current) {
        const restored = {
          ...current,
          thread: { ...current.thread, ...result.thread },
        };
        queryClient.setQueryData<ThreadListCache>(["threads"], (cached) =>
          restoreUnarchivedThreadInCache(cached, restored),
        );
        queryClient.setQueryData<ThreadListCache>(
          ["threads", "archived"],
          (cached) => removeThreadFromCache(cached, current.thread.id),
        );
      }
      onUnarchiveSuccess?.();
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  return {
    showCreate,
    setShowCreate,
    showManage,
    setShowManage,
    profilePrincipalId,
    setProfilePrincipalId,
    concluding,
    setConcluding,
    conclusion,
    setConclusion,
    conclude,
    coordinationRelevance,
    create,
    updateGroupChat,
    addStandIn,
    createStandIn,
    startProfileDirectMessage,
    mute,
    unmute,
    archive,
    unarchive,
  };
}
