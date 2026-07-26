import {
  CheckCircleIcon,
  CircleNotchIcon,
  GitBranchIcon,
  HandTapIcon,
} from "@phosphor-icons/react";
import type { PilotCoordinationThread, PrincipalId } from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { getBootstrap, getTeamPulse, getThreads } from "../api.js";
import { initials, tintFor } from "../design/utils.js";
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
} from "../pilot/api.js";
import { usePilotOptional } from "../pilot/context.js";

export function CoordinationView() {
  const pilot = usePilotOptional();
  const queryClient = useQueryClient();
  const { formatRelative, formatTime, t } = useI18n();
  const [selectedThreadId, setSelectedThreadId] = useState<string>();
  const [conclusion, setConclusion] = useState("");
  const [responsibleId, setResponsibleId] = useState<PrincipalId>();
  const pilotProject =
    pilot?.projects.data?.projects.find(
      (project) => project.id === pilot.selectedProjectId,
    ) ?? pilot?.projects.data?.projects[0];
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
  const pilotOverview = useQuery({
    queryKey: ["pilot", "overview", pilot?.identityId, pilotProject?.id],
    queryFn: ({ signal }) =>
      getPilotOverview(pilot!.identityId!, pilotProject!.id, signal),
    enabled: Boolean(pilot?.enabled && pilot.identityId && pilotProject),
    refetchInterval: 1_500,
  });

  const pilotPrincipals = pilotOverview.data?.principals ?? [];
  const pilotItems = (pilotOverview.data?.coordination ?? []).map((thread) =>
    pilotCoordinationToThreadPayload(
      thread,
      pilotPrincipals,
      pilot?.bootstrap.data?.standIn,
    ),
  );
  const items = [...(threads.data?.items ?? []), ...pilotItems];
  const current =
    items.find((item) => item.thread.id === selectedThreadId) ?? items[0];
  const currentPilotThread = pilotOverview.data?.coordination.find(
    (thread) => thread.id === current?.thread.id,
  );

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

  if (threads.isLoading && pilotOverview.isLoading) {
    return (
      <div className="animate-view-enter grid h-full place-items-center p-[34px]">
        <p className="text-[13px] text-ink-muted">{t("general.loading")}</p>
      </div>
    );
  }

  if (threads.isError && pilotOverview.isError) {
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
    <div className="animate-view-enter grid h-full grid-cols-[292px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
      <aside className="flex min-w-0 flex-col border-r border-line bg-panel">
        <header className="border-b border-line p-[18px]">
          <div className="flex items-center gap-2.5">
            <GitBranchIcon size={17} className="text-accent-strong" />
            <strong className="text-[15px] font-[620]">{t("nav.coord")}</strong>
            <span className="ml-auto rounded-pill bg-raise px-2 py-0.5 font-mono text-[10px] text-faint">
              {items.length}
            </span>
          </div>
          <p className="mt-2 text-[10.5px] text-faint">
            {pilotProject?.name ?? t("coord.scopeTitle")}
          </p>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-2.5">
          <div className="grid gap-1">
            {items.map((item) => {
              const pilotThread = pilotOverview.data?.coordination.find(
                (thread) => thread.id === item.thread.id,
              );
              return (
                <button
                  type="button"
                  key={item.thread.id}
                  data-testid={
                    pilotThread
                      ? `pilot-coordination-thread-${pilotThread.id}`
                      : undefined
                  }
                  onClick={() => setSelectedThreadId(item.thread.id)}
                  className={
                    item.thread.id === current.thread.id
                      ? "grid w-full gap-2 rounded-[11px] bg-sel p-[12px_13px] text-left"
                      : "grid w-full gap-2 rounded-[11px] bg-transparent p-[12px_13px] text-left hover:bg-hover-wash"
                  }
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        pilotThread?.status === "resolved"
                          ? "h-1.5 w-1.5 rounded-full bg-green"
                          : pilotThread?.status === "needs_confirmation"
                            ? "h-1.5 w-1.5 rounded-full bg-danger"
                            : "h-1.5 w-1.5 rounded-full bg-amber"
                      }
                    />
                    <strong className="truncate text-[11.5px] font-[620]">
                      {item.thread.title}
                    </strong>
                    <time className="ml-auto font-mono text-[9px] text-faint">
                      {formatRelative(
                        pilotThread?.updatedAt ?? item.thread.createdAt,
                      )}
                    </time>
                  </div>
                  <p className="line-clamp-2 text-[10.5px] leading-[1.5] text-ink-muted">
                    {pilotThread?.safeContext ??
                      item.messages.at(-1)?.body ??
                      t("coord.lede")}
                  </p>
                  <div className="flex items-center gap-1.5 font-mono text-[9px] text-faint">
                    <span>{pilotProject?.name ?? "Intero"}</span>
                    <span>·</span>
                    <span>
                      {pilotThread
                        ? pilotThread.participantIds.map(nameOf).join(", ")
                        : item.thread.participantIds.map(nameOf).join(", ")}
                    </span>
                  </div>
                  {pilotThread?.status === "needs_confirmation" ? (
                    <span className="justify-self-start rounded-pill bg-danger-soft px-1.5 py-0.5 text-[9px] text-danger">
                      待确认
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <div className="grid h-full min-w-0 grid-cols-[minmax(0,1fr)_340px] grid-rows-[minmax(0,1fr)]">
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
                      (item) =>
                        item.envelope.operationId === message.operationId,
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
          {currentPilotThread?.status === "open" ? (
            <section className="mt-5 rounded-card border border-line bg-panel2 p-[18px_20px]">
              <div className="flex items-center gap-2">
                <HandTapIcon size={16} className="text-accent-strong" />
                <strong className="text-[12.5px] font-[620]">
                  提议一个待确认结论
                </strong>
              </div>
              <textarea
                value={conclusion}
                data-testid="pilot-coordination-conclusion"
                onChange={(event) => setConclusion(event.target.value)}
                placeholder="写下安全、可撤回的候选结论…"
                className="mt-3 min-h-[78px] w-full resize-none rounded-inset border border-line2 bg-raise p-3 text-[12.5px] leading-[1.65] outline-none placeholder:text-faint focus:border-accent-strong"
              />
              <div className="mt-3 flex items-center gap-2">
                <select
                  aria-label="选择负责人"
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
                  className="h-8 rounded-btn border-0 bg-accent-strong px-3.5 text-[12px] font-[620] text-on-accent disabled:opacity-45"
                >
                  {propose.isPending ? (
                    <CircleNotchIcon size={14} className="animate-spin" />
                  ) : null}
                  送交负责人确认
                </button>
              </div>
            </section>
          ) : currentPilotThread?.status === "needs_confirmation" &&
            currentPilotThread.responsibleParticipantId ===
              pilot?.identityId ? (
            <button
              type="button"
              data-testid="pilot-coordination-confirm"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate()}
              className="mt-5 inline-flex h-9 items-center gap-2 rounded-btn border-0 bg-accent-strong px-4 text-[12.5px] font-[620] text-on-accent"
            >
              <CheckCircleIcon size={15} />
              作为负责人确认结论
            </button>
          ) : null}
          {propose.isError || confirm.isError ? (
            <p className="mt-3 text-[11.5px] text-danger">
              {(propose.error ?? confirm.error)?.message}
            </p>
          ) : null}
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
                <div
                  className="flex items-center gap-2 text-[11.5px] text-ink"
                  key={action}
                >
                  <CheckCircleIcon
                    size={13}
                    weight="fill"
                    className="text-green"
                  />
                  <span className="font-mono">{action}</span>
                </div>
              ))}
              {grantedActions.size === 0 ? (
                <p className="text-[11.5px] text-faint">{t("general.none")}</p>
              ) : null}
            </div>
            <p className="mt-3 text-[10.5px] text-faint">
              {t("coord.grantsNote")}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
