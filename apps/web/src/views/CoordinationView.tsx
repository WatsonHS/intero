import {
  ChatCircleDotsIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  HandTapIcon,
} from "@phosphor-icons/react";
import type { PilotCoordinationThread, PrincipalId } from "@intero/domain";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { ThreadPayload } from "../api.js";
import {
  getBootstrap,
  getProjectAutomation,
  getTeamPulse,
  getThreads,
  revertProjectAutomationSignal,
} from "../api.js";
import {
  Avatar,
  AvatarPair,
  EmptySlot,
  FilterChip,
  ListPane,
  ListRow,
  LoadMore,
  Meta,
  SectionLabel,
  StatusPill,
  Timeline,
  TimelineEntry,
} from "../design/primitives.js";
import type { Tone } from "../design/utils.js";
import { useI18n } from "../i18n/index.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";
import {
  pilotCoordinationTitle,
  pilotCoordinationToThreadPayload,
} from "../pilot/adapters.js";
import {
  confirmPilotConclusion,
  getPilotOverview,
  proposePilotConclusion,
  updatePilotCoordinationRelevance,
} from "../pilot/api.js";
import { usePilotOptional } from "../pilot/context.js";

type BranchState = "open" | "needs_confirmation" | "resolved";

const STATE_TONE: Record<BranchState, Tone> = {
  open: "amber",
  needs_confirmation: "danger",
  resolved: "green",
};

const FILTERS: Array<{ id: BranchState | "all"; label: TranslationKey }> = [
  { id: "all", label: "general.all" },
  { id: "open", label: "coord.state.open" },
  { id: "needs_confirmation", label: "coord.state.needs_confirmation" },
  { id: "resolved", label: "coord.state.resolved" },
];

const PAGE_SIZE = 8;

export function CoordinationView({
  initialThreadId,
  onSelectThread,
  onOpenThread,
}: {
  initialThreadId?: string | undefined;
  onSelectThread?: (threadId: string) => void;
  onOpenThread: () => void;
}) {
  const pilot = usePilotOptional();
  const queryClient = useQueryClient();
  const { formatRelative, formatTime, t } = useI18n();
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>(
    initialThreadId,
  );
  const [filter, setFilter] = useState<BranchState | "all">("all");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [conclusion, setConclusion] = useState("");
  const [responsibleId, setResponsibleId] = useState<PrincipalId>();
  const pilotProject =
    pilot?.projects.data?.projects.find(
      (project) => project.id === pilot.selectedProjectId,
    ) ?? pilot?.projects.data?.projects[0];
  const accessibleProjects = pilot?.projects.data?.projects ?? [];
  const threads = useQuery({
    queryKey: ["threads", "coordination"],
    queryFn: ({ signal }) => getThreads("coordination", signal),
    refetchOnWindowFocus: true,
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
  const pilotOverviews = useQueries({
    queries: accessibleProjects.map((project) => ({
      queryKey: ["pilot", "overview", pilot?.identityId, project.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getPilotOverview(pilot!.identityId!, project.id, signal),
      enabled: Boolean(pilot?.enabled && pilot.identityId),
      refetchOnWindowFocus: true,
    })),
  });

  const pilotPrincipals = [
    ...new Map(
      pilotOverviews
        .flatMap((overview) => overview.data?.principals ?? [])
        .map((principal) => [principal.id, principal]),
    ).values(),
  ];
  const pilotThreads = [
    ...new Map(
      pilotOverviews
        .flatMap((overview) => overview.data?.coordination ?? [])
        .map((thread) => [thread.id, thread]),
    ).values(),
  ];
  const pilotThreadById = new Map(
    pilotThreads.flatMap((thread) => [
      [thread.id, thread] as const,
      ...(thread.conversationThreadId
        ? ([[thread.conversationThreadId, thread]] as const)
        : []),
    ]),
  );
  const coordinationRelevance = pilotOverviews.flatMap(
    (overview) => overview.data?.coordinationRelevance ?? [],
  );
  const projectNames = new Map(
    pilot?.projects.data?.projects.map((project) => [
      project.id,
      project.name,
    ]) ?? [],
  );
  function projectNameOf(thread: PilotCoordinationThread | undefined): string {
    if (!thread) return t("coord.projectUnbound");
    return (
      projectNames.get(thread.projectId) ??
      `Project · ${thread.projectId.slice(0, 8)}`
    );
  }
  const pilotItems = pilotThreads
    .filter((thread) => !thread.conversationThreadId)
    .map((thread) =>
      pilotCoordinationToThreadPayload(
        thread,
        pilotPrincipals,
        pilot?.bootstrap.data?.standIn,
      ),
    );
  const items = [
    ...new Map(
      [...(threads.data?.items ?? []), ...pilotItems].map((item) => [
        item.thread.id,
        item,
      ]),
    ).values(),
  ];
  const filtered = items.filter(
    (item) =>
      filter === "all" ||
      branchState(item, pilotThreadById.get(item.thread.id)) === filter,
  );
  const visible = filtered.slice(0, shown);
  const selected = selectedThreadId
    ? items.find((item) => item.thread.id === selectedThreadId)
    : undefined;
  const selectedRecordMissing = Boolean(selectedThreadId && !selected);
  const current = selectedRecordMissing
    ? undefined
    : (filtered.find((item) => item.thread.id === selectedThreadId) ??
      filtered[0] ??
      selected ??
      items[0]);
  const currentPilotThread = current
    ? pilotThreadById.get(current.thread.id)
    : undefined;
  const currentProjectId = currentPilotThread?.projectId ?? pilotProject?.id;
  const currentRelevance = currentPilotThread
    ? coordinationRelevance.find(
        (item) =>
          item.coordinationThreadId === currentPilotThread.id &&
          item.principalId === pilot?.identityId,
      )
    : undefined;
  const automation = useQuery({
    queryKey: ["project-automation", currentProjectId],
    queryFn: ({ signal }) => getProjectAutomation(currentProjectId!, signal),
    enabled: Boolean(currentProjectId),
    refetchOnWindowFocus: true,
  });
  const currentAutomation = current
    ? automation.data?.signals.find(
        ({ signal }) => signal.coordinationThreadId === current.thread.id,
      )
    : undefined;

  const principalNames = new Map<string, string>();
  for (const principal of pulse.data?.principals ?? []) {
    principalNames.set(principal.id, principal.displayName);
  }
  for (const principal of current?.principals ?? []) {
    principalNames.set(principal.id, principal.displayName);
  }
  for (const principal of pilotPrincipals) {
    principalNames.set(principal.id, principal.displayName);
  }
  if (bootstrap.data) {
    principalNames.set(
      bootstrap.data.currentPrincipal.id,
      bootstrap.data.currentPrincipal.displayName,
    );
    principalNames.set(
      bootstrap.data.standInPrincipal.id,
      bootstrap.data.standInPrincipal.displayName,
    );
  }
  function nameOf(id: string): string {
    return principalNames.get(id) ?? id.slice(0, 8);
  }

  useEffect(() => {
    if (initialThreadId) setSelectedThreadId(initialThreadId);
  }, [initialThreadId]);

  useEffect(() => {
    if (!currentPilotThread) return;
    setConclusion(currentPilotThread.conclusion ?? "");
    setResponsibleId(
      currentPilotThread.responsibleParticipantId ??
        currentPilotThread.participantIds[0],
    );
  }, [
    currentPilotThread?.id,
    currentPilotThread?.conclusion,
    currentPilotThread?.responsibleParticipantId,
  ]);

  const invalidatePilot = async () => {
    await queryClient.invalidateQueries({ queryKey: ["pilot", "overview"] });
  };
  const propose = useMutation({
    mutationFn: () =>
      proposePilotConclusion(pilot!.identityId!, currentPilotThread!.id, {
        conclusion: conclusion.trim(),
        responsibleParticipantId: responsibleId!,
      }),
    onSuccess: invalidatePilot,
  });
  const confirm = useMutation({
    mutationFn: () =>
      confirmPilotConclusion(pilot!.identityId!, currentPilotThread!.id),
    onSuccess: invalidatePilot,
  });
  const revisit = useMutation({
    mutationFn: () =>
      updatePilotCoordinationRelevance(
        pilot!.identityId!,
        currentPilotThread!.id,
        "revisit",
      ),
    onSuccess: invalidatePilot,
  });
  const revertAutomation = useMutation({
    mutationFn: () =>
      revertProjectAutomationSignal(
        pilotProject!.id,
        currentAutomation!.signal.id,
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["project-automation", pilotProject?.id],
        }),
        queryClient.invalidateQueries({ queryKey: ["pilot", "overview"] }),
        queryClient.invalidateQueries({ queryKey: ["action-inbox"] }),
      ]);
    },
  });

  const pilotOverviewsLoading =
    Boolean(pilot?.enabled && pilot.projects.isLoading) ||
    pilotOverviews.some((overview) => overview.isLoading);
  const pilotOverviewsUnavailable =
    pilotOverviews.length > 0 &&
    pilotOverviews.every((overview) => overview.isError);

  if (threads.isLoading || pilotOverviewsLoading) {
    return (
      <div className="animate-view-enter grid h-full place-items-center p-[34px]">
        <p className="text-[13px] text-ink-muted">{t("general.loading")}</p>
      </div>
    );
  }

  if (threads.isError && pilotOverviewsUnavailable) {
    return (
      <div className="animate-view-enter grid h-full place-items-center p-[34px]">
        <div className="grid justify-items-center gap-3 text-center">
          <strong className="text-[15px] font-[600] text-ink">
            {t("general.unavailable")}
          </strong>
          <button
            type="button"
            className="h-[34px] cursor-pointer rounded-btn border border-line2 bg-transparent px-3.5 text-[12.5px] text-ink hover:border-accent-strong"
            onClick={() => void threads.refetch()}
          >
            {t("general.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (selectedRecordMissing) {
    return (
      <div
        className="animate-view-enter grid h-full place-items-center p-[34px]"
        data-testid="coordination-degraded-record"
      >
        <div className="max-w-[500px] rounded-container border border-amber-soft bg-amber-soft p-6 text-center">
          <strong className="text-[16px] font-[630] text-amber">
            这条协调记录无法完整读取
          </strong>
          <p className="mt-2 text-[12px] leading-[1.7] text-ink-muted">
            链接指向旧版、已迁移或你已失去访问权限的记录。Intero 不会用另一条
            Thread 冒充它，也不会显示空白详情。
          </p>
          <p className="mt-2 font-mono text-[10px] text-amber">
            COORDINATION_RECORD_UNAVAILABLE · {selectedThreadId}
          </p>
          <button
            type="button"
            onClick={onOpenThread}
            className="mt-4 h-9 rounded-btn border border-amber px-4 text-[11.5px] text-amber"
          >
            返回可访问的通讯记录
          </button>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="animate-view-enter grid h-full place-items-center p-[34px]">
        <div className="grid max-w-[440px] justify-items-center gap-2.5 rounded-container border border-dashed border-line2 px-[44px] py-[54px] text-center">
          <strong className="text-[19px] font-[600] text-ink">
            {t("coord.empty.title")}
          </strong>
          <p className="text-[13px] leading-[1.6] text-ink-muted">
            {t("coord.empty.body")}
          </p>
        </div>
      </div>
    );
  }

  // The aside's scope-ownership map: union of resourceScope per envelope actor,
  // drawn from the thread's resolved coordination actions.
  const scopesByActor = new Map<string, Set<string>>();
  for (const { envelope } of current.actions) {
    const scopes = scopesByActor.get(envelope.actorId) ?? new Set<string>();
    for (const scope of envelope.resourceScope) scopes.add(scope);
    scopesByActor.set(envelope.actorId, scopes);
  }
  const scopeOwnerCount = new Map<string, number>();
  for (const scopes of scopesByActor.values()) {
    for (const scope of scopes) {
      scopeOwnerCount.set(scope, (scopeOwnerCount.get(scope) ?? 0) + 1);
    }
  }
  const contestedScopes = [...scopeOwnerCount.entries()]
    .filter(([, count]) => count >= 2)
    .map(([scope]) => scope);
  const grantedActions = new Set<string>();
  for (const { envelope } of current.actions) {
    for (const action of envelope.requestedActions) grantedActions.add(action);
  }

  // The last coordination_action message that has a matching resolved action is
  // the terminal, resolved node in the timeline.
  let lastResolvedIndex = -1;
  current.messages.forEach((message, index) => {
    if (
      message.kind === "coordination_action" &&
      current.actions.some(
        (item) => item.envelope.operationId === message.operationId,
      )
    ) {
      lastResolvedIndex = index;
    }
  });

  const currentState = branchState(current, currentPilotThread);

  return (
    <div className="animate-view-enter grid h-full grid-cols-[312px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
      <ListPane
        title={t("coord.branches")}
        count={`${filtered.length} / ${items.length}`}
        lede={t("coord.branchesLede")}
        filters={FILTERS.map((option) => (
          <FilterChip
            key={option.id}
            active={filter === option.id}
            onClick={() => {
              setFilter(option.id);
              setShown(PAGE_SIZE);
            }}
          >
            {t(option.label)}
          </FilterChip>
        ))}
        onScroll={(event) => {
          const element = event.currentTarget;
          if (
            element.scrollTop + element.clientHeight >
            element.scrollHeight - 80
          ) {
            setShown((count) => Math.min(count + PAGE_SIZE, filtered.length));
          }
        }}
        footer={
          <>
            {shown < filtered.length ? (
              <LoadMore
                onClick={() =>
                  setShown((count) =>
                    Math.min(count + PAGE_SIZE, filtered.length),
                  )
                }
                label={t("general.loadMore")}
              />
            ) : null}
            <span className="ml-auto font-mono text-[10px] text-faint">
              {t("general.showingOf", {
                shown: visible.length,
                total: filtered.length,
              })}
            </span>
          </>
        }
      >
        {visible.map((item) => {
          const pilotThread = pilotThreadById.get(item.thread.id);
          const state = branchState(item, pilotThread);
          const [first, second] = item.thread.participantIds;
          return (
            <ListRow
              key={item.thread.id}
              selected={item.thread.id === current.thread.id}
              onClick={() => {
                setSelectedThreadId(item.thread.id);
                onSelectThread?.(item.thread.id);
              }}
              {...(pilotThread
                ? { testId: `pilot-coordination-thread-${pilotThread.id}` }
                : {})}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Meta>{item.thread.id.slice(0, 8)}</Meta>
                <StatusPill tone={STATE_TONE[state]} size="sm">
                  {t(`coord.state.${state}` as TranslationKey)}
                </StatusPill>
                <Meta className="ml-auto text-[9px]">
                  {formatRelative(
                    pilotThread?.updatedAt ?? item.thread.createdAt,
                  )}
                </Meta>
              </span>
              <span className="text-[12.5px] font-[560] leading-[1.4] [text-wrap:pretty]">
                {item.thread.title}
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <Meta
                  tone={pilotThread ? "muted" : "faint"}
                  className="max-w-[112px] shrink-0 truncate rounded-pill bg-raise px-1.5 py-0.5 text-[9px]"
                >
                  {projectNameOf(pilotThread)}
                </Meta>
                {first && second ? (
                  <AvatarPair
                    left={{ id: first, name: nameOf(first) }}
                    right={{ id: second, name: nameOf(second) }}
                  />
                ) : first ? (
                  <Avatar id={first} name={nameOf(first)} size="xs" />
                ) : null}
                <span className="min-w-0 truncate text-[10px] text-faint">
                  {item.thread.participantIds.map(nameOf).join(", ")}
                </span>
              </span>
            </ListRow>
          );
        })}
        {filtered.length === 0 ? (
          <div className="mx-0.5 my-2.5">
            <EmptySlot>{t("coord.noneInFilter")}</EmptySlot>
          </div>
        ) : null}
      </ListPane>

      <div className="h-full overflow-auto px-[34px] pb-[60px] pt-[30px]">
        <div className="flex items-center gap-2.5">
          <Meta className="text-[10.5px]">{current.thread.id.slice(0, 8)}</Meta>
          <Meta
            tone={currentPilotThread ? "muted" : "faint"}
            className="max-w-[180px] truncate rounded-pill bg-raise px-2 py-1 text-[9.5px]"
          >
            {projectNameOf(currentPilotThread)}
          </Meta>
          <StatusPill tone={STATE_TONE[currentState]}>
            {t(`coord.state.${currentState}` as TranslationKey)}
          </StatusPill>
          <span className="text-[11px] text-faint">
            {currentPilotThread
              ? pilotCoordinationTitle(currentPilotThread.trigger)
              : t("coord.eyebrow")}{" "}
            · {formatRelative(current.thread.createdAt)}
          </span>
          <button
            type="button"
            onClick={onOpenThread}
            className="ml-auto inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] text-ink hover:border-accent-strong hover:text-accent-strong"
          >
            <ChatCircleDotsIcon size={13} />
            {t("coord.openThread")}
          </button>
        </div>
        <h1 className="mt-3 text-[26px] font-[540] tracking-[-0.035em] text-ink">
          {current.thread.title}
        </h1>
        <p className="mt-3 max-w-[620px] text-[13px] leading-[1.75] text-ink-muted [text-wrap:pretty]">
          {t("coord.lede")}
        </p>
        {currentRelevance?.dismissedAt || currentRelevance?.mutedAt ? (
          <button
            type="button"
            disabled={revisit.isPending}
            onClick={() => revisit.mutate()}
            className="mt-3 inline-flex h-8 cursor-pointer items-center rounded-btn border border-line2 bg-panel2 px-3 text-[11px] text-ink-muted hover:border-accent-strong hover:text-accent-strong disabled:opacity-45"
          >
            {t("chat.coordination.revisit")}
          </button>
        ) : null}

        {!currentPilotThread ? (
          <div
            className="mt-4 max-w-[660px] rounded-card border border-amber-soft bg-amber-soft px-4 py-3 text-[11px] leading-[1.65] text-amber"
            data-testid="coordination-legacy-detail"
          >
            这是旧版 Coordination 记录。历史消息与已解析 action
            仍可查看，但缺少当前
            Project、候选步骤或确认状态时将保持只读，不会推断补齐。
            <span className="ml-1 font-mono">COORDINATION_LEGACY_RECORD</span>
          </div>
        ) : currentPilotThread.participantIds.length === 0 ||
          !currentPilotThread.safeContext.trim() ? (
          <div
            className="mt-4 max-w-[660px] rounded-card border border-amber-soft bg-amber-soft px-4 py-3 text-[11px] leading-[1.65] text-amber"
            data-testid="coordination-incomplete-detail"
          >
            这条记录尚未完成迁移：参与者或安全上下文缺失。确认操作已暂停，请先从原始
            Thread 恢复信息。
            <span className="ml-1 font-mono">
              COORDINATION_PARTIAL_MIGRATION
            </span>
          </div>
        ) : null}

        {currentAutomation ? (
          <section
            className="mt-5 max-w-[660px] rounded-[13px] border border-accent-soft bg-accent-soft px-4 py-[15px]"
            data-testid="automation-coordination-context"
          >
            <div className="flex items-center gap-2">
              <span className="rounded-pill bg-panel2 px-2.5 py-1 text-[10px] font-[650] text-accent-strong">
                {t("general.standIn")} · {currentAutomation.signal.kind}
              </span>
              <Meta className="ml-auto text-[9.5px]">
                {formatRelative(currentAutomation.signal.detectedAt)}
              </Meta>
            </div>
            <p className="mt-3 text-[12.5px] leading-[1.7] text-ink [text-wrap:pretty]">
              {currentAutomation.signal.safeContext}
            </p>
            <div className="mt-3 grid gap-1.5">
              {currentAutomation.signal.candidateNextSteps.map(
                (step, index) => (
                  <p
                    key={`${currentAutomation.signal.id}-${index}`}
                    className="text-[11.5px] leading-[1.6] text-ink-muted"
                  >
                    {index + 1}. {step}
                  </p>
                ),
              )}
            </div>
            <details className="mt-3 border-t border-line pt-3">
              <summary className="cursor-pointer text-[10.5px] text-faint">
                {t("coord.automationAudit")}
              </summary>
              <div className="mt-2 grid gap-1">
                {currentAutomation.audit.map((entry) => (
                  <p
                    key={entry.id}
                    className="font-mono text-[9.5px] leading-[1.55] text-faint"
                  >
                    {entry.action} · {formatTime(entry.createdAt)} ·{" "}
                    {entry.detail}
                  </p>
                ))}
              </div>
            </details>
            {automation.data?.canManage &&
            currentAutomation.signal.status !== "reverted" ? (
              <button
                type="button"
                data-testid="automation-coordination-revert"
                disabled={revertAutomation.isPending}
                onClick={() => revertAutomation.mutate()}
                className="mt-3 h-8 rounded-btn border border-line2 bg-panel2 px-3 text-[11px] text-ink-muted hover:border-danger hover:text-danger disabled:opacity-45"
              >
                {t("coord.automationRevert")}
              </button>
            ) : null}
          </section>
        ) : null}

        {scopesByActor.size > 0 ? (
          <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-2.5">
            {[...scopesByActor.entries()].map(([actorId, scopes]) => (
              <div
                key={actorId}
                className="rounded-[13px] border border-line bg-panel2 px-4 py-[15px]"
              >
                <div className="flex items-center gap-[9px]">
                  <Avatar id={actorId} name={nameOf(actorId)} size="md" />
                  <strong className="text-[12px] font-[620]">
                    {t("coord.owns", { name: nameOf(actorId) })}
                  </strong>
                </div>
                <div className="mt-3 grid gap-1.5">
                  {[...scopes].map((scope) => (
                    <div
                      key={scope}
                      className="rounded-quiet bg-raise px-[11px] py-2 font-mono text-[10.5px] text-ink-muted"
                    >
                      {scope}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {contestedScopes.length > 0 ? (
          <div className="mt-2.5 rounded-[13px] border border-dashed border-danger bg-danger-soft px-4 py-[15px]">
            <SectionLabel className="text-danger">
              {t("coord.contested")}
            </SectionLabel>
            <p className="mt-[9px] text-[12px] leading-[1.65] text-ink [text-wrap:pretty]">
              {t("coord.contestedBody")}{" "}
              <span className="font-mono">{contestedScopes.join(", ")}</span>
            </p>
          </div>
        ) : null}

        <Timeline className="mt-[30px]">
          {current.messages.map((message, index) => {
            const action =
              message.kind === "coordination_action"
                ? current.actions.find(
                    (item) => item.envelope.operationId === message.operationId,
                  )
                : undefined;
            const envelope = action?.envelope;
            const isHumanEscalation = envelope?.action === "human_escalation";
            const isLastResolved = index === lastResolvedIndex;
            const tone: Tone = isLastResolved
              ? "green"
              : isHumanEscalation
                ? "danger"
                : "cool";
            const tagText = envelope
              ? t(`coord.action.${envelope.action}` as TranslationKey)
              : nameOf(message.senderId);
            const who = envelope
              ? nameOf(envelope.actorId)
              : nameOf(message.senderId);
            const body = envelope?.humanMessage ?? message.body;
            const meta = envelope
              ? t("coord.meta", {
                  policy: envelope.policyVersion,
                  sequence: message.sequence,
                })
              : `seq ${message.sequence}`;

            return (
              <TimelineEntry key={message.id} tone={tone}>
                <div className="flex items-center gap-2.5">
                  <span
                    className={`text-[10px] font-[700] tracking-[0.08em] ${
                      isLastResolved
                        ? "text-green"
                        : isHumanEscalation
                          ? "text-danger"
                          : "text-ink-muted"
                    }`}
                  >
                    {tagText}
                  </span>
                  <span className="text-[11.5px] text-ink-muted">{who}</span>
                  <time className="ml-auto font-mono text-[9.5px] text-faint">
                    {formatTime(message.createdAt)}
                  </time>
                </div>
                <p className="mt-[9px] max-w-[620px] text-[13px] leading-[1.75] text-ink [text-wrap:pretty]">
                  {body}
                </p>
                <Meta className="mt-2 block text-[9.5px]">{meta}</Meta>
                {isHumanEscalation ? (
                  action ? (
                    <div className="mt-[13px] inline-flex items-center gap-2 rounded-btn bg-green-soft px-[13px] py-[9px] text-[12px] text-green">
                      <CheckCircleIcon size={14} weight="fill" />
                      {t("coord.resolved")}
                    </div>
                  ) : (
                    <p className="mt-[13px] text-[12px] text-danger">
                      {t("coord.decisionNote")}
                    </p>
                  )
                ) : null}
              </TimelineEntry>
            );
          })}
        </Timeline>

        {currentPilotThread?.status === "open" ? (
          <section className="mt-5 max-w-[660px] rounded-card border border-line bg-panel2 px-5 py-[18px]">
            <div className="flex items-center gap-2">
              <HandTapIcon size={16} className="text-accent-strong" />
              <strong className="text-[12.5px] font-[620]">
                {t("coord.proposeTitle")}
              </strong>
            </div>
            <textarea
              value={conclusion}
              data-testid="pilot-coordination-conclusion"
              onChange={(event) => setConclusion(event.target.value)}
              placeholder={t("coord.proposePlaceholder")}
              className="mt-3 min-h-[78px] w-full resize-none rounded-inset border border-line2 bg-raise p-3 text-[12.5px] leading-[1.65] outline-none placeholder:text-faint focus:border-accent-strong"
            />
            <div className="mt-3 flex items-center gap-2">
              <select
                aria-label={t("coord.responsible")}
                value={responsibleId ?? ""}
                onChange={(event) =>
                  setResponsibleId(event.target.value as PrincipalId)
                }
                className="h-8 rounded-btn border border-line2 bg-bg px-2.5 text-[11.5px]"
              >
                {currentPilotThread.participantIds.map((id) => (
                  <option value={id} key={id}>
                    {nameOf(id)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                data-testid="pilot-coordination-propose"
                disabled={
                  !conclusion.trim() || !responsibleId || propose.isPending
                }
                onClick={() => propose.mutate()}
                className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-btn border-0 bg-accent-strong px-3.5 text-[12px] font-[620] text-on-accent disabled:opacity-45"
              >
                {propose.isPending ? (
                  <CircleNotchIcon size={14} className="animate-spin" />
                ) : null}
                {t("coord.sendForConfirmation")}
              </button>
            </div>
          </section>
        ) : currentPilotThread?.status === "needs_confirmation" &&
          currentPilotThread.responsibleParticipantId === pilot?.identityId ? (
          <button
            type="button"
            data-testid="pilot-coordination-confirm"
            disabled={confirm.isPending}
            onClick={() => confirm.mutate()}
            className="mt-5 inline-flex h-9 cursor-pointer items-center gap-2 rounded-btn border-0 bg-accent-strong px-4 text-[12.5px] font-[620] text-on-accent"
          >
            <CheckCircleIcon size={15} />
            {t("coord.confirmAsResponsible")}
          </button>
        ) : null}
        {currentPilotThread?.conclusion &&
        currentPilotThread.status === "resolved" ? (
          <div className="mt-5 flex max-w-[660px] items-center gap-2.5 rounded-[13px] border border-green-soft bg-green-soft px-4 py-3.5">
            <CheckCircleIcon size={16} weight="fill" className="text-green" />
            <span className="text-[12.5px] leading-[1.6] text-ink [text-wrap:pretty]">
              {currentPilotThread.conclusion}
            </span>
          </div>
        ) : null}
        {propose.isError || confirm.isError || revisit.isError ? (
          <p className="mt-3 text-[11.5px] text-danger">
            {(propose.error ?? confirm.error ?? revisit.error)?.message}
          </p>
        ) : null}

        {grantedActions.size > 0 ? (
          <div className="mt-[30px] max-w-[660px] rounded-[13px] bg-raise px-4 py-[15px]">
            <SectionLabel>{t("coord.grants")}</SectionLabel>
            <div className="mt-3 flex flex-wrap gap-2">
              {[...grantedActions].map((action) => (
                <span
                  key={action}
                  className="inline-flex items-center gap-1.5 rounded-pill bg-panel2 px-2.5 py-1 font-mono text-[10.5px] text-ink"
                >
                  <CheckCircleIcon
                    size={12}
                    weight="fill"
                    className="text-green"
                  />
                  {action}
                </span>
              ))}
            </div>
            <p className="mt-3 text-[10.5px] text-faint">
              {t("coord.grantsNote")}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A branch's state. Pilot threads carry it explicitly; plain coordination
 * threads are resolved once every escalation has a matching resolved action.
 */
function branchState(
  item: ThreadPayload,
  pilotThread: PilotCoordinationThread | undefined,
): BranchState {
  if (pilotThread) return pilotThread.status;
  const escalations = item.messages.filter(
    (message) => message.kind === "coordination_action",
  );
  if (escalations.length === 0) return "open";
  const resolved = escalations.every((message) =>
    item.actions.some(
      (action) => action.envelope.operationId === message.operationId,
    ),
  );
  return resolved ? "resolved" : "needs_confirmation";
}
