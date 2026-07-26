import { ArrowLeftIcon, GitPullRequestIcon } from "@phosphor-icons/react";
import type { PilotPulseEntry, PublicWorkProjection } from "@intero/domain";
import { useQuery } from "@tanstack/react-query";

import {
  getActivity,
  getOfflineStatus,
  getTeamPulse,
  getThreads,
} from "../api.js";
import {
  Avatar,
  Meta,
  NarrativeGrid,
  PhaseChip,
  SectionLabel,
  Timeline,
  TimelineEntry,
  cn,
} from "../design/primitives.js";
import {
  PHASE_META,
  confidencePercent,
  freshest,
  isStale,
  loadSummary,
  orderByAttention,
} from "../design/utils.js";
import { useI18n } from "../i18n/index.js";
import { pilotPulseEntryToProjection } from "../pilot/adapters.js";
import { getPilotOverview } from "../pilot/api.js";
import { usePilotOptional } from "../pilot/context.js";
import {
  mergeWorkLines,
  workLineFromNarrative,
  workLineFromProjection,
  type WorkLine,
} from "./work-lines.js";

/**
 * One person's detail page. It is the expanded form of their Team Pulse card:
 * the same parallel workstreams, ordered the same way, with the full narrative
 * each Representative published instead of the two-line summary.
 */
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
  const pilot = usePilotOptional();
  const pilotProject =
    pilot?.projects.data?.projects.find(
      (project) => project.id === pilot.selectedProjectId,
    ) ?? pilot?.projects.data?.projects[0];

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
  const pilotOverview = useQuery({
    queryKey: ["pilot", "overview", pilot?.identityId, pilotProject?.id],
    queryFn: ({ signal }) =>
      getPilotOverview(pilot!.identityId!, pilotProject!.id, signal),
    enabled: Boolean(pilot?.enabled && pilot.identityId && pilotProject),
    refetchInterval: 1_500,
  });

  const pilotEntries = pilotOverview.data?.pulse ?? [];
  const projections = [
    ...(pulse.data?.projections ?? []),
    ...pilotEntries.map(pilotPulseEntryToProjection),
  ];
  const workstreams = [
    ...new Map(
      projections
        .filter((item) => item.ownerId === ownerId)
        .map((item) => [item.id, item]),
    ).values(),
  ];
  const entryByProjectionId = new Map<string, PilotPulseEntry>(
    pilotEntries.map((entry) => [entry.workStateId, entry]),
  );
  const principalName =
    pilotOverview.data?.principals.find((principal) => principal.id === ownerId)
      ?.displayName ??
    pulse.data?.principals.find((principal) => principal.id === ownerId)
      ?.displayName ??
    ownerId.slice(0, 8);
  const pulseReady = pulse.isSuccess || pilotOverview.isSuccess;
  const pulsePending = pulse.isPending && pilotOverview.isPending;
  const offline = runtime.data?.fallback === "public";
  const offlineSyncTime = runtime.data?.freshnessAt
    ? formatRelative(runtime.data.freshnessAt)
    : t("general.none");

  if (!pulseReady || workstreams.length === 0) {
    return (
      <div className="grid h-full grid-cols-[minmax(0,1fr)_340px] grid-rows-[minmax(0,1fr)] animate-view-enter">
        <div className="grid h-full place-items-center overflow-auto px-[32px] pb-[60px] pt-[26px]">
          <div className="grid justify-items-center gap-3 text-center">
            <p className="text-[13px] text-ink-muted">
              {pulsePending ? t("general.loading") : t("person.notFound")}
            </p>
            <button
              type="button"
              onClick={onBack}
              className="inline-flex cursor-pointer items-center gap-[7px] border-0 bg-transparent p-0 text-[11.5px] text-ink-muted hover:text-accent-strong"
            >
              <ArrowLeftIcon size={13} />
              {t("person.back")}
            </button>
          </div>
        </div>
        <aside className="h-full overflow-auto border-l border-line bg-panel px-[24px] pb-[50px] pt-[26px]" />
      </div>
    );
  }

  const staleAfterSeconds = pulse.data?.staleAfterSeconds;
  const ordered = orderByAttention(workstreams);
  const load = loadSummary(workstreams);
  const lead = freshest(workstreams) ?? ordered[0]!;
  const leadStale = isStale(lead.freshnessAt, staleAfterSeconds);
  const loadLabel =
    load.blocked > 0
      ? t("pulse.load.blocked", { total: load.total, blocked: load.blocked })
      : load.live < load.total
        ? t("pulse.load.partial", { total: load.total, live: load.live })
        : t("pulse.load.all", { total: load.total });
  const summaryText =
    lead.decisions[0] ?? lead.blockers[0] ?? lead.dependencies[0];

  const workstreamIds = new Set<string>(workstreams.map((item) => item.id));
  const checkpoints = (activity.data?.items ?? [])
    .filter(
      (event) =>
        event.actorId === ownerId || workstreamIds.has(event.aggregateId),
    )
    .slice(-6)
    .reverse();

  // A dependency is something this person is waiting on; a blocker is what is
  // holding a workstream still. Both are bounded strings from the public
  // contract — nothing here is inferred.
  const dependencies = workstreams.flatMap((workstream) =>
    workstream.dependencies.map((text) => ({
      workstreamId: workstream.id,
      title: workstream.title,
      text,
    })),
  );
  const blockers = workstreams.flatMap((workstream) =>
    workstream.blockers.map((text) => ({
      workstreamId: workstream.id,
      title: workstream.title,
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
      <div className="h-full overflow-auto px-[32px] pb-[60px] pt-[26px]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex cursor-pointer items-center gap-[7px] border-0 bg-transparent p-0 text-[11.5px] text-ink-muted hover:text-accent-strong"
        >
          <ArrowLeftIcon size={13} />
          {t("person.back")}
        </button>

        <div className="mt-5 grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-4">
          <Avatar id={ownerId} name={principalName} size="xl" />
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
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    offline || leadStale ? "bg-amber" : "bg-green",
                  )}
                />
                {offline
                  ? t("person.standInPublic", { time: offlineSyncTime })
                  : t("person.standInLocal", {
                      time: formatRelative(lead.freshnessAt),
                    })}
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
              {t("person.atStandIn")}
            </button>
          </span>
        </div>

        {summaryText ? (
          <p className="mt-[22px] max-w-[660px] rounded-[13px] border border-accent-soft bg-accent-soft px-[18px] py-[16px] text-[13px] leading-[1.75] text-ink [text-wrap:pretty]">
            <strong className="font-[650]">{t("person.says")}</strong>{" "}
            {summaryText}
          </p>
        ) : null}

        <div className="mt-[30px] flex items-center gap-2.5">
          <strong className="text-[14px] font-[620]">
            {t("person.parallel")}
          </strong>
          <Meta tone={load.blocked > 0 ? "danger" : "faint"}>{loadLabel}</Meta>
        </div>
        <p className="mt-[9px] max-w-[620px] text-[11.5px] leading-[1.65] text-faint [text-wrap:pretty]">
          {t("person.parallelLede")}
        </p>
        <div className="mt-3.5 flex flex-col gap-2.5">
          {ordered.map((workstream) => (
            <WorkstreamCard
              key={workstream.id}
              workstream={workstream}
              line={mergeWorkLines(
                workLineFromProjection(workstream),
                entryByProjectionId.get(workstream.id)?.narrative
                  ? workLineFromNarrative(
                      entryByProjectionId.get(workstream.id)!.narrative,
                    )
                  : undefined,
              )}
              stale={isStale(workstream.freshnessAt, staleAfterSeconds)}
              offline={offline}
              offlineSyncTime={offlineSyncTime}
            />
          ))}
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
            <Timeline className="mt-4">
              {checkpoints.map((event) => (
                <TimelineEntry
                  key={`${event.sequence}-${event.aggregateId}`}
                  tone="accent"
                >
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
                  <Meta className="mt-1.5 block text-[9.5px]">
                    seq {event.sequence}
                  </Meta>
                </TimelineEntry>
              ))}
            </Timeline>
          )}
        </div>
      </div>

      <aside className="h-full overflow-auto border-l border-line bg-panel px-[24px] pb-[50px] pt-[26px]">
        <div className="rounded-inset bg-raise px-[16px] py-[15px]">
          <SectionLabel>{t("person.confHow")}</SectionLabel>
          <p className="mt-2.5 text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
            {t("person.confNote", {
              value: confidencePercent(lead.confidence),
            })}
          </p>
          {lead.contradictionClaimIds.length > 0 ? (
            <p className="mt-2 text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
              {t("person.confContradictions", {
                count: lead.contradictionClaimIds.length,
              })}
            </p>
          ) : null}
        </div>

        <RelationList
          label={t("person.waitingOn")}
          tone="danger"
          items={dependencies}
        />
        <RelationList
          label={t("person.blockers")}
          tone="neutral"
          items={blockers}
        />

        {groups.length > 0 ? (
          <div className="mt-[22px]">
            <SectionLabel>{t("person.groups")}</SectionLabel>
            <div className="mt-[11px] flex flex-col gap-2">
              {groups.map((item) => (
                <button
                  key={item.thread.id}
                  type="button"
                  onClick={onOpenChat}
                  className="grid w-full cursor-pointer gap-1.5 rounded-[11px] border border-dashed border-line2 bg-transparent px-[13px] py-3 text-left text-ink hover:border-accent-strong"
                >
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

        <p className="mt-6 rounded-[11px] bg-raise px-[15px] py-[14px] text-[11px] leading-[1.7] text-faint [text-wrap:pretty]">
          {t("person.footer")}
        </p>
      </aside>
    </div>
  );
}

/**
 * One in-flight workstream at full detail: the phase it is in, what backs that
 * claim, and the narrative rows. Blocked work carries the danger surface so it
 * is legible before the text is read.
 */
function WorkstreamCard({
  workstream,
  line,
  stale,
  offline,
  offlineSyncTime,
}: {
  workstream: PublicWorkProjection;
  line: WorkLine;
  stale: boolean;
  offline: boolean;
  offlineSyncTime: string;
}) {
  const { t, formatRelative } = useI18n();
  const blocked = PHASE_META[workstream.phase].tone === "danger";
  const rows: Array<{
    label: string;
    value: string;
    tone?: "default" | "danger";
    mono?: boolean;
  }> = [{ label: t("work.done"), value: line.done ?? t("work.noneReported") }];
  if (line.evidence) {
    rows.push({
      label: t("work.evidence"),
      value: line.evidence,
      mono: true,
    });
  }
  rows.push({
    label: t("work.next"),
    value: line.next ?? t("work.noneReported"),
    ...(blocked ? { tone: "danger" as const } : {}),
  });
  if (line.collaboration) {
    rows.push({ label: t("work.collaboration"), value: line.collaboration });
  }

  return (
    <article
      className={cn(
        "rounded-card border px-[19px] py-[17px]",
        blocked ? "border-danger-soft bg-danger-soft" : "border-line bg-panel2",
      )}
      data-testid={`person-work-card-${workstream.id}`}
    >
      <div className="flex items-center gap-2.5">
        <PhaseChip phase={workstream.phase} size="sm" />
        <Meta>{workstream.id.slice(0, 8)}</Meta>
        {workstream.artifactIds.length > 0 ? (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-faint">
            <GitPullRequestIcon size={12} />
            {workstream.artifactIds.length}
          </span>
        ) : null}
        <Meta tone={offline || stale ? "amber" : "faint"} className="ml-auto">
          {offline
            ? t("pulse.card.syncedAt", { time: offlineSyncTime })
            : formatRelative(workstream.freshnessAt)}
        </Meta>
      </div>
      <h2 className="mt-3 text-[16px] font-[570] leading-[1.4] tracking-[-0.02em] [text-wrap:pretty]">
        {workstream.title}
      </h2>
      {line.focus ? (
        <p className="mt-2.5 max-w-[620px] text-[12.5px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
          {line.focus}
        </p>
      ) : null}
      <NarrativeGrid
        rows={rows}
        labelWidth={54}
        className="mt-3.5 border-t border-line pt-3.5"
      />
    </article>
  );
}

function RelationList({
  label,
  tone,
  items,
}: {
  label: string;
  tone: "danger" | "neutral";
  items: Array<{ workstreamId: string; title: string; text: string }>;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-[22px]">
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-[11px] flex flex-col gap-2">
        {items.map((item, index) => (
          <div
            key={`${item.workstreamId}-${index}`}
            className={cn(
              "rounded-[11px] border px-[13px] py-3",
              tone === "danger"
                ? "border-danger-soft bg-danger-soft"
                : "border-line bg-panel2",
            )}
          >
            <div className="flex items-center gap-2">
              <Meta tone={tone === "danger" ? "danger" : "faint"}>
                {item.workstreamId.slice(0, 8)}
              </Meta>
              <span className="truncate text-[11px] text-ink-muted">
                {item.title}
              </span>
            </div>
            <p className="mt-1.5 text-[12px] leading-[1.55] text-ink [text-wrap:pretty]">
              {item.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
