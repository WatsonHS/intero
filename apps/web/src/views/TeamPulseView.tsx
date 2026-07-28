import {
  ArrowUpRightIcon,
  CaretDownIcon,
  CaretUpIcon,
  PlantIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type {
  PilotCollaborationPosture,
  PilotProject,
  PilotPulseEntry,
  PilotWorkNarrative,
  PublicWorkProjection,
} from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import {
  getActionInbox,
  getProjectSpecs,
  getProjectWork,
  getTeamPulse,
  getThreads,
} from "../api.js";
import {
  Avatar,
  MasonryColumns,
  Meta,
  TONE_CLASSES,
  cn,
} from "../design/primitives.js";
import { Reveal } from "../design/reveal.js";
import {
  PHASE_META,
  freshest,
  isStale,
  loadSummary,
  orderByAttention,
  revealMove,
  type Tone,
} from "../design/utils.js";
import { useI18n } from "../i18n/index.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";
import { pilotPulseEntryToProjection } from "../pilot/adapters.js";
import {
  getPilotOverview,
  updatePilotPosture,
  withdrawPilotPulse,
} from "../pilot/api.js";
import { usePilotOptional } from "../pilot/context.js";
import {
  projectWorkToPulse,
  workLineFromProjectContext,
  type ProjectPulseContext,
} from "./project-pulse.js";
import {
  mergeWorkLines,
  workLineFromNarrative,
  workLineFromProjection,
  type WorkLine,
} from "./work-lines.js";
import {
  PULSE_MAX_ITEMS,
  PULSE_PAGE_SIZE,
  isInDetailWindow,
  pulseDetailOnlyCount,
} from "./work-visibility.js";
import {
  ProjectAgentConnectionBadge,
  summarizeProjectAgentConnections,
} from "./agent/connection-state.js";

export function TeamPulseView({
  onOpenPerson,
  onOpenAction,
  onOpenAgentConnections,
  onOpenSpecs,
}: {
  onOpenPerson: (ownerId: string) => void;
  onOpenAction: (sourceRef: string) => void;
  onOpenAgentConnections: (projectId?: string) => void;
  onOpenSpecs: () => void;
}) {
  return (
    <CanonicalTeamPulseView
      onOpenPerson={onOpenPerson}
      onOpenAction={onOpenAction}
      onOpenAgentConnections={onOpenAgentConnections}
      onOpenSpecs={onOpenSpecs}
    />
  );
}

function CanonicalTeamPulseView({
  onOpenPerson,
  onOpenAction,
  onOpenAgentConnections,
  onOpenSpecs,
}: {
  onOpenPerson: (ownerId: string) => void;
  onOpenAction: (sourceRef: string) => void;
  onOpenAgentConnections: (projectId?: string) => void;
  onOpenSpecs: () => void;
}) {
  const { t, formatDate, formatRelative, formatTime } = useI18n();
  const queryClient = useQueryClient();
  const pilot = usePilotOptional();
  const [openOwners, setOpenOwners] = useState<Set<string>>(new Set());
  const pilotProject =
    pilot?.projects.data?.projects.find(
      (project) => project.id === pilot.selectedProjectId,
    ) ?? pilot?.projects.data?.projects[0];

  const pulse = useQuery({
    queryKey: ["team-pulse"],
    queryFn: ({ signal }) => getTeamPulse(signal),
    refetchInterval: 30_000,
  });
  const inbox = useQuery({
    queryKey: ["action-inbox"],
    queryFn: ({ signal }) => getActionInbox(signal),
    enabled: !pilot?.enabled || Boolean(pilot.effectiveIdentity),
  });
  const standInThreads = useQuery({
    queryKey: ["threads", "stand_in"],
    queryFn: ({ signal }) => getThreads("stand_in", signal),
  });
  const pilotOverview = useQuery({
    queryKey: ["pilot", "overview", pilot?.identityId, pilotProject?.id],
    queryFn: ({ signal }) =>
      getPilotOverview(pilot!.identityId!, pilotProject!.id, signal),
    enabled: Boolean(pilot?.enabled && pilot.identityId && pilotProject),
    refetchInterval: 1_500,
  });
  const projectWork = useQuery({
    queryKey: ["project-work", pilotProject?.id],
    queryFn: ({ signal }) => getProjectWork(pilotProject!.id, signal),
    enabled: Boolean(
      pilotProject &&
      pilot?.bootstrap.data?.adapters.projectWork === "postgres",
    ),
    refetchInterval: 4_000,
  });
  const projectSpecs = useQuery({
    queryKey: ["project-specs", pilotProject?.id],
    queryFn: ({ signal }) => getProjectSpecs(pilotProject!.id, signal),
    enabled: Boolean(
      pilotProject &&
      pilot?.bootstrap.data?.adapters.projectWork === "postgres",
    ),
    refetchInterval: 4_000,
  });
  const invalidatePilot = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pilot", "overview"] }),
      queryClient.invalidateQueries({ queryKey: ["pilot", "projects"] }),
    ]);
  };
  const posture = useMutation({
    mutationFn: (next: PilotCollaborationPosture) =>
      updatePilotPosture(pilot!.identityId!, pilotProject!.id, next),
    onSuccess: invalidatePilot,
  });
  const withdraw = useMutation({
    mutationFn: ({
      projectId,
      workStateId,
    }: {
      projectId: string;
      workStateId: string;
    }) => withdrawPilotPulse(pilot!.identityId!, projectId, workStateId),
    onSuccess: invalidatePilot,
  });

  const pilotEntries = pilotOverview.data?.pulse ?? [];
  const agentConnections = summarizeProjectAgentConnections(
    pilotOverview.data?.bindings ?? [],
    pilot?.identityId,
  );
  const pilotEntryByProjectionId = new Map(
    pilotEntries.map((entry) => [entry.workStateId, entry]),
  );
  const projectPulse = projectWork.data
    ? projectWorkToPulse(projectWork.data)
    : { projections: [], contexts: new Map<string, ProjectPulseContext>() };
  const allProjections = mergeProjections(
    pulse.data?.projections ?? [],
    pilotEntries.map(pilotPulseEntryToProjection),
    projectPulse.projections,
  );
  const projections = allProjections.filter((projection) =>
    isInDetailWindow(projection.freshnessAt),
  );
  const staleAfterSeconds = pulse.data?.staleAfterSeconds;
  const principalNames = new Map(
    pulse.data?.principals.map((principal) => [
      principal.id,
      principal.displayName,
    ]) ?? [],
  );
  for (const principal of pilotOverview.data?.principals ?? []) {
    principalNames.set(principal.id, principal.displayName);
  }
  const projectNames = new Map<string, string>(
    pilot?.projects.data?.projects.map((project) => [
      project.id,
      project.name,
    ]) ?? [],
  );
  if (projectWork.data) {
    projectNames.set(
      projectWork.data.project.id,
      projectWork.data.project.name,
    );
  }
  const people = groupByOwner(projections);
  const specsInReview =
    projectSpecs.data?.items.filter((item) => item.spec.status === "in_review")
      .length ?? 0;
  const staleProjections = projections.filter((item) =>
    isStale(item.freshnessAt, staleAfterSeconds),
  );

  const pilotActive = Boolean(
    pilot?.enabled && pilot.identityId && pilotProject,
  );
  const pulseReady =
    pulse.isSuccess || (pilotActive && pilotOverview.isSuccess);
  const isLoadingState =
    pulse.isPending && (!pilotActive || pilotOverview.isPending);
  const isEmptyState = pulseReady && projections.length === 0;
  const isErrorState = pulse.isError && (!pilotActive || pilotOverview.isError);
  const showCards = pulseReady && projections.length > 0;

  const freshPill =
    staleProjections.length > 0
      ? { tone: "amber" as Tone, text: t("pulse.fresh.partial") }
      : { tone: "green" as Tone, text: t("pulse.fresh.live") };
  const freshPillClasses = TONE_CLASSES[freshPill.tone];

  const standInThread = standInThreads.data?.items[0];
  const standInEntries = (standInThread?.messages ?? [])
    .filter((message) => message.serverReadable)
    .slice(-3)
    .reverse();

  function toggleOwner(ownerId: string) {
    setOpenOwners((previous) => {
      const next = new Set(previous);
      if (next.has(ownerId)) next.delete(ownerId);
      else next.add(ownerId);
      return next;
    });
  }

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_340px] grid-rows-[minmax(0,1fr)] animate-view-enter">
      <div className="h-full overflow-auto pt-[34px] px-[34px] pb-[60px]">
        <header className="flex items-start justify-between gap-6">
          <div>
            <p className="text-[11.5px] text-ink-muted">
              {formatDate(new Date())}
            </p>
            <h1 className="mt-[10px] text-[30px] font-[540] tracking-[-0.035em]">
              {t("pulse.title")}
            </h1>
            <p className="mt-3 max-w-[540px] text-[13px] leading-[1.75] text-ink-muted [text-wrap:pretty]">
              {t("pulse.lede")}
            </p>
          </div>
          {pilotProject && pilotOverview.data ? (
            <ProjectAgentConnectionBadge
              bindings={pilotOverview.data.bindings}
              identityId={pilot?.identityId}
              onOpen={() => onOpenAgentConnections(pilotProject.id)}
            />
          ) : null}
        </header>

        {showCards ? (
          <div className="mt-6 flex items-center rounded-card bg-raise py-[18px] px-[22px]">
            <div className="pr-7">
              <span
                key={people.length}
                className="inline-block animate-count-up font-mono text-[24px] tracking-[-0.04em]"
              >
                {people.length}
              </span>
              <span className="ml-2 text-[12px] text-ink-muted">
                {t("pulse.countPeople")}
              </span>
            </div>
            <div className="border-l border-line px-7">
              <span
                key={projections.length}
                className="inline-block animate-count-up font-mono text-[24px] tracking-[-0.04em]"
              >
                {projections.length}
              </span>
              <span className="ml-2 text-[12px] text-ink-muted">
                {t("pulse.countTasks")}
              </span>
            </div>
            <div className="border-l border-line px-7">
              <span
                key={inbox.data?.items.length ?? 0}
                className="inline-block animate-count-up font-mono text-[24px] tracking-[-0.04em] text-danger"
              >
                {inbox.data?.items.length ?? 0}
              </span>
              <span className="ml-2 text-[12px] text-ink-muted">
                {t("pulse.countInbox")}
              </span>
            </div>
            <button
              type="button"
              onClick={onOpenSpecs}
              className="flex cursor-pointer items-baseline gap-2 border-0 border-l border-line bg-transparent px-7 text-left hover:opacity-70"
            >
              <span
                key={specsInReview}
                className="inline-block animate-count-up font-mono text-[24px] tracking-[-0.04em] text-amber"
              >
                {specsInReview}
              </span>
              <span className="text-[12px] text-ink-muted">
                {t("pulse.countSpecs")}
              </span>
            </button>
            <span
              className={cn(
                "ml-auto flex items-center gap-2 rounded-pill px-3 py-1.5",
                freshPillClasses.bg,
              )}
            >
              <span
                className={cn("h-1.5 w-1.5 rounded-full", freshPillClasses.dot)}
              />
              <span className={cn("text-[11px]", freshPillClasses.text)}>
                {freshPill.text}
              </span>
            </span>
          </div>
        ) : null}

        {isLoadingState ? (
          <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] items-start gap-3">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="rounded-container border border-line bg-panel2 p-[18px]"
              >
                <div className="grid grid-cols-[34px_1fr] items-center gap-[11px]">
                  <span className="h-[34px] w-[34px] animate-shimmer rounded-full bg-raise" />
                  <span className="grid gap-1.5">
                    <span className="h-[10px] w-[96px] animate-shimmer rounded-[4px] bg-raise" />
                    <span className="h-[9px] w-[140px] animate-shimmer rounded-[4px] bg-raise" />
                  </span>
                </div>
                <div className="mt-3.5 h-[92px] animate-shimmer rounded-inset bg-raise" />
              </div>
            ))}
          </div>
        ) : null}

        {isEmptyState ? (
          <div className="mt-[26px] rounded-container border border-dashed border-line2 py-[44px] px-[40px]">
            <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-accent-soft text-accent-strong">
              <PlantIcon size={19} />
            </span>
            <h2 className="mt-[18px] text-[19px] font-semibold tracking-[-0.025em]">
              {allProjections.length > 0
                ? t("pulse.empty.recentTitle")
                : agentConnections.connected.length > 0
                  ? "Coding Agent 已连接，等待第一条工作更新"
                  : t("pulse.empty.title")}
            </h2>
            <p className="mt-2.5 max-w-[480px] text-[13px] leading-[1.75] text-ink-muted [text-wrap:pretty]">
              {allProjections.length > 0
                ? t("pulse.empty.recentBody")
                : agentConnections.connected.length > 0
                  ? `已验证的 Agent 会把 ${pilotProject?.name ?? "当前 Project"} 中允许共享的结构化 checkpoint 显示在这里。`
                  : t("pulse.empty.body")}
            </p>
            <div className="mt-5 flex gap-[9px]">
              <button
                type="button"
                onClick={() => onOpenAgentConnections(pilotProject?.id)}
                className="h-[34px] cursor-pointer rounded-btn border-0 bg-accent-strong px-3.5 text-[12.5px] font-[620] text-on-accent"
              >
                {agentConnections.connected.length > 0
                  ? "查看连接状态"
                  : `为 ${pilotProject?.name ?? "当前 Project"} 连接 Coding Agent`}
              </button>
            </div>
          </div>
        ) : null}

        {isErrorState ? (
          <div className="mt-[26px] rounded-container border border-danger-soft bg-danger-soft py-[26px] px-[28px]">
            <div className="flex items-center gap-2.5">
              <WarningCircleIcon size={19} className="text-danger" />
              <strong className="text-[15px] font-[620]">
                {t("pulse.error.title")}
              </strong>
            </div>
            <p className="mt-3 max-w-[520px] text-[12.5px] leading-[1.7] text-ink-muted">
              {t("pulse.error.body")}
            </p>
            <div className="mt-[18px] flex items-center gap-3.5">
              <button
                type="button"
                onClick={() => void pulse.refetch()}
                className="h-8 cursor-pointer rounded-btn border-0 bg-accent-strong px-3.5 text-[12px] font-[620] text-on-accent"
              >
                {t("general.retry")}
              </button>
              <span className="font-mono text-[10.5px] text-faint">
                {pulse.error instanceof Error
                  ? pulse.error.message
                  : String(pulse.error ?? "")}
              </span>
            </div>
          </div>
        ) : null}

        {showCards ? (
          <MasonryColumns
            className="mt-[22px]"
            items={people}
            keyOf={(person) => person.ownerId}
            renderItem={({ ownerId, workstreams }, index) => (
              <PersonCard
                ownerId={ownerId}
                name={principalNames.get(ownerId) ?? ownerId.slice(0, 8)}
                workstreams={workstreams}
                index={index}
                staleAfterSeconds={staleAfterSeconds}
                open={openOwners.has(ownerId)}
                onToggle={() => toggleOwner(ownerId)}
                onOpen={() => onOpenPerson(ownerId)}
                pilotEntryByProjectionId={pilotEntryByProjectionId}
                pilotIdentityId={pilot?.identityId}
                withdrawingWorkStateId={
                  withdraw.isPending
                    ? withdraw.variables.workStateId
                    : undefined
                }
                onWithdraw={(entry) =>
                  withdraw.mutate({
                    projectId: entry.projectId,
                    workStateId: entry.workStateId,
                  })
                }
                projectNames={projectNames}
                projectContextByProjectionId={projectPulse.contexts}
              />
            )}
          />
        ) : null}
      </div>

      <aside className="h-full overflow-auto border-l border-line bg-panel pt-[34px] px-[26px] pb-[50px]">
        <div className="flex items-center gap-2.5">
          <strong className="text-[13px] font-[620]">
            {t("pulse.inbox.title")}
          </strong>
          <span
            key={inbox.data?.items.length ?? 0}
            className="grid h-[18px] min-w-[18px] animate-badge-bounce place-items-center rounded-[9px] bg-danger-soft px-1.5 font-mono text-[10px] text-danger"
          >
            {inbox.data?.items.length ?? 0}
          </span>
        </div>
        <p className="mt-2.5 text-[11.5px] leading-[1.6] text-faint [text-wrap:pretty]">
          {t("pulse.inbox.lede")}
        </p>
        <div className="mt-[18px] flex flex-col gap-2.5">
          {inbox.isPending ? (
            <p className="text-[12px] text-ink-muted">{t("general.loading")}</p>
          ) : null}
          {inbox.isError ? (
            <div className="rounded-card border border-danger-soft bg-danger-soft p-3 text-[12px] text-ink-muted">
              <p>收件箱读取失败。请重新登录，或稍后重试。</p>
              <button
                type="button"
                onClick={() => void inbox.refetch()}
                className="mt-2 h-7 cursor-pointer rounded-btn border-0 bg-accent-strong px-2.5 text-[11px] font-[620] text-on-accent"
              >
                {t("general.retry")}
              </button>
            </div>
          ) : null}
          {inbox.data?.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenAction(item.sourceRef)}
              onMouseEnter={revealMove}
              onMouseMove={revealMove}
              className="group relative grid w-full gap-1.5 overflow-hidden rounded-card border border-line bg-panel2-glass py-[15px] px-[16px] text-left text-ink"
            >
              <Reveal />
              <span className="relative text-[10px] font-[650] tracking-[0.06em] text-accent-strong">
                {t(`inbox.${item.kind}` as TranslationKey)}
              </span>
              <strong className="relative text-[12.5px] font-[600] leading-[1.45]">
                {item.title}
              </strong>
              <span className="relative text-[11px] leading-[1.55] text-ink-muted">
                {item.detail}
              </span>
            </button>
          ))}
          {inbox.data && inbox.data.items.length === 0 ? (
            <p className="text-[12px] text-faint">{t("pulse.inbox.empty")}</p>
          ) : null}
        </div>

        {pilotActive && pilotProject ? (
          <PilotProjectContextCard
            project={pilotProject}
            teamName={
              pilot?.teams.data?.teams.find(
                (team) => team.id === pilotProject.primaryTeamId,
              )?.name
            }
            identityId={pilot?.identityId ?? pilotProject.ownerId}
            pending={posture.isPending}
            onPostureChange={(next) => posture.mutate(next)}
          />
        ) : null}

        <div className="relative mt-[26px] overflow-hidden rounded-card border border-accent-soft bg-accent-soft p-[18px]">
          <span className="pointer-events-none absolute -top-[75%] -left-[5%] h-[210%] w-[110%] animate-drift-y">
            <span className="block h-full w-full animate-drift">
              <span className="block h-full w-full animate-drift-fade bg-[radial-gradient(circle,var(--intero-glow)_0%,transparent_66%)]" />
            </span>
          </span>
          <div className="relative grid grid-cols-[26px_1fr] items-center gap-2.5">
            <span className="grid h-[26px] w-[26px] place-items-center rounded-[8px_12px_8px_8px] bg-accent-strong text-[9px] font-bold text-on-accent">
              IR
            </span>
            <strong className="text-[11.5px] font-[620]">
              {t("pulse.standIn.title")}
            </strong>
          </div>
          <div className="relative mt-3.5 flex flex-col gap-3">
            {standInEntries.length === 0 ? (
              <p className="text-[11.5px] leading-[1.6] text-ink-muted [text-wrap:pretty]">
                {t("pulse.standIn.empty")}
              </p>
            ) : (
              standInEntries.map((message) => (
                <div
                  key={message.id}
                  className="grid grid-cols-[6px_1fr] gap-2.5"
                >
                  <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-accent-strong" />
                  <span className="text-[11.5px] leading-[1.6] text-ink-muted [text-wrap:pretty]">
                    {message.body} · {formatTime(message.createdAt)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

/**
 * One person, one card. The card is a list of everything they have in flight
 * at once — ordered by how much attention each workstream needs, not by
 * priority. Every line is a projection published by that person's
 * Stand-in; nothing here is entered by hand.
 */
function PersonCard({
  ownerId,
  name,
  workstreams,
  index,
  staleAfterSeconds,
  open,
  onToggle,
  onOpen,
  pilotEntryByProjectionId,
  pilotIdentityId,
  withdrawingWorkStateId,
  onWithdraw,
  projectNames,
  projectContextByProjectionId,
}: {
  ownerId: string;
  name: string;
  workstreams: PublicWorkProjection[];
  index: number;
  staleAfterSeconds: number | undefined;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  pilotEntryByProjectionId: Map<string, PilotPulseEntry>;
  pilotIdentityId: string | undefined;
  withdrawingWorkStateId: string | undefined;
  onWithdraw: (entry: PilotPulseEntry) => void;
  projectNames: Map<string, string>;
  projectContextByProjectionId: Map<string, ProjectPulseContext>;
}) {
  const { t, formatRelative } = useI18n();
  const ordered = orderByAttention(workstreams);
  const load = loadSummary(workstreams);
  const lead = freshest(workstreams) ?? ordered[0]!;
  const leadStale = isStale(lead.freshnessAt, staleAfterSeconds);
  const visible = ordered.slice(0, open ? PULSE_MAX_ITEMS : PULSE_PAGE_SIZE);
  const nextCount = Math.min(
    PULSE_PAGE_SIZE,
    Math.max(ordered.length - PULSE_PAGE_SIZE, 0),
  );
  const detailOnlyCount = pulseDetailOnlyCount(ordered.length);

  const loadLabel =
    load.blocked > 0
      ? t("pulse.load.blocked", { total: load.total, blocked: load.blocked })
      : load.live < load.total
        ? t("pulse.load.partial", { total: load.total, live: load.live })
        : t("pulse.load.all", { total: load.total });

  return (
    <section
      // `group` is load-bearing: every Reveal layer is opacity-0 until
      // group-hover, so without it the acrylic never becomes visible.
      className="group relative w-full max-w-[520px] overflow-hidden rounded-container border border-line bg-panel2-glass p-[18px] animate-card-enter"
      style={{ animationDelay: `${Math.min(index * 45, 320)}ms` }}
      onMouseEnter={revealMove}
      onMouseMove={revealMove}
    >
      <Reveal />
      <button
        type="button"
        onClick={onOpen}
        className="relative grid w-full cursor-pointer grid-cols-[34px_minmax(0,1fr)_22px] items-center gap-[11px] border-0 bg-transparent p-0 text-left text-ink hover:text-accent-strong"
      >
        <Avatar
          id={ownerId}
          name={name}
          size="lg"
          className="animate-avatar-pop transition-transform duration-[240ms] ease-decelerate hover:scale-[1.06]"
        />
        <span className="grid min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <strong className="truncate text-[13.5px] font-[620] tracking-[-0.01em]">
              {name}
            </strong>
            <Meta tone={leadStale ? "amber" : "faint"}>
              {formatRelative(lead.freshnessAt)}
            </Meta>
          </span>
          <small className="mt-[3px] truncate text-[10.5px] text-faint">
            {t("pulse.card.role")}
          </small>
        </span>
        <ArrowUpRightIcon size={13} className="text-faint" />
      </button>

      <p
        className="relative mt-[13px] text-[12px] leading-[1.6] text-ink-muted [text-wrap:pretty]"
        data-testid={`stand-in-person-summary-${ownerId}`}
      >
        {personSummary(ordered, load, t)}
      </p>

      <div className="relative mt-4 flex items-center gap-2">
        <span className="text-[10px] font-[650] tracking-[0.08em] text-faint">
          {t("pulse.parallel")}
        </span>
        <span className="h-px flex-1 bg-line" />
        <Meta tone={load.blocked > 0 ? "danger" : "faint"}>{loadLabel}</Meta>
      </div>

      <div className="relative mt-2.5 flex flex-col gap-2">
        {visible.map((workstream) => {
          const entry = pilotEntryByProjectionId.get(workstream.id);
          const withdrawable =
            entry && entry.ownerId === pilotIdentityId ? entry : undefined;
          return (
            <ParallelTaskRow
              key={workstream.id}
              workstream={workstream}
              line={lineFor(
                workstream,
                pilotEntryByProjectionId,
                projectContextByProjectionId,
              )}
              projectName={
                workstream.projectId
                  ? (projectNames.get(workstream.projectId) ??
                    `Project · ${workstream.projectId.slice(0, 8)}`)
                  : t("pulse.card.projectUnbound")
              }
              stale={isStale(workstream.freshnessAt, staleAfterSeconds)}
              withdrawableEntry={withdrawable}
              withdrawing={withdrawingWorkStateId === withdrawable?.workStateId}
              onWithdraw={onWithdraw}
              onOpen={onOpen}
            />
          );
        })}
      </div>

      {ordered.length > PULSE_PAGE_SIZE ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="relative mt-[9px] flex cursor-pointer items-center gap-1.5 self-start border-0 bg-transparent p-0 text-[11px] text-ink-muted hover:text-accent-strong"
        >
          {open ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />}
          {open
            ? t("pulse.card.collapse")
            : t("pulse.card.more", { count: nextCount })}
        </button>
      ) : null}
      {open && detailOnlyCount > 0 ? (
        <button
          type="button"
          onClick={onOpen}
          className="relative mt-2 block cursor-pointer border-0 bg-transparent p-0 text-[10.5px] text-faint hover:text-accent-strong"
        >
          {t("pulse.card.inDetail", { count: detailOnlyCount })}
        </button>
      ) : null}
    </section>
  );
}

/**
 * A single in-flight workstream, compressed to one row: what phase it is in,
 * what evidence backs that, when it was last observed, and the two lines that
 * actually tell a reader whether to step in — what just landed and what is next.
 */
function ParallelTaskRow({
  workstream,
  line,
  projectName,
  stale,
  withdrawableEntry,
  withdrawing,
  onWithdraw,
  onOpen,
}: {
  workstream: PublicWorkProjection;
  line: WorkLine;
  projectName: string;
  stale: boolean;
  withdrawableEntry: PilotPulseEntry | undefined;
  withdrawing: boolean;
  onWithdraw: (entry: PilotPulseEntry) => void;
  onOpen: () => void;
}) {
  const { t, formatRelative } = useI18n();
  const meta = PHASE_META[workstream.phase];
  const tone = TONE_CLASSES[meta.tone];
  const blocked = meta.tone === "danger";
  const next = line.next ?? line.collaboration;

  return (
    <div
      className={cn(
        "group/parallel-task relative w-full rounded-[11px] border text-left text-ink",
        blocked
          ? "border-danger-soft bg-danger-soft"
          : "border-line bg-raise hover:border-line2",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        data-testid={`peer-work-card-${workstream.id}`}
        aria-label={workstream.title}
        className="absolute inset-0 z-0 cursor-pointer rounded-[11px] border-0 bg-transparent outline-offset-2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent-strong"
      />
      <div className="pointer-events-none relative z-[1] grid w-full grid-cols-[7px_minmax(0,1fr)] items-start gap-2.5 px-[11px] py-2.5 text-left text-ink">
        <span
          className={cn(
            "mt-[5px] h-[7px] w-[7px] rounded-full",
            tone.dot,
            blocked ? "animate-dot-pulse" : undefined,
          )}
        />
        <span className="grid min-w-0 gap-[7px]">
          <span
            className={cn(
              "pr-16 text-[12.5px] font-[540] leading-[1.45] tracking-[-0.008em] [text-wrap:pretty]",
              meta.tone === "faint" ? "text-faint" : "text-ink",
            )}
          >
            {workstream.title}
          </span>
          <Meta
            tone={stale ? "amber" : "faint"}
            className={cn(
              "absolute top-[12px] right-[11px] shrink-0 text-[9.5px]",
              withdrawableEntry
                ? "transition-opacity duration-150 group-hover/parallel-task:opacity-0 group-focus-within/parallel-task:opacity-0"
                : undefined,
            )}
          >
            {formatRelative(workstream.freshnessAt)}
          </Meta>
          <span className="flex min-w-0 items-center gap-2">
            <Meta
              tone="muted"
              className="max-w-[120px] shrink-0 truncate rounded-pill bg-panel px-1.5 py-0.5 text-[9px]"
            >
              {projectName}
            </Meta>
            <span className={cn("shrink-0 text-[9.5px] font-[650]", tone.text)}>
              {t(`phase.${workstream.phase}` as TranslationKey)}
            </span>
            {line.evidence ? (
              <span className="min-w-0 truncate font-mono text-[9px] text-faint">
                {line.evidence}
              </span>
            ) : null}
          </span>
          <span className="mt-px grid grid-cols-[34px_minmax(0,1fr)] gap-x-[9px] gap-y-2">
            <span className="pt-px text-[9px] font-[650] tracking-[0.04em] text-faint">
              {t("work.done")}
            </span>
            <span className="text-[11px] leading-[1.5] text-ink-muted [text-wrap:pretty]">
              {line.done ?? line.focus ?? t("work.noneReported")}
            </span>
            <span
              className={cn(
                "pt-px text-[9px] font-[650] tracking-[0.04em]",
                blocked ? "text-danger" : "text-faint",
              )}
            >
              {t("work.next")}
            </span>
            <span
              className={cn(
                "text-[11px] leading-[1.5] [text-wrap:pretty]",
                blocked ? "text-danger" : "text-ink-muted",
              )}
            >
              {next ?? t("work.noneReported")}
            </span>
          </span>
        </span>
      </div>
      {withdrawableEntry ? (
        <button
          type="button"
          data-testid={`pilot-withdraw-${withdrawableEntry.workStateId}`}
          disabled={withdrawing}
          title={t("pulse.card.withdraw", {
            title: withdrawableEntry.title,
          })}
          onClick={() => onWithdraw(withdrawableEntry)}
          className="pointer-events-none absolute top-[10px] right-[10px] z-10 cursor-pointer border-0 bg-transparent px-1 py-0.5 text-[9px] font-[620] text-faint opacity-0 underline-offset-2 transition-[color,opacity] duration-150 group-hover/parallel-task:pointer-events-auto group-hover/parallel-task:opacity-100 group-focus-within/parallel-task:pointer-events-auto group-focus-within/parallel-task:opacity-100 hover:text-danger hover:underline disabled:cursor-wait disabled:no-underline disabled:opacity-60"
        >
          {withdrawing
            ? t("pulse.card.withdrawing")
            : t("pulse.card.withdrawAction")}
        </button>
      ) : null}
    </div>
  );
}

/** Narrative for a workstream, whichever source published it. */
function lineFor(
  workstream: PublicWorkProjection,
  pilotEntries: Map<string, PilotPulseEntry>,
  projectContexts: Map<string, ProjectPulseContext>,
): WorkLine {
  const context = projectContexts.get(workstream.id);
  const narrative = pilotEntries.get(workstream.id)?.narrative;
  return mergeWorkLines(
    workLineFromProjection(workstream),
    narrative ? workLineFromNarrative(narrative) : undefined,
    context ? workLineFromProjectContext(context) : undefined,
  );
}

function personSummary(
  ordered: PublicWorkProjection[],
  load: { total: number; live: number; blocked: number },
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
): string {
  const titles = ordered
    .filter((item) => item.phase !== "completed" && item.phase !== "paused")
    .slice(0, 2)
    .map((item) => item.title);
  if (titles.length === 0) {
    return t("pulse.summary.quiet", {
      titles: ordered
        .slice(0, 2)
        .map((item) => item.title)
        .join("、"),
    });
  }
  return load.blocked > 0
    ? t("pulse.summary.blocked", {
        titles: titles.join("、"),
        blocked: load.blocked,
      })
    : t("pulse.summary.active", { titles: titles.join("、") });
}

function NarrativeLine({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[58px_minmax(0,1fr)] gap-2.5">
      <span className="pt-[1px] text-[10px] font-[620] text-faint">
        {label}
      </span>
      <p className="text-[11.5px] leading-[1.6] text-ink-muted [text-wrap:pretty]">
        {children}
      </p>
    </div>
  );
}

export function PilotWorkNarrativeContent({
  narrative,
}: {
  narrative: PilotWorkNarrative;
}) {
  return (
    <>
      <NarrativeLine label="正在做">{narrative.currentFocus}</NarrativeLine>
      <NarrativeLine label="刚完成">
        {narrative.completedOutcome || "尚未报告完成结果"}
      </NarrativeLine>
      <NarrativeLine label="结果依据">
        {narrative.evidence.length > 0
          ? narrative.evidence.join("；")
          : "尚未报告单独的验证或产物"}
      </NarrativeLine>
      <NarrativeLine label="下一步">
        {narrative.nextStep || "尚未报告下一步"}
      </NarrativeLine>
      <NarrativeLine label="需要协作">
        {narrative.collaboration.needed
          ? [
              narrative.collaboration.request,
              narrative.collaboration.requestedFrom
                ? `负责人：${narrative.collaboration.requestedFrom}`
                : "",
            ]
              .filter(Boolean)
              .join(" · ")
          : "暂不需要他人协助"}
      </NarrativeLine>
    </>
  );
}

function PilotProjectContextCard({
  project,
  teamName,
  identityId,
  pending,
  onPostureChange,
}: {
  project: PilotProject;
  teamName: string | undefined;
  identityId: string;
  pending: boolean;
  onPostureChange: (posture: PilotCollaborationPosture) => void;
}) {
  return (
    <div
      className="mt-[22px] rounded-card border border-line bg-panel2 p-[16px]"
      data-testid="pilot-project-context"
    >
      <div className="flex items-center gap-2">
        <ShieldCheckIcon size={15} className="text-green" />
        <strong className="text-[11.5px] font-[620]">项目共享范围</strong>
      </div>
      <p className="mt-2 text-[11.5px] text-ink">
        {project.name}
        {teamName ? ` · ${teamName}` : ""}
      </p>
      <p className="mt-1 text-[10.5px] leading-[1.55] text-faint">
        仅发布结构化工作摘要；原始 prompt、文件、diff 与终端输出保持私有。
      </p>
      {project.ownerId === identityId ? (
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {(["collaborative", "paused", "private"] as const).map((posture) => (
            <button
              type="button"
              key={posture}
              data-testid={`pilot-posture-${posture}`}
              disabled={pending}
              onClick={() => onPostureChange(posture)}
              className={
                project.posture === posture
                  ? "h-8 rounded-quiet bg-accent-soft px-2 text-[10px] font-[620] text-accent-strong"
                  : "h-8 rounded-quiet bg-raise px-2 text-[10px] text-ink-muted"
              }
            >
              {posture === "collaborative"
                ? "团队协作"
                : posture === "paused"
                  ? "已暂停"
                  : "仅自己"}
            </button>
          ))}
        </div>
      ) : (
        <span className="mt-3 inline-flex rounded-pill bg-raise px-2.5 py-1 text-[10px] text-faint">
          {project.posture === "collaborative"
            ? "团队协作"
            : project.posture === "paused"
              ? "已暂停"
              : "仅创建者"}
        </span>
      )}
    </div>
  );
}

function mergeProjections(
  ...sources: PublicWorkProjection[][]
): PublicWorkProjection[] {
  return [
    ...new Map(
      sources.flat().map((projection) => [projection.id, projection]),
    ).values(),
  ];
}

function groupByOwner(
  workstreams: PublicWorkProjection[],
): Array<{ ownerId: string; workstreams: PublicWorkProjection[] }> {
  const groups = new Map<string, PublicWorkProjection[]>();
  for (const workstream of workstreams) {
    const group = groups.get(workstream.ownerId);
    if (group) group.push(workstream);
    else groups.set(workstream.ownerId, [workstream]);
  }
  return Array.from(groups, ([ownerId, ownerWorkstreams]) => ({
    ownerId,
    workstreams: ownerWorkstreams,
  }));
}
