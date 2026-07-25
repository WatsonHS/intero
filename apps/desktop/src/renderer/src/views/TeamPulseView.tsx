import {
  ArrowUpRightIcon,
  CloudArrowDownIcon,
  PlantIcon,
  TimerIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type { PublicWorkProjection, WorkstreamPhase } from "@intero/domain";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  getActionInbox,
  getOfflineStatus,
  getTeamPulse,
  getThreads,
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
  const { t, formatDate, formatRelative, formatTime } = useI18n();
  const [openOwners, setOpenOwners] = useState<Set<string>>(new Set());

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
  const representativeThreads = useQuery({
    queryKey: ["threads", "representative"],
    queryFn: ({ signal }) => getThreads("representative", signal),
  });

  const projections = pulse.data?.projections ?? [];
  const staleAfterSeconds = pulse.data?.staleAfterSeconds;
  const principalNames = new Map(
    pulse.data?.principals.map((principal) => [
      principal.id,
      principal.displayName,
    ]) ?? [],
  );
  const people = groupByOwner(projections);
  const staleProjections = projections.filter((item) =>
    isStale(item.freshnessAt, staleAfterSeconds),
  );
  const isOffline = runtime.data?.fallback === "public";
  const hasQueryError = pulse.isError || runtime.isError;
  const offlineSyncTime = runtime.data?.freshnessAt
    ? formatRelative(runtime.data.freshnessAt)
    : t("general.none");

  const isLoadingState = pulse.isPending;
  const isEmptyState = pulse.isSuccess && projections.length === 0;
  const isErrorState = pulse.isError;
  const showCards = pulse.isSuccess && projections.length > 0;

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

  const representativeThread = representativeThreads.data?.items[0];
  const repEntries = (representativeThread?.messages ?? [])
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
                className={cn(
                  "text-[11.5px] font-[620]",
                  runtimeInkClass,
                )}
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
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  freshPillClasses.dot,
                )}
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
              <PersonCard
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
            <p className="text-[12px] text-ink-muted">
              {t("general.loading")}
            </p>
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
              {t("pulse.rep.title")}
            </strong>
          </div>
          <div className="relative mt-3.5 flex flex-col gap-3">
            {repEntries.length === 0 ? (
              <p className="text-[11.5px] leading-[1.6] text-ink-muted [text-wrap:pretty]">
                {t("pulse.rep.empty")}
              </p>
            ) : (
              repEntries.map((message) => (
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
            {t("pulse.card.changes", { count: main.changedFields.length })}
          </span>
          {offline ? (
            <span className="ml-auto font-mono text-[9px] text-faint">
              {t("pulse.card.source")}
            </span>
          ) : null}
        </div>
      </button>

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
        <span>{open ? t("pulse.card.collapse") : t("pulse.card.expand")}</span>
      </button>
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
