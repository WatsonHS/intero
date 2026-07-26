import {
  ArrowLeftIcon,
  CaretDownIcon,
  CircleNotchIcon,
  GitCommitIcon,
  HandTapIcon,
  LockSimpleIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react";
import type {
  KanbanCard,
  KanbanColumn,
  PublicWorkProjection,
  WorkstreamId,
} from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { getActivity, getBootstrap, getKanban, updateKanbanCard } from "../api.js";
import { confidencePercent, PHASE_META, type Tone } from "../design/utils.js";
import { useI18n } from "../i18n/index.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";
import { usePilotOptional } from "../pilot/context.js";
import { WorkItemDetailSurface } from "./project/WorkItemDetailSurface.js";

const COLUMNS: Array<{ id: KanbanColumn; label: TranslationKey; tone: Tone }> = [
  { id: "backlog", label: "project.column.backlog", tone: "faint" },
  { id: "planned", label: "project.column.planned", tone: "faint" },
  { id: "in_progress", label: "project.column.in_progress", tone: "green" },
  { id: "review", label: "project.column.review", tone: "amber" },
  { id: "done", label: "project.column.done", tone: "faint" },
];

function columnMeta(column: KanbanColumn) {
  return COLUMNS.find((item) => item.id === column) ?? COLUMNS[0]!;
}

function toneTextClass(tone: Tone): string {
  if (tone === "green") return "text-green";
  if (tone === "amber") return "text-amber";
  if (tone === "danger") return "text-danger";
  return "text-faint";
}

function toneBgClass(tone: Tone): string {
  if (tone === "green") return "bg-green";
  if (tone === "amber") return "bg-amber";
  if (tone === "danger") return "bg-danger";
  return "bg-faint";
}

function toneSoftBgClass(tone: Tone): string {
  if (tone === "green") return "bg-green-soft";
  if (tone === "amber") return "bg-amber-soft";
  if (tone === "danger") return "bg-danger-soft";
  return "bg-raise";
}

function firstLinkedWorkstream(
  card: KanbanCard,
  byId: Map<string, PublicWorkProjection>,
): PublicWorkProjection | undefined {
  for (const id of card.relatedWorkstreamIds) {
    const found = byId.get(id);
    if (found) return found;
  }
  return undefined;
}

type TabId = "activity" | "claims" | "changes";

export function WorkItemView({
  cardId,
  onBack,
}: {
  cardId: string;
  onBack: () => void;
}) {
  const pilot = usePilotOptional();
  const projectId =
    pilot?.selectedProjectId ?? pilot?.projects.data?.projects[0]?.id;
  return projectId &&
    pilot?.bootstrap.data?.adapters.projectWork === "postgres" ? (
    <WorkItemDetailSurface
      projectId={projectId}
      workItemId={cardId}
      {...(pilot?.identityId ? { identityId: pilot.identityId } : {})}
      onBack={onBack}
    />
  ) : (
    <LegacyWorkItemView cardId={cardId} onBack={onBack} />
  );
}

function LegacyWorkItemView({
  cardId,
  onBack,
}: {
  cardId: string;
  onBack: () => void;
}) {
  const { formatRelative, formatTime, t } = useI18n();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>("activity");

  const board = useQuery({
    queryKey: ["kanban"],
    queryFn: ({ signal }) => getKanban(undefined, signal),
  });
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });
  const activity = useQuery({
    queryKey: ["activity"],
    queryFn: ({ signal }) => getActivity(0, 200, signal),
  });

  const card = board.data?.cards.find((item) => item.id === cardId);

  const update = useMutation({
    mutationFn: (patch: Parameters<typeof updateKanbanCard>[1]) => {
      if (!card) throw new Error("Card is unavailable.");
      return updateKanbanCard(card.id, patch);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["kanban"] });
    },
  });

  if (board.isPending) {
    return (
      <div className="animate-view-enter grid h-full place-items-center">
        <div className="flex flex-col items-center gap-3 text-ink-muted">
          <CircleNotchIcon size={22} className="animate-spin" />
          <p className="text-[12.5px]">{t("project.loading")}</p>
        </div>
      </div>
    );
  }

  if (board.isError || !card) {
    return (
      <div className="animate-view-enter grid h-full place-items-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-[13px] font-[600] text-ink">
            {t("project.unavailable")}
          </p>
          <button
            type="button"
            className="inline-flex h-[34px] cursor-pointer items-center gap-[7px] rounded-btn border border-line2 bg-transparent px-3.5 text-[12.5px] text-ink hover:border-accent-strong"
            onClick={onBack}
          >
            <ArrowLeftIcon size={13} />
            {t("item.back")}
          </button>
        </div>
      </div>
    );
  }

  const workstreamById = new Map<string, PublicWorkProjection>(
    board.data.workstreams.map((workstream) => [workstream.id, workstream]),
  );
  const workstream = firstLinkedWorkstream(card, workstreamById);
  const principals = board.data.principals;
  const principalNames = new Map(
    principals.map((principal) => [principal.id, principal.displayName]),
  );
  const humanPrincipals = principals.filter(
    (principal) => principal.kind === "human",
  );
  const project = board.data.projects.find((item) => item.id === card.projectId);
  const col = columnMeta(card.column);
  const relatedWorkstreamIdSet = new Set<string>(card.relatedWorkstreamIds);

  const activityItems = (activity.data?.items ?? [])
    .filter(
      (event) =>
        event.aggregateId === card.id ||
        relatedWorkstreamIdSet.has(event.aggregateId),
    )
    .toSorted(
      (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
    );

  const contradictionCount = workstream?.contradictionClaimIds.length ?? 0;
  const changesCount = workstream?.changedFields.length ?? 0;

  const TABS: Array<{ id: TabId; label: TranslationKey; count: number }> = [
    { id: "activity", label: "item.tab.activity", count: activityItems.length },
    { id: "claims", label: "item.tab.claims", count: contradictionCount },
    { id: "changes", label: "item.tab.changes", count: changesCount },
  ];

  const ownerName = workstream
    ? (principalNames.get(workstream.ownerId) ?? workstream.ownerId.slice(0, 8))
    : undefined;
  const firstBlocker = workstream?.blockers[0];

  function toggleWorkstream(workstreamId: WorkstreamId) {
    const linked = card!.relatedWorkstreamIds.includes(workstreamId);
    update.mutate({
      relatedWorkstreamIds: linked
        ? card!.relatedWorkstreamIds.filter((id) => id !== workstreamId)
        : [...card!.relatedWorkstreamIds, workstreamId],
    });
  }

  function commitPoints(raw: string) {
    if (raw.trim() === "") return;
    const parsed = Math.min(100, Math.max(0, Math.round(Number(raw))));
    if (Number.isNaN(parsed)) return;
    if (parsed !== card!.estimatePoints) update.mutate({ estimatePoints: parsed });
  }

  return (
    <div className="animate-view-enter grid h-full grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 overflow-auto p-[26px_32px_50px]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex cursor-pointer items-center gap-[7px] border-0 bg-transparent p-0 text-[11.5px] text-ink-muted hover:text-accent-strong"
        >
          <ArrowLeftIcon size={13} />
          {t("item.back")}
        </button>
        <div className="mt-3.5 flex items-center gap-2 text-[11.5px] text-faint">
          <span>{bootstrap.data?.organization.name ?? "—"}</span>
          <span>/</span>
          <span>{project?.name ?? "—"}</span>
          <span>/</span>
          <span className="font-mono">{card.id.slice(0, 8)}</span>
        </div>
        <h1 className="mt-3 max-w-[660px] text-[25px] font-[570] leading-[1.25] tracking-[-0.03em] [text-wrap:pretty]">
          {card.title}
        </h1>
        <div className="mt-[18px] flex items-center gap-2.5">
          <span
            className={`inline-flex items-center gap-[7px] rounded-pill px-[13px] py-[7px] text-[12px] font-[620] ${toneSoftBgClass(col.tone)} ${toneTextClass(col.tone)}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${toneBgClass(col.tone)} ${
                workstream?.phase === "blocked" ? "animate-dot-pulse" : ""
              }`}
            />
            {t(col.label)}
          </span>
          {workstream ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-faint">
              <LockSimpleIcon size={12} />
              {t("item.readonly", {
                name: ownerName ?? "—",
                time: formatRelative(workstream.freshnessAt),
              })}
            </span>
          ) : null}
        </div>
        {firstBlocker ? (
          <p className="mt-5 max-w-[660px] rounded-[13px] border border-danger-soft bg-danger-soft p-[16px_18px] text-[12.5px] leading-[1.7] [text-wrap:pretty]">
            <strong className="font-[650]">{t("item.blockedReason")}</strong>{" "}
            {firstBlocker}
          </p>
        ) : null}
        {card.description ? (
          <p className="mt-[22px] max-w-[660px] text-[13.5px] leading-[1.85] text-ink-muted [text-wrap:pretty]">
            {card.description}
          </p>
        ) : null}

        <div className="mt-7 flex gap-1 border-b border-line">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex cursor-pointer items-center gap-2 border-0 bg-transparent px-3.5 py-[11px] text-[12.5px] font-[570] ${
                  active
                    ? "text-ink shadow-[inset_0_-2px_0_var(--intero-accent)]"
                    : "text-ink-muted"
                }`}
              >
                <span>{t(tab.label)}</span>
                <span className="font-mono text-[10px] text-faint">
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {activeTab === "activity" ? (
          <div className="mt-[22px] flex max-w-[680px] flex-col gap-[14px]">
            {activity.isPending ? (
              <p className="text-[12px] text-faint">{t("general.loading")}</p>
            ) : null}
            {activityItems.length === 0 && !activity.isPending ? (
              <p className="text-[12px] text-faint">{t("item.activityEmpty")}</p>
            ) : (
              activityItems.map((event, index) => (
                <div
                  key={event.sequence}
                  className="animate-message-enter grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3"
                  style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
                >
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-raise text-ink-muted">
                    <GitCommitIcon size={15} />
                  </span>
                  <span className="grid min-w-0">
                    <strong className="truncate text-[12px] font-[570]">
                      {event.eventType}
                    </strong>
                    <small className="mt-1 font-mono text-[10.5px] leading-[1.5] text-faint">
                      {`${event.aggregateType} · seq ${event.sequence}`}
                    </small>
                  </span>
                  <time className="font-mono text-[9.5px] text-faint">
                    {formatTime(event.occurredAt)}
                  </time>
                </div>
              ))
            )}
          </div>
        ) : null}

        {activeTab === "claims" ? (
          <div className="mt-[22px] max-w-[680px]">
            <p className="text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
              {t("item.claimsLede")}
            </p>
            {workstream && contradictionCount > 0 ? (
              <>
                <div className="mt-4">
                  <p className="text-[10.5px] font-[650] tracking-[0.08em] text-faint">
                    {t("item.contradictionRefs")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {workstream.contradictionClaimIds.map((claimId) => (
                      <span
                        key={claimId}
                        className="rounded-[6px] bg-panel2 px-2 py-1 font-mono text-[10px] text-ink-muted"
                      >
                        {claimId.slice(0, 8)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-[14px] flex items-center gap-[11px] rounded-[13px] bg-danger-soft p-[14px_16px]">
                  <HandTapIcon size={16} className="text-danger" />
                  <span className="text-[12.5px] leading-[1.6] text-ink">
                    {t("item.contradictionNote")}
                  </span>
                </div>
                <p className="mt-[10px] text-[11px] text-faint">
                  {t("item.claimsLocal")}
                </p>
              </>
            ) : (
              <p className="mt-4 text-[12px] text-faint">
                {t("item.claimsEmpty")}
              </p>
            )}
          </div>
        ) : null}

        {activeTab === "changes" ? (
          <div className="mt-[22px] max-w-[680px]">
            <div className="grid grid-cols-[104px_minmax(0,1fr)_74px] gap-3 border-b border-line2 px-3 pb-2.5 text-[10.5px] tracking-[0.08em] text-faint">
              <span>{t("item.changes.field")}</span>
              <span>{t("item.changes.by")}</span>
              <span>{t("item.changes.time")}</span>
            </div>
            {workstream && workstream.changedFields.length > 0 ? (
              workstream.changedFields.map((field) => (
                <div
                  key={field}
                  className="grid grid-cols-[104px_minmax(0,1fr)_74px] items-center gap-3 border-b border-line px-3 py-[13px]"
                >
                  <span className="font-mono text-[11px] text-ink">{field}</span>
                  <span className="text-[11px] text-ink-muted">
                    {t("item.changes.projected")}
                  </span>
                  <span className="font-mono text-[10px] text-faint">
                    {formatRelative(workstream.projectedAt)}
                  </span>
                </div>
              ))
            ) : (
              <p className="mt-4 text-[12px] text-faint">
                {t("item.changesEmpty")}
              </p>
            )}
          </div>
        ) : null}
      </div>

      <aside className="min-w-0 overflow-auto border-l border-line bg-panel p-[26px_24px_40px]">
        <div className="flex items-center gap-2">
          <PencilSimpleIcon size={13} className="text-faint" />
          <span className="text-[10.5px] font-[650] tracking-[0.08em] text-faint">
            {t("item.editable")}
          </span>
        </div>
        <div className="mt-[11px] grid gap-1.5">
          <div className="grid grid-cols-[68px_1fr_14px] items-center gap-3 rounded-[9px] border border-transparent p-[8px_10px] hover:border-line2 hover:bg-panel2">
            <span className="text-[11px] text-faint">{t("item.owner")}</span>
            <select
              className="w-full cursor-pointer border-0 bg-transparent text-[12px] text-ink outline-none"
              value={card.ownerId ?? ""}
              onChange={(event) =>
                update.mutate(
                  event.target.value ? { ownerId: event.target.value } : {},
                )
              }
            >
              <option value="">{t("project.unassigned")}</option>
              {humanPrincipals.map((principal) => (
                <option value={principal.id} key={principal.id}>
                  {principal.displayName}
                </option>
              ))}
            </select>
            <CaretDownIcon size={12} className="text-faint" />
          </div>
          <div className="grid grid-cols-[68px_1fr_14px] items-center gap-3 rounded-[9px] border border-transparent p-[8px_10px] hover:border-line2 hover:bg-panel2">
            <span className="text-[11px] text-faint">
              {t("item.columnLabel")}
            </span>
            <select
              className="w-full cursor-pointer border-0 bg-transparent text-[12px] text-ink outline-none"
              value={card.column}
              onChange={(event) => {
                const nextColumn = event.target.value as KanbanColumn;
                const position = (board.data?.cards ?? []).filter(
                  (item) => item.column === nextColumn,
                ).length;
                update.mutate({ column: nextColumn, position });
              }}
            >
              {COLUMNS.map((column) => (
                <option value={column.id} key={column.id}>
                  {t(column.label)}
                </option>
              ))}
            </select>
            <CaretDownIcon size={12} className="text-faint" />
          </div>
          <div className="grid grid-cols-[68px_1fr_14px] items-center gap-3 rounded-[9px] border border-transparent p-[8px_10px] hover:border-line2 hover:bg-panel2">
            <span className="text-[11px] text-faint">{t("item.points")}</span>
            <input
              key={`${card.id}:points`}
              type="number"
              min={0}
              max={100}
              defaultValue={card.estimatePoints ?? ""}
              className="w-full border-0 bg-transparent text-[12px] text-ink outline-none"
              onBlur={(event) => commitPoints(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitPoints((event.target as HTMLInputElement).value);
                }
              }}
            />
            <CaretDownIcon size={12} className="text-faint" />
          </div>
        </div>
        {update.isError ? (
          <p className="mt-2 text-[11px] text-danger">
            {t("item.updateFailed")}
          </p>
        ) : null}

        <div className="mt-[18px]">
          <span className="text-[10.5px] font-[650] tracking-[0.08em] text-faint">
            {t("item.linked")}
          </span>
          <p className="mt-1.5 text-[10.5px] text-faint">
            {t("item.linkHint")}
          </p>
          <div className="mt-2 flex flex-col gap-1.5">
            {board.data.workstreams.length === 0 ? (
              <p className="text-[11px] text-faint">
                {t("item.noWorkstreams")}
              </p>
            ) : (
              board.data.workstreams.map((option) => {
                const checked = card!.relatedWorkstreamIds.includes(option.id);
                return (
                  <label
                    key={option.id}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-[9px] border p-[8px_10px] ${
                      checked
                        ? "border-accent-strong bg-accent-soft"
                        : "border-transparent hover:border-line2 hover:bg-panel2"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleWorkstream(option.id)}
                      className="h-3.5 w-3.5 accent-[var(--intero-accent)]"
                    />
                    <span className="grid min-w-0">
                      <strong className="truncate text-[11.5px] font-[560]">
                        {option.title}
                      </strong>
                      <small className="text-[10px] text-faint">
                        {t(`phase.${option.phase}` as TranslationKey)}
                      </small>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        <div className="mt-[22px] flex items-center gap-2">
          <LockSimpleIcon size={13} className="text-faint" />
          <span className="text-[10.5px] font-[650] tracking-[0.08em] text-faint">
            {t("item.readonlySection")}
          </span>
        </div>
        <div className="mt-3 grid gap-[13px] rounded-[11px] bg-raise p-[13px_12px]">
          <div className="grid grid-cols-[68px_1fr] items-center gap-3">
            <span className="text-[11px] text-faint">{t("item.state")}</span>
            {workstream ? (
              <span
                className={`inline-flex items-center gap-[7px] text-[12px] ${toneTextClass(PHASE_META[workstream.phase].tone)}`}
              >
                <span
                  className={`h-[5px] w-[5px] rounded-full ${toneBgClass(PHASE_META[workstream.phase].tone)}`}
                />
                {t(`phase.${workstream.phase}` as TranslationKey)}
              </span>
            ) : (
              <span className="text-[12px] text-faint">—</span>
            )}
          </div>
          <div className="grid grid-cols-[68px_1fr] items-center gap-3">
            <span className="text-[11px] text-faint">
              {t("item.confidence")}
            </span>
            {workstream ? (
              <span className="inline-flex items-center gap-[9px]">
                <span className="relative h-1 w-14 overflow-hidden rounded-[2px] bg-line2">
                  <span
                    className={`absolute inset-y-0 left-0 ${toneBgClass(PHASE_META[workstream.phase].tone)}`}
                    style={{ width: `${confidencePercent(workstream.confidence)}%` }}
                  />
                </span>
                <span className="font-mono text-[11px] text-ink-muted">
                  {confidencePercent(workstream.confidence)}%
                </span>
              </span>
            ) : (
              <span className="font-mono text-[11px] text-faint">—</span>
            )}
          </div>
          <div className="grid grid-cols-[68px_1fr] items-center gap-3">
            <span className="text-[11px] text-faint">
              {t("item.freshness")}
            </span>
            <span className="font-mono text-[11.5px] text-ink">
              {workstream ? formatRelative(workstream.freshnessAt) : "—"}
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}
