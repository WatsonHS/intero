import { CheckCircleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

import { getBootstrap, getTeamPulse, getThreads } from "../api.js";
import { initials, tintFor } from "../design/utils.js";
import { useI18n } from "../i18n/index.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";

export function CoordinationView() {
  const { formatTime, t } = useI18n();
  const threads = useQuery({
    queryKey: ["threads", "coordination"],
    queryFn: ({ signal }) => getThreads("coordination", signal),
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

  const current = threads.data?.items[0];

  const principalNames = new Map<string, string>();
  for (const principal of pulse.data?.principals ?? []) {
    principalNames.set(principal.id, principal.displayName);
  }
  for (const principal of current?.principals ?? []) {
    principalNames.set(principal.id, principal.displayName);
  }
  if (bootstrap.data) {
    principalNames.set(
      bootstrap.data.currentPrincipal.id,
      bootstrap.data.currentPrincipal.displayName,
    );
    principalNames.set(
      bootstrap.data.representativePrincipal.id,
      bootstrap.data.representativePrincipal.displayName,
    );
  }
  function nameOf(id: string): string {
    return principalNames.get(id) ?? id.slice(0, 8);
  }

  if (threads.isLoading) {
    return (
      <div className="animate-view-enter grid h-full place-items-center p-[34px]">
        <p className="text-[13px] text-ink-muted">{t("general.loading")}</p>
      </div>
    );
  }

  if (threads.isError) {
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

  if (!current) {
    return (
      <div className="animate-view-enter grid h-full place-items-center p-[34px]">
        <div className="grid max-w-[440px] justify-items-center gap-2.5 rounded-container border border-dashed border-line2 p-[54px_44px] text-center">
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

  // Compute the aside's scope-ownership map: union of resourceScope per
  // envelope actor, drawn from the thread's resolved coordination actions.
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

  // The last coordination_action message that has a matching resolved
  // action is the terminal, resolved node in the timeline.
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

  return (
    <div className="animate-view-enter grid h-full grid-cols-[minmax(0,1fr)_340px] grid-rows-[minmax(0,1fr)]">
      <div className="h-full overflow-auto p-[34px_34px_60px]">
        <p className="text-[11px] font-[650] tracking-[0.1em] text-accent-strong">
          {t("coord.eyebrow")}
        </p>
        <h1 className="mt-2.5 text-[28px] font-[540] tracking-[-0.035em] text-ink">
          {current.thread.title}
        </h1>
        <p className="mt-3 max-w-[600px] text-[13px] leading-[1.75] text-ink-muted [text-wrap:pretty]">
          {t("coord.lede")}
        </p>

        <div className="relative mt-[30px] pl-[26px]">
          <span className="absolute left-[6px] top-2 bottom-6 w-px bg-line2" />
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
            const stateColorClass = isLastResolved
              ? "text-green"
              : isHumanEscalation
                ? "text-danger"
                : "text-ink-muted";
            const ringColorClass = isLastResolved
              ? "border-green"
              : isHumanEscalation
                ? "border-danger"
                : "border-ink-muted";
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
              <div className="relative pb-6" key={message.id}>
                <span
                  className={`absolute -left-[26px] top-[5px] h-[13px] w-[13px] rounded-full bg-bg border-2 ${ringColorClass}`}
                />
                <div className="flex items-center gap-2.5">
                  <span
                    className={`text-[10px] font-[700] tracking-[0.08em] ${stateColorClass}`}
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
                <div className="mt-2 font-mono text-[9.5px] text-faint">
                  {meta}
                </div>
                {isHumanEscalation ? (
                  action ? (
                    <div className="mt-[13px] inline-flex items-center gap-2 rounded-[9px] bg-green-soft px-[13px] py-[9px] text-[12px] text-green">
                      <CheckCircleIcon size={14} weight="fill" />
                      {t("coord.resolved")}
                    </div>
                  ) : (
                    <p className="mt-[13px] text-[12px] text-danger">
                      {t("coord.decisionNote")}
                    </p>
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <aside className="h-full overflow-auto border-l border-line bg-panel p-[34px_26px_50px]">
        <div className="text-[10.5px] font-[650] tracking-[0.08em] text-faint">
          {t("coord.scopeTitle")}
        </div>

        {[...scopesByActor.entries()].map(([actorId, scopes]) => (
          <div
            className="mt-3.5 rounded-[13px] border border-line bg-panel2 p-[15px_16px]"
            key={actorId}
          >
            <div className="flex items-center gap-[9px]">
              <span
                className="grid h-6 w-6 place-items-center rounded-full text-[8.5px] font-[650] text-on-tint"
                style={{ background: tintFor(actorId) }}
              >
                {initials(nameOf(actorId))}
              </span>
              <strong className="text-[12px] font-bold text-ink">
                {t("coord.owns", { name: nameOf(actorId) })}
              </strong>
            </div>
            <div className="mt-3 grid gap-1.5">
              {[...scopes].map((scope) => (
                <div
                  className="rounded-quiet bg-raise p-[8px_11px] font-mono text-[10.5px] text-ink-muted"
                  key={scope}
                >
                  {scope}
                </div>
              ))}
            </div>
          </div>
        ))}

        {contestedScopes.length > 0 ? (
          <div className="mt-3 rounded-[13px] border border-dashed border-danger bg-danger-soft p-[15px_16px]">
            <div className="text-[10px] font-[700] tracking-[0.08em] text-danger">
              {t("coord.contested")}
            </div>
            <p className="mt-[9px] text-[12px] leading-[1.65] text-ink [text-wrap:pretty]">
              {t("coord.contestedBody")}{" "}
              <span className="font-mono">{contestedScopes.join(", ")}</span>
            </p>
          </div>
        ) : null}

        <div className="mt-[22px] rounded-[13px] bg-raise p-[15px_16px]">
          <div className="text-[10.5px] font-[650] tracking-[0.08em] text-faint">
            {t("coord.grants")}
          </div>
          <div className="mt-3 grid gap-[9px]">
            {[...grantedActions].map((action) => (
              <div className="flex items-center gap-2 text-[11.5px] text-ink" key={action}>
                <CheckCircleIcon size={13} weight="fill" className="text-green" />
                <span className="font-mono">{action}</span>
              </div>
            ))}
            {grantedActions.size === 0 ? (
              <p className="text-[11.5px] text-faint">{t("general.none")}</p>
            ) : null}
          </div>
          <p className="mt-3 text-[10.5px] text-faint">{t("coord.grantsNote")}</p>
        </div>
      </aside>
    </div>
  );
}
