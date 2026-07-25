import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CircleNotchIcon,
  KanbanIcon,
  LinkBreakIcon,
  LinkIcon,
  ListBulletsIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import type {
  KanbanCard,
  KanbanColumn,
  PublicWorkProjection,
} from "@intero/domain";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  ConfidenceBar,
  Input,
  PhaseLabel,
  Textarea,
} from "@intero/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  createKanbanCard,
  getBootstrap,
  getKanban,
  updateKanbanCard,
} from "../api.js";
import { useI18n } from "../i18n/index.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";

const columns: Array<{
  id: KanbanColumn;
  label: TranslationKey;
}> = [
  { id: "backlog", label: "kanban.column.backlog" },
  { id: "planned", label: "kanban.column.planned" },
  { id: "in_progress", label: "kanban.column.inProgress" },
  { id: "review", label: "kanban.column.review" },
  { id: "done", label: "kanban.column.done" },
];

export function KanbanView() {
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
  const selectedProjectId =
    projectId ?? board.data?.selectedProjectId ?? board.data?.projects[0]?.id;
  const cards = board.data?.cards ?? [];
  const selected = cards.find((card) => card.id === selectedCardId) ?? cards[0];
  const principalNames = new Map(
    board.data?.principals.map((principal) => [
      principal.id,
      principal.displayName,
    ]) ?? [],
  );
  const workstreamById = new Map(
    board.data?.workstreams.map((workstream) => [workstream.id, workstream]) ??
      [],
  );

  const create = useMutation({
    mutationFn: async () => {
      if (!selectedProjectId) throw new Error("Project is unavailable.");
      const columnCards = cards.filter((card) => card.column === "planned");
      return createKanbanCard({
        projectId: selectedProjectId,
        title: newTitle.trim() || t("kanban.untitled"),
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
  const update = useMutation({
    mutationFn: ({
      card,
      patch,
    }: {
      card: KanbanCard;
      patch: Parameters<typeof updateKanbanCard>[1];
    }) => updateKanbanCard(card.id, patch),
    onMutate: ({ card }) => {
      setSelectedCardId(card.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["kanban"] });
    },
  });

  function move(card: KanbanCard, direction: -1 | 1) {
    const index = columns.findIndex((column) => column.id === card.column);
    const next = columns[index + direction];
    if (!next) return;
    update.mutate({
      card,
      patch: {
        column: next.id,
        position: cards.filter((item) => item.column === next.id).length,
      },
    });
  }

  function toggleWorkstream(card: KanbanCard, workstreamId: string) {
    const linked = card.relatedWorkstreamIds.includes(
      workstreamId as (typeof card.relatedWorkstreamIds)[number],
    );
    update.mutate({
      card,
      patch: {
        relatedWorkstreamIds: linked
          ? card.relatedWorkstreamIds.filter((id) => id !== workstreamId)
          : [...card.relatedWorkstreamIds, workstreamId],
      },
    });
  }

  return (
    <div className="kanban-view">
      <header className="kanban-header">
        <div>
          <p className="eyebrow">{t("kanban.eyebrow")}</p>
          <h1>{t("kanban.title")}</h1>
          <p>{t("kanban.lede")}</p>
        </div>
        <div className="kanban-header__actions">
          {board.data && board.data.projects.length > 1 ? (
            <label className="kanban-project-select">
              <span>{t("kanban.project")}</span>
              <select
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
            </label>
          ) : (
            <Badge variant="outline">
              {board.data?.projects.find(
                (project) => project.id === selectedProjectId,
              )?.name ?? t("kanban.project")}
            </Badge>
          )}
          <div className="kanban-view-toggle">
            <Button
              type="button"
              size="sm"
              variant={viewMode === "board" ? "secondary" : "ghost"}
              onClick={() => setViewMode("board")}
            >
              <KanbanIcon size={15} />
              {t("kanban.board")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewMode === "list" ? "secondary" : "ghost"}
              onClick={() => setViewMode("list")}
            >
              <ListBulletsIcon size={15} />
              {t("kanban.list")}
            </Button>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => setShowCreate((current) => !current)}
          >
            <PlusIcon size={15} />
            {t("kanban.newCard")}
          </Button>
        </div>
      </header>

      {showCreate ? (
        <Card className="kanban-create gap-0">
          <div>
            <p className="eyebrow">{t("kanban.createEyebrow")}</p>
            <strong>{t("kanban.createTitle")}</strong>
            <small>{t("kanban.createDetail")}</small>
          </div>
          <Input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder={t("kanban.titlePlaceholder")}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter" && !create.isPending) {
                event.preventDefault();
                create.mutate();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            disabled={!selectedProjectId || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? (
              <CircleNotchIcon size={14} className="spin" />
            ) : (
              <PlusIcon size={14} />
            )}
            {t("kanban.create")}
          </Button>
        </Card>
      ) : null}

      {board.isPending ? (
        <div className="kanban-state">
          <CircleNotchIcon size={22} className="spin" />
          <p>{t("kanban.loading")}</p>
        </div>
      ) : null}
      {board.isError ? (
        <div className="kanban-state">
          <h2>{t("kanban.unavailable")}</h2>
          <p>{board.error.message}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void board.refetch()}
          >
            {t("general.retry")}
          </Button>
        </div>
      ) : null}

      {board.data ? (
        <div
          className={
            selected
              ? "kanban-workspace kanban-workspace--detail"
              : "kanban-workspace"
          }
        >
          <div className="kanban-content">
            {cards.length === 0 ? (
              <div className="kanban-empty">
                <KanbanIcon size={28} />
                <h2>{t("kanban.emptyTitle")}</h2>
                <p>{t("kanban.emptyDetail")}</p>
              </div>
            ) : viewMode === "board" ? (
              <div className="kanban-board">
                {columns.map((column) => {
                  const columnCards = cards
                    .filter((card) => card.column === column.id)
                    .toSorted((left, right) => left.position - right.position);
                  return (
                    <section className="kanban-column" key={column.id}>
                      <header>
                        <span
                          className={`kanban-column__dot kanban-column__dot--${column.id}`}
                        />
                        <h2>{t(column.label)}</h2>
                        <span>{columnCards.length}</span>
                      </header>
                      <div className="kanban-column__cards">
                        {columnCards.map((card) => (
                          <KanbanCardItem
                            key={card.id}
                            card={card}
                            active={selected?.id === card.id}
                            {...(card.ownerId &&
                            principalNames.get(card.ownerId)
                              ? {
                                  principalName: principalNames.get(
                                    card.ownerId,
                                  )!,
                                }
                              : {})}
                            workstreams={card.relatedWorkstreamIds
                              .map((id) => workstreamById.get(id))
                              .filter(
                                (item): item is PublicWorkProjection =>
                                  item !== undefined,
                              )}
                            onSelect={() => setSelectedCardId(card.id)}
                          />
                        ))}
                        {columnCards.length === 0 ? (
                          <div className="kanban-column__empty">
                            {t("kanban.noCards")}
                          </div>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="kanban-list">
                <div className="kanban-list__header">
                  <span>{t("kanban.card")}</span>
                  <span>{t("kanban.status")}</span>
                  <span>{t("kanban.owner")}</span>
                  <span>{t("kanban.workstreams")}</span>
                  <span>{t("kanban.updated")}</span>
                </div>
                {cards.map((card) => (
                  <button
                    type="button"
                    className={
                      selected?.id === card.id
                        ? "kanban-list__row kanban-list__row--active"
                        : "kanban-list__row"
                    }
                    key={card.id}
                    onClick={() => setSelectedCardId(card.id)}
                  >
                    <strong>{card.title}</strong>
                    <span>{t(columnKey(card.column))}</span>
                    <span>
                      {card.ownerId
                        ? (principalNames.get(card.ownerId) ??
                          card.ownerId.slice(0, 8))
                        : t("general.none")}
                    </span>
                    <span>{card.relatedWorkstreamIds.length}</span>
                    <time>{formatRelative(card.updatedAt)}</time>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selected ? (
            <aside className="kanban-detail">
              <div className="kanban-detail__meta">
                <Badge variant="outline">{t(columnKey(selected.column))}</Badge>
                <span>{selected.id.slice(0, 8)}</span>
              </div>
              <Input
                key={`${selected.id}:title`}
                className="kanban-detail__title"
                defaultValue={selected.title}
                aria-label={t("kanban.cardTitle")}
                onBlur={(event) => {
                  const title = event.target.value.trim();
                  if (title && title !== selected.title) {
                    update.mutate({ card: selected, patch: { title } });
                  }
                }}
              />
              <Textarea
                key={`${selected.id}:description`}
                className="kanban-detail__description"
                defaultValue={selected.description}
                placeholder={t("kanban.descriptionPlaceholder")}
                aria-label={t("kanban.description")}
                onBlur={(event) => {
                  if (event.target.value !== selected.description) {
                    update.mutate({
                      card: selected,
                      patch: { description: event.target.value },
                    });
                  }
                }}
              />

              <div className="kanban-detail__section">
                <div className="kanban-detail__section-title">
                  <div>
                    <p className="eyebrow">{t("kanban.flow")}</p>
                    <h3>{t("kanban.status")}</h3>
                  </div>
                  {update.isPending ? (
                    <CircleNotchIcon size={15} className="spin" />
                  ) : null}
                </div>
                <select
                  className="kanban-detail__select"
                  value={selected.column}
                  onChange={(event) =>
                    update.mutate({
                      card: selected,
                      patch: {
                        column: event.target.value as KanbanColumn,
                        position: cards.filter(
                          (card) => card.column === event.target.value,
                        ).length,
                      },
                    })
                  }
                >
                  {columns.map((column) => (
                    <option value={column.id} key={column.id}>
                      {t(column.label)}
                    </option>
                  ))}
                </select>
                <div className="kanban-detail__move">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={selected.column === columns[0]!.id}
                    onClick={() => move(selected, -1)}
                  >
                    <ArrowLeftIcon size={14} />
                    {t("kanban.moveLeft")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={selected.column === columns.at(-1)!.id}
                    onClick={() => move(selected, 1)}
                  >
                    {t("kanban.moveRight")}
                    <ArrowRightIcon size={14} />
                  </Button>
                </div>
              </div>

              <div className="kanban-detail__section">
                <div className="kanban-detail__section-title">
                  <div>
                    <p className="eyebrow">{t("kanban.optionalLink")}</p>
                    <h3>{t("kanban.linkedWorkstreams")}</h3>
                  </div>
                  {selected.relatedWorkstreamIds.length > 0 ? (
                    <LinkIcon size={17} />
                  ) : (
                    <LinkBreakIcon size={17} />
                  )}
                </div>
                <p className="kanban-detail__hint">{t("kanban.linkHint")}</p>
                <div className="kanban-workstream-options">
                  {board.data.workstreams.length === 0 ? (
                    <p>{t("kanban.noWorkstreams")}</p>
                  ) : (
                    board.data.workstreams.map((workstream) => {
                      const checked = selected.relatedWorkstreamIds.includes(
                        workstream.id,
                      );
                      return (
                        <label
                          className={
                            checked
                              ? "kanban-workstream-option kanban-workstream-option--checked"
                              : "kanban-workstream-option"
                          }
                          key={workstream.id}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              toggleWorkstream(selected, workstream.id)
                            }
                          />
                          <span>
                            <strong>{workstream.title}</strong>
                            <small>
                              {t(`phase.${workstream.phase}` as TranslationKey)}
                            </small>
                          </span>
                          <ConfidenceBar
                            value={workstream.confidence}
                            label={t("confidence.label", {
                              value: Math.round(workstream.confidence * 100),
                            })}
                          />
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function KanbanCardItem({
  card,
  active,
  principalName,
  workstreams,
  onSelect,
}: {
  card: KanbanCard;
  active: boolean;
  principalName?: string;
  workstreams: PublicWorkProjection[];
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const primaryWorkstream = workstreams[0];
  return (
    <button
      type="button"
      className={active ? "kanban-card kanban-card--active" : "kanban-card"}
      onClick={onSelect}
    >
      <div className="kanban-card__meta">
        <span>{card.id.slice(0, 8)}</span>
        {card.estimatePoints !== undefined ? (
          <Badge variant="outline">
            {t("kanban.points", { count: card.estimatePoints })}
          </Badge>
        ) : null}
      </div>
      <h3>{card.title}</h3>
      {card.description ? <p>{card.description}</p> : null}
      {primaryWorkstream ? (
        <div className="kanban-card__workstream">
          <PhaseLabel
            phase={primaryWorkstream.phase}
            label={t(`phase.${primaryWorkstream.phase}` as TranslationKey)}
          />
          <span>{primaryWorkstream.title}</span>
          {workstreams.length > 1 ? (
            <small>+{workstreams.length - 1}</small>
          ) : null}
        </div>
      ) : card.relatedWorkstreamIds.length > 0 ? (
        <div className="kanban-card__unlinked">
          <LinkIcon size={13} />
          {t("kanban.restrictedLinks", {
            count: card.relatedWorkstreamIds.length,
          })}
        </div>
      ) : (
        <div className="kanban-card__unlinked">
          <LinkBreakIcon size={13} />
          {t("kanban.independentCard")}
        </div>
      )}
      <div className="kanban-card__footer">
        {principalName ? (
          <>
            <Avatar className="kanban-card__avatar">
              <AvatarFallback>{initials(principalName)}</AvatarFallback>
            </Avatar>
            <span>{principalName}</span>
          </>
        ) : (
          <span>{t("kanban.unassigned")}</span>
        )}
      </div>
    </button>
  );
}

function columnKey(column: KanbanColumn): TranslationKey {
  return (
    columns.find((item) => item.id === column)?.label ?? "kanban.column.backlog"
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts.at(-1)![0] ?? ""}`.toUpperCase();
}
