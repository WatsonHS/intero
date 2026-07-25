import { ArrowLeftIcon } from "@phosphor-icons/react";
import type { PublicWorkProjection, WorkstreamPhase } from "@intero/domain";
import { useQuery } from "@tanstack/react-query";

import {
  getActivity,
  getOfflineStatus,
  getTeamPulse,
  getThreads,
} from "../api.js";
import {
  PHASE_META,
  confidencePercent,
  initials,
  isStale,
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

export function PersonView({
  ownerId,
  onBack,
  onOpenChat,
}: {
  ownerId: string;
  onBack: () => void;
  onOpenChat: () => void;
}) {
  const { t, formatRelative, formatTime } = useI18n();

  const pulse = useQuery({
    queryKey: ["team-pulse"],
    queryFn: ({ signal }) => getTeamPulse(signal),
    refetchInterval: 30_000,
  });
  const runtime = useQuery({
    queryKey: ["offline-status"],
    queryFn: ({ signal }) => getOfflineStatus(signal),
  });
  const threads = useQuery({
    queryKey: ["threads"],
    queryFn: ({ signal }) => getThreads(undefined, signal),
  });
  const activity = useQuery({
    queryKey: ["activity"],
    queryFn: ({ signal }) => getActivity(0, 500, signal),
  });

  const workstreams = (pulse.data?.projections ?? []).filter(
    (item) => item.ownerId === ownerId,
  );
  const principalName =
    pulse.data?.principals.find((principal) => principal.id === ownerId)
      ?.displayName ?? ownerId.slice(0, 8);
  const offline = runtime.data?.fallback === "public";
  const offlineSyncTime = runtime.data?.freshnessAt
    ? formatRelative(runtime.data.freshnessAt)
    : t("general.none");

  if (!pulse.isSuccess || workstreams.length === 0) {
    return (
      <div className="grid h-full grid-cols-[minmax(0,1fr)_340px] grid-rows-[minmax(0,1fr)] animate-view-enter">
        <div className="grid h-full place-items-center overflow-auto pt-[26px] px-[32px] pb-[60px]">
          <div className="grid justify-items-center gap-3 text-center">
            <p className="text-[13px] text-ink-muted">
              {pulse.isPending ? t("general.loading") : t("person.notFound")}
            </p>
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-[7px] border-0 bg-transparent p-0 text-[11.5px] text-ink-muted hover:text-accent-strong"
            >
              <ArrowLeftIcon size={13} />
              {t("person.back")}
            </button>
          </div>
        </div>
        <aside className="h-full overflow-auto border-l border-line bg-panel pt-[26px] px-[24px] pb-[50px]" />
      </div>
    );
  }

  const main = chooseMainWorkstream(workstreams);
  const subs = workstreams.filter((item) => item.id !== main.id);
  const mainTone = TONE_CLASSES[PHASE_META[main.phase].tone];
  const mainStale = isStale(main.freshnessAt, pulse.data?.staleAfterSeconds);
  const repDotClass = offline || mainStale ? "bg-amber" : "bg-green";
  const repText = offline
    ? t("person.repPublic", { time: offlineSyncTime })
    : t("person.repLocal", { time: formatRelative(main.freshnessAt) });
  const summaryText =
    main.blockers[0] ?? main.dependencies[0] ?? main.decisions[0];
  const noteText = main.decisions[0] ?? main.blockers[0];
  const freshColorClass = mainStale ? "text-amber" : "text-faint";

  const workstreamIds = new Set<string>(workstreams.map((item) => item.id));
  const checkpoints = (activity.data?.items ?? [])
    .filter(
      (event) =>
        event.actorId === ownerId || workstreamIds.has(event.aggregateId),
    )
    .slice(-6)
    .reverse();

  const dependencies = workstreams.flatMap((workstream) =>
    workstream.dependencies.map((text) => ({
      workstreamId: workstream.id,
      text,
    })),
  );
  const blockers = workstreams.flatMap((workstream) =>
    workstream.blockers.map((text) => ({
      workstreamId: workstream.id,
      text,
    })),
  );
  const groups = (threads.data?.items ?? []).filter(
    (item) =>
      (item.thread.kind === "human_group" || item.thread.kind === "room") &&
      item.thread.participantIds.some((id) => id === ownerId),
  );

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_340px] grid-rows-[minmax(0,1fr)] animate-view-enter">
      <div className="h-full overflow-auto pt-[26px] px-[32px] pb-[60px]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-[7px] border-0 bg-transparent p-0 text-[11.5px] text-ink-muted hover:text-accent-strong"
        >
          <ArrowLeftIcon size={13} />
          {t("person.back")}
        </button>

        <div className="mt-5 grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-4">
          <span
            className="grid h-[52px] w-[52px] place-items-center rounded-full text-[15px] font-bold text-on-tint"
            style={{ background: tintFor(ownerId) }}
          >
            {initials(principalName)}
          </span>
          <span className="grid min-w-0">
            <h1 className="m-0 text-[26px] font-[560] tracking-[-0.035em]">
              {principalName}
            </h1>
            <span className="mt-[7px] flex items-center gap-2.5">
              <span className="text-[12px] text-faint">
                {t("pulse.card.role")}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted">
                <span
                  className={cn("h-1.5 w-1.5 rounded-full", repDotClass)}
                />
                {repText}
              </span>
            </span>
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              onClick={onOpenChat}
              className="h-8 cursor-pointer rounded-btn border border-line2 bg-transparent px-3.5 text-[12px] text-ink hover:border-accent-strong hover:text-accent-strong"
            >
              {t("person.dm")}
            </button>
            <button
              type="button"
              onClick={onOpenChat}
              className="h-8 cursor-pointer rounded-btn border-0 bg-accent-strong px-3.5 text-[12px] font-[620] text-on-accent"
            >
              {t("person.atRep")}
            </button>
          </span>
        </div>

        {summaryText ? (
          <p className="mt-[22px] max-w-[660px] rounded-[13px] border border-accent-soft bg-accent-soft py-[16px] px-[18px] text-[13px] leading-[1.75] text-ink [text-wrap:pretty]">
            <strong className="font-[650]">{t("person.says")}</strong>{" "}
            {summaryText}
          </p>
        ) : null}

        <div className="mt-[30px] flex items-center gap-2.5">
          <strong className="text-[14px] font-[620]">
            {t("person.main")}
          </strong>
          <span className="font-mono text-[10.5px] text-faint">
            {main.id.slice(0, 8)}
          </span>
        </div>
        <div className="mt-3 rounded-card border border-line bg-panel2 py-[18px] px-[20px]">
          <PhaseChip phase={main.phase} size="md" />
          <h2 className="mt-3 text-[18px] font-[570] leading-[1.35] tracking-[-0.02em] [text-wrap:pretty]">
            {main.title}
          </h2>
          {noteText ? (
            <p className="mt-3 max-w-[620px] text-[13px] leading-[1.75] text-ink-muted [text-wrap:pretty]">
              {noteText}
            </p>
          ) : null}
          <div className="mt-4 flex items-center gap-5 border-t border-line pt-3.5">
            <span className="inline-flex items-center gap-2">
              <span className="relative h-1 w-[52px] overflow-hidden rounded-[2px] bg-line2">
                <span
                  className={cn("absolute inset-y-0 left-0", mainTone.dot)}
                  style={{ width: `${confidencePercent(main.confidence)}%` }}
                />
              </span>
              <span className="font-mono text-[10.5px] text-ink-muted">
                {t("person.confidence", {
                  value: confidencePercent(main.confidence),
                })}
              </span>
            </span>
            <span className="text-[11.5px] text-faint">
              {t("person.changes", { count: main.changedFields.length })}
            </span>
            <span
              className={cn("ml-auto font-mono text-[10.5px]", freshColorClass)}
            >
              {formatRelative(main.freshnessAt)}
            </span>
          </div>
        </div>

        <div className="mt-[30px] flex items-center gap-2.5">
          <strong className="text-[14px] font-[620]">
            {t("person.subs")}
          </strong>
          <span className="font-mono text-[10.5px] text-faint">
            {subs.length}
          </span>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {subs.map((sub) => {
            const dim = sub.phase === "completed" || sub.phase === "paused";
            return (
              <div
                key={sub.id}
                className="grid grid-cols-[minmax(0,1fr)_90px_84px] items-center gap-3.5 rounded-inset border border-line bg-panel2 py-[13px] px-[16px]"
              >
                <span
                  className={cn(
                    "truncate text-[12.5px]",
                    dim ? "text-faint" : "text-ink",
                  )}
                >
                  {sub.title}
                </span>
                <PhaseChip phase={sub.phase} size="sm" />
                <span className="text-right font-mono text-[10px] text-faint">
                  {formatRelative(sub.freshnessAt)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-[30px]">
          <strong className="text-[14px] font-[620]">
            {t("person.checkpoints")}
          </strong>
          <p className="mt-2 max-w-[560px] text-[11.5px] leading-[1.65] text-faint">
            {t("person.checkpointsLede")}
          </p>
          {checkpoints.length === 0 ? (
            <p className="mt-4 text-[12.5px] text-ink-muted">
              {t("person.checkpointsEmpty")}
            </p>
          ) : (
            <div className="relative mt-4 pl-6">
              <span className="absolute top-2 bottom-3 left-[5px] w-px bg-line2" />
              {checkpoints.map((event) => (
                <div
                  key={`${event.sequence}-${event.aggregateId}`}
                  className="relative pb-5"
                >
                  <span className="absolute -left-6 top-[5px] h-[11px] w-[11px] rounded-full border-2 border-accent-strong bg-bg" />
                  <div className="flex items-center gap-2.5">
                    <span className="text-[11px] font-[650] text-accent-strong">
                      {event.eventType}
                    </span>
                    <time className="font-mono text-[9.5px] text-faint">
                      {formatTime(event.occurredAt)}
                    </time>
                  </div>
                  <p className="mt-2 max-w-[600px] text-[12.5px] leading-[1.7] text-ink [text-wrap:pretty]">
                    {event.aggregateType} · {event.eventType}
                  </p>
                  <div className="mt-1.5 font-mono text-[9.5px] text-faint">
                    seq {event.sequence}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <aside className="h-full overflow-auto border-l border-line bg-panel pt-[26px] px-[24px] pb-[50px]">
        <div className="rounded-inset bg-raise py-[15px] px-[16px]">
          <div className="text-[10.5px] font-[650] tracking-[0.08em] text-faint">
            {t("person.confHow")}
          </div>
          <p className="mt-2.5 text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
            {t("person.confNote", {
              value: confidencePercent(main.confidence),
            })}
          </p>
          {main.contradictionClaimIds.length > 0 ? (
            <p className="mt-2 text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
              {t("person.confContradictions", {
                count: main.contradictionClaimIds.length,
              })}
            </p>
          ) : null}
        </div>

        {dependencies.length > 0 ? (
          <div className="mt-[22px]">
            <div className="text-[10.5px] font-[650] tracking-[0.08em] text-faint">
              {t("person.waitingOn")}
            </div>
            <div className="mt-[11px] flex flex-col gap-2">
              {dependencies.map((dependency, index) => (
                <div
                  key={`${dependency.workstreamId}-${index}`}
                  className="rounded-[11px] border border-danger-soft bg-danger-soft py-3 px-[13px]"
                >
                  <span className="font-mono text-[10.5px] text-danger">
                    {dependency.workstreamId.slice(0, 8)}
                  </span>
                  <p className="mt-1.5 text-[12px] leading-[1.55] text-ink [text-wrap:pretty]">
                    {dependency.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {blockers.length > 0 ? (
          <div className="mt-[22px]">
            <div className="text-[10.5px] font-[650] tracking-[0.08em] text-faint">
              {t("person.blockers")}
            </div>
            <div className="mt-[11px] flex flex-col gap-2">
              {blockers.map((blocker, index) => (
                <div
                  key={`${blocker.workstreamId}-${index}`}
                  className="rounded-[11px] border border-line bg-panel2 py-3 px-[13px]"
                >
                  <span className="font-mono text-[10.5px] text-faint">
                    {blocker.workstreamId.slice(0, 8)}
                  </span>
                  <p className="mt-1.5 text-[12px] leading-[1.55] text-ink [text-wrap:pretty]">
                    {blocker.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {groups.length > 0 ? (
          <div className="mt-[22px]">
            <div className="text-[10.5px] font-[650] tracking-[0.08em] text-faint">
              {t("person.groups")}
            </div>
            <div className="mt-[11px] flex flex-col gap-2">
              {groups.map((item) => (
                <button
                  key={item.thread.id}
                  type="button"
                  onClick={onOpenChat}
                  className="group relative grid w-full gap-1.5 overflow-hidden rounded-[11px] border border-transparent bg-transparent py-3 px-[13px] text-left text-ink hover:border-accent-strong"
                >
                  <span
                    className="pointer-events-none absolute inset-0 animate-dash-flow rounded-[11px] group-hover:opacity-0"
                    style={{
                      backgroundImage:
                        "linear-gradient(90deg, var(--intero-line2) 0 7px, transparent 7px 14px), linear-gradient(90deg, var(--intero-line2) 0 7px, transparent 7px 14px), linear-gradient(180deg, var(--intero-line2) 0 7px, transparent 7px 14px), linear-gradient(180deg, var(--intero-line2) 0 7px, transparent 7px 14px)",
                      backgroundSize: "14px 1px, 14px 1px, 1px 14px, 1px 14px",
                      backgroundPosition: "0 0, 0 100%, 0 0, 100% 0",
                      backgroundRepeat: "repeat-x, repeat-x, repeat-y, repeat-y",
                    }}
                  />
                  <span className="text-[12px] font-[600]">
                    {item.thread.title}
                  </span>
                  <span className="justify-self-start rounded-pill bg-accent-soft px-2 py-[3px] text-[9.5px] font-[620] text-accent-strong">
                    {t("person.groupMembers", {
                      count: item.thread.participantIds.length,
                    })}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <p className="mt-6 rounded-[11px] bg-raise py-[14px] px-[15px] text-[11px] leading-[1.7] text-faint [text-wrap:pretty]">
          {t("person.footer")}
        </p>
      </aside>
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
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill font-[620]",
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
