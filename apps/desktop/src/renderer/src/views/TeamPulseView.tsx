import { ChatCircleDotsIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import {
  AttentionItem,
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

  return (
    <div className="pulse-layout">
      <section className="pulse-main">
        <header className="view-header">
          <div>
            <p className="eyebrow">{formatDate(new Date())}</p>
            <h1>{t("pulse.title")}</h1>
            <p className="view-header__lede">{t("pulse.lede")}</p>
          </div>
        </header>

        <div className="pulse-summary">
          <div>
            <span className="pulse-summary__number">
              {pulse.data?.projections.length ?? "—"}
            </span>
            <span>{t("pulse.activeWorkstreams")}</span>
          </div>
          <div>
            <span className="pulse-summary__number">
              {pulse.data?.projections.filter(
                (item) => item.phase === "blocked",
              ).length ?? "—"}
            </span>
            <span>{t("pulse.blockedWorkstreams")}</span>
          </div>
          <div className="runtime-readout">
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
        {pulse.data?.projections.length === 0 ? (
          <EmptyState
            title={t("pulse.emptyTitle")}
            detail={t("pulse.emptyDetail")}
          />
        ) : null}
        <div className="workstream-list">
          {pulse.data?.projections.map((workstream, index) => (
            <article
              className="workstream-row"
              key={workstream.id}
              style={{ "--row-index": index } as CSSProperties}
            >
              <div className="workstream-row__owner">
                <span className="person-avatar">
                  {ownerInitials(
                    principalNames.get(workstream.ownerId) ??
                      workstream.ownerId,
                  )}
                </span>
                <span>
                  <strong>
                    {principalNames.get(workstream.ownerId) ??
                      workstream.ownerId.slice(0, 8)}
                  </strong>
                  <small>{t("pulse.owner")}</small>
                </span>
              </div>
              <div className="workstream-row__body">
                <div className="workstream-row__title">
                  <PhaseLabel
                    phase={workstream.phase}
                    label={t(`phase.${workstream.phase}` as TranslationKey)}
                  />
                  <h3>{workstream.title}</h3>
                </div>
                <p>
                  {workstream.blockers[0] ??
                    workstream.dependencies[0] ??
                    workstream.decisions[0] ??
                    t("pulse.noMeaningfulChange")}
                </p>
                <div className="workstream-row__meta">
                  <FreshnessLabel
                    timestamp={workstream.freshnessAt}
                    stale={
                      Date.now() - Date.parse(workstream.freshnessAt) >
                      (pulse.data?.staleAfterSeconds ?? 300) * 1_000
                    }
                    label={formatRelative(workstream.freshnessAt)}
                  />
                  <ConfidenceBar
                    value={workstream.confidence}
                    label={t("confidence.label", {
                      value: Math.round(workstream.confidence * 100),
                    })}
                  />
                  <span>
                    {t("pulse.meaningfulChanges", {
                      count: workstream.changedFields.length,
                    })}
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className="attention-rail">
        <div className="attention-rail__header">
          <div>
            <p className="eyebrow">{t("pulse.onlyNeedsYou")}</p>
            <h2>{t("pulse.actionInbox")}</h2>
          </div>
          <span className="count-badge">{inbox.data?.items.length ?? 0}</span>
        </div>
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

        <div className="representative-peek">
          <div className="representative-peek__identity">
            <span className="representative-mark" aria-hidden="true">
              IR
            </span>
            <span>
              <strong>{t("pulse.yourRepresentative")}</strong>
              <small>{t("pulse.oneIdentity")}</small>
            </span>
          </div>
          <p>
            {latestRepresentativeMessage?.body ??
              t("pulse.noRepresentativeMessage")}
          </p>
          <button type="button" onClick={onOpenRepresentative}>
            <ChatCircleDotsIcon size={17} />
            {t("pulse.openThread")}
          </button>
        </div>
      </aside>
    </div>
  );
}

function ownerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts.at(-1)![0] ?? ""}`.toUpperCase();
}
