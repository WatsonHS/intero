import {
  ArrowsClockwiseIcon,
  CircleNotchIcon,
  KanbanIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import type { KanbanCard, KanbanColumn, PublicWorkProjection } from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { createKanbanCard, getBootstrap, getKanban } from "../api.js";
import { Reveal } from "../design/reveal.js";
import {
  initials,
  isStale,
  revealMove,
  tintFor,
  type Tone,
} from "../design/utils.js";
import { useI18n } from "../i18n/index.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";

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

export function ProjectView({
  onOpenItem,
}: {
  onOpenItem: (cardId: string) => void;
}) {
  const { formatRelative, t } = useI18n();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState<string>();
  const [selectedCardId, setSelectedCardId] = useState<string>();
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const board = useQuery({
    queryKey: ["kanban", projectId],
    queryFn: ({ signal }) => getKanban(projectId, signal),
  });
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!selectedProjectId) throw new Error("Project is unavailable.");
      const columnCards = cards.filter((card) => card.column === "planned");
      return createKanbanCard({
        projectId: selectedProjectId,
        title: newTitle.trim() || t("project.untitled"),
        description: "",
        column: "planned",
        position: columnCards.length,
        ...(bootstrap.data?.currentPrincipal.id
          ? { ownerId: bootstrap.data.currentPrincipal.id }
          : {}),
        relatedWorkstreamIds: [],
      });
    },
    onSuccess: async (card) => {
      setNewTitle("");
      setShowCreate(false);
      setSelectedCardId(card.id);
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

  if (board.isError) {
    return (
      <div className="animate-view-enter grid h-full place-items-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-[13px] font-[600] text-ink">
            {t("project.unavailable")}
          </p>
          <button
            type="button"
            className="h-[34px] cursor-pointer rounded-btn border border-line2 bg-transparent px-3.5 text-[12.5px] text-ink hover:border-accent-strong"
            onClick={() => void board.refetch()}
          >
            {t("general.retry")}
          </button>
        </div>
      </div>
    );
  }

  const selectedProjectId =
    projectId ?? board.data.selectedProjectId ?? board.data.projects[0]?.id;
  const selectedProject = board.data.projects.find(
    (project) => project.id === selectedProjectId,
  );
  const cards = board.data.cards;
  const workstreamById = new Map<string, PublicWorkProjection>(
    board.data.workstreams.map((workstream) => [workstream.id, workstream]),
  );
  const principalNames = new Map(
    board.data.principals.map((principal) => [
      principal.id,
      principal.displayName,
    ]),
  );
  const selected = cards.find((card) => card.id === selectedCardId) ?? cards[0];

  const totalPoints = cards.reduce(
    (sum, card) => sum + (card.estimatePoints ?? 0),
    0,
  );
  const donePoints = cards
    .filter((card) => card.column === "done")
    .reduce((sum, card) => sum + (card.estimatePoints ?? 0), 0);
  const percent = totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : 0;

  const selWorkstream = selected
    ? firstLinkedWorkstream(selected, workstreamById)
    : undefined;
  const selOwnerName = selected?.ownerId
    ? (principalNames.get(selected.ownerId) ?? selected.ownerId.slice(0, 8))
    : undefined;
  const selCol = selected ? columnMeta(selected.column) : undefined;

  return (
    <div
      className={`animate-view-enter grid h-full ${
        selected && selCol
          ? "grid-cols-[minmax(0,1fr)_320px]"
          : "grid-cols-[minmax(0,1fr)]"
      }`}
    >
      <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]">
        <header className="p-[26px_30px_18px] border-b border-line">
          <div className="flex items-center gap-[14px]">
            <div>
              <p className="text-[11.5px] text-faint">
                {bootstrap.data?.organization.name ?? "—"}
              </p>
              <h1 className="mt-1.5 text-[22px] font-[570] tracking-[-0.03em]">
                {selectedProject?.name ?? "—"}
              </h1>
            </div>
            {board.data.projects.length > 1 ? (
              <select
                className="h-8 cursor-pointer rounded-[9px] border border-line2 bg-transparent px-2.5 text-[12px] text-ink"
                value={selectedProjectId}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setSelectedCardId(undefined);
                }}
              >
                {board.data.projects.map((project) => (
                  <option value={project.id} key={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            ) : null}
            <span className="inline-flex items-center gap-[9px] rounded-pill bg-raise px-3 py-1.5 text-[11.5px] text-ink-muted">
              <span className="relative h-[5px] w-24 overflow-hidden rounded-[3px] bg-raise">
                <span
                  className="absolute inset-y-0 left-0 origin-left animate-bar-grow bg-green"
                  style={{ width: `${percent}%` }}
                />
              </span>
              <span className="font-mono text-[11px] text-ink-muted">
                {t("project.pointsDone", {
                  done: donePoints,
                  total: totalPoints,
                })}
              </span>
            </span>
            <div className="ml-auto flex rounded-[10px] bg-raise p-[3px]">
              <button
                type="button"
                className={`h-7 cursor-pointer rounded-quiet px-[13px] text-[11.5px] font-semibold ${
                  viewMode === "board"
                    ? "bg-panel2 text-ink"
                    : "text-ink-muted"
                }`}
                onClick={() => setViewMode("board")}
              >
                {t("project.board")}
              </button>
              <button
                type="button"
                className={`h-7 cursor-pointer rounded-quiet px-[13px] text-[11.5px] font-semibold ${
                  viewMode === "list" ? "bg-panel2 text-ink" : "text-ink-muted"
                }`}
                onClick={() => setViewMode("list")}
              >
                {t("project.list")}
              </button>
            </div>
            <button
              type="button"
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-btn border border-line2 bg-transparent px-3 text-[12.5px] text-ink hover:border-accent-strong"
              onClick={() => setShowCreate((current) => !current)}
            >
              <PlusIcon size={13} />
              {t("project.newCard")}
            </button>
          </div>
          <p className="mt-3.5 inline-flex items-center gap-2 rounded-pill bg-accent-soft px-3 py-[7px] text-[11.5px] text-accent-strong">
            <ArrowsClockwiseIcon size={13} />
            {t("project.callout")}
          </p>
          {showCreate ? (
            <div className="mt-3 flex items-center gap-2">
              <input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder={t("project.cardTitlePlaceholder")}
                autoFocus
                className="h-[34px] w-64 rounded-btn border border-line2 bg-transparent px-3 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-accent-strong"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !create.isPending) {
                    event.preventDefault();
                    create.mutate();
                  }
                }}
              />
              <button
                type="button"
                className="h-[34px] cursor-pointer rounded-btn border-0 bg-accent-strong px-3.5 text-[12.5px] font-[620] text-on-accent disabled:opacity-55"
                disabled={!selectedProjectId || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? (
                  <CircleNotchIcon size={14} className="animate-spin" />
                ) : (
                  t("project.create")
                )}
              </button>
              {create.isError ? (
                <span className="text-[11px] text-danger">
                  {t("project.createFailed")}
                </span>
              ) : null}
            </div>
          ) : null}
        </header>

        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <KanbanIcon size={28} className="text-faint" />
            <p className="text-[13px] font-[600] text-ink">
              {t("project.empty.title")}
            </p>
            <p className="max-w-xs text-[12px] leading-[1.6] text-ink-muted">
              {t("project.empty.body")}
            </p>
            <button
              type="button"
              className="inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-btn border-0 bg-accent-strong px-3.5 text-[12.5px] font-[620] text-on-accent"
              onClick={() => setShowCreate(true)}
            >
              <PlusIcon size={14} />
              {t("project.newCard")}
            </button>
          </div>
        ) : viewMode === "board" ? (
          <div className="min-h-0 overflow-auto p-[20px_30px_34px]">
            <div className="grid grid-cols-[repeat(5,minmax(0,1fr))] items-start gap-2.5">
              {COLUMNS.map((column) => {
                const columnCards = cards
                  .filter((card) => card.column === column.id)
                  .toSorted((left, right) => left.position - right.position);
                return (
                  <div className="flex flex-col gap-[9px]" key={column.id}>
                    <div className="flex items-center gap-2 px-1">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${toneBgClass(column.tone)}`}
                      />
                      <strong className="text-[11.5px] font-[650]">
                        {t(column.label)}
                      </strong>
                      <span className="font-mono text-[10.5px] text-faint">
                        {columnCards.length}
                      </span>
                    </div>
                    {columnCards.map((card) => {
                      const workstream = firstLinkedWorkstream(
                        card,
                        workstreamById,
                      );
                      const ownerName = card.ownerId
                        ? (principalNames.get(card.ownerId) ??
                          card.ownerId.slice(0, 8))
                        : undefined;
                      const freshAt = workstream?.freshnessAt ?? card.updatedAt;
                      const stale = workstream
                        ? isStale(workstream.freshnessAt, undefined)
                        : false;
                      return (
                        <button
                          type="button"
                          key={card.id}
                          onClick={() => setSelectedCardId(card.id)}
                          onMouseEnter={revealMove}
                          onMouseMove={revealMove}
                          className={`group relative grid w-full gap-2.5 overflow-hidden rounded-[13px] border bg-panel2-glass p-[13px_14px] text-left text-ink cursor-pointer transition-[border-color,transform] duration-[180ms] hover:-translate-y-px ${
                            selected?.id === card.id
                              ? "border-accent-strong"
                              : "border-line"
                          }`}
                        >
                          <Reveal />
                          <span className="font-mono text-[10px] text-faint">
                            {card.id.slice(0, 8)}
                          </span>
                          <span className="text-[12.5px] font-[560] leading-[1.45] [text-wrap:pretty]">
                            {card.title}
                          </span>
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-[7px]">
                            {card.ownerId ? (
                              <span
                                className="grid h-[22px] w-[22px] place-items-center rounded-full text-[8.5px] font-[650] text-on-tint"
                                style={{ background: tintFor(card.ownerId) }}
                              >
                                {initials(ownerName)}
                              </span>
                            ) : (
                              <span className="text-[10px] text-faint">
                                {t("project.unassigned")}
                              </span>
                            )}
                            {card.estimatePoints !== undefined ? (
                              <span className="inline-grid h-[18px] min-w-5 place-items-center rounded-[6px] bg-raise px-1.5 font-mono text-[10px] text-ink-muted">
                                {card.estimatePoints}
                              </span>
                            ) : null}
                            <span
                              className={`ml-auto font-mono text-[9.5px] ${
                                stale ? "text-amber" : "text-faint"
                              }`}
                            >
                              {formatRelative(freshAt)}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="min-h-0 overflow-auto p-[18px_30px_34px]">
            <div className="grid grid-cols-[74px_minmax(0,1fr)_92px_96px_44px_84px_78px] gap-3.5 border-b border-line2 px-3 pb-2.5 text-[10.5px] tracking-[0.08em] text-faint">
              <span>{t("project.col.id")}</span>
              <span>{t("project.col.task")}</span>
              <span>{t("project.col.status")}</span>
              <span>{t("project.col.owner")}</span>
              <span>{t("project.col.points")}</span>
              <span>{t("project.col.confidence")}</span>
              <span>{t("project.col.updated")}</span>
            </div>
            {cards.map((card) => {
              const workstream = firstLinkedWorkstream(card, workstreamById);
              const ownerName = card.ownerId
                ? (principalNames.get(card.ownerId) ??
                  card.ownerId.slice(0, 8))
                : undefined;
              const col = columnMeta(card.column);
              const freshAt = workstream?.freshnessAt ?? card.updatedAt;
              const stale = workstream
                ? isStale(workstream.freshnessAt, undefined)
                : false;
              const confPercent = workstream
                ? Math.round(workstream.confidence * 100)
                : undefined;
              return (
                <button
                  type="button"
                  key={card.id}
                  onClick={() => setSelectedCardId(card.id)}
                  className={`grid w-full grid-cols-[74px_minmax(0,1fr)_92px_96px_44px_84px_78px] items-center gap-3.5 rounded-quiet border-0 border-b border-line p-3 text-left text-ink cursor-pointer hover:bg-hover-wash ${
                    selected?.id === card.id ? "bg-sel" : ""
                  }`}
                >
                  <span className="font-mono text-[10.5px] text-faint">
                    {card.id.slice(0, 8)}
                  </span>
                  <span className="truncate text-[12.5px] font-[540]">
                    {card.title}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 text-[11px] ${toneTextClass(col.tone)}`}
                  >
                    <span
                      className={`h-[5px] w-[5px] rounded-full ${toneBgClass(col.tone)}`}
                    />
                    {t(col.label)}
                  </span>
                  <span className="inline-flex min-w-0 items-center gap-[7px]">
                    {card.ownerId ? (
                      <>
                        <span
                          className="grid h-5 w-5 place-items-center rounded-full text-[8px] font-[650] text-on-tint"
                          style={{ background: tintFor(card.ownerId) }}
                        >
                          {initials(ownerName)}
                        </span>
                        <span className="truncate text-[11px] text-ink-muted">
                          {ownerName}
                        </span>
                      </>
                    ) : (
                      <span className="truncate text-[11px] text-ink-muted">
                        {t("project.unassigned")}
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[11px] text-ink-muted">
                    {card.estimatePoints ?? "—"}
                  </span>
                  <span className="inline-flex items-center gap-[7px]">
                    {workstream && confPercent !== undefined ? (
                      <>
                        <span className="relative h-1 w-[34px] overflow-hidden rounded-[2px] bg-raise">
                          <span
                            className={`absolute inset-y-0 left-0 ${toneBgClass(col.tone)}`}
                            style={{ width: `${confPercent}%` }}
                          />
                        </span>
                        <span className="font-mono text-[10px] text-ink-muted">
                          {confPercent}%
                        </span>
                      </>
                    ) : (
                      <span className="font-mono text-[10px] text-faint">
                        —
                      </span>
                    )}
                  </span>
                  <span
                    className={`font-mono text-[10px] ${
                      stale ? "text-amber" : "text-faint"
                    }`}
                  >
                    {formatRelative(freshAt)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selected && selCol ? (
        <aside
          key={selected.id}
          className="animate-panel-slide min-w-0 overflow-auto border-l border-line bg-panel p-[26px_24px_40px]"
        >
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[11px] text-faint">
              {selected.id.slice(0, 8)}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-pill bg-raise px-2.5 py-1 text-[10.5px] ${toneTextClass(selCol.tone)}`}
            >
              <span
                className={`h-[5px] w-[5px] rounded-full ${toneBgClass(selCol.tone)}`}
              />
              {t(selCol.label)}
            </span>
            <span className="ml-auto text-[10.5px] text-faint">
              {selectedProject?.name ?? "—"}
            </span>
          </div>
          <h3 className="mt-3.5 text-[17px] font-[600] leading-[1.35] tracking-[-0.025em] [text-wrap:pretty]">
            {selected.title}
          </h3>
          {selected.description ? (
            <p className="mt-3 text-[12.5px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
              {selected.description}
            </p>
          ) : null}
          <div className="mt-4 rounded-inset border border-line bg-panel2 p-[13px_15px]">
            <div className="flex items-center gap-2.5">
              {selected.ownerId ? (
                <span
                  className="grid h-6 w-6 place-items-center rounded-full text-[8.5px] font-[650] text-on-tint"
                  style={{ background: tintFor(selected.ownerId) }}
                >
                  {initials(selOwnerName)}
                </span>
              ) : (
                <span className="grid h-6 w-6 place-items-center rounded-full bg-raise text-[8.5px] font-[650] text-faint">
                  —
                </span>
              )}
              <span className="grid">
                <strong className="text-[11.5px] font-[620]">
                  {selected.ownerId ? selOwnerName : t("project.unassigned")}
                </strong>
                <small className="mt-[3px] text-[10px] text-faint">
                  {selWorkstream
                    ? t("project.maintained", {
                        time: formatRelative(selWorkstream.freshnessAt),
                      })
                    : t("project.independent")}
                </small>
              </span>
            </div>
          </div>
          <button
            type="button"
            className="mt-4 h-[34px] w-full cursor-pointer rounded-btn border-0 bg-accent-strong text-[12.5px] font-[620] text-on-accent"
            onClick={() => onOpenItem(selected.id)}
          >
            {t("project.openItem")}
          </button>
        </aside>
      ) : null}
    </div>
  );
}
