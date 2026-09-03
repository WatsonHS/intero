import { GitBranchIcon } from "@phosphor-icons/react";
import type { PilotCoordinationBrief, ThreadMessage } from "@intero/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { correctInteroScope } from "../../api.js";
import { cn } from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";
import type { AmbiguousCoordinationScope } from "./constants.js";

export function CoordinationCard({
  message,
  principalNames,
  onOpenCoordination,
}: {
  message: ThreadMessage;
  principalNames: Map<string, string>;
  onOpenCoordination?: ((threadId: string) => void) | undefined;
}) {
  const { t } = useI18n();
  const summary = message.coordinationSummary;
  if (!summary) return null;
  const statusLabel =
    summary.status === "resolved"
      ? t("chat.coordination.status.resolved")
      : summary.status === "needs_action"
        ? t("chat.coordination.status.needsAction")
        : summary.status === "waiting"
          ? t("chat.coordination.status.waiting")
          : t("chat.coordination.status.open");
  return (
    <article
      data-testid={`coordination-summary-${message.id}`}
      className="rounded-card border border-amber-soft bg-amber-soft p-[17px_19px]"
    >
      <div className="flex items-center gap-2">
        <GitBranchIcon size={16} className="text-amber" />
        <strong className="text-[12.5px] font-[650] text-ink">
          {t("chat.coordination.summary")}
        </strong>
        <span className="rounded-pill bg-panel px-2 py-0.5 text-[10px] text-amber">
          {statusLabel}
        </span>
        <span className="ml-auto font-mono text-[9.5px] text-faint">
          {summary.boundaryKey}
        </span>
      </div>
      <p className="mt-2.5 text-[13px] leading-[1.7] text-ink">
        {summary.situation}
      </p>
      <p className="mt-2 text-[11.5px] leading-[1.65] text-ink-muted">
        {summary.conclusion || summary.unresolvedQuestion}
      </p>
      {summary.scope ? (
        <div
          data-testid={`coordination-scope-${message.id}`}
          className="mt-3 flex flex-wrap items-center gap-2 text-[10.5px] text-ink-muted"
        >
          <span className="rounded-pill bg-panel px-2 py-1 font-[620] text-ink">
            {t(`chat.coordination.scope.${summary.scope.kind}`)}
          </span>
          {summary.scope.kind !== "ambiguous" ? (
            <span>
              {t("chat.coordination.scopeProjectCount", {
                count: summary.scope.projectIds.length,
              })}
            </span>
          ) : null}
        </div>
      ) : null}
      {summary.brief ? (
        <CoordinationBriefView
          brief={summary.brief}
          principalNames={principalNames}
        />
      ) : null}
      {summary.interoRequestId && summary.scope?.kind === "ambiguous" ? (
        <InteroScopeCorrection
          requestId={summary.interoRequestId}
          scope={summary.scope}
        />
      ) : null}
      {!summary.interoRequestId || summary.brief ? (
        <button
          type="button"
          onClick={() => onOpenCoordination?.(summary.coordinationThreadId)}
          className="mt-3 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-btn border border-amber bg-transparent px-3 text-[11.5px] text-amber hover:bg-panel"
        >
          <GitBranchIcon size={13} />
          {t("chat.coordination.open")}
        </button>
      ) : null}
    </article>
  );
}

function CoordinationBriefView({
  brief,
  principalNames,
}: {
  brief: PilotCoordinationBrief;
  principalNames: Map<string, string>;
}) {
  const { formatRelative, t } = useI18n();
  return (
    <section
      data-testid="coordination-layered-brief"
      className="mt-3 rounded-[12px] border border-amber/25 bg-panel/80 p-3.5"
    >
      <strong className="block text-[12.5px] font-[680] text-ink">
        {brief.headline}
      </strong>
      <dl className="mt-3 grid gap-2.5 sm:grid-cols-2">
        <div>
          <dt className="text-[9.5px] font-[650] uppercase tracking-[0.08em] text-faint">
            {t("chat.coordination.whatChanged")}
          </dt>
          <dd className="mt-1 text-[11.5px] leading-[1.55] text-ink-muted">
            {brief.whatChanged}
          </dd>
        </div>
        <div>
          <dt className="text-[9.5px] font-[650] uppercase tracking-[0.08em] text-faint">
            {t("chat.coordination.whyItMatters")}
          </dt>
          <dd className="mt-1 text-[11.5px] leading-[1.55] text-ink-muted">
            {brief.whyItMatters}
          </dd>
        </div>
      </dl>
      {brief.needsFromYou ? (
        <div className="mt-3 rounded-[10px] bg-amber-soft px-3 py-2 text-[11.5px] leading-[1.55] text-ink">
          <strong>{t("chat.coordination.needsFromYou")}: </strong>
          {brief.needsFromYou}
        </div>
      ) : null}
      {brief.options.length > 0 ? (
        <div className="mt-3 grid gap-1.5">
          <span className="text-[9.5px] font-[650] uppercase tracking-[0.08em] text-faint">
            {t("chat.coordination.options")}
          </span>
          {brief.options.map((option) => (
            <div
              key={option.id}
              className="rounded-[9px] border border-line-soft bg-canvas px-2.5 py-2 text-[11px] text-ink"
            >
              <strong>{option.label}</strong>
              {option.tradeoff ? (
                <span className="ml-1 text-ink-muted">— {option.tradeoff}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {brief.humanDecision ? (
        <div
          data-testid="coordination-human-decision"
          className="mt-3 rounded-[10px] border border-green-soft bg-green-soft px-3 py-2 text-[11.5px] leading-[1.55] text-ink"
        >
          <strong>{t("chat.coordination.humanDecision")}: </strong>
          {brief.humanDecision.outcome}
          <small className="mt-1 block text-[10px] text-ink-muted">
            {brief.humanDecision.decidedBy
              .map(
                (principalId) =>
                  principalNames.get(principalId) ?? principalId.slice(0, 8),
              )
              .join(", ")}
            {" · "}
            {formatRelative(brief.humanDecision.confirmedAt)}
          </small>
        </div>
      ) : null}
      {brief.facts.length > 0 || brief.interpretations.length > 0 ? (
        <details className="mt-3 text-[11px] text-ink-muted">
          <summary className="cursor-pointer font-[620] text-ink">
            {t("chat.coordination.evidence")}
          </summary>
          <div className="mt-2 grid gap-2">
            {brief.facts.map((fact) => (
              <div key={`${fact.label}:${fact.sourceRef}`}>
                <strong className="text-ink">{fact.label}: </strong>
                {fact.value}
                <code className="ml-1 text-[9.5px] text-faint">
                  {fact.sourceRef}
                </code>
              </div>
            ))}
            {brief.interpretations.map((interpretation) => (
              <div key={interpretation.statement}>
                {interpretation.statement}
                <span className="ml-1 rounded-pill bg-raise px-1.5 py-0.5 text-[9px] text-faint">
                  {interpretation.confidence}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function InteroScopeCorrection({
  requestId,
  scope,
}: {
  requestId: string;
  scope: AmbiguousCoordinationScope;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [teamScopeSelected, setTeamScopeSelected] = useState(false);
  const mutation = useMutation({
    mutationFn: () =>
      teamScopeSelected
        ? correctInteroScope({ requestId, scopeKind: "team" })
        : correctInteroScope({ requestId, projectIds: selectedProjectIds }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  return (
    <section
      data-testid={`intero-scope-correction-${requestId}`}
      className="mt-3 rounded-[12px] border border-line bg-panel p-3"
    >
      <strong className="text-[11.5px] font-[650] text-ink">
        {t("chat.coordination.correctScope")}
      </strong>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {scope.candidates.map((candidate) => {
          const selected = selectedProjectIds.includes(candidate.projectId);
          return (
            <button
              type="button"
              key={candidate.projectId}
              aria-pressed={selected}
              onClick={() => {
                setTeamScopeSelected(false);
                setSelectedProjectIds((current) =>
                  current.includes(candidate.projectId)
                    ? current.filter((id) => id !== candidate.projectId)
                    : [...current, candidate.projectId],
                );
              }}
              className={cn(
                "cursor-pointer rounded-pill border px-2.5 py-1.5 text-[10.5px]",
                selected
                  ? "border-accent bg-accent-soft text-accent-strong"
                  : "border-line bg-canvas text-ink-muted hover:text-ink",
              )}
            >
              {candidate.name}
            </button>
          );
        })}
        <button
          type="button"
          data-testid="intero-scope-team"
          aria-pressed={teamScopeSelected}
          onClick={() => {
            setTeamScopeSelected((selected) => !selected);
            setSelectedProjectIds([]);
          }}
          className={cn(
            "cursor-pointer rounded-pill border px-2.5 py-1.5 text-[10.5px]",
            teamScopeSelected
              ? "border-accent bg-accent-soft text-accent-strong"
              : "border-line bg-canvas text-ink-muted hover:text-ink",
          )}
        >
          {t("chat.coordination.teamScope")}
        </button>
      </div>
      <button
        type="button"
        disabled={
          (!teamScopeSelected && selectedProjectIds.length === 0) ||
          mutation.isPending
        }
        onClick={() => mutation.mutate()}
        className="mt-2.5 inline-flex h-8 cursor-pointer items-center rounded-btn border-0 bg-ink px-3 text-[11px] text-canvas disabled:cursor-not-allowed disabled:opacity-45"
      >
        {mutation.isPending
          ? t("chat.coordination.correctingScope")
          : t("chat.coordination.applyScope")}
      </button>
      {mutation.isError ? (
        <p className="mt-2 text-[10.5px] text-danger">
          {mutation.error instanceof Error
            ? mutation.error.message
            : t("chat.coordination.scopeCorrectionFailed")}
        </p>
      ) : null}
    </section>
  );
}
