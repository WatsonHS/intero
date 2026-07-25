import { ChatCircleDotsIcon } from "@phosphor-icons/react";
import type { PublicWorkProjection } from "@intero/domain";
import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import {
  AttentionItem,
  Avatar,
  AvatarFallback,
  Card,
  CardContent,
  CardHeader,
  ConfidenceBar,
  EmptyState,
  FreshnessLabel,
  LoadingRows,
  PhaseLabel,
} from "@intero/ui";

import {
  getActionInbox,
  getOfflineStatus,
  getTeamPulse,
  getThreads,
} from "../api.js";
import { useI18n } from "../i18n/index.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";

export function TeamPulseView({
  onOpenRepresentative,
  onOpenAction,
}: {
  onOpenRepresentative: () => void;
  onOpenAction: (sourceRef: string) => void;
}) {
  const { formatDate, formatRelative, t } = useI18n();
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
  const principalNames = new Map(
    pulse.data?.principals.map((principal) => [
      principal.id,
      principal.displayName,
    ]) ?? [],
  );
  const latestRepresentativeMessage =
    representativeThreads.data?.items[0]?.messages
      .filter((message) => message.serverReadable)
      .at(-1);
  const visibleProjections =
    pulse.data?.projections.filter(
      (item) => item.phase !== "completed" && item.phase !== "paused",
    ) ?? [];
  const people = groupByOwner(visibleProjections);

  return (
    <div className="pulse-layout">
      <section className="pulse-main">
        <header className="view-header">
          <div>
            <p className="eyebrow">{formatDate(new Date())}</p>
            <h1>{t("pulse.title")}</h1>
            <p className="view-header__lede">{t("pulse.lede")}</p>
          </div>
          <div className="pulse-runtime-card">
            <span
              className={
                !runtime.data || runtime.data.stale
                  ? "runtime-dot runtime-dot--stale"
                  : "runtime-dot"
              }
            />
            <span>
              <strong>
                {runtime.isPending
                  ? t("general.loading")
                  : runtime.data?.fallback === "public"
                    ? t("pulse.publicFallback")
                    : runtime.data?.fallback === "local"
                      ? t("pulse.localRuntime")
                      : t("general.unavailable")}
              </strong>
              <small>
                {runtime.isPending
                  ? t("pulse.checkingFreshness")
                  : runtime.data?.localRuntime === "online"
                    ? t("app.localConnected")
                    : runtime.data?.freshnessAt
                      ? formatRelative(runtime.data.freshnessAt)
                      : t("general.none")}
              </small>
            </span>
          </div>
        </header>

        <div className="pulse-summary">
          <div>
            <span className="pulse-summary__number">
              {pulse.data ? people.length : "—"}
            </span>
            <span>{t("pulse.activePeople")}</span>
          </div>
          <div>
            <span className="pulse-summary__number">
              {pulse.data ? visibleProjections.length : "—"}
            </span>
            <span>{t("pulse.runningWorkstreams")}</span>
          </div>
          <div>
            <span className="pulse-summary__number pulse-summary__number--accent">
              {inbox.data?.items.length ?? "—"}
            </span>
            <span>{t("pulse.needsPeople")}</span>
          </div>
          <span className="pulse-live">
            <span className="runtime-dot" aria-hidden="true" />
            {t("general.live")}
          </span>
        </div>

        <div className="section-heading">
          <div>
            <p className="eyebrow">{t("pulse.concurrentWork")}</p>
            <h2>{t("pulse.whereTeamIs")}</h2>
          </div>
        </div>

        {pulse.isPending ? <LoadingRows label={t("general.loading")} /> : null}
        {pulse.isError ? (
          <div className="inline-error">
            <strong>{t("pulse.unavailable")}</strong>
            <span>{pulse.error.message}</span>
            <button type="button" onClick={() => void pulse.refetch()}>
              {t("general.retry")}
            </button>
          </div>
        ) : null}
        {pulse.data && visibleProjections.length === 0 ? (
          <EmptyState
            title={t("pulse.emptyTitle")}
            detail={t("pulse.emptyDetail")}
          />
        ) : null}
        <div className="people-work-grid">
          {people.map(({ ownerId, workstreams }, index) => {
            const mainWorkstream = chooseMainWorkstream(workstreams);
            const otherWorkstreams = workstreams.filter(
              (item) => item.id !== mainWorkstream.id,
            );
            const ownerName =
              principalNames.get(ownerId) ?? ownerId.slice(0, 8);
            const stale =
              Date.now() - Date.parse(mainWorkstream.freshnessAt) >
              (pulse.data?.staleAfterSeconds ?? 300) * 1_000;

            return (
              <Card
                className="person-work-card gap-0"
                key={ownerId}
                style={{ "--row-index": index } as CSSProperties}
              >
                <CardHeader className="person-work-card__owner p-0">
                  <Avatar className="person-work-card__avatar">
                    <AvatarFallback className="person-avatar">
                      {ownerInitials(ownerName)}
                    </AvatarFallback>
                  </Avatar>
                  <span>
                    <strong>{ownerName}</strong>
                    <small>{t("pulse.maintainedByRepresentative")}</small>
                  </span>
                  <FreshnessLabel
                    timestamp={mainWorkstream.freshnessAt}
                    stale={stale}
                    label={formatRelative(mainWorkstream.freshnessAt)}
                  />
                </CardHeader>

                <CardContent className="p-0">
                  <p className="person-work-card__summary">
                    {meaningfulDetail(
                      mainWorkstream,
                      t("pulse.noMeaningfulChange"),
                    )}
                  </p>

                  <div className="person-work-card__primary">
                    <div className="person-work-card__title">
                      <PhaseLabel
                        phase={mainWorkstream.phase}
                        label={t(
                          `phase.${mainWorkstream.phase}` as TranslationKey,
                        )}
                      />
                      <h3>{mainWorkstream.title}</h3>
                    </div>
                    <div className="person-work-card__meta">
                      <ConfidenceBar
                        value={mainWorkstream.confidence}
                        label={t("confidence.label", {
                          value: Math.round(mainWorkstream.confidence * 100),
                        })}
                      />
                      <span>
                        {t("pulse.meaningfulChanges", {
                          count: mainWorkstream.changedFields.length,
                        })}
                      </span>
                    </div>
                  </div>

                  {otherWorkstreams.length > 0 ? (
                    <details className="person-work-card__more">
                      <summary>
                        <span>
                          {t("pulse.moreWorkstreams", {
                            count: otherWorkstreams.length,
                          })}
                        </span>
                        <span aria-hidden="true">＋</span>
                      </summary>
                      <div className="person-work-card__secondary-list">
                        {otherWorkstreams.map((workstream) => (
                          <div
                            className="person-work-card__secondary"
                            key={workstream.id}
                          >
                            <PhaseLabel
                              phase={workstream.phase}
                              label={t(
                                `phase.${workstream.phase}` as TranslationKey,
                              )}
                            />
                            <strong>{workstream.title}</strong>
                            <FreshnessLabel
                              timestamp={workstream.freshnessAt}
                              label={formatRelative(workstream.freshnessAt)}
                            />
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : (
                    <div className="person-work-card__single">
                      1 {t("pulse.runningWorkstreams")}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <aside className="attention-rail">
        <div className="attention-rail__header">
          <h2>{t("pulse.actionInbox")}</h2>
          <span className="count-badge">{inbox.data?.items.length ?? 0}</span>
        </div>
        <p className="attention-rail__lede">{t("pulse.onlyNeedsYou")}</p>
        <div className="attention-list">
          {inbox.isPending ? <p>{t("general.loading")}</p> : null}
          {inbox.isError ? (
            <div className="inline-error">
              <strong>{t("general.unavailable")}</strong>
              <button type="button" onClick={() => void inbox.refetch()}>
                {t("general.retry")}
              </button>
            </div>
          ) : null}
          {inbox.data?.items.map((item) => (
            <AttentionItem
              key={item.id}
              eyebrow={t(`inbox.${item.kind}` as TranslationKey)}
              title={item.title}
              detail={item.detail}
              onOpen={() => onOpenAction(item.sourceRef)}
            />
          ))}
          {inbox.data?.items.length === 0 ? (
            <p className="quiet-copy">{t("pulse.emptyInbox")}</p>
          ) : null}
        </div>

        <Card className="representative-peek gap-0">
          <div className="representative-peek__identity">
            <span className="representative-mark" aria-hidden="true">
              IR
            </span>
            <span>
              <strong>{t("pulse.yourRepresentative")}</strong>
              <small>{t("pulse.oneIdentity")}</small>
            </span>
          </div>
          <span className="representative-peek__eyebrow">
            {t("pulse.recentRepresentative")}
          </span>
          <p>
            {latestRepresentativeMessage?.body ??
              t("pulse.noRepresentativeMessage")}
          </p>
          <button type="button" onClick={onOpenRepresentative}>
            <ChatCircleDotsIcon size={17} />
            {t("pulse.openThread")}
          </button>
        </Card>
      </aside>
    </div>
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

function ownerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts.at(-1)![0] ?? ""}`.toUpperCase();
}
