import {
  ArrowBendDownRightIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  EyeIcon,
  GearSixIcon,
  GitBranchIcon,
  HandTapIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
  PaperclipIcon,
  PencilSimpleIcon,
  PlusIcon,
  RobotIcon,
  UserPlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import type {
  ConversationThread,
  PilotProject,
  PilotStandInAnswerDetail,
  PrincipalId,
  ThreadMessage,
  ThreadMessageAttachment,
} from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  addStandInToThread,
  concludeThread,
  completeAttachmentUpload,
  createAttachmentUpload,
  createConversationThread,
  getBootstrap,
  getAttachmentDownload,
  getThreadMessages,
  markThreadRead,
  getTeamPulse,
  getThreads,
  sendThreadMessage,
  updateConversationThread,
  type BootstrapPayload,
  type PrincipalSummary,
  type ThreadPayload,
} from "../api.js";
import { createClientUuid } from "../client-id.js";
import { ChatMarkdown } from "../components/ChatMarkdown.js";
import { useNotifications } from "../design/notifications.js";
import { Avatar, cn } from "../design/primitives.js";
import { initials, tintFor } from "../design/utils.js";
import { useI18n } from "../i18n/index.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";
import {
  pilotDmToThreadPayload,
  pilotStandInToThreadPayload,
} from "../pilot/adapters.js";
import {
  addPilotStandIn,
  answerPilotStandInInConversation,
  askPilotStandIn,
  getPilotDms,
  getPilotStandIn,
  sendPilotDm,
  type PilotTeamPayload,
} from "../pilot/api.js";
import { usePilotOptional } from "../pilot/context.js";
import { useConversationRealtime } from "../realtime/context.js";
import { NewConversationModal } from "./chat/NewConversationModal.js";
import { GroupChatManagementModal } from "./chat/GroupChatManagementModal.js";

const THREAD_GROUPS: Array<{
  kind: ConversationThread["kind"];
  label: TranslationKey;
}> = [
  { kind: "stand_in", label: "chat.group.standIn" },
  { kind: "human_group", label: "chat.group.temp" },
  { kind: "room", label: "chat.group.rooms" },
  { kind: "human_direct", label: "chat.group.direct" },
];
const RELEVANT_KINDS = new Set(THREAD_GROUPS.map((group) => group.kind));
const DIRECTORY_REFRESH_INTERVAL_MS = 60_000;
const MAX_MESSAGE_IMAGES = 8;
const MAX_MESSAGE_IMAGE_BYTES = 25 * 1024 * 1024;
const MESSAGE_IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

interface ComposerImage {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  previewUrl: string;
  status: "uploading" | "available" | "failed";
}

export function buildGroupChatThreadInput(input: {
  currentPrincipalId: PrincipalId;
  standInPrincipalId: PrincipalId;
  title: string;
  memberIds: string[];
  teamId?: string;
}) {
  return {
    kind: "room" as const,
    ...(input.teamId ? { teamId: input.teamId } : {}),
    title: input.title,
    participantIds: [
      input.currentPrincipalId,
      input.standInPrincipalId,
      ...input.memberIds.filter((id) => id !== input.currentPrincipalId),
    ],
    standInIds: [input.standInPrincipalId],
  };
}

export function CommunicationsView({
  initialThreadId,
  initialStandInOwnerId,
  onOpenThread,
  onOpenStandIn,
}: {
  initialThreadId?: string;
  initialStandInOwnerId?: string;
  onOpenThread?: (threadId: string) => void;
  onOpenStandIn?: (ownerId: string) => void;
} = {}) {
  const { formatRelative, formatTime, t } = useI18n();
  const notifications = useNotifications();
  const queryClient = useQueryClient();
  const pilot = usePilotOptional();
  const realtime = useConversationRealtime();
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>(
    initialThreadId,
  );
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Set<string>());
  const [markdownPreview, setMarkdownPreview] = useState(false);
  const [composerImages, setComposerImages] = useState<ComposerImage[]>([]);
  const reservedImageSlotsRef = useRef(0);
  const composerThreadIdRef = useRef<string | undefined>(initialThreadId);
  const retryableSendRef = useRef<
    { key: string; clientMessageId: string } | undefined
  >(undefined);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [mentionCursor, setMentionCursor] = useState(0);
  const [selectedStandInOwnerId, setSelectedStandInOwnerId] = useState<
    PrincipalId | undefined
  >(initialStandInOwnerId as PrincipalId | undefined);
  const [concluding, setConcluding] = useState(false);
  const [conclusion, setConclusion] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [historyExhausted, setHistoryExhausted] = useState<Set<string>>(
    () => new Set(),
  );

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
  const current =
    items.find((item) => item.thread.id === selectedThreadId) ?? items[0];
  const currentPilotItem = pilotDms.data?.items.find(
    (item) => item.thread.id === current?.thread.id,
  );
  const currentIsPilot = currentPilotItem !== undefined;
  const currentIsPilotStandIn =
    pilotStandInItem?.thread.id === current?.thread.id;
  const principals = collectPrincipals(allItems, pulse.data?.principals ?? [], [
    bootstrap.data?.currentPrincipal,
    bootstrap.data?.standInPrincipal,
    pilotStandIn.data?.standInOwner,
    pilotStandIn.data?.standIn,
    ...(pilotDms.data?.principals ?? []),
  ]);
  const principalNames = buildPrincipalNames(principals);
  const pilotTeamMembers =
    pilot?.teams.data?.teams.flatMap((team) => team.members) ?? [];
  const standInOwnerIds = new Map<PrincipalId, PrincipalId>();
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
        standInOwnerIds,
        additionalStandIns: currentIsPilotStandIn
          ? standInMentionCandidates
          : !currentIsPilot &&
              (current.thread.kind === "room" ||
                current.thread.kind === "human_group")
            ? standInMentionCandidates.filter((candidate) =>
                current.thread.participantIds.includes(candidate.principalId),
              )
            : [],
      })
    : [];
  const activeMention = conversationMentionQuery(draft, mentionCursor);
  const visibleMentionCandidates = mentionPickerOpen
    ? filterConversationMentionCandidates(
        mentionCandidates,
        activeMention?.query ?? "",
      )
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
    setSelectedStandInOwnerId(undefined);
    setSelectedThreadId(threadId);
    onOpenThread?.(threadId);
  }

  function selectStandIn(ownerId: PrincipalId) {
    setSelectedStandInOwnerId(ownerId);
    if (pilotProject) setSelectedThreadId(pilotProject.id);
    onOpenStandIn?.(ownerId);
  }

  const markRead = useMutation({
    mutationFn: (input: { threadId: string; sequence: number }) =>
      conversationIdentity
        ? markThreadRead({
            threadId: input.threadId,
            sequence: input.sequence,
          })
        : Promise.reject(new Error(t("chat.identityUnavailable"))),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["threads"] }),
  });
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
  const loadOlder = useMutation({
    mutationFn: (input: { threadId: string; beforeSequence: number }) =>
      getThreadMessages(input.threadId, {
        beforeSequence: input.beforeSequence,
        limit: 100,
      }),
    onSuccess: (page, input) => {
      if (!page.hasMore) {
        setHistoryExhausted((current) => {
          const next = new Set(current);
          next.add(input.threadId);
          return next;
        });
      }
      queryClient.setQueryData<{ items: ThreadPayload[] }>(
        ["threads"],
        (cached) => {
          if (!cached) return cached;
          return {
            ...cached,
            items: cached.items.map((item) => {
              if (item.thread.id !== input.threadId) return item;
              const messages = new Map(
                [...page.items, ...item.messages].map((message) => [
                  message.sequence,
                  message,
                ]),
              );
              return {
                ...item,
                historyExpanded: true,
                messages: [...messages.values()].sort(
                  (left, right) => left.sequence - right.sequence,
                ),
              };
            }),
          };
        },
      );
    },
  });

  // Opening a thread is what marks it read; nothing else moves the marker.
  const currentUnread = current?.unreadCount ?? 0;
  const currentLastSequence = current?.messages.at(-1)?.sequence ?? 0;
  const currentLastRevision = current?.messages.at(-1)?.revision ?? 1;
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

  useEffect(() => {
    setMentionPickerOpen(false);
    setShowManage(false);
  }, [current?.thread.id]);

  useEffect(() => {
    if (
      composerThreadIdRef.current &&
      composerThreadIdRef.current !== current?.thread.id
    ) {
      setComposerImages((images) => {
        for (const image of images) {
          URL.revokeObjectURL(image.previewUrl);
          previewUrlsRef.current.delete(image.previewUrl);
        }
        return [];
      });
      reservedImageSlotsRef.current = 0;
      setMarkdownPreview(false);
    }
    composerThreadIdRef.current = current?.thread.id;
  }, [current?.thread.id]);

  useEffect(
    () => () => {
      for (const previewUrl of previewUrlsRef.current) {
        URL.revokeObjectURL(previewUrl);
      }
      previewUrlsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (
      realtime.status !== "live" ||
      !current ||
      currentIsPilot ||
      currentIsPilotStandIn
    ) {
      return;
    }
    let disposed = false;
    let release: (() => void) | undefined;
    void realtime
      .watchThread(current.thread.id)
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else release = unsubscribe;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      release?.();
    };
  }, [
    current?.thread.id,
    currentIsPilot,
    currentIsPilotStandIn,
    realtime.status,
    realtime.watchThread,
  ]);

  useEffect(() => {
    if (
      !current ||
      currentIsPilot ||
      currentIsPilotStandIn ||
      currentUnread === 0 ||
      !conversationIdentity?.currentPrincipalId ||
      markRead.isPending
    ) {
      return;
    }
    markRead.mutate({
      threadId: current.thread.id,
      sequence: currentLastSequence,
    });
  }, [current?.thread.id, currentUnread, currentLastSequence]);

  const standInReplies = useMutation({
    mutationFn: (input: {
      threadId: string;
      senderId: string;
      body: string;
      projectId?: string;
      mentionedStandIns: MentionedStandIn[];
    }) =>
      requestConversationStandInReplies(input, {
        sendMessage: sendThreadMessage,
        answerStandIn: answerPilotStandInInConversation,
      }),
    onError: (error) => {
      notifications.error(
        error instanceof Error ? error.message : t("chat.standInReplyFailed"),
        { title: t("chat.standInReplyFailed") },
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  useEffect(() => {
    const node = messagesEndRef.current;
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({
        block: "end",
        behavior: currentLastRevision > 1 ? "auto" : "smooth",
      });
    }
  }, [current?.thread.id, currentLastRevision, currentLastSequence]);

  const send = useMutation({
    mutationFn: async (input: {
      threadId: string;
      senderId: string;
      body: string;
      mode: "canonical" | "pilot-dm" | "pilot-stand-in";
      standInOwnerId?: PrincipalId;
      mentionedStandIns?: MentionedStandIn[];
      clientMessageId: string;
      mentionedPrincipalIds: string[];
      attachmentIds: string[];
    }) => {
      if (input.mode === "pilot-dm") {
        await sendPilotDm(
          input.senderId as PrincipalId,
          input.threadId,
          input.body,
          input.clientMessageId,
        );
        return input;
      }
      if (input.mode === "pilot-stand-in") {
        if (!input.standInOwnerId) {
          throw new Error("Choose a personal Stand-in.");
        }
        await askPilotStandIn(
          input.senderId as PrincipalId,
          pilot!.selectedProjectId!,
          input.standInOwnerId,
          input.body,
          input.clientMessageId,
        );
        return input;
      }
      await sendCanonicalConversationMessage(input, {
        addStandIn: addStandInToThread,
        sendMessage: sendThreadMessage,
      });
      return input;
    },
    onSuccess: async (input) => {
      retryableSendRef.current = undefined;
      setDraft("");
      setMarkdownPreview(false);
      setComposerImages((images) => {
        for (const image of images) {
          URL.revokeObjectURL(image.previewUrl);
          previewUrlsRef.current.delete(image.previewUrl);
        }
        return [];
      });
      reservedImageSlotsRef.current = 0;
      if (
        input.mode === "canonical" &&
        (input.mentionedStandIns?.length ?? 0) > 0
      ) {
        standInReplies.mutate({
          threadId: input.threadId,
          senderId: input.senderId,
          body: input.body,
          ...(pilot?.selectedProjectId
            ? { projectId: pilot.selectedProjectId }
            : {}),
          mentionedStandIns: input.mentionedStandIns ?? [],
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["threads"] }),
        queryClient.invalidateQueries({ queryKey: ["pilot", "dms"] }),
        queryClient.invalidateQueries({
          queryKey: ["pilot", "stand_in"],
        }),
      ]);
    },
    onError: (error) => {
      notifications.error(
        error instanceof Error ? error.message : t("chat.sendFailed"),
        { title: t("chat.sendFailed") },
      );
    },
  });
  const create = useMutation({
    mutationFn: async (input: {
      title: string;
      memberIds: string[];
      teamId?: string;
    }) => {
      const identity = conversationIdentity;
      if (!identity) throw new Error(t("chat.identityUnavailable"));
      const thread = await createConversationThread(
        buildGroupChatThreadInput({
          ...identity,
          title: input.title || t("chat.defaultRoomTitle"),
          memberIds: input.memberIds,
          ...(input.teamId ? { teamId: input.teamId } : {}),
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
      addParticipantIds: string[];
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
        await addStandInToThread({
          threadId,
          standInId: conversationIdentity!.standInPrincipalId,
          actorId: conversationIdentity!.currentPrincipalId,
        });
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
        title: t("chat.group.standIn"),
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
  });

  async function addComposerImages(files: File[]) {
    if (!canAttachImages || !current || !currentSenderId) return;
    for (const file of files) {
      if (reservedImageSlotsRef.current >= MAX_MESSAGE_IMAGES) break;
      if (!MESSAGE_IMAGE_TYPES.has(file.type)) {
        notifications.warning(t("chat.imageTypeUnsupported"));
        continue;
      }
      if (file.size > MAX_MESSAGE_IMAGE_BYTES) {
        notifications.warning(t("chat.imageTooLarge"));
        continue;
      }
      reservedImageSlotsRef.current += 1;
      const id = createClientUuid();
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      const image: ComposerImage = {
        id,
        fileName: file.name || "image",
        contentType: file.type,
        byteSize: file.size,
        previewUrl,
        status: "uploading",
      };
      setComposerImages((currentImages) => [...currentImages, image]);
      try {
        const checksumSha256 = await sha256Hex(file);
        const upload = await createAttachmentUpload({
          id,
          threadId: current.thread.id,
          ownerId: currentSenderId,
          fileName: image.fileName,
          contentType: file.type,
          byteSize: file.size,
          checksumSha256,
          encryptionMode: "server_envelope",
        });
        const uploaded = await fetch(upload.uploadUrl, {
          method: "PUT",
          headers: {
            "content-type": file.type,
            "x-amz-meta-sha256": checksumSha256,
            ...upload.requiredHeaders,
          },
          body: file,
        });
        if (!uploaded.ok) throw new Error("attachment_upload_failed");
        const completed = await completeAttachmentUpload(id);
        if (completed.state !== "available") {
          throw new Error("attachment_scan_failed");
        }
        setComposerImages((currentImages) =>
          currentImages.map((candidate) =>
            candidate.id === id
              ? { ...candidate, status: "available" }
              : candidate,
          ),
        );
      } catch {
        setComposerImages((currentImages) =>
          currentImages.map((candidate) =>
            candidate.id === id
              ? { ...candidate, status: "failed" }
              : candidate,
          ),
        );
      }
    }
  }

  function removeComposerImage(id: string) {
    if (composerImages.some((image) => image.id === id)) {
      reservedImageSlotsRef.current = Math.max(
        0,
        reservedImageSlotsRef.current - 1,
      );
    }
    setComposerImages((images) => {
      const removed = images.find((image) => image.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
        previewUrlsRef.current.delete(removed.previewUrl);
      }
      return images.filter((image) => image.id !== id);
    });
  }

  function submit() {
    const availableImages = composerImages.filter(
      (image) => image.status === "available",
    );
    if (
      !current ||
      !currentSenderId ||
      (!draft.trim() && availableImages.length === 0) ||
      composerImages.some((image) => image.status !== "available") ||
      current.thread.accessMode === "human_only_e2ee" ||
      send.isPending
    ) {
      return;
    }
    setMentionPickerOpen(false);
    const body = draft.trim();
    const mode = currentIsPilot
      ? "pilot-dm"
      : currentIsPilotStandIn
        ? "pilot-stand-in"
        : "canonical";
    const sendKey = [
      current.thread.id,
      mode,
      activeStandInOwnerId ?? "",
      body,
      availableImages.map((image) => image.id).join(","),
    ].join("\u0000");
    if (retryableSendRef.current?.key !== sendKey) {
      retryableSendRef.current = {
        key: sendKey,
        clientMessageId: createClientUuid(),
      };
    }
    send.mutate({
      threadId: current.thread.id,
      senderId: currentSenderId,
      body,
      mentionedStandIns: mentionedStandIns(body, mentionCandidates),
      clientMessageId: retryableSendRef.current.clientMessageId,
      mentionedPrincipalIds: extractConversationMentionPrincipalIds(
        body,
        mentionCandidates,
        currentSenderId,
      ),
      attachmentIds: availableImages.map((image) => image.id),
      ...(currentIsPilotStandIn && activeStandInOwnerId
        ? { standInOwnerId: activeStandInOwnerId }
        : {}),
      mode,
    });
  }

  function selectMention(candidate: ConversationMentionCandidate) {
    const result = applyConversationMention(
      draft,
      mentionCursor,
      candidate,
      activeMention,
    );
    setDraft(result.draft);
    setMentionCursor(result.cursor);
    setMentionPickerOpen(false);
    if (currentIsPilotStandIn && candidate.standInOwnerId) {
      selectStandIn(candidate.standInOwnerId);
    }
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(result.cursor, result.cursor);
    });
  }

  function toggleExpanded(messageId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  function renderMessage(message: ThreadMessage) {
    if (!current) return null;
    const thread = current.thread;

    if (message.kind === "system_access_change") {
      return (
        <p className="rounded-inset bg-raise p-[12px_16px] text-center text-[11.5px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
          {message.body || t("chat.accessChanged")}
        </p>
      );
    }

    if (message.kind === "coordination_action") {
      const action = current.actions.find(
        (item) => item.envelope.operationId === message.operationId,
      );
      if (action?.envelope.action === "human_escalation") {
        return (
          <div className="rounded-card border border-danger-soft bg-danger-soft p-[18px_20px]">
            <div className="flex items-center gap-[9px]">
              <HandTapIcon size={17} className="text-danger" />
              <strong className="text-[12.5px] font-[620] text-danger">
                {t("chat.needsHuman")}
              </strong>
            </div>
            <p className="mt-2.5 text-[13px] leading-[1.7] text-ink [text-wrap:pretty]">
              {message.body}
            </p>
            <div className="mt-[14px] inline-flex items-center gap-2 rounded-[9px] bg-green-soft px-[13px] py-[9px] text-[12px] text-green">
              <CheckCircleIcon size={14} weight="fill" />
              {t("chat.resolved")}
            </div>
          </div>
        );
      }
      const name = action
        ? t(`coord.action.${action.envelope.action}` as TranslationKey)
        : t("coord.action.coordination_request");
      return (
        <div className="flex items-center gap-3 rounded-card border border-green-soft bg-green-soft p-[14px_17px]">
          <GitBranchIcon size={17} className="text-green" />
          <span className="grid min-w-0">
            <strong className="text-[12px] font-[620]">{name}</strong>
            <small className="mt-1 text-[11.5px] leading-[1.55] text-ink-muted">
              {message.body}
            </small>
          </span>
          <span className="ml-auto shrink-0 font-mono text-[9.5px] text-faint">
            seq {message.sequence}
          </span>
        </div>
      );
    }

    const isStandIn = thread.standInIds.includes(message.senderId);
    const senderName =
      principalNames.get(message.senderId) ?? message.senderId.slice(0, 8);

    if (isStandIn) {
      const ownerName = ownerNameFor(thread, principalNames);
      const isOpen = expanded.has(message.id);
      const groundedExchange = currentIsPilotStandIn
        ? pilotStandIn.data?.exchanges.find(
            (exchange) => exchange.answerMessageId === message.id,
          )
        : undefined;
      return (
        <div className="grid grid-cols-[30px_minmax(0,1fr)] gap-3">
          <span
            className="grid h-[30px] w-[30px] place-items-center rounded-[9px_13px_9px_9px] text-[9.5px] font-[700] text-on-tint"
            style={{ background: tintFor(message.senderId) }}
          >
            {initials(senderName)}
          </span>
          <div className="min-w-0 max-w-[620px] rounded-card border border-line2 bg-panel2 p-[15px_17px]">
            <div className="mb-[9px] flex items-center gap-[9px]">
              <strong className="text-[12px] font-[620]">{senderName}</strong>
              <span className="rounded-pill bg-accent-soft px-[7px] py-0.5 text-[9.5px] font-[620] text-accent-strong">
                {t("chat.agentOf", { name: ownerName })}
              </span>
              <time className="ml-auto font-mono text-[9.5px] text-faint">
                {formatTime(message.createdAt)}
              </time>
            </div>
            {message.streamState === "pending" && !message.body ? (
              <div
                data-testid={`stand-in-stream-${message.id}`}
                className="flex items-center gap-2 py-1 text-[12px] text-ink-muted"
              >
                <span className="inline-flex gap-1" aria-hidden="true">
                  <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-strong" />
                  <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-strong [animation-delay:140ms]" />
                  <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-strong [animation-delay:280ms]" />
                </span>
                {t("chat.standInThinking")}
              </div>
            ) : message.serverReadable ? (
              <div className="relative">
                <ChatMarkdown
                  markdown={message.body}
                  renderText={(text) => (
                    <MentionText body={text} candidates={mentionCandidates} />
                  )}
                />
                {message.streamState === "streaming" ? (
                  <span
                    aria-hidden="true"
                    className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-accent-strong align-[-0.15em]"
                  />
                ) : null}
              </div>
            ) : (
              <p className="text-[13px] text-ink">
                {t("chat.encryptedMessage")}
              </p>
            )}
            {message.streamState === "failed" ? (
              <p className="mt-2 text-[11px] text-danger">
                {t("chat.standInStreamFailed")}
              </p>
            ) : null}
            <MessageAttachments attachments={message.attachments ?? []} />
            {groundedExchange?.structuredAnswer ? (
              <StandInAnswerContent
                answer={groundedExchange.structuredAnswer}
                testId={`pilot-stand-in-answer-${message.id}`}
              />
            ) : null}
            <button
              type="button"
              className="mt-[13px] flex w-full items-center gap-2 border-0 border-t border-line bg-transparent pt-[11px] text-[10.5px] text-green cursor-pointer"
              onClick={() => toggleExpanded(message.id)}
            >
              <CheckCircleIcon size={13} weight="fill" />
              <span>
                {t("chat.durableSequence", { sequence: message.sequence })} ·{" "}
                {message.serverReadable
                  ? t("chat.agentReadable")
                  : t("chat.encrypted")}
              </span>
              <span className="ml-auto text-faint">
                {isOpen ? t("chat.collapseBasis") : t("chat.expandBasis")}
              </span>
            </button>
            {isOpen ? (
              <div className="mt-[11px] grid gap-2 rounded-[10px] bg-raise p-[12px_14px]">
                {groundedExchange?.sources.map((source) => (
                  <div
                    key={source.workStateId}
                    data-testid={`pilot-stand-in-source-${source.workStateId}`}
                    className="grid gap-1 text-[10.5px] leading-[1.55] text-ink-muted"
                  >
                    <strong className="font-[620] text-ink">
                      来源 · {source.title}
                    </strong>
                    <span>
                      {source.provenance.client} /{" "}
                      {source.provenance.connectionName} · 新鲜度{" "}
                      {formatRelative(source.freshnessAt)}
                    </span>
                    <span className="font-mono text-[9.5px] text-faint">
                      Work State {source.workStateId.slice(0, 8)} ·{" "}
                      {source.eventType}
                    </span>
                  </div>
                ))}
                <p className="font-mono text-[10px] leading-[1.6] text-faint">
                  seq {message.sequence} · {thread.accessMode}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    const isOwn = message.senderId === currentSenderId;
    const avatar = (
      <span
        className="grid h-[30px] w-[30px] place-items-center rounded-full text-[9.5px] font-[650] text-on-tint"
        style={{ background: tintFor(message.senderId) }}
      >
        {initials(senderName)}
      </span>
    );
    const content = (
      <div
        className={cn(
          "min-w-0",
          isOwn ? "flex flex-col items-end text-right" : undefined,
        )}
      >
        <div
          className={cn(
            "flex items-center gap-[9px]",
            isOwn ? "justify-end" : undefined,
          )}
        >
          <strong className="text-[12px] font-[620]">{senderName}</strong>
          <time className="font-mono text-[9.5px] text-faint">
            {formatTime(message.createdAt)}
          </time>
        </div>
        <div
          className={cn(
            "mt-[7px] max-w-[560px] rounded-card p-[12px_15px] text-left",
            isOwn ? "w-fit bg-accent-soft" : "bg-bubble",
          )}
        >
          {message.serverReadable ? (
            <ChatMarkdown
              markdown={message.body}
              renderText={(text) => (
                <MentionText body={text} candidates={mentionCandidates} />
              )}
            />
          ) : (
            <p className="text-[13px] leading-[1.7] text-ink">
              {t("chat.encryptedMessage")}
            </p>
          )}
          <MessageAttachments attachments={message.attachments ?? []} />
        </div>
      </div>
    );
    return (
      <div
        className={cn(
          "grid gap-3",
          isOwn
            ? "grid-cols-[minmax(0,1fr)_30px]"
            : "grid-cols-[30px_minmax(0,1fr)]",
        )}
        data-message-side={isOwn ? "right" : "left"}
        data-testid={
          currentIsPilot ? `pilot-dm-message-${message.sequence}` : undefined
        }
      >
        {isOwn ? (
          <>
            {content}
            {avatar}
          </>
        ) : (
          <>
            {avatar}
            {content}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[292px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] animate-view-enter">
      <aside className="flex min-w-0 flex-col border-r border-line bg-panel">
        <div className="p-[18px_18px_14px]">
          <div className="flex items-center gap-[10px]">
            <strong className="text-[15px] font-[620] tracking-[-0.02em]">
              {t("chat.title")}
            </strong>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                aria-label={t("chat.search")}
                className="grid h-[26px] w-[26px] cursor-pointer place-items-center rounded-quiet border-0 bg-raise text-ink-muted"
                onClick={() =>
                  setShowSearch((prev) => {
                    const next = !prev;
                    if (!next) setSearch("");
                    return next;
                  })
                }
              >
                <MagnifyingGlassIcon size={14} />
              </button>
              <button
                type="button"
                aria-label={t("chat.new")}
                className="grid h-[26px] w-[26px] cursor-pointer place-items-center rounded-quiet border-0 bg-raise text-ink-muted"
                onClick={() => setShowCreate((prev) => !prev)}
              >
                <PlusIcon size={14} />
              </button>
            </div>
          </div>
          {showSearch ? (
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("chat.search")}
              aria-label={t("chat.search")}
              className="mt-2.5 h-8 w-full rounded-[9px] border border-line2 bg-transparent px-2.5 text-[12px] outline-none placeholder:text-faint"
            />
          ) : null}
        </div>

        {showCreate ? (
          <NewConversationModal
            candidates={conversationCandidates}
            busy={create.isPending}
            onClose={() => setShowCreate(false)}
            onCreate={(input) => create.mutate(input)}
          />
        ) : null}

        {threads.isPending && items.length === 0 ? (
          <div className="flex items-center gap-2 px-2.5 py-4 text-[12px] text-ink-muted">
            <CircleNotchIcon size={18} className="animate-spin" />
            <span>{t("chat.loading")}</span>
          </div>
        ) : null}
        {threads.isError && items.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-2.5 py-4 text-[12px] text-ink-muted">
            <span>{t("chat.unavailable")}</span>
            <button
              type="button"
              onClick={() => void threads.refetch()}
              className="h-8 cursor-pointer rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] text-ink hover:border-accent-strong"
            >
              {t("general.retry")}
            </button>
          </div>
        ) : null}

        {threads.isError && items.length > 0 ? (
          <div className="px-2.5 py-2 text-[11px] text-ink-muted">
            部分常规会话暂不可用；个人替身与云端会话仍可使用。
          </div>
        ) : null}

        {canRenderCommunicationItems({
          itemCount: items.length,
          canonicalPending: threads.isPending,
          canonicalError: threads.isError,
        }) ? (
          <div className="min-h-0 flex-1 overflow-auto px-2.5 pb-4">
            {THREAD_GROUPS.map((group) => {
              const grouped = visibleItems.filter(
                (item) => item.thread.kind === group.kind,
              );
              if (grouped.length === 0) return null;
              return (
                <div key={group.kind}>
                  <div className="px-2.5 py-2 text-[10.5px] font-[650] tracking-[0.1em] text-faint">
                    {t(group.label)}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {grouped.map((item) => (
                      <SidebarThreadItem
                        key={item.thread.id}
                        item={item}
                        active={current?.thread.id === item.thread.id}
                        principalNames={principalNames}
                        teamNames={teamNames}
                        threadTitles={threadTitles}
                        formatRelative={formatRelative}
                        t={t}
                        onSelect={() => {
                          if (
                            item.thread.id === pilotStandInItem?.thread.id &&
                            activeStandInOwnerId
                          ) {
                            selectStandIn(activeStandInOwnerId);
                          } else {
                            selectThread(item.thread.id);
                          }
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </aside>

      {current ? (
        <div className="grid h-full min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]">
          {showManage && current.thread.kind === "room" ? (
            <GroupChatManagementModal
              title={current.thread.title}
              participantIds={current.thread.participantIds}
              standInIds={current.thread.standInIds}
              principalNames={principalNames}
              candidates={conversationCandidates}
              busy={updateGroupChat.isPending}
              error={
                updateGroupChat.error instanceof Error
                  ? updateGroupChat.error.message
                  : undefined
              }
              onClose={() => setShowManage(false)}
              onSave={(input) =>
                updateGroupChat.mutate({
                  threadId: current.thread.id,
                  ...input,
                })
              }
            />
          ) : null}
          <header className="flex items-center gap-[13px] border-b border-line p-[18px_26px]">
            <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-accent-soft text-[12px] font-[650] text-accent-strong">
              {initials(current.thread.title)}
            </span>
            <span className="grid min-w-0">
              <strong className="truncate text-[14.5px] font-[620] tracking-[-0.015em]">
                {current.thread.title}
              </strong>
              <small className="mt-[3px] truncate text-[11px] text-ink-muted">
                {currentIsPilotStandIn
                  ? "个人替身 · 仅使用该成员在当前项目内已共享的 Work State"
                  : currentIsPilot
                    ? "同团队 · 仅参与者可见 · 持久化 1:1"
                    : t("chat.subPeopleStandIns", {
                        people: current.thread.participantIds.length,
                        standIns: current.thread.standInIds.length,
                      })}
              </small>
            </span>
            {current.thread.kind === "room" ? (
              <button
                type="button"
                data-testid="group-chat-management-trigger"
                aria-label={t("chat.manage")}
                onClick={() => setShowManage(true)}
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] text-ink-muted hover:border-accent-strong hover:text-accent-strong"
              >
                <GearSixIcon size={14} />
                {t("chat.manage")}
              </button>
            ) : current.thread.kind === "human_direct" &&
              current.thread.standInIds.length === 0 ? (
              <button
                type="button"
                data-testid="pilot-add-stand-in"
                disabled={addStandIn.isPending}
                onClick={() => addStandIn.mutate(current.thread.id)}
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] hover:border-accent-strong"
              >
                {addStandIn.isPending ? (
                  <CircleNotchIcon size={14} className="animate-spin" />
                ) : (
                  <UserPlusIcon size={14} />
                )}
                邀请替身
              </button>
            ) : current.thread.kind === "human_direct" &&
              current.thread.standInIds.length > 0 ? (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-pill bg-accent-soft px-2.5 py-1 text-[10.5px] text-accent-strong">
                <RobotIcon size={13} />
                替身已加入
              </span>
            ) : null}
          </header>

          {/* A branched discussion is meant to end: its conclusion is posted
              back into the conversation it came from, then it closes. */}
          {current.thread.parentThreadId && !currentIsPilot ? (
            <div className="border-b border-line px-[26px] py-3">
              {current.thread.concludedAt ? (
                <div className="flex items-center gap-2 rounded-inset bg-green-soft px-3 py-2.5 text-[11.5px] text-green">
                  <CheckCircleIcon size={14} weight="fill" />
                  {t("chat.concludedInto", {
                    title:
                      threadTitles.get(current.thread.parentThreadId) ?? "—",
                  })}
                  <button
                    type="button"
                    onClick={() => selectThread(current.thread.parentThreadId!)}
                    className="ml-auto cursor-pointer border-0 bg-transparent p-0 text-[11.5px] text-accent-strong hover:underline"
                  >
                    {t("chat.openOrigin")}
                  </button>
                </div>
              ) : concluding ? (
                <div className="grid gap-2 rounded-inset border border-line2 bg-panel2 p-3">
                  <span className="text-[11px] text-faint">
                    {t("chat.concludeHint", {
                      title:
                        threadTitles.get(current.thread.parentThreadId) ?? "—",
                    })}
                  </span>
                  <textarea
                    rows={2}
                    autoFocus
                    value={conclusion}
                    onChange={(event) => setConclusion(event.target.value)}
                    placeholder={t("chat.concludePlaceholder")}
                    className="w-full resize-none rounded-btn border border-line bg-panel px-3 py-2 text-[12px] leading-[1.6] text-ink outline-none placeholder:text-faint focus:border-accent-strong"
                  />
                  <div className="flex items-center gap-2">
                    {conclude.isError ? (
                      <span role="alert" className="text-[11px] text-danger">
                        {t("chat.concludeFailed")}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      disabled={!conclusion.trim() || conclude.isPending}
                      onClick={() =>
                        conclude.mutate({
                          threadId: current.thread.id,
                          conclusion: conclusion.trim(),
                        })
                      }
                      className="ml-auto h-8 cursor-pointer rounded-btn border-0 bg-accent-strong px-3.5 text-[12px] font-[620] text-on-accent disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {t("chat.concludeSend")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConcluding(false)}
                      className="h-8 cursor-pointer border-0 bg-transparent px-2 text-[12px] text-faint hover:text-ink"
                    >
                      {t("general.close")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConcluding(true)}
                  className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] text-ink-muted hover:border-accent-strong hover:text-accent-strong"
                >
                  <ArrowBendDownRightIcon size={13} />
                  {t("chat.conclude")}
                </button>
              )}
            </div>
          ) : null}

          <div className="overflow-auto p-[22px_26px_30px]">
            <div className="mx-auto flex max-w-[800px] flex-col gap-4">
              {!currentIsPilot &&
              !currentIsPilotStandIn &&
              (current.messages[0]?.sequence ?? 0) > 1 &&
              !historyExhausted.has(current.thread.id) ? (
                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    disabled={loadOlder.isPending}
                    onClick={() =>
                      loadOlder.mutate({
                        threadId: current.thread.id,
                        beforeSequence: current.messages[0]!.sequence,
                      })
                    }
                    className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-btn border border-line2 bg-transparent px-3 text-[11px] text-ink-muted hover:border-accent-strong hover:text-accent-strong disabled:cursor-wait disabled:opacity-50"
                  >
                    {loadOlder.isPending ? (
                      <CircleNotchIcon size={13} className="animate-spin" />
                    ) : null}
                    {t("chat.loadOlder")}
                  </button>
                  {loadOlder.isError ? (
                    <span role="alert" className="text-[10.5px] text-danger">
                      {t("chat.loadOlderFailed")}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {currentIsPilot && currentPilotItem?.thread.standInId ? (
                <p className="rounded-inset bg-raise p-[12px_16px] text-center text-[11.5px] leading-[1.7] text-ink-muted">
                  替身只会看到加入后的消息，不会读取此前的私聊历史。
                </p>
              ) : null}
              {current.messages.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-10 text-center">
                  <strong className="text-[13px] font-[620]">
                    {t("chat.emptyThread")}
                  </strong>
                  <p className="text-[12px] text-ink-muted">
                    {t("chat.emptyThreadDetail")}
                  </p>
                </div>
              ) : (
                current.messages.map((message, index) => (
                  <div
                    key={message.id}
                    className="animate-message-enter"
                    style={{
                      animationDelay: `${Math.min(index * 40, 320)}ms`,
                    }}
                  >
                    {renderMessage(message)}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} aria-hidden="true" />
            </div>
          </div>

          <div className="p-[0_26px_22px]">
            <div className="mx-auto max-w-[800px]">
              <div
                className="relative rounded-card border border-line2 bg-panel2 p-[11px_13px]"
                onDragOver={(event) => {
                  if (canAttachImages) event.preventDefault();
                }}
                onDrop={(event) => {
                  if (!canAttachImages) return;
                  event.preventDefault();
                  void addComposerImages([...event.dataTransfer.files]);
                }}
              >
                <div className="mb-[9px] flex items-center gap-[7px]">
                  <button
                    type="button"
                    aria-label={t("chat.mention")}
                    aria-expanded={mentionPickerOpen}
                    data-testid="communications-mention-trigger"
                    onClick={() => {
                      const cursor =
                        composerRef.current?.selectionStart ?? draft.length;
                      setMentionCursor(cursor);
                      setMentionPickerOpen((open) => !open);
                    }}
                    className={cn(
                      "grid h-6 w-6 cursor-pointer place-items-center rounded-[8px] border text-[13px] font-[650]",
                      mentionPickerOpen
                        ? "border-accent-strong bg-accent-soft text-accent-strong"
                        : "border-line2 bg-transparent text-ink-muted hover:border-accent-strong hover:text-accent-strong",
                    )}
                  >
                    @
                  </button>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      void addComposerImages([
                        ...(event.currentTarget.files ?? []),
                      ]);
                      event.currentTarget.value = "";
                    }}
                  />
                  <button
                    type="button"
                    aria-label={t("chat.attachImage")}
                    title={t("chat.attachImage")}
                    disabled={
                      !canAttachImages ||
                      composerImages.length >= MAX_MESSAGE_IMAGES
                    }
                    onClick={() => imageInputRef.current?.click()}
                    className="grid h-6 w-6 cursor-pointer place-items-center rounded-[8px] border border-line2 bg-transparent text-ink-muted hover:border-accent-strong hover:text-accent-strong disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <PaperclipIcon size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={
                      markdownPreview
                        ? t("chat.markdownWrite")
                        : t("chat.markdownPreview")
                    }
                    title={
                      markdownPreview
                        ? t("chat.markdownWrite")
                        : t("chat.markdownPreview")
                    }
                    disabled={!draft.trim()}
                    onClick={() => setMarkdownPreview((visible) => !visible)}
                    className={cn(
                      "grid h-6 w-6 cursor-pointer place-items-center rounded-[8px] border disabled:cursor-not-allowed disabled:opacity-35",
                      markdownPreview
                        ? "border-accent-strong bg-accent-soft text-accent-strong"
                        : "border-line2 bg-transparent text-ink-muted hover:border-accent-strong hover:text-accent-strong",
                    )}
                  >
                    {markdownPreview ? (
                      <PencilSimpleIcon size={13} />
                    ) : (
                      <EyeIcon size={13} />
                    )}
                  </button>
                  <span className="ml-auto inline-flex items-center gap-[5px] text-[10px] text-faint">
                    <LockSimpleIcon size={12} />
                    {currentIsPilot
                      ? "仅两位参与者可见 · 暂不支持附件"
                      : currentIsPilotStandIn
                        ? "不读取私聊历史、私有 Work State 或原始数据"
                        : current.thread.accessMode === "human_only_e2ee"
                          ? t("chat.e2ee")
                          : t("chat.markdownHint")}
                  </span>
                </div>
                {mentionPickerOpen ? (
                  <div
                    data-testid="communications-mention-picker"
                    className="absolute bottom-[54px] left-[11px] right-[11px] z-20 grid max-h-[220px] gap-1 overflow-auto rounded-inset border border-line bg-panel p-1.5 shadow-[0_16px_42px_rgba(0,0,0,0.22)] sm:right-auto sm:w-[360px]"
                  >
                    {visibleMentionCandidates.length > 0 ? (
                      visibleMentionCandidates.map((candidate) => (
                        <button
                          type="button"
                          key={candidate.principalId}
                          data-testid={`communications-mention-option-${candidate.principalId}`}
                          onClick={() => selectMention(candidate)}
                          className="grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded-btn border-0 bg-transparent px-2.5 py-2 text-left hover:bg-raise"
                        >
                          {candidate.kind === "stand_in" ? (
                            <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-accent-soft text-accent-strong">
                              <RobotIcon size={14} />
                            </span>
                          ) : (
                            <Avatar
                              id={candidate.principalId}
                              name={candidate.displayName}
                              size="md"
                            />
                          )}
                          <strong className="truncate text-[11.5px] font-[620] text-ink">
                            {candidate.displayName}
                          </strong>
                          <small className="rounded-pill bg-raise px-2 py-0.5 text-[9.5px] text-faint">
                            {t(
                              candidate.kind === "stand_in"
                                ? "chat.mentionStandIn"
                                : "chat.mentionPerson",
                            )}
                          </small>
                        </button>
                      ))
                    ) : (
                      <span className="px-2.5 py-3 text-[11px] text-faint">
                        {t("chat.noMentionCandidates")}
                      </span>
                    )}
                  </div>
                ) : null}
                {composerImages.length > 0 ? (
                  <div className="mb-2.5 flex gap-2 overflow-x-auto pb-1">
                    {composerImages.map((image) => (
                      <div
                        key={image.id}
                        className="relative h-[72px] w-[88px] shrink-0 overflow-hidden rounded-[9px] bg-raise"
                      >
                        <img
                          src={image.previewUrl}
                          alt={image.fileName}
                          className={cn(
                            "h-full w-full object-cover",
                            image.status === "available" ? "" : "opacity-45",
                          )}
                        />
                        {image.status === "uploading" ? (
                          <span
                            className="absolute inset-0 grid place-items-center"
                            title={t("chat.imageUploading")}
                          >
                            <CircleNotchIcon
                              size={17}
                              className="animate-spin text-on-tint"
                            />
                          </span>
                        ) : null}
                        {image.status === "failed" ? (
                          <span
                            className="absolute inset-x-1 bottom-1 rounded bg-danger/85 px-1 py-0.5 text-center text-[8px] text-white"
                            title={t("chat.imageUploadFailed")}
                          >
                            {t("chat.imageUploadFailed")}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          aria-label={t("chat.removeImage")}
                          onClick={() => removeComposerImage(image.id)}
                          className="absolute right-1 top-1 grid h-5 w-5 cursor-pointer place-items-center rounded-full border-0 bg-black/65 text-white"
                        >
                          <XIcon size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="grid grid-cols-[1fr_34px] items-end gap-[9px]">
                  {markdownPreview ? (
                    <div
                      data-testid="communications-markdown-preview"
                      className="min-h-[42px] max-h-[180px] overflow-auto rounded-[9px] bg-raise px-3 py-2"
                    >
                      <ChatMarkdown
                        markdown={draft}
                        renderText={(text) => (
                          <MentionText
                            body={text}
                            candidates={mentionCandidates}
                          />
                        )}
                      />
                    </div>
                  ) : (
                    <textarea
                      ref={composerRef}
                      data-testid="communications-composer"
                      rows={1}
                      value={draft}
                      onChange={(event) => {
                        const cursor =
                          event.currentTarget.selectionStart ??
                          event.currentTarget.value.length;
                        setDraft(event.currentTarget.value);
                        setMentionCursor(cursor);
                        setMentionPickerOpen(
                          Boolean(
                            conversationMentionQuery(
                              event.currentTarget.value,
                              cursor,
                            ),
                          ),
                        );
                      }}
                      onSelect={(event) => {
                        setMentionCursor(
                          event.currentTarget.selectionStart ?? draft.length,
                        );
                      }}
                      onPaste={(event) => {
                        const files = [...event.clipboardData.files].filter(
                          (file) => file.type.startsWith("image/"),
                        );
                        if (files.length > 0 && canAttachImages) {
                          event.preventDefault();
                          void addComposerImages(files);
                        }
                      }}
                      onKeyDown={(event) => {
                        const isComposing =
                          event.nativeEvent.isComposing ||
                          event.nativeEvent.keyCode === 229;
                        if (event.key === "Escape" && mentionPickerOpen) {
                          event.preventDefault();
                          setMentionPickerOpen(false);
                          return;
                        }
                        if (
                          event.key === "Enter" &&
                          !event.shiftKey &&
                          !isComposing &&
                          mentionPickerOpen &&
                          visibleMentionCandidates[0]
                        ) {
                          event.preventDefault();
                          selectMention(visibleMentionCandidates[0]);
                          return;
                        }
                        if (
                          shouldSubmitComposerKey({
                            key: event.key,
                            shiftKey: event.shiftKey,
                            isComposing,
                          })
                        ) {
                          event.preventDefault();
                          submit();
                        }
                      }}
                      placeholder={t("chat.placeholder")}
                      disabled={
                        !currentSenderId ||
                        current.thread.accessMode === "human_only_e2ee"
                      }
                      className="min-h-[34px] max-h-[110px] resize-none border-0 bg-transparent px-1 py-2 text-[12.5px] leading-[1.55] outline-none placeholder:text-faint"
                    />
                  )}
                  <button
                    type="button"
                    disabled={
                      (!draft.trim() &&
                        !composerImages.some(
                          (image) => image.status === "available",
                        )) ||
                      composerImages.some(
                        (image) => image.status !== "available",
                      ) ||
                      !currentSenderId ||
                      current.thread.accessMode === "human_only_e2ee" ||
                      send.isPending
                    }
                    onClick={submit}
                    className="grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-[10px] border-0 bg-accent-strong text-on-accent disabled:opacity-55"
                  >
                    {send.isPending ? (
                      <CircleNotchIcon size={16} className="animate-spin" />
                    ) : (
                      <ArrowUpIcon size={16} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : !threads.isPending && !threads.isError && items.length === 0 ? (
        <div className="grid h-full min-w-0 place-items-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid h-9 w-9 place-items-center rounded-[11px_15px_11px_11px] bg-accent-strong text-[12px] font-[700] text-on-accent">
              IR
            </span>
            <strong className="text-[19px] font-[600]">
              {t("chat.empty.title")}
            </strong>
            <p className="max-w-[320px] text-[13px] text-ink-muted">
              {t("chat.empty.body")}
            </p>
            <button
              type="button"
              disabled={!conversationIdentity || createStandIn.isPending}
              onClick={() => createStandIn.mutate()}
              className="mt-1 inline-flex h-[34px] cursor-pointer items-center justify-center gap-1.5 rounded-btn border-0 bg-accent-strong px-3.5 text-[12.5px] font-[620] text-on-accent disabled:opacity-55"
            >
              {createStandIn.isPending ? (
                <CircleNotchIcon size={14} className="animate-spin" />
              ) : null}
              {t("chat.empty.start")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function resolvePilotCommunicationPrincipal(
  identityId: PrincipalId | undefined,
  bootstrap:
    | {
        identities: PrincipalSummary[];
        currentPrincipal?: PrincipalSummary;
      }
    | undefined,
): PrincipalSummary | undefined {
  if (!identityId || !bootstrap) return undefined;
  return bootstrap.currentPrincipal?.id === identityId
    ? bootstrap.currentPrincipal
    : bootstrap.identities.find((principal) => principal.id === identityId);
}

export function resolveConversationIdentity(
  bootstrap: BootstrapPayload | undefined,
  pilotIdentityId: PrincipalId | undefined,
):
  | {
      currentPrincipalId: PrincipalId;
      standInPrincipalId: PrincipalId;
    }
  | undefined {
  const currentPrincipalId = pilotIdentityId ?? bootstrap?.currentPrincipal?.id;
  if (!currentPrincipalId) return undefined;
  const bootstrapMatchesCurrent =
    bootstrap?.currentPrincipal?.id === currentPrincipalId;
  return {
    currentPrincipalId: currentPrincipalId as PrincipalId,
    standInPrincipalId:
      (bootstrapMatchesCurrent
        ? (bootstrap?.standInPrincipal?.id as PrincipalId | undefined)
        : undefined) ??
      personalStandInPrincipalId(currentPrincipalId as PrincipalId),
  };
}

export function canRenderCommunicationItems(input: {
  itemCount: number;
  canonicalPending: boolean;
  canonicalError: boolean;
}): boolean {
  return (
    input.itemCount > 0 || (!input.canonicalPending && !input.canonicalError)
  );
}

export interface ConversationMentionCandidate {
  principalId: PrincipalId;
  displayName: string;
  kind: "human" | "stand_in";
  standInOwnerId?: PrincipalId;
  threadParticipant?: boolean;
}

export interface MentionedStandIn {
  principalId: PrincipalId;
  ownerId: PrincipalId;
  needsJoin: boolean;
}

export interface ConversationMention {
  start: number;
  end: number;
  query: string;
}

export function conversationMentionCandidates(input: {
  participantIds: string[];
  standInIds: string[];
  principalNames: Map<string, string>;
  standInOwnerIds?: Map<PrincipalId, PrincipalId>;
  additionalStandIns?: PersonalStandInMentionCandidate[];
}): ConversationMentionCandidate[] {
  const standInIds = new Set(input.standInIds);
  const candidates = new Map<string, ConversationMentionCandidate>();
  for (const principalId of input.participantIds) {
    const standInOwnerId = input.standInOwnerIds?.get(
      principalId as PrincipalId,
    );
    candidates.set(principalId, {
      principalId: principalId as PrincipalId,
      displayName:
        input.principalNames.get(principalId) ?? principalId.slice(0, 8),
      kind: standInIds.has(principalId) ? "stand_in" : "human",
      threadParticipant: true,
      ...(standInOwnerId ? { standInOwnerId } : {}),
    });
  }
  for (const candidate of input.additionalStandIns ?? []) {
    const principalId = personalStandInPrincipalId(candidate.principalId);
    if (candidates.has(principalId)) continue;
    candidates.set(principalId, {
      principalId,
      displayName: `${candidate.displayName} 的替身`,
      kind: "stand_in",
      standInOwnerId: candidate.principalId,
      threadParticipant: false,
    });
  }
  return [...candidates.values()].toSorted(
    (left, right) =>
      Number(left.kind === "stand_in") - Number(right.kind === "stand_in") ||
      left.displayName.localeCompare(right.displayName),
  );
}

export function mentionedStandIns(
  body: string,
  candidates: ConversationMentionCandidate[],
): MentionedStandIn[] {
  const mentioned = new Map<PrincipalId, MentionedStandIn>();
  for (const part of splitConversationMentions(body, candidates)) {
    if (part.mention?.kind !== "stand_in" || !part.mention.standInOwnerId) {
      continue;
    }
    mentioned.set(part.mention.principalId, {
      principalId: part.mention.principalId,
      ownerId: part.mention.standInOwnerId,
      needsJoin: part.mention.threadParticipant === false,
    });
  }
  return [...mentioned.values()];
}

export async function prepareConversationStandIns(
  input: {
    threadId: string;
    senderId: string;
    mentionedStandIns?: MentionedStandIn[];
  },
  dependencies: {
    addStandIn: (input: {
      threadId: string;
      standInId: string;
      actorId: string;
    }) => Promise<unknown>;
  },
): Promise<void> {
  for (const mentioned of input.mentionedStandIns ?? []) {
    if (!mentioned.needsJoin) continue;
    await dependencies.addStandIn({
      threadId: input.threadId,
      standInId: mentioned.principalId,
      actorId: input.senderId,
    });
  }
}

export async function sendCanonicalConversationMessage(
  input: {
    threadId: string;
    senderId: string;
    body: string;
    mentionedStandIns?: MentionedStandIn[];
    clientMessageId?: string;
    mentionedPrincipalIds?: string[];
    attachmentIds?: string[];
  },
  dependencies: {
    addStandIn: (input: {
      threadId: string;
      standInId: string;
      actorId: string;
    }) => Promise<unknown>;
    sendMessage: (input: {
      threadId: string;
      senderId: string;
      body: string;
      clientMessageId?: string;
      mentionedPrincipalIds?: string[];
      attachmentIds?: string[];
    }) => Promise<unknown>;
  },
): Promise<void> {
  await prepareConversationStandIns(input, dependencies);
  await dependencies.sendMessage({
    threadId: input.threadId,
    senderId: input.senderId,
    body: input.body,
    ...(input.clientMessageId
      ? { clientMessageId: input.clientMessageId }
      : {}),
    mentionedPrincipalIds: input.mentionedPrincipalIds ?? [],
    attachmentIds: input.attachmentIds ?? [],
  });
}

export class StandInReplyError extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : "The Stand-in could not answer this message.",
      { cause },
    );
    this.name = "StandInReplyError";
  }
}

export async function requestConversationStandInReplies(
  input: {
    threadId: string;
    senderId: string;
    body: string;
    projectId?: string;
    mentionedStandIns: MentionedStandIn[];
  },
  dependencies: {
    sendMessage: (input: {
      threadId: string;
      senderId: string;
      body: string;
    }) => Promise<unknown>;
    answerStandIn: (
      identityId: PrincipalId,
      projectId: string,
      standInOwnerId: PrincipalId,
      question: string,
    ) => Promise<{
      answer: string;
      standIn: { id: string };
    }>;
  },
): Promise<void> {
  if (input.mentionedStandIns.length === 0) return;

  if (!input.projectId) {
    throw new StandInReplyError(
      new Error("No active project is available for the Stand-in."),
    );
  }
  const errors: unknown[] = [];
  for (const mentioned of input.mentionedStandIns) {
    try {
      const result = await dependencies.answerStandIn(
        input.senderId as PrincipalId,
        input.projectId,
        mentioned.ownerId,
        input.body,
      );
      await dependencies.sendMessage({
        threadId: input.threadId,
        senderId: result.standIn.id,
        body: result.answer,
      });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw new StandInReplyError(errors[0]);
}

export function conversationMentionQuery(
  draft: string,
  cursor: number,
): ConversationMention | undefined {
  const beforeCursor = draft.slice(0, cursor);
  const match = /@([^\s@]*)$/u.exec(beforeCursor);
  if (!match) return undefined;
  return {
    start: match.index,
    end: cursor,
    query: match[1] ?? "",
  };
}

export function filterConversationMentionCandidates(
  candidates: ConversationMentionCandidate[],
  query: string,
): ConversationMentionCandidate[] {
  const needle = query.replaceAll(/\s/gu, "").toLocaleLowerCase();
  return candidates.filter((candidate) =>
    candidate.displayName
      .replaceAll(/\s/gu, "")
      .toLocaleLowerCase()
      .includes(needle),
  );
}

export function applyConversationMention(
  draft: string,
  cursor: number,
  candidate: ConversationMentionCandidate,
  mention = conversationMentionQuery(draft, cursor),
): { draft: string; cursor: number } {
  const start = mention?.start ?? cursor;
  const end = mention?.end ?? cursor;
  const nextCharacter = draft[end];
  const separator =
    nextCharacter === undefined ||
    !/[\s，。！？、,.!?:;；：）)\]】]/u.test(nextCharacter)
      ? " "
      : "";
  const token = `@${candidate.displayName}${separator}`;
  return {
    draft: `${draft.slice(0, start)}${token}${draft.slice(end)}`,
    cursor: start + token.length,
  };
}

export interface ConversationMessagePart {
  text: string;
  mention?: ConversationMentionCandidate;
}

export function splitConversationMentions(
  body: string,
  candidates: ConversationMentionCandidate[],
): ConversationMessagePart[] {
  const candidateByName = new Map(
    candidates.map((candidate) => [candidate.displayName, candidate]),
  );
  const names = [...candidateByName.keys()]
    .filter(Boolean)
    .toSorted((left, right) => right.length - left.length);
  if (names.length === 0) return [{ text: body }];

  const alternatives = names.map(escapeRegularExpression).join("|");
  const matcher = new RegExp(
    `@(${alternatives})(?=$|[\\s，。！？、,.!?:;；：）)\\]】])`,
    "gu",
  );
  const parts: ConversationMessagePart[] = [];
  let offset = 0;
  for (const match of body.matchAll(matcher)) {
    const index = match.index;
    if (index > offset) parts.push({ text: body.slice(offset, index) });
    const candidate = candidateByName.get(match[1] ?? "");
    parts.push({
      text: match[0],
      ...(candidate ? { mention: candidate } : {}),
    });
    offset = index + match[0].length;
  }
  if (offset < body.length) parts.push({ text: body.slice(offset) });
  return parts.length > 0 ? parts : [{ text: body }];
}

export function extractConversationMentionPrincipalIds(
  body: string,
  candidates: ConversationMentionCandidate[],
  senderId?: string,
): string[] {
  return [
    ...new Set(
      splitConversationMentions(body, candidates)
        .map((part) => part.mention?.principalId)
        .filter(
          (principalId): principalId is PrincipalId =>
            principalId !== undefined && principalId !== senderId,
        ),
    ),
  ];
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface PersonalStandInMentionCandidate {
  principalId: PrincipalId;
  displayName: string;
  teamName: string;
}

export interface PersonalStandInMention {
  start: number;
  end: number;
  query: string;
}

export function personalStandInMentionCandidates(input: {
  project: PilotProject | undefined;
  teams: PilotTeamPayload[];
  currentPrincipalId: PrincipalId | undefined;
}): PersonalStandInMentionCandidate[] {
  if (!input.project) return [];
  const participatingTeamIds = new Set(input.project.participatingTeamIds);
  return [
    ...new Map(
      input.teams
        .filter((team) => participatingTeamIds.has(team.id))
        .flatMap((team) =>
          team.members
            .filter(
              (member) =>
                member.kind === "human" &&
                member.id !== input.currentPrincipalId,
            )
            .map(
              (member) =>
                [
                  member.id,
                  {
                    principalId: member.id,
                    displayName: member.displayName,
                    teamName: team.name,
                  },
                ] as const,
            ),
        ),
    ).values(),
  ].toSorted((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

export function personalStandInMentionQuery(
  draft: string,
): PersonalStandInMention | undefined {
  const match = /@([^\s@]*)$/u.exec(draft);
  if (!match) return undefined;
  return {
    start: match.index,
    end: draft.length,
    query: match[1] ?? "",
  };
}

export function shouldSubmitComposerKey(input: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}): boolean {
  return input.key === "Enter" && !input.shiftKey && !input.isComposing;
}

export function applyPersonalStandInMention(
  draft: string,
  mention: PersonalStandInMention,
  candidate: PersonalStandInMentionCandidate,
): string {
  return `${draft.slice(0, mention.start)}@${candidate.displayName} 的替身 ${draft.slice(mention.end)}`;
}

export function personalStandInPrincipalId(ownerId: PrincipalId): PrincipalId {
  return `${ownerId.slice(0, 14)}5${ownerId.slice(15)}` as PrincipalId;
}

export function mergeCommunicationItems(
  personalStandInItem: ThreadPayload | undefined,
  canonicalItems: ThreadPayload[],
  pilotItems: ThreadPayload[],
  hideCanonicalStandIns = Boolean(personalStandInItem),
): ThreadPayload[] {
  const canonicalPersonalStandIn = personalStandInItem
    ? canonicalItems.find(
        (item) => item.thread.id === personalStandInItem.thread.id,
      )
    : undefined;
  const mergedPersonalStandIn =
    personalStandInItem && canonicalPersonalStandIn
      ? {
          ...personalStandInItem,
          thread: canonicalPersonalStandIn.thread,
          messages: canonicalPersonalStandIn.messages,
          ...(canonicalPersonalStandIn.unreadCount !== undefined
            ? { unreadCount: canonicalPersonalStandIn.unreadCount }
            : {}),
          ...(canonicalPersonalStandIn.mentionCount !== undefined
            ? { mentionCount: canonicalPersonalStandIn.mentionCount }
            : {}),
          ...(canonicalPersonalStandIn.lastReadSequence !== undefined
            ? {
                lastReadSequence: canonicalPersonalStandIn.lastReadSequence,
              }
            : {}),
          principals: [
            ...new Map(
              [
                ...personalStandInItem.principals,
                ...canonicalPersonalStandIn.principals,
              ].map((principal) => [principal.id, principal]),
            ).values(),
          ],
        }
      : personalStandInItem;
  return [
    ...(mergedPersonalStandIn ? [mergedPersonalStandIn] : []),
    ...canonicalItems.filter(
      (item) => !(hideCanonicalStandIns && item.thread.kind === "stand_in"),
    ),
    ...pilotItems,
  ];
}

function MentionText({
  body,
  candidates,
}: {
  body: string;
  candidates: ConversationMentionCandidate[];
}) {
  return splitConversationMentions(body, candidates).map((part, index) =>
    part.mention ? (
      <span
        key={`${part.mention.principalId}-${index}`}
        data-mention-id={part.mention.principalId}
        className="inline-flex rounded-[5px] bg-accent-soft px-1 font-[620] text-accent-strong"
      >
        {part.text}
      </span>
    ) : (
      part.text
    ),
  );
}

function MessageAttachments({
  attachments,
}: {
  attachments: ThreadMessageAttachment[];
}) {
  if (attachments.length === 0) return null;
  return (
    <div
      className={cn(
        "mt-2 grid gap-2",
        attachments.length > 1 ? "grid-cols-2" : "grid-cols-1",
      )}
    >
      {attachments.map((attachment) => (
        <MessageImage key={attachment.id} attachment={attachment} />
      ))}
    </div>
  );
}

function MessageImage({ attachment }: { attachment: ThreadMessageAttachment }) {
  const download = useQuery({
    queryKey: ["conversation-attachment", attachment.id],
    queryFn: ({ signal }) => getAttachmentDownload(attachment.id, signal),
    staleTime: 4 * 60_000,
  });
  if (!download.data?.downloadUrl) {
    return (
      <div className="grid min-h-[96px] place-items-center rounded-[10px] bg-raise text-[10.5px] text-ink-muted">
        {download.isError ? (
          attachment.fileName
        ) : (
          <CircleNotchIcon className="animate-spin" />
        )}
      </div>
    );
  }
  return (
    <a
      href={download.data.downloadUrl}
      target="_blank"
      rel="noreferrer noopener"
      className="group block min-w-0 overflow-hidden rounded-[10px] bg-raise"
      title={attachment.fileName}
    >
      <img
        src={download.data.downloadUrl}
        alt={attachment.fileName}
        loading="lazy"
        className="max-h-[360px] w-full object-contain transition-transform duration-200 group-hover:scale-[1.01]"
      />
    </a>
  );
}

function AnswerLine({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[58px_minmax(0,1fr)] gap-2.5 text-[11.5px] leading-[1.6]">
      <strong className="font-[620] text-faint">{label}</strong>
      <span className="text-ink-muted [text-wrap:pretty]">{children}</span>
    </div>
  );
}

export function StandInAnswerContent({
  answer,
  testId,
}: {
  answer: PilotStandInAnswerDetail;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="mt-3 grid gap-2.5 rounded-[10px] bg-raise p-[11px_13px]"
    >
      <AnswerLine label="当前状态">{answer.currentStatus}</AnswerLine>
      <AnswerLine label="已完成">
        {answer.completedOutcome || "尚无已完成结果"}
      </AnswerLine>
      <AnswerLine label="结果依据">
        {answer.evidence.length > 0
          ? answer.evidence.join("；")
          : "当前 Work State 未提供单独依据"}
      </AnswerLine>
      <AnswerLine label="下一步">
        {answer.nextStep || "尚未明确下一步"}
      </AnswerLine>
      <AnswerLine label="需要协作">
        {answer.neededCollaboration || "暂不需要他人协助"}
      </AnswerLine>
    </div>
  );
}

function SidebarThreadItem({
  item,
  active,
  principalNames,
  teamNames,
  threadTitles,
  formatRelative,
  t,
  onSelect,
}: {
  item: ThreadPayload;
  active: boolean;
  principalNames: Map<string, string>;
  teamNames: Map<string, string>;
  threadTitles: Map<string, string>;
  formatRelative: (value: string) => string;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  onSelect: () => void;
}) {
  const lastMessage = item.messages.at(-1);
  const preview = lastMessage
    ? lastMessage.serverReadable
      ? lastMessage.body ||
        lastMessage.attachments?.[0]?.fileName ||
        (lastMessage.streamState === "pending"
          ? t("chat.standInThinking")
          : "—")
      : t("chat.encryptedMessage")
    : "—";
  const time = formatRelative(lastMessage?.createdAt ?? item.thread.createdAt);
  const humanParticipants = item.thread.participantIds.filter(
    (id) => !item.thread.standInIds.includes(id),
  );
  const unread = item.unreadCount ?? 0;
  const mentions = item.mentionCount ?? 0;
  const teamName = item.thread.teamId
    ? teamNames.get(item.thread.teamId)
    : undefined;
  const origin = item.thread.parentThreadId
    ? threadTitles.get(item.thread.parentThreadId)
    : undefined;

  return (
    <button
      type="button"
      data-testid={
        item.thread.kind === "stand_in"
          ? "personal-stand-in-conversation"
          : undefined
      }
      onClick={onSelect}
      className={
        active
          ? "grid w-full grid-cols-[30px_minmax(0,1fr)_auto] items-start gap-[11px] rounded-[11px] border-0 bg-sel p-[10px_11px] text-left cursor-pointer"
          : "grid w-full grid-cols-[30px_minmax(0,1fr)_auto] items-start gap-[11px] rounded-[11px] border-0 bg-transparent p-[10px_11px] text-left cursor-pointer hover:bg-hover-wash"
      }
    >
      <ThreadGlyph thread={item.thread} principalNames={principalNames} />
      <span className="grid min-w-0 gap-[3px]">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "truncate text-[12.5px]",
              unread > 0 ? "font-[650] text-ink" : "font-[570]",
            )}
          >
            {item.thread.title}
          </span>
          {teamName ? (
            <span
              title={teamName}
              className="shrink-0 rounded-[6px] bg-raise px-1.5 py-0.5 font-mono text-[8.5px] font-[650] tracking-[0.04em] text-ink-muted"
            >
              {teamName}
            </span>
          ) : null}
          {item.thread.standInIds.length > 0 ? (
            <RobotIcon
              size={11}
              className="shrink-0 text-accent-strong"
              aria-label={t("chat.standInPresent")}
            />
          ) : null}
        </span>
        {origin ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[10px] text-faint">
            <ArrowBendDownRightIcon size={11} className="shrink-0" />
            <span className="truncate">
              {t("chat.branchedFrom", { title: origin })}
            </span>
          </span>
        ) : null}
        <span className="truncate text-[11px] text-ink-muted">{preview}</span>
        {item.thread.concludedAt ? (
          <span className="justify-self-start rounded-pill bg-green-soft px-2 py-[3px] text-[9.5px] font-[620] text-green">
            {t("chat.concluded")}
          </span>
        ) : null}
        {humanParticipants.length > 1 ? (
          <span className="mt-0.5 flex items-center">
            {humanParticipants.slice(0, 4).map((id, index) => (
              <Avatar
                key={id}
                id={id}
                name={principalNames.get(id)}
                size="xs"
                className={index > 0 ? "-ml-[5px] ring-1 ring-panel" : ""}
              />
            ))}
            {humanParticipants.length > 4 ? (
              <span className="ml-1.5 font-mono text-[9px] text-faint">
                +{humanParticipants.length - 4}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className="grid justify-items-end gap-1.5">
        <time className="font-mono text-[9.5px] text-faint">{time}</time>
        {mentions > 0 ? (
          <span
            className="animate-badge-bounce grid h-[17px] min-w-[22px] place-items-center rounded-[9px] bg-amber px-[5px] font-mono text-[9px] font-[700] text-white"
            title={t("chat.mentionNotificationTitle")}
          >
            @{mentions > 9 ? "9+" : mentions}
          </span>
        ) : null}
        {unread > 0 ? (
          <span className="animate-badge-bounce grid h-[17px] min-w-[17px] place-items-center rounded-[9px] bg-accent-strong px-[5px] font-mono text-[9.5px] text-on-accent">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function ThreadGlyph({
  thread,
  principalNames,
}: {
  thread: ConversationThread;
  principalNames: Map<string, string>;
}) {
  if (thread.kind === "stand_in") {
    return (
      <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-accent-strong text-[10px] font-[650] text-on-accent">
        IR
      </span>
    );
  }
  if (thread.kind === "room") {
    return (
      <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-raise text-[10px] font-[650] text-ink-muted">
        #
      </span>
    );
  }
  if (thread.kind === "human_group") {
    return (
      <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-raise text-[10px] font-[650] text-ink-muted">
        ◇
      </span>
    );
  }
  const humanId = thread.participantIds.find(
    (id) => !thread.standInIds.includes(id),
  );
  const name = humanId ? principalNames.get(humanId) : undefined;
  return (
    <span
      className={
        humanId
          ? "grid h-[30px] w-[30px] place-items-center rounded-full text-[10px] font-[650] text-on-tint"
          : "grid h-[30px] w-[30px] place-items-center rounded-full bg-raise text-[10px] font-[650] text-ink-muted"
      }
      style={humanId ? { background: tintFor(humanId) } : undefined}
    >
      {initials(name)}
    </span>
  );
}

function ownerNameFor(
  thread: ConversationThread,
  principalNames: Map<string, string>,
): string {
  const humanId = thread.participantIds.find(
    (id) => !thread.standInIds.includes(id),
  );
  if (!humanId) return "—";
  return principalNames.get(humanId) ?? humanId.slice(0, 8);
}

function collectPrincipals(
  threadPayloads: ThreadPayload[],
  pulsePrincipals: PrincipalSummary[],
  bootstrapPrincipals: Array<PrincipalSummary | undefined>,
): PrincipalSummary[] {
  const byId = new Map<string, PrincipalSummary>();
  for (const principal of [
    ...threadPayloads.flatMap((item) => item.principals),
    ...pulsePrincipals,
    ...bootstrapPrincipals.filter(
      (item): item is PrincipalSummary => item !== undefined,
    ),
  ]) {
    byId.set(principal.id, principal);
  }
  return [...byId.values()].toSorted((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

function buildPrincipalNames(
  principals: PrincipalSummary[],
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const principal of principals) {
    counts.set(
      principal.displayName,
      (counts.get(principal.displayName) ?? 0) + 1,
    );
  }
  return new Map(
    principals.map((principal) => [
      principal.id,
      counts.get(principal.displayName) === 1
        ? principal.displayName
        : `${principal.displayName} · ${principal.id.slice(-4)}`,
    ]),
  );
}
