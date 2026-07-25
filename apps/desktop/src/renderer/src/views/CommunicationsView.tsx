import {
  ArrowUpIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  CloudArrowDownIcon,
  GitBranchIcon,
  HandTapIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import type { ConversationThread, ThreadMessage } from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  createConversationThread,
  getBootstrap,
  getOfflineStatus,
  getTeamPulse,
  getThreads,
  sendThreadMessage,
  type PrincipalSummary,
  type ThreadPayload,
} from "../api.js";
import { initials, tintFor } from "../design/utils.js";
import { useI18n } from "../i18n/index.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";

const THREAD_GROUPS: Array<{
  kind: ConversationThread["kind"];
  label: TranslationKey;
}> = [
  { kind: "representative", label: "chat.group.rep" },
  { kind: "human_group", label: "chat.group.temp" },
  { kind: "room", label: "chat.group.rooms" },
  { kind: "human_direct", label: "chat.group.direct" },
];
const RELEVANT_KINDS = new Set(THREAD_GROUPS.map((group) => group.kind));

export function CommunicationsView() {
  const { formatRelative, formatTime, t } = useI18n();
  const queryClient = useQueryClient();
  const [selectedThreadId, setSelectedThreadId] = useState<string>();
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newThreadTitle, setNewThreadTitle] = useState("");
  const [newThreadKind, setNewThreadKind] = useState<"human_group" | "room">(
    "human_group",
  );
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

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
  const offline = useQuery({
    queryKey: ["offline-status"],
    queryFn: ({ signal }) => getOfflineStatus(signal),
    refetchInterval: 5_000,
  });
  const offlinePublic = offline.data?.fallback === "public";
  const offlineTime = offline.data?.freshnessAt
    ? formatRelative(offline.data.freshnessAt)
    : t("general.unavailable");

  const allItems = threads.data?.items ?? [];
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
  const principals = collectPrincipals(allItems, pulse.data?.principals ?? [], [
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
        representativeIds: [identity.representativePrincipal.id],
      });
    },
    onSuccess: async (thread) => {
      setNewThreadTitle("");
      setShowCreate(false);
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
        title: t("chat.group.rep"),
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

    const isRepresentative = thread.representativeIds.includes(
      message.senderId,
    );
    const senderName =
      principalNames.get(message.senderId) ?? message.senderId.slice(0, 8);

    if (isRepresentative) {
      const ownerName = ownerNameFor(thread, principalNames);
      const isOpen = expanded.has(message.id);
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
              <span
                className={
                  offlinePublic
                    ? "font-mono text-[9.5px] text-amber"
                    : "font-mono text-[9.5px] text-green"
                }
              >
                {offlinePublic
                  ? t("chat.public", { time: offlineTime })
                  : t("chat.local")}
              </span>
              <time className="ml-auto font-mono text-[9.5px] text-faint">
                {formatTime(message.createdAt)}
              </time>
            </div>
            <p className="text-[13px] leading-[1.75] text-ink [text-wrap:pretty]">
              {message.serverReadable
                ? message.body
                : t("chat.encryptedMessage")}
            </p>
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
              <p className="mt-[11px] rounded-[10px] bg-raise p-[12px_14px] font-mono text-[11.5px] leading-[1.7] text-ink-muted">
                seq {message.sequence} · {thread.accessMode}
              </p>
            ) : null}
          </div>
        </div>
      );
    }

    const isOwn = message.senderId === bootstrap.data?.currentPrincipal.id;
    return (
      <div className="grid grid-cols-[30px_minmax(0,1fr)] gap-3">
        <span
          className="grid h-[30px] w-[30px] place-items-center rounded-full text-[9.5px] font-[650] text-on-tint"
          style={{ background: tintFor(message.senderId) }}
        >
          {initials(senderName)}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-[9px]">
            <strong className="text-[12px] font-[620]">{senderName}</strong>
            <time className="font-mono text-[9.5px] text-faint">
              {formatTime(message.createdAt)}
            </time>
          </div>
          <p
            className={
              isOwn
                ? "mt-[7px] max-w-[560px] rounded-card bg-accent-soft p-[12px_15px] text-[13px] leading-[1.7] text-ink [text-wrap:pretty]"
                : "mt-[7px] max-w-[560px] rounded-card bg-bubble p-[12px_15px] text-[13px] leading-[1.7] text-ink [text-wrap:pretty]"
            }
          >
            {message.serverReadable ? message.body : t("chat.encryptedMessage")}
          </p>
        </div>
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
          <div className="mx-2.5 mb-3 flex flex-col gap-2 rounded-[13px] border border-line2 bg-panel2 p-3">
            <div className="flex gap-1.5">
              <button
                type="button"
                className={
                  newThreadKind === "human_group"
                    ? "rounded-pill bg-accent-soft px-[9px] py-[3px] text-[10px] font-[600] text-accent-strong cursor-pointer"
                    : "rounded-pill bg-raise px-[9px] py-[3px] text-[10px] font-[600] text-ink-muted cursor-pointer"
                }
                onClick={() => setNewThreadKind("human_group")}
              >
                {t("chat.temporaryGroup")}
              </button>
              <button
                type="button"
                className={
                  newThreadKind === "room"
                    ? "rounded-pill bg-accent-soft px-[9px] py-[3px] text-[10px] font-[600] text-accent-strong cursor-pointer"
                    : "rounded-pill bg-raise px-[9px] py-[3px] text-[10px] font-[600] text-ink-muted cursor-pointer"
                }
                onClick={() => setNewThreadKind("room")}
              >
                {t("chat.room")}
              </button>
            </div>
            <input
              value={newThreadTitle}
              onChange={(event) => setNewThreadTitle(event.target.value)}
              placeholder={t("chat.threadTitle")}
              aria-label={t("chat.threadTitle")}
              className="h-8 w-full rounded-[9px] border border-line2 bg-transparent px-2.5 text-[12px] outline-none placeholder:text-faint"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !create.isPending) {
                  event.preventDefault();
                  create.mutate();
                }
              }}
            />
            <button
              type="button"
              disabled={!bootstrap.data || create.isPending}
              onClick={() => create.mutate()}
              className="inline-flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-btn border-0 bg-accent-strong px-3.5 text-[12.5px] font-[620] text-on-accent disabled:opacity-55"
            >
              {create.isPending ? (
                <CircleNotchIcon size={14} className="animate-spin" />
              ) : (
                <PlusIcon size={14} />
              )}
              {t("chat.create")}
            </button>
            {create.isError ? (
              <p className="text-[11px] text-danger">{t("chat.createFailed")}</p>
            ) : null}
          </div>
        ) : null}

        {threads.isPending ? (
          <div className="flex items-center gap-2 px-2.5 py-4 text-[12px] text-ink-muted">
            <CircleNotchIcon size={18} className="animate-spin" />
            <span>{t("chat.loading")}</span>
          </div>
        ) : null}
        {threads.isError ? (
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

        {!threads.isPending && !threads.isError ? (
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
                        formatRelative={formatRelative}
                        t={t}
                        onSelect={() => setSelectedThreadId(item.thread.id)}
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
          <header className="flex items-center gap-[13px] border-b border-line p-[18px_26px]">
            <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-accent-soft text-[12px] font-[650] text-accent-strong">
              {initials(current.thread.title)}
            </span>
            <span className="grid min-w-0">
              <strong className="truncate text-[14.5px] font-[620] tracking-[-0.015em]">
                {current.thread.title}
              </strong>
              <small className="mt-[3px] truncate text-[11px] text-ink-muted">
                {t("chat.subPeopleReps", {
                  people: current.thread.participantIds.length,
                  reps: current.thread.representativeIds.length,
                })}
              </small>
            </span>
          </header>

          <div className="overflow-auto p-[22px_26px_30px]">
            <div className="mx-auto flex max-w-[800px] flex-col gap-4">
              {offlinePublic ? (
                <div className="flex items-center gap-[11px] rounded-[13px] border border-amber-soft bg-amber-soft p-[13px_16px]">
                  <CloudArrowDownIcon size={17} className="text-amber" />
                  <span className="text-[12px] leading-[1.6] text-ink [text-wrap:pretty]">
                    {t("chat.offlineBanner", { time: offlineTime })}
                  </span>
                </div>
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
            </div>
          </div>

          <div className="p-[0_26px_22px]">
            <div className="mx-auto max-w-[800px]">
              <div className="rounded-card border border-line2 bg-panel2 p-[11px_13px]">
                <div className="mb-[9px] flex items-center gap-[7px]">
                  {current.thread.representativeIds.map((repId, index) => {
                    const name = principalNames.get(repId) ?? repId.slice(0, 8);
                    return (
                      <button
                        type="button"
                        key={repId}
                        className={
                          index === 0
                            ? "rounded-pill bg-accent-soft px-[9px] py-[3px] text-[10px] text-accent-strong cursor-pointer"
                            : "rounded-pill bg-raise px-[9px] py-[3px] text-[10px] text-ink-muted cursor-pointer"
                        }
                        onClick={() =>
                          setDraft((prevDraft) => `${prevDraft}@${name} `)
                        }
                      >
                        @{name}
                      </button>
                    );
                  })}
                  <span className="ml-auto inline-flex items-center gap-[5px] text-[10px] text-faint">
                    <LockSimpleIcon size={12} />
                    {current.thread.accessMode === "human_only_e2ee"
                      ? t("chat.e2ee")
                      : offlinePublic
                        ? t("chat.hintOffline")
                        : t("chat.hint")}
                  </span>
                </div>
                <div className="grid grid-cols-[1fr_34px] items-end gap-[9px]">
                  <textarea
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
                    className="min-h-[34px] max-h-[110px] resize-none border-0 bg-transparent px-1 py-2 text-[12.5px] leading-[1.55] outline-none placeholder:text-faint"
                  />
                  <button
                    type="button"
                    disabled={
                      !draft.trim() ||
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
              {send.isError ? (
                <p className="mt-2 text-[11px] text-danger">
                  {t("chat.sendFailed")}
                </p>
              ) : null}
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
              disabled={!bootstrap.data || createRepresentative.isPending}
              onClick={() => createRepresentative.mutate()}
              className="mt-1 inline-flex h-[34px] cursor-pointer items-center justify-center gap-1.5 rounded-btn border-0 bg-accent-strong px-3.5 text-[12.5px] font-[620] text-on-accent disabled:opacity-55"
            >
              {createRepresentative.isPending ? (
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

function SidebarThreadItem({
  item,
  active,
  principalNames,
  formatRelative,
  t,
  onSelect,
}: {
  item: ThreadPayload;
  active: boolean;
  principalNames: Map<string, string>;
  formatRelative: (value: string) => string;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  onSelect: () => void;
}) {
  const lastMessage = item.messages.at(-1);
  const preview = lastMessage
    ? lastMessage.serverReadable
      ? lastMessage.body
      : t("chat.encryptedMessage")
    : "—";
  const time = formatRelative(lastMessage?.createdAt ?? item.thread.createdAt);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        active
          ? "grid w-full grid-cols-[30px_minmax(0,1fr)_auto] items-start gap-[11px] rounded-[11px] border-0 bg-sel p-[10px_11px] text-left cursor-pointer"
          : "grid w-full grid-cols-[30px_minmax(0,1fr)_auto] items-start gap-[11px] rounded-[11px] border-0 bg-transparent p-[10px_11px] text-left cursor-pointer hover:bg-hover-wash"
      }
    >
      <ThreadGlyph thread={item.thread} principalNames={principalNames} />
      <span className="grid min-w-0 gap-[3px]">
        <span className="truncate text-[12.5px] font-[570]">
          {item.thread.title}
        </span>
        <span className="truncate text-[11px] text-ink-muted">{preview}</span>
      </span>
      <time className="self-start font-mono text-[9.5px] text-faint">
        {time}
      </time>
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
  if (thread.kind === "representative") {
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
    (id) => !thread.representativeIds.includes(id),
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
    (id) => !thread.representativeIds.includes(id),
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
