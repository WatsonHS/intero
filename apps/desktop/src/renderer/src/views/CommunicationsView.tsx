import {
  AddressBookIcon,
  ArrowUpIcon,
  ChatCircleDotsIcon,
  CircleNotchIcon,
  HashIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  RobotIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { ConversationThread } from "@intero/domain";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  Input,
  Textarea,
} from "@intero/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  createConversationThread,
  getBootstrap,
  getTeamPulse,
  getThreads,
  sendThreadMessage,
  type PrincipalSummary,
  type ThreadPayload,
} from "../api.js";
import { useI18n } from "../i18n/index.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";

const conversationGroups: Array<{
  kinds: ConversationThread["kind"][];
  label: TranslationKey;
}> = [
  { kinds: ["representative"], label: "chat.group.representative" },
  { kinds: ["human_group"], label: "chat.group.temporary" },
  { kinds: ["room"], label: "chat.group.rooms" },
  { kinds: ["human_direct"], label: "chat.group.direct" },
];

export function CommunicationsView() {
  const { formatRelative, formatTime, t } = useI18n();
  const queryClient = useQueryClient();
  const [selectedThreadId, setSelectedThreadId] = useState<string>();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [showDirectory, setShowDirectory] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newThreadTitle, setNewThreadTitle] = useState("");
  const [newThreadKind, setNewThreadKind] = useState<"human_group" | "room">(
    "human_group",
  );

  const threads = useQuery({
    queryKey: ["threads"],
    queryFn: ({ signal }) => getThreads(undefined, signal),
    refetchInterval: 3_000,
  });
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });
  const pulse = useQuery({
    queryKey: ["team-pulse"],
    queryFn: ({ signal }) => getTeamPulse(signal),
    refetchInterval: 30_000,
  });

  const items = threads.data?.items ?? [];
  const visibleItems = items.filter((item) => {
    if (
      !conversationGroups.some((group) =>
        group.kinds.includes(item.thread.kind),
      )
    ) {
      return false;
    }
    const query = search.trim().toLocaleLowerCase();
    if (!query) return true;
    return (
      item.thread.title.toLocaleLowerCase().includes(query) ||
      item.principals.some((principal) =>
        principal.displayName.toLocaleLowerCase().includes(query),
      )
    );
  });
  const current =
    visibleItems.find((item) => item.thread.id === selectedThreadId) ??
    visibleItems[0];
  const principals = collectPrincipals(items, pulse.data?.principals ?? [], [
    bootstrap.data?.currentPrincipal,
    bootstrap.data?.representativePrincipal,
  ]);
  const principalNames = buildPrincipalNames(principals);
  const currentSenderId = current
    ? current.thread.participantIds.some(
        (id) => id === bootstrap.data?.currentPrincipal.id,
      )
      ? bootstrap.data?.currentPrincipal.id
      : current.thread.participantIds.find(
          (id) => !current.thread.representativeIds.includes(id),
        )
    : undefined;

  const send = useMutation({
    mutationFn: sendThreadMessage,
    onSuccess: async () => {
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const identity = bootstrap.data;
      if (!identity) throw new Error("Identity is unavailable.");
      const representative =
        newThreadKind === "room" || newThreadKind === "human_group"
          ? [identity.representativePrincipal.id]
          : [];
      return createConversationThread({
        kind: newThreadKind,
        title:
          newThreadTitle.trim() ||
          (newThreadKind === "room"
            ? t("chat.defaultRoomTitle")
            : t("chat.defaultGroupTitle")),
        participantIds: [
          identity.currentPrincipal.id,
          identity.representativePrincipal.id,
        ],
        representativeIds: representative,
      });
    },
    onSuccess: async (thread) => {
      setNewThreadTitle("");
      setShowCreate(false);
      setShowDirectory(false);
      setSelectedThreadId(thread.id);
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });
  const createRepresentative = useMutation({
    mutationFn: async () => {
      const identity = bootstrap.data;
      if (!identity) throw new Error("Identity is unavailable.");
      return createConversationThread({
        kind: "representative",
        title: t("thread.yourRepresentative"),
        participantIds: [
          identity.currentPrincipal.id,
          identity.representativePrincipal.id,
        ],
        representativeIds: [identity.representativePrincipal.id],
      });
    },
    onSuccess: async (thread) => {
      setSelectedThreadId(thread.id);
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  function submit() {
    if (
      !current ||
      !currentSenderId ||
      !draft.trim() ||
      current.thread.accessMode === "human_only_e2ee" ||
      send.isPending
    ) {
      return;
    }
    send.mutate({
      threadId: current.thread.id,
      senderId: currentSenderId,
      body: draft.trim(),
    });
  }

  return (
    <div className="communications-view">
      <aside className="communications-sidebar">
        <header className="communications-sidebar__header">
          <div>
            <p className="eyebrow">{t("chat.eyebrow")}</p>
            <h1>{t("chat.title")}</h1>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant={showCreate ? "secondary" : "ghost"}
            aria-label={showCreate ? t("general.close") : t("chat.new")}
            onClick={() => setShowCreate((currentValue) => !currentValue)}
          >
            {showCreate ? <XIcon size={16} /> : <PlusIcon size={16} />}
          </Button>
        </header>

        <div className="communications-search">
          <MagnifyingGlassIcon size={14} aria-hidden="true" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("chat.search")}
            aria-label={t("chat.search")}
          />
        </div>

        <div className="communications-sidebar__tabs">
          <Button
            type="button"
            size="sm"
            variant={showDirectory ? "ghost" : "secondary"}
            onClick={() => setShowDirectory(false)}
          >
            <ChatCircleDotsIcon size={15} />
            {t("chat.recent")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={showDirectory ? "secondary" : "ghost"}
            onClick={() => setShowDirectory(true)}
          >
            <AddressBookIcon size={15} />
            {t("chat.directory")}
          </Button>
        </div>

        {showCreate ? (
          <Card className="communications-create gap-0">
            <div className="communications-create__kinds">
              <Button
                type="button"
                size="sm"
                variant={
                  newThreadKind === "human_group" ? "secondary" : "ghost"
                }
                onClick={() => setNewThreadKind("human_group")}
              >
                {t("chat.temporaryGroup")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={newThreadKind === "room" ? "secondary" : "ghost"}
                onClick={() => setNewThreadKind("room")}
              >
                {t("chat.projectRoom")}
              </Button>
            </div>
            <Input
              value={newThreadTitle}
              onChange={(event) => setNewThreadTitle(event.target.value)}
              placeholder={t("chat.threadTitle")}
              aria-label={t("chat.threadTitle")}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !create.isPending) {
                  event.preventDefault();
                  create.mutate();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={!bootstrap.data || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? (
                <CircleNotchIcon size={14} className="spin" />
              ) : (
                <PlusIcon size={14} />
              )}
              {t("chat.create")}
            </Button>
            {create.isError ? (
              <p className="composer-error">{t("chat.createFailed")}</p>
            ) : null}
          </Card>
        ) : null}

        <div className="communications-thread-list">
          {threads.isPending ? (
            <div className="communications-sidebar__state">
              <CircleNotchIcon size={18} className="spin" />
              <span>{t("chat.loading")}</span>
            </div>
          ) : null}
          {threads.isError ? (
            <div className="communications-sidebar__state">
              <span>{t("chat.unavailable")}</span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void threads.refetch()}
              >
                {t("general.retry")}
              </Button>
            </div>
          ) : null}
          {!threads.isPending && !threads.isError
            ? conversationGroups.map((group) => {
                const grouped = visibleItems.filter((item) =>
                  group.kinds.includes(item.thread.kind),
                );
                if (grouped.length === 0) return null;
                return (
                  <section
                    className="communications-thread-group"
                    key={group.label}
                  >
                    <h2>{t(group.label)}</h2>
                    {grouped.map((item) => (
                      <ThreadListItem
                        key={item.thread.id}
                        item={item}
                        active={
                          !showDirectory &&
                          current?.thread.id === item.thread.id
                        }
                        principalNames={principalNames}
                        formatRelative={formatRelative}
                        onSelect={() => {
                          setShowDirectory(false);
                          setSelectedThreadId(item.thread.id);
                        }}
                      />
                    ))}
                  </section>
                );
              })
            : null}
        </div>
      </aside>

      {showDirectory ? (
        <DirectoryPanel
          principals={principals}
          principalNames={principalNames}
          threads={items}
          onOpenThread={(threadId) => {
            setSelectedThreadId(threadId);
            setShowDirectory(false);
          }}
        />
      ) : current ? (
        <section className="communications-thread">
          <header className="communications-thread__header">
            <ThreadAvatar thread={current.thread} />
            <div>
              <p className="eyebrow">{t(threadKindKey(current.thread.kind))}</p>
              <h2>{current.thread.title}</h2>
            </div>
            <div className="communications-thread__status">
              <Badge variant="outline">
                {t("general.participants", {
                  count: current.thread.participantIds.length,
                })}
              </Badge>
              <span>
                {current.thread.accessMode === "human_only_e2ee"
                  ? t("thread.encrypted")
                  : t("thread.agentReadable")}
              </span>
            </div>
          </header>

          <div className="communications-messages">
            <div className="date-divider">
              <span>{t("general.today")}</span>
            </div>
            {current.messages.length === 0 ? (
              <div className="communications-empty">
                <ChatCircleDotsIcon size={24} />
                <h3>{t("chat.emptyThread")}</h3>
                <p>{t("chat.emptyThreadDetail")}</p>
              </div>
            ) : (
              current.messages.map((message) => {
                if (message.kind !== "message") {
                  return (
                    <div
                      className="communications-system-message"
                      key={message.id}
                    >
                      <LockSimpleIcon size={14} />
                      <span>{message.body || t("chat.accessChanged")}</span>
                      <time>{formatTime(message.createdAt)}</time>
                    </div>
                  );
                }
                const representative =
                  current.thread.representativeIds.includes(message.senderId);
                const senderName =
                  principalNames.get(message.senderId) ??
                  message.senderId.slice(0, 8);
                return (
                  <article
                    className={
                      representative
                        ? "communications-message communications-message--representative"
                        : "communications-message"
                    }
                    key={message.id}
                  >
                    <Avatar
                      className={
                        representative
                          ? "communications-message__avatar communications-message__avatar--representative"
                          : "communications-message__avatar"
                      }
                    >
                      <AvatarFallback>{initials(senderName)}</AvatarFallback>
                    </Avatar>
                    <div className="communications-message__content">
                      <header>
                        <strong>{senderName}</strong>
                        {representative ? (
                          <Badge variant="secondary">{t("chat.agent")}</Badge>
                        ) : null}
                        <time>{formatTime(message.createdAt)}</time>
                      </header>
                      <p>
                        {message.serverReadable
                          ? message.body
                          : t("thread.encryptedMessage")}
                      </p>
                      {representative ? (
                        <small>
                          <RobotIcon size={12} />
                          {t("chat.representativeBasis")}
                        </small>
                      ) : null}
                    </div>
                  </article>
                );
              })
            )}
          </div>

          <div className="communications-composer">
            <div className="communications-composer__meta">
              <LockSimpleIcon size={13} />
              <span>
                {current.thread.accessMode === "human_only_e2ee"
                  ? t("chat.encryptedComposerUnavailable")
                  : t("chat.sharedThread")}
              </span>
            </div>
            <div className="communications-composer__row">
              <Textarea
                rows={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder={t("chat.placeholder")}
                disabled={
                  !currentSenderId ||
                  current.thread.accessMode === "human_only_e2ee"
                }
              />
              <Button
                type="button"
                size="icon"
                aria-label={t("thread.send")}
                disabled={
                  !draft.trim() ||
                  !currentSenderId ||
                  current.thread.accessMode === "human_only_e2ee" ||
                  send.isPending
                }
                onClick={submit}
              >
                {send.isPending ? (
                  <CircleNotchIcon size={17} className="spin" />
                ) : (
                  <ArrowUpIcon size={17} weight="bold" />
                )}
              </Button>
            </div>
            {send.isError ? (
              <p className="composer-error">{t("thread.sendFailed")}</p>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="communications-welcome">
          <span className="representative-mark">
            <RobotIcon size={22} />
          </span>
          <p className="eyebrow">{t("chat.onePlace")}</p>
          <h2>{t("chat.emptyTitle")}</h2>
          <p>{t("chat.emptyDetail")}</p>
          <Button
            type="button"
            disabled={!bootstrap.data || createRepresentative.isPending}
            onClick={() => createRepresentative.mutate()}
          >
            {createRepresentative.isPending ? (
              <CircleNotchIcon size={16} className="spin" />
            ) : (
              <ChatCircleDotsIcon size={16} />
            )}
            {t("thread.startRepresentative")}
          </Button>
        </section>
      )}
    </div>
  );
}

function ThreadListItem({
  item,
  active,
  principalNames,
  formatRelative,
  onSelect,
}: {
  item: ThreadPayload;
  active: boolean;
  principalNames: Map<string, string>;
  formatRelative: (value: string) => string;
  onSelect: () => void;
}) {
  const lastMessage = item.messages.at(-1);
  const fallbackParticipant = item.thread.participantIds.find(
    (id) => !item.thread.representativeIds.includes(id),
  );
  return (
    <button
      type="button"
      className={
        active
          ? "communications-thread-item communications-thread-item--active"
          : "communications-thread-item"
      }
      onClick={onSelect}
    >
      <ThreadAvatar thread={item.thread} compact />
      <span className="communications-thread-item__body">
        <strong>{item.thread.title}</strong>
        <small>
          {lastMessage?.body ||
            (fallbackParticipant
              ? principalNames.get(fallbackParticipant)
              : undefined) ||
            "—"}
        </small>
      </span>
      <time>
        {lastMessage
          ? formatRelative(lastMessage.createdAt)
          : formatRelative(item.thread.createdAt)}
      </time>
    </button>
  );
}

function DirectoryPanel({
  principals,
  principalNames,
  threads,
  onOpenThread,
}: {
  principals: PrincipalSummary[];
  principalNames: Map<string, string>;
  threads: ThreadPayload[];
  onOpenThread: (threadId: string) => void;
}) {
  const { t } = useI18n();
  const people = principals.filter((principal) => principal.kind === "human");
  return (
    <section className="communications-directory">
      <header>
        <p className="eyebrow">{t("chat.peopleAndAgents")}</p>
        <h2>{t("chat.directoryTitle")}</h2>
        <p>{t("chat.directoryDetail")}</p>
      </header>
      <div className="communications-directory__grid">
        {people.map((person) => {
          const displayName =
            principalNames.get(person.id) ?? person.displayName;
          const existing = threads.find(
            (item) =>
              item.thread.kind === "human_direct" &&
              item.thread.participantIds.some((id) => id === person.id),
          );
          const representative = existing?.principals.find(
            (principal) => principal.kind === "representative",
          );
          return (
            <Card className="directory-person gap-0" key={person.id}>
              <Avatar className="directory-person__avatar">
                <AvatarFallback>{initials(displayName)}</AvatarFallback>
              </Avatar>
              <div>
                <strong>{displayName}</strong>
                <small>
                  {representative
                    ? t("chat.representativeNamed", {
                        name: representative.displayName,
                      })
                    : t("chat.noPublicRepresentative")}
                </small>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!existing}
                onClick={() => {
                  if (existing) onOpenThread(existing.thread.id);
                }}
              >
                {existing ? t("chat.openDirect") : t("chat.noDirectYet")}
              </Button>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function ThreadAvatar({
  thread,
  compact = false,
}: {
  thread: ConversationThread;
  compact?: boolean;
}) {
  const size = compact ? 17 : 21;
  if (thread.kind === "representative") {
    return (
      <span className="communications-thread-avatar communications-thread-avatar--representative">
        <RobotIcon size={size} />
      </span>
    );
  }
  if (thread.kind === "room") {
    return (
      <span className="communications-thread-avatar">
        <HashIcon size={size} />
      </span>
    );
  }
  return (
    <span className="communications-thread-avatar">
      <UsersThreeIcon size={size} />
    </span>
  );
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

function threadKindKey(kind: ConversationThread["kind"]): TranslationKey {
  if (kind === "representative") return "chat.kind.representative";
  if (kind === "room") return "chat.kind.room";
  if (kind === "human_direct") return "chat.kind.direct";
  if (kind === "human_group") return "chat.kind.group";
  return "chat.kind.structured";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts.at(-1)![0] ?? ""}`.toUpperCase();
}
