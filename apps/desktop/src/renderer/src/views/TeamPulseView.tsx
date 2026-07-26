import {
  ArrowUpRightIcon,
  CloudArrowDownIcon,
  CloudCheckIcon,
  PlantIcon,
  ShieldCheckIcon,
  TimerIcon,
  UserCircleMinusIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type {
  PilotCollaborationPosture,
  PilotProject,
  PilotPulseEntry,
  PilotWorkNarrative,
  PublicWorkProjection,
  Feature,
  WorkHistoryEntry,
  WorkItem,
  WorkstreamPhase,
} from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import {
  getActionInbox,
  getOfflineStatus,
  getProjectSpecs,
  getProjectWork,
  getTeamPulse,
  getThreads,
  type ProjectWorkPayload,
} from "../api.js";
import { Reveal } from "../design/reveal.js";
import {
  PHASE_META,
  confidencePercent,
  initials,
  isStale,
  revealMove,
  staleAfterMinutes,
  tintFor,
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

const TONE_CLASSES: Record<Tone, { text: string; bg: string; dot: string }> = {
  green: { text: "text-green", bg: "bg-green-soft", dot: "bg-green" },
  amber: { text: "text-amber", bg: "bg-amber-soft", dot: "bg-amber" },
  danger: { text: "text-danger", bg: "bg-danger-soft", dot: "bg-danger" },
  faint: { text: "text-faint", bg: "bg-raise", dot: "bg-faint" },
  accent: {
    text: "text-accent-strong",
    bg: "bg-accent-soft",
    dot: "bg-accent-strong",
  },
  cool: { text: "text-ink-muted", bg: "bg-raise", dot: "bg-faint" },
};

function cn(...classes: Array<string | false | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function TeamPulseView({
  onOpenPerson,
  onOpenAction,
  onOpenSetup,
}: {
  onOpenPerson: (ownerId: string) => void;
  onOpenAction: (sourceRef: string) => void;
  onOpenSetup: () => void;
}) {
  return (
    <CanonicalTeamPulseView
      onOpenPerson={onOpenPerson}
      onOpenAction={onOpenAction}
      onOpenSetup={onOpenSetup}
    />
  );
}

function CanonicalTeamPulseView({
  onOpenPerson,
  onOpenAction,
  onOpenSetup,
}: {
  onOpenPerson: (ownerId: string) => void;
  onOpenAction: (sourceRef: string) => void;
  onOpenSetup: () => void;
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
  });
  const runtime = useQuery({
    queryKey: ["offline-status"],
    queryFn: ({ signal }) => getOfflineStatus(signal),
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
    mutationFn: (workStateId: string) =>
      withdrawPilotPulse(pilot!.identityId!, pilotProject!.id, workStateId),
    onSuccess: invalidatePilot,
  });

  const pilotEntries = pilotOverview.data?.pulse ?? [];
  const pilotEntryByProjectionId = new Map(
    pilotEntries.map((entry) => [entry.workStateId, entry]),
  );
  const projectPulse = projectWork.data
    ? projectWorkToPulse(projectWork.data)
    : { projections: [], contexts: new Map<string, ProjectPulseContext>() };
  const projections = mergeProjections(
    pulse.data?.projections ?? [],
    pilotEntries.map(pilotPulseEntryToProjection),
    projectPulse.projections,
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
  const people = groupByOwner(projections);
  const staleProjections = projections.filter((item) =>
    isStale(item.freshnessAt, staleAfterSeconds),
  );
  const isOffline = runtime.data?.fallback === "public";
  const hasQueryError = pulse.isError || runtime.isError;
  const offlineSyncTime = runtime.data?.freshnessAt
    ? formatRelative(runtime.data.freshnessAt)
    : t("general.none");

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

  let runtimeBg = "bg-raise";
  let runtimeDotClass = "bg-faint";
  let runtimeInkClass = "text-ink-muted";
  let runtimeTitle = t("pulse.runtime.connecting");
  let runtimeDetail = "";
  if (runtime.isPending) {
    runtimeBg = "bg-raise";
    runtimeDotClass = "bg-faint";
    runtimeInkClass = "text-ink-muted";
    runtimeTitle = t("pulse.runtime.connecting");
    runtimeDetail = "";
  } else if (hasQueryError) {
    runtimeBg = "bg-danger-soft";
    runtimeDotClass = "bg-danger";
    runtimeInkClass = "text-danger";
    runtimeTitle = t("pulse.runtime.errorTitle");
    runtimeDetail = t("pulse.runtime.errorDetail");
  } else if (isOffline) {
    runtimeBg = "bg-amber-soft";
    runtimeDotClass = "bg-amber";
    runtimeInkClass = "text-amber";
    runtimeTitle = t("pulse.runtime.public");
    runtimeDetail = t("pulse.runtime.lastSync", { time: offlineSyncTime });
  } else if (staleProjections.length > 0) {
    runtimeBg = "bg-amber-soft";
    runtimeDotClass = "bg-amber";
    runtimeInkClass = "text-amber";
    runtimeTitle = t("pulse.runtime.local");
    runtimeDetail = t("pulse.runtime.staleDetail", {
      count: staleProjections.length,
      minutes: staleAfterMinutes(staleAfterSeconds),
    });
  } else {
    runtimeBg = "bg-green-soft";
    runtimeDotClass = "bg-green";
    runtimeInkClass = "text-green";
    runtimeTitle = t("pulse.runtime.local");
    runtimeDetail = t("pulse.runtime.fresh", { time: offlineSyncTime });
  }

  const hasBanner = isOffline || staleProjections.length > 0;
  const freshPill = isOffline
    ? { tone: "amber" as Tone, text: t("pulse.fresh.outdated") }
    : staleProjections.length > 0
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
          <div
            className={cn(
              "flex items-center gap-[9px] rounded-pill px-3.5 py-2",
              runtimeBg,
            )}
          >
            <span
              className={cn(
                "h-[7px] w-[7px] animate-breathe rounded-full",
                runtimeDotClass,
              )}
            />
            <span className="grid">
              <strong
                className={cn("text-[11.5px] font-[620]", runtimeInkClass)}
              >
                {runtimeTitle}
              </strong>
              {runtimeDetail ? (
                <small className="mt-[2px] font-mono text-[9.5px] text-ink-muted">
                  {runtimeDetail}
                </small>
              ) : null}
            </span>
          </div>
        </header>

        {hasBanner ? (
          <div className="mt-[22px] grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-3 rounded-[13px] border border-amber-soft bg-amber-soft py-[15px] px-[17px]">
            {isOffline ? (
              <CloudArrowDownIcon size={18} className="text-amber" />
            ) : (
              <TimerIcon size={18} className="text-amber" />
            )}
            <span className="grid gap-[5px]">
              <strong className="text-[12.5px] font-[620] text-amber">
                {isOffline
                  ? t("pulse.banner.offlineTitle")
                  : t("pulse.banner.staleTitle", {
                      count: staleProjections.length,
                    })}
              </strong>
              <span className="text-[12px] leading-[1.65] text-ink-muted [text-wrap:pretty]">
                {isOffline
                  ? t("pulse.banner.offlineBody")
                  : t("pulse.banner.staleBody", {
                      minutes: staleAfterMinutes(staleAfterSeconds),
                    })}
              </span>
            </span>
            <span className="font-mono text-[10px] text-faint">
              {isOffline
                ? t("pulse.banner.offlineMeta", { time: offlineSyncTime })
                : t("pulse.banner.staleMeta", {
                    minutes: staleAfterMinutes(staleAfterSeconds),
                  })}
            </span>
          </div>
        ) : null}

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
              <span className="inline-block animate-count-up font-mono text-[24px] tracking-[-0.04em]">
                {projectSpecs.data?.items.filter(
                  (item) => item.spec.status === "in_review",
                ).length ?? 0}
              </span>
              <span className="ml-2 text-[12px] text-ink-muted">
                Specs in review
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
          <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(310px,1fr))] items-start gap-3">
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
              {t("pulse.empty.title")}
            </h2>
            <p className="mt-2.5 max-w-[480px] text-[13px] leading-[1.75] text-ink-muted [text-wrap:pretty]">
              {t("pulse.empty.body")}
            </p>
            <div className="mt-5 flex gap-[9px]">
              <button
                type="button"
                onClick={onOpenSetup}
                className="h-[34px] cursor-pointer rounded-btn border-0 bg-accent-strong px-3.5 text-[12.5px] font-[620] text-on-accent"
              >
                {t("pulse.empty.register")}
              </button>
              <button
                type="button"
                onClick={onOpenSetup}
                className="h-[34px] cursor-pointer rounded-btn border border-line2 bg-transparent px-3.5 text-[12.5px] text-ink hover:border-accent-strong"
              >
                {t("pulse.empty.connect")}
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
          <div className="mt-[22px] grid grid-cols-[repeat(auto-fill,minmax(310px,1fr))] items-start gap-3">
            {people.map(({ ownerId, workstreams }, index) => (
              <PeerPersonCard
                key={ownerId}
                ownerId={ownerId}
                name={principalNames.get(ownerId) ?? ownerId.slice(0, 8)}
                workstreams={workstreams}
                index={index}
                staleAfterSeconds={staleAfterSeconds}
                offline={isOffline}
                offlineSyncTime={offlineSyncTime}
                open={openOwners.has(ownerId)}
                onToggle={() => toggleOwner(ownerId)}
                onOpen={() => onOpenPerson(ownerId)}
                pilotEntryByProjectionId={pilotEntryByProjectionId}
                pilotIdentityId={pilot?.identityId}
                withdrawingWorkStateId={
                  withdraw.isPending ? withdraw.variables : undefined
                }
                onWithdraw={(workStateId) => withdraw.mutate(workStateId)}
                projectContextByProjectionId={projectPulse.contexts}
              />
            ))}
          </div>
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
              <p>{t("general.unavailable")}</p>
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

function PersonCard({
  ownerId,
  name,
  workstreams,
  index,
  staleAfterSeconds,
  offline,
  offlineSyncTime,
  open,
  onToggle,
  onOpen,
  pilotEntryByProjectionId,
  pilotIdentityId,
  withdrawingWorkStateId,
  onWithdraw,
}: {
  ownerId: string;
  name: string;
  workstreams: PublicWorkProjection[];
  index: number;
  staleAfterSeconds: number | undefined;
  offline: boolean;
  offlineSyncTime: string;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  pilotEntryByProjectionId: Map<string, PilotPulseEntry>;
  pilotIdentityId: string | undefined;
  withdrawingWorkStateId: string | undefined;
  onWithdraw: (workStateId: string) => void;
}) {
  const { t, formatRelative } = useI18n();
  const main = chooseMainWorkstream(workstreams);
  const subs = workstreams.filter((item) => item.id !== main.id);
  const activeSubs = subs.filter(
    (item) => item.phase !== "completed" && item.phase !== "paused",
  ).length;
  const mainTone = TONE_CLASSES[PHASE_META[main.phase].tone];
  const mainStale = isStale(main.freshnessAt, staleAfterSeconds);
  const freshColorClass = offline || mainStale ? "text-amber" : "text-faint";
  const freshText = offline
    ? t("pulse.card.syncedAt", { time: offlineSyncTime })
    : formatRelative(main.freshnessAt);
  const delay = Math.min(index * 45, 320);
  const pilotEntry = pilotEntryByProjectionId.get(main.id);
  const pilotNarrative = pilotEntry?.narrative;
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-container border border-line bg-panel2-glass p-[18px] animate-card-enter"
      style={{ animationDelay: `${delay}ms` }}
      onMouseEnter={revealMove}
      onMouseMove={revealMove}
    >
      <Reveal />
      <button
        type="button"
        onClick={onOpen}
        className="grid w-full grid-cols-[34px_minmax(0,1fr)_22px] items-center gap-[11px] border-0 bg-transparent p-0 text-left text-ink hover:text-accent-strong"
      >
        <span
          className="grid h-[34px] w-[34px] animate-avatar-pop place-items-center rounded-full text-[10.5px] font-bold text-on-tint transition-transform duration-[240ms] ease-decelerate hover:scale-[1.06]"
          style={{ background: tintFor(ownerId), animationDelay: `${delay}ms` }}
        >
          {initials(name)}
        </span>
        <span className="grid min-w-0">
          <span className="flex items-center gap-2">
            <strong className="text-[13.5px] font-[620] tracking-[-0.01em]">
              {name}
            </strong>
            <span className={cn("font-mono text-[9.5px]", freshColorClass)}>
              {freshText}
            </span>
          </span>
          <small className="mt-[3px] truncate text-[10.5px] text-faint">
            {t("pulse.card.role")}
          </small>
        </span>
        <ArrowUpRightIcon size={13} className="text-faint" />
      </button>

      {pilotEntry && pilotNarrative ? (
        <div
          className="mt-[13px] grid gap-3 rounded-inset border border-transparent bg-raise p-3.5 text-left text-ink"
          data-testid={`pilot-pulse-entry-${pilotEntry.workStateId}`}
        >
          <div className="flex items-center gap-2">
            <PhaseChip phase={main.phase} size="sm" />
            <h3 className="text-[14px] font-[570] leading-[1.4] tracking-[-0.015em] [text-wrap:pretty]">
              {main.title}
            </h3>
          </div>
          <PilotWorkNarrativeContent narrative={pilotNarrative} />
          <button
            type="button"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((current) => !current)}
            className="mt-0.5 flex items-center gap-1.5 border-0 border-t border-line bg-transparent pt-2.5 text-left font-mono text-[9.5px] text-faint hover:text-ink-muted"
          >
            <CloudCheckIcon size={12} className="text-green" />
            来源与新鲜度 · {formatRelative(pilotEntry.freshnessAt)}
            <span className="ml-auto">{detailsOpen ? "收起" : "查看"}</span>
          </button>
          {detailsOpen ? (
            <div
              data-testid={`pilot-pulse-provenance-${pilotEntry.workStateId}`}
              className="grid gap-2 rounded-[9px] border border-line bg-panel px-2.5 py-2 font-mono text-[9.5px] text-faint"
            >
              <span>
                {pilotEntry.provenance.client} ·{" "}
                {pilotEntry.provenance.connectionName} · {pilotEntry.eventType}
              </span>
              <span>
                发生于 {formatRelative(pilotEntry.provenance.occurredAt)} ·
                接收于 {formatRelative(pilotEntry.provenance.receivedAt)}
              </span>
              {pilotEntry.ownerId === pilotIdentityId ? (
                <button
                  type="button"
                  data-testid={`pilot-withdraw-${pilotEntry.workStateId}`}
                  disabled={withdrawingWorkStateId === pilotEntry.workStateId}
                  onClick={() => onWithdraw(pilotEntry.workStateId)}
                  className="inline-flex w-fit items-center gap-1 border-0 bg-transparent p-0 text-[9.5px] text-ink-muted hover:text-danger"
                >
                  <UserCircleMinusIcon size={12} />
                  {withdrawingWorkStateId === pilotEntry.workStateId
                    ? "撤回中…"
                    : "撤回团队摘要"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <p className="mt-[13px] text-[12px] leading-[1.6] text-ink-muted [text-wrap:pretty]">
            {meaningfulDetail(main, t("pulse.card.noChange"))}
          </p>
          <button
            type="button"
            onClick={onOpen}
            className="mt-3.5 block w-full rounded-inset border border-transparent bg-raise p-3.5 text-left text-ink hover:border-line2"
          >
            <PhaseChip phase={main.phase} size="sm" />
            <h3 className="mt-2.5 text-[14px] font-[570] leading-[1.4] tracking-[-0.015em] [text-wrap:pretty]">
              {main.title}
            </h3>
            <div className="mt-3 flex items-center gap-3.5">
              <span className="inline-flex items-center gap-[7px]">
                <span className="relative h-1 w-[44px] overflow-hidden rounded-[2px] bg-line2">
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 origin-left animate-bar-grow transition-[width] duration-[620ms] ease-decelerate",
                      mainTone.dot,
                    )}
                    style={{ width: `${confidencePercent(main.confidence)}%` }}
                  />
                </span>
                <span className="font-mono text-[10px] text-ink-muted">
                  {confidencePercent(main.confidence)}
                </span>
              </span>
              <span className="text-[10.5px] text-faint">
                {t("pulse.card.changes", {
                  count: main.changedFields.length,
                })}
              </span>
              {offline ? (
                <span className="ml-auto font-mono text-[9px] text-faint">
                  {t("pulse.card.source")}
                </span>
              ) : null}
            </div>
          </button>
        </>
      )}

      {subs.length > 0 ? (
        <button
          type="button"
          onClick={onToggle}
          className="mt-3 flex w-full items-center gap-[9px] border-0 bg-transparent p-0 text-left text-[11px] text-ink-muted hover:text-accent-strong"
        >
          <span>
            {open
              ? t("pulse.card.subsOpen")
              : t("pulse.card.subsClosed", {
                  active: activeSubs,
                  total: subs.length,
                })}
          </span>
          <span className="h-px flex-1 bg-line" />
          <span>
            {open ? t("pulse.card.collapse") : t("pulse.card.expand")}
          </span>
        </button>
      ) : null}
      {open ? (
        <div className="mt-2.5 flex flex-col gap-0.5">
          {subs.map((sub) => {
            const tone = TONE_CLASSES[PHASE_META[sub.phase].tone];
            const dim = sub.phase === "completed" || sub.phase === "paused";
            return (
              <div
                key={sub.id}
                className="grid grid-cols-[7px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[9px] p-[8px_9px] hover:bg-hover-wash"
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
                <span
                  className={cn(
                    "truncate text-[11.5px]",
                    dim ? "text-faint" : "text-ink",
                  )}
                >
                  {sub.title}
                </span>
                <span className="font-mono text-[9.5px] text-faint">
                  {formatRelative(sub.freshnessAt)}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function PeerPersonCard({
  ownerId,
  name,
  workstreams,
  index,
  staleAfterSeconds,
  offline,
  offlineSyncTime,
  open,
  onToggle,
  onOpen,
  pilotEntryByProjectionId,
  pilotIdentityId,
  withdrawingWorkStateId,
  onWithdraw,
  projectContextByProjectionId,
}: {
  ownerId: string;
  name: string;
  workstreams: PublicWorkProjection[];
  index: number;
  staleAfterSeconds: number | undefined;
  offline: boolean;
  offlineSyncTime: string;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  pilotEntryByProjectionId: Map<string, PilotPulseEntry>;
  pilotIdentityId: string | undefined;
  withdrawingWorkStateId: string | undefined;
  onWithdraw: (workStateId: string) => void;
  projectContextByProjectionId: Map<string, ProjectPulseContext>;
}) {
  const { t, formatRelative } = useI18n();
  const active = workstreams.filter(
    (item) => item.phase !== "completed" && item.phase !== "paused",
  );
  const blocked = workstreams.filter((item) => item.phase === "blocked");
  const freshest = workstreams.reduce((latest, item) =>
    Date.parse(item.freshnessAt) > Date.parse(latest.freshnessAt)
      ? item
      : latest,
  );
  const stale = isStale(freshest.freshnessAt, staleAfterSeconds);
  const visible = open ? workstreams : workstreams.slice(0, 3);
  const summary =
    blocked.length > 0
      ? `正在推进 ${active.map((item) => item.title).slice(0, 2).join("、")}；其中 ${blocked.length} 项受阻。`
      : active.length > 0
        ? `正在推进 ${active.map((item) => item.title).slice(0, 2).join("、")}。`
        : `最近完成或暂停了 ${workstreams.map((item) => item.title).slice(0, 2).join("、")}。`;
  return (
    <section
      className="relative overflow-hidden rounded-container border border-line bg-panel2-glass p-[18px] animate-card-enter"
      style={{ animationDelay: `${Math.min(index * 45, 320)}ms` }}
    >
      <Reveal />
      <button
        type="button"
        onClick={onOpen}
        className="relative grid w-full grid-cols-[34px_minmax(0,1fr)_22px] items-center gap-[11px] border-0 bg-transparent p-0 text-left"
      >
        <span
          className="grid h-[34px] w-[34px] place-items-center rounded-full text-[10.5px] font-bold text-on-tint"
          style={{ background: tintFor(ownerId) }}
        >
          {initials(name)}
        </span>
        <span className="grid min-w-0">
          <span className="flex items-center gap-2">
            <strong className="text-[13.5px] font-[620]">{name}</strong>
            <span className="font-mono text-[9.5px] text-faint">
              {offline
                ? t("pulse.card.syncedAt", { time: offlineSyncTime })
                : formatRelative(freshest.freshnessAt)}
            </span>
          </span>
          <small className="mt-1 text-[10px] text-faint">
            {active.length} active · {blocked.length} blocked
            {stale ? " · stale" : ""}
          </small>
        </span>
        <ArrowUpRightIcon size={13} className="text-faint" />
      </button>
      <p
        className="relative mt-3 text-[11.5px] leading-[1.65] text-ink-muted"
        data-testid={`stand-in-person-summary-${ownerId}`}
      >
        {summary}
      </p>
      <div className="relative mt-3 grid gap-2.5">
        {visible.map((workstream) => {
          const pilotEntry = pilotEntryByProjectionId.get(workstream.id);
          const projectContext = projectContextByProjectionId.get(
            workstream.id,
          );
          return (
            <article
              key={workstream.id}
              className="rounded-inset border border-line bg-raise p-3.5"
              data-testid={`peer-work-card-${workstream.id}`}
            >
              <div className="flex items-start gap-2">
                <PhaseChip phase={workstream.phase} size="sm" />
                <h3 className="text-[13px] font-[570] leading-[1.45]">
                  {workstream.title}
                </h3>
              </div>
              {projectContext ? (
                <ProjectWorkPulseContent
                  context={projectContext}
                  formatRelative={formatRelative}
                />
              ) : pilotEntry?.narrative ? (
                <div className="mt-3">
                  <PilotWorkNarrativeContent narrative={pilotEntry.narrative} />
                </div>
              ) : (
                <p className="mt-2 text-[11px] leading-[1.6] text-ink-muted">
                  {meaningfulDetail(workstream, t("pulse.card.noChange"))}
                </p>
              )}
              {pilotEntry && pilotEntry.ownerId === pilotIdentityId ? (
                <button
                  type="button"
                  disabled={withdrawingWorkStateId === pilotEntry.workStateId}
                  onClick={() => onWithdraw(pilotEntry.workStateId)}
                  className="mt-2 border-0 bg-transparent p-0 font-mono text-[9px] text-faint hover:text-danger"
                >
                  撤回团队摘要
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
      {workstreams.length > 3 ? (
        <button
          type="button"
          onClick={onToggle}
          className="relative mt-3 w-full border-0 border-t border-line bg-transparent pt-3 text-left text-[10.5px] text-faint"
        >
          {open ? "收起" : `${workstreams.length - 3} more`}
        </button>
      ) : null}
    </section>
  );
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

type ProjectPulseContext = {
  kind: "work_item" | "feature";
  description: string;
  statusLabel: string;
  completedOutcome?: string;
  evidence?: string;
  blockers: string[];
  nextStep: string;
  source: string;
  updatedAt: string;
};

function ProjectWorkPulseContent({
  context,
  formatRelative,
}: {
  context: ProjectPulseContext;
  formatRelative: (value: string) => string;
}) {
  return (
    <div className="mt-3">
      <NarrativeLine label="正在做">
        {context.description || context.statusLabel}
      </NarrativeLine>
      <NarrativeLine label="刚完成">
        {context.completedOutcome ?? "尚未完成"}
      </NarrativeLine>
      <NarrativeLine label="结果依据">
        {context.evidence ?? "尚未附加完成依据"}
      </NarrativeLine>
      <NarrativeLine label="下一步">{context.nextStep}</NarrativeLine>
      <NarrativeLine label="需要协作">
        {context.blockers.length > 0
          ? context.blockers.join("；")
          : "暂不需要他人协助"}
      </NarrativeLine>
      <details className="mt-2">
        <summary className="cursor-pointer font-mono text-[9px] text-faint">
          来源与新鲜度
        </summary>
        <p className="mt-1.5 font-mono text-[9px] leading-[1.5] text-faint">
          {context.source} · {formatRelative(context.updatedAt)}
        </p>
      </details>
    </div>
  );
}

function projectWorkToPulse(data: ProjectWorkPayload): {
  projections: PublicWorkProjection[];
  contexts: Map<string, ProjectPulseContext>;
} {
  const contexts = new Map<string, ProjectPulseContext>();
  const workItemTitles = new Map(
    data.workItems.map((item) => [item.id, item.title]),
  );
  const projections: PublicWorkProjection[] = [];
  for (const item of data.workItems) {
    if (!item.ownerId) continue;
    const blockers = blockersFor(item, data, workItemTitles);
    const latestHistory = data.history
      .filter((entry) => entry.workItemId === item.id)
      .at(-1);
    projections.push({
      id: item.id as unknown as PublicWorkProjection["id"],
      projectId: item.projectId,
      ownerId: item.ownerId,
      title: item.title,
      phase:
        blockers.length > 0 ? "blocked" : phaseForWorkItem(item.status),
      blockers,
      dependencies: [],
      decisions: [],
      artifactIds: [],
      freshnessAt: item.updatedAt,
      confidence: 1,
      contradictionClaimIds: [],
      version: data.history.filter((entry) => entry.workItemId === item.id)
        .length,
      changedFields: ["phase"],
      projectedAt: item.updatedAt,
    });
    contexts.set(item.id, {
      kind: "work_item",
      description: item.description,
      statusLabel: workItemStatusLabel(item.status),
      ...(item.status === "done"
        ? { completedOutcome: item.title }
        : {}),
      ...(item.completionEvidence
        ? { evidence: item.completionEvidence }
        : {}),
      blockers,
      nextStep: workItemNextStep(item.status),
      source: historySource(latestHistory),
      updatedAt: item.updatedAt,
    });
  }
  const parentFeatureIds = new Set(
    data.workItems.flatMap((item) =>
      item.featureId ? [item.featureId] : [],
    ),
  );
  for (const feature of data.features) {
    if (!feature.ownerId || parentFeatureIds.has(feature.id)) continue;
    projections.push({
      id: feature.id as unknown as PublicWorkProjection["id"],
      projectId: feature.projectId,
      ownerId: feature.ownerId,
      title: feature.title,
      phase: phaseForFeature(feature.stage),
      blockers: [],
      dependencies: [],
      decisions: [],
      artifactIds: [],
      freshnessAt: feature.updatedAt,
      confidence: 1,
      contradictionClaimIds: [],
      version: 1,
      changedFields: ["phase"],
      projectedAt: feature.updatedAt,
    });
    contexts.set(feature.id, {
      kind: "feature",
      description: feature.description,
      statusLabel: feature.stage.replaceAll("_", " "),
      ...(feature.stage === "released"
        ? { completedOutcome: feature.title }
        : {}),
      blockers: [],
      nextStep:
        feature.stage === "planned"
          ? "开始开发"
          : feature.stage === "in_development"
            ? "完成并发布"
            : "观察发布结果",
      source: "Project Feature",
      updatedAt: feature.updatedAt,
    });
  }
  return { projections, contexts };
}

function blockersFor(
  item: WorkItem,
  data: ProjectWorkPayload,
  titles: Map<string, string>,
): string[] {
  return data.relations.flatMap((relation) => {
    if (relation.sourceId === item.id && relation.kind === "blocked_by") {
      return [`受 ${titles.get(relation.targetId) ?? "另一 Work Item"} 阻塞`];
    }
    if (relation.targetId === item.id && relation.kind === "blocks") {
      return [`受 ${titles.get(relation.sourceId) ?? "另一 Work Item"} 阻塞`];
    }
    return [];
  });
}

function phaseForWorkItem(status: WorkItem["status"]): WorkstreamPhase {
  if (status === "done") return "completed";
  if (status === "ready_for_test") return "validating";
  if (status === "in_progress") return "implementing";
  return "planning";
}

function phaseForFeature(stage: Feature["stage"]): WorkstreamPhase {
  if (stage === "released") return "completed";
  if (stage === "in_development") return "implementing";
  return "planning";
}

function workItemStatusLabel(status: WorkItem["status"]): string {
  if (status === "ready_for_test") return "等待测试";
  if (status === "in_progress") return "开发中";
  if (status === "done") return "已完成";
  return "待开始";
}

function workItemNextStep(status: WorkItem["status"]): string {
  if (status === "ready_for_test") return "由项目参与者完成验收";
  if (status === "in_progress") return "继续开发并提交验证依据";
  if (status === "done") return "观察结果或领取下一项工作";
  return "开始工作";
}

function historySource(history: WorkHistoryEntry | undefined): string {
  if (!history) return "Project Work";
  return history.actor.kind === "agent"
    ? "Connected Coding Agent"
    : "Intero member";
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
      sources
        .flat()
        .map((projection) => [projection.id, projection]),
    ).values(),
  ];
}

function PhaseChip({
  phase,
  size,
}: {
  phase: WorkstreamPhase;
  size: "sm" | "md";
}) {
  const { t } = useI18n();
  const meta = PHASE_META[phase];
  const tone = TONE_CLASSES[meta.tone];
  const sizeClasses =
    size === "sm"
      ? "px-[9px] py-[3px] text-[9.5px]"
      : "px-[10px] py-1 text-[10px]";
  return (
    <span
      key={phase}
      className={cn(
        "inline-flex animate-pill-pulse items-center gap-1.5 rounded-pill font-[620]",
        sizeClasses,
        tone.text,
        tone.bg,
      )}
    >
      <span
        className={cn(
          "h-[5px] w-[5px] rounded-full",
          tone.dot,
          meta.tone === "danger" ? "animate-dot-pulse" : undefined,
        )}
      />
      {t(`phase.${phase}` as TranslationKey)}
    </span>
  );
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

function chooseMainWorkstream(
  workstreams: PublicWorkProjection[],
): PublicWorkProjection {
  const rank: Record<string, number> = {
    blocked: 0,
    reviewing: 1,
    implementing: 2,
    planning: 3,
    paused: 4,
    completed: 5,
  };
  return workstreams.reduce((current, candidate) => {
    const currentRank = rank[current.phase] ?? 10;
    const candidateRank = rank[candidate.phase] ?? 10;
    if (candidateRank !== currentRank) {
      return candidateRank < currentRank ? candidate : current;
    }
    return Date.parse(candidate.freshnessAt) > Date.parse(current.freshnessAt)
      ? candidate
      : current;
  });
}

function meaningfulDetail(
  workstream: PublicWorkProjection,
  fallback: string,
): string {
  return (
    workstream.blockers[0] ??
    workstream.dependencies[0] ??
    workstream.decisions[0] ??
    fallback
  );
}
