import {
  ArrowRightIcon,
  ArrowsClockwiseIcon,
  ArrowsDownUpIcon,
  CaretDownIcon,
  CaretRightIcon,
  CircleNotchIcon,
  FileTextIcon,
  GitPullRequestIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import type {
  Epic,
  Feature,
  Sprint,
  WorkItem,
  WorkItemStatus,
} from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  createEpic,
  createFeature,
  createProgramIncrement,
  createWorkItem,
  getProjectWork,
  closeSprint,
  updateFeature,
  updateWorkItem,
  type ProjectWorkPayload,
} from "../../api.js";
import {
  Avatar,
  EmptySlot,
  FilterChip,
  Meta,
  Meter,
  Pager,
  SearchField,
  SectionLabel,
  SegmentedControl,
  StatusPill,
  TableHead,
  cn,
} from "../../design/primitives.js";
import { isStale, type Tone } from "../../design/utils.js";
import { useI18n } from "../../i18n/index.js";
import type { TranslationKey } from "../../i18n/locales/zh-CN.js";
import { getPilotOverview } from "../../pilot/api.js";
import { usePilotOptional } from "../../pilot/context.js";

type ProjectPane = "board" | "list" | "epic" | "backlog";

const COLUMNS: Array<{
  id: WorkItemStatus;
  label: TranslationKey;
  tone: Tone;
}> = [
  { id: "todo", label: "work.status.todo", tone: "faint" },
  { id: "in_progress", label: "work.status.in_progress", tone: "green" },
  {
    id: "ready_for_test",
    label: "work.status.ready_for_test",
    tone: "amber",
  },
  { id: "done", label: "work.status.done", tone: "faint" },
];

const STAGE_TONE: Record<Feature["stage"], Tone> = {
  planned: "faint",
  in_development: "green",
  released: "accent",
};

const PRIORITY_TONE: Record<WorkItem["priority"], Tone> = {
  P0: "danger",
  P1: "amber",
  P2: "faint",
  P3: "faint",
};

const LIST_TEMPLATE = "74px minmax(0,1fr) 100px 108px 44px 72px 78px";
const BACKLOG_TEMPLATE = "78px 44px minmax(0,1fr) 120px 82px";
const LIST_PAGE_SIZE = 12;
const BACKLOG_PAGE_SIZE = 10;
const EPIC_PAGE_SIZE = 4;
const FEATURE_ITEM_PREVIEW = 5;

export function ProjectWorkSurface({
  projectId,
  canGovern,
  onOpenItem,
}: {
  projectId: string;
  canGovern: boolean;
  onOpenItem: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const { t, formatRelative } = useI18n();
  const pilot = usePilotOptional();
  const [pane, setPane] = useState<ProjectPane>("board");
  const [sprintFilter, setSprintFilter] = useState<string>();
  const [featureFilter, setFeatureFilter] = useState<string>();
  const [listPage, setListPage] = useState(0);
  const [epicPage, setEpicPage] = useState(0);
  const [backlogPage, setBacklogPage] = useState(0);
  const [openEpics, setOpenEpics] = useState<Record<string, boolean>>({});
  const [openFeatures, setOpenFeatures] = useState<Record<string, boolean>>({});
  const [epicQuery, setEpicQuery] = useState("");
  const [epicStage, setEpicStage] = useState<Feature["stage"] | "all">("all");
  const [epicOwner, setEpicOwner] = useState<string>("all");
  const [backlogEpic, setBacklogEpic] = useState<string>("all");
  const [backlogSize, setBacklogSize] = useState<"all" | "small" | "large">(
    "all",
  );
  const [backlogQuery, setBacklogQuery] = useState("");
  const [backlogSort, setBacklogSort] = useState<"age" | "points">("age");
  const [newTitle, setNewTitle] = useState("");
  const [newEpicTitle, setNewEpicTitle] = useState("");
  const [newFeatureTitle, setNewFeatureTitle] = useState("");
  const [newFeatureEpicId, setNewFeatureEpicId] = useState("");
  const [showPi, setShowPi] = useState(false);

  const data = useQuery({
    queryKey: ["project-work", projectId],
    queryFn: ({ signal }) => getProjectWork(projectId, signal),
    refetchInterval: 4_000,
  });
  const overview = useQuery({
    queryKey: ["pilot", "overview", pilot?.identityId, projectId],
    queryFn: ({ signal }) =>
      getPilotOverview(pilot!.identityId!, projectId, signal),
    enabled: Boolean(pilot?.identityId),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["project-work", projectId] });

  const currentSprint = useMemo(
    () =>
      data.data?.sprints.find((sprint) => sprint.status === "active") ??
      data.data?.sprints.find((sprint) => sprint.status === "planned"),
    [data.data?.sprints],
  );
  const activeSprintId = sprintFilter ?? currentSprint?.id ?? ("all" as const);

  const create = useMutation({
    mutationFn: () =>
      createWorkItem(projectId, {
        title: newTitle.trim(),
        status: "todo",
        priority: "P2",
        ...(activeSprintId !== "all" && currentSprint
          ? { piId: currentSprint.piId, sprintId: activeSprintId }
          : {}),
      }),
    onSuccess: async (item) => {
      setNewTitle("");
      await refresh();
      onOpenItem(item.id);
    },
  });
  const move = useMutation({
    mutationFn: (input: { id: string; status: WorkItemStatus }) =>
      updateWorkItem(projectId, input.id, { status: input.status }),
    onSuccess: refresh,
  });
  const createPi = useMutation({
    mutationFn: (input: {
      startDate: string;
      sprintCount: number;
      sprintDurationWeeks: number;
      timezone: string;
    }) => createProgramIncrement(projectId, input),
    onSuccess: async () => {
      setShowPi(false);
      await refresh();
    },
  });
  const createEpicMutation = useMutation({
    mutationFn: () =>
      createEpic(projectId, { title: newEpicTitle.trim(), description: "" }),
    onSuccess: async () => {
      setNewEpicTitle("");
      await refresh();
    },
  });
  const createFeatureMutation = useMutation({
    mutationFn: () =>
      createFeature(projectId, {
        title: newFeatureTitle.trim(),
        description: "",
        stage: "planned",
        ...(newFeatureEpicId ? { epicId: newFeatureEpicId } : {}),
      }),
    onSuccess: async () => {
      setNewFeatureTitle("");
      setNewFeatureEpicId("");
      await refresh();
    },
  });
  const moveFeature = useMutation({
    mutationFn: (input: { id: string; stage: Feature["stage"] }) =>
      updateFeature(projectId, input.id, { stage: input.stage }),
    onSuccess: refresh,
  });
  const closeCurrentSprint = useMutation({
    mutationFn: (sprintId: string) => closeSprint(projectId, sprintId),
    onSuccess: refresh,
  });

  if (data.isPending) {
    return (
      <div className="grid h-full place-items-center text-ink-muted">
        <CircleNotchIcon size={22} className="animate-spin" />
      </div>
    );
  }
  if (data.isError || !data.data) {
    return (
      <div className="grid h-full place-items-center gap-3 text-[13px] text-danger">
        {t("project.unavailable")}
      </div>
    );
  }

  const work = data.data;
  const names = new Map(
    (overview.data?.principals ?? []).map((principal) => [
      principal.id,
      principal.displayName,
    ]),
  );
  const nameOf = (id: string) => names.get(id) ?? id.slice(0, 8);
  // Branded ids are strings at the UI boundary; the maps are keyed loosely so
  // filter state (plain strings) can look rows up without casting.
  const epicOfFeature = new Map<string, string | undefined>(
    work.features.map((feature) => [feature.id, feature.epicId]),
  );
  const featureOfItem = new Map<string, string>(
    work.workItems.flatMap((item) =>
      item.featureId ? [[item.id, item.featureId] as [string, string]] : [],
    ),
  );
  const featureNames = new Map<string, string>(
    work.features.map((feature) => [feature.id, feature.title]),
  );
  const epicNames = new Map<string, string>(
    work.epics.map((epic) => [epic.id, epic.title]),
  );
  const prCount = new Map<string, number>();
  for (const reference of work.codeReferences) {
    prCount.set(
      reference.workItemId,
      (prCount.get(reference.workItemId) ?? 0) + 1,
    );
  }

  // The scheduled set: everything in the selected sprint, plus carryover, which
  // stays visible until it is finished or explicitly rescheduled.
  const scheduled = work.workItems.filter(
    (item) =>
      (activeSprintId === "all"
        ? Boolean(item.sprintId) || item.carryover
        : item.sprintId === activeSprintId || item.carryover) &&
      (!featureFilter || featureOfItem.get(item.id) === featureFilter),
  );
  const backlogItems = work.workItems.filter(
    (item) => !item.sprintId && !item.carryover,
  );
  const donePoints = scheduled
    .filter((item) => item.status === "done")
    .reduce((sum, item) => sum + (item.points ?? 0), 0);
  const totalPoints = scheduled.reduce(
    (sum, item) => sum + (item.points ?? 0),
    0,
  );

  const selectedSprint = work.sprints.find(
    (sprint) => sprint.id === activeSprintId,
  );

  return (
    <div className="animate-view-enter grid h-full grid-rows-[auto_minmax(0,1fr)]">
      <header className="border-b border-line px-[30px] pb-[18px] pt-[26px]">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
          <div>
            <p className="text-[11.5px] text-faint">{t("project.eyebrow")}</p>
            <h1 className="mt-1.5 text-[22px] font-[570] tracking-[-0.03em]">
              {work.project.name}
            </h1>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              active={activeSprintId === "all"}
              onClick={() => {
                setSprintFilter("all");
                resetPages();
              }}
            >
              {t("general.all")}
            </FilterChip>
            {work.sprints.map((sprint) => (
              <FilterChip
                key={sprint.id}
                active={activeSprintId === sprint.id}
                onClick={() => {
                  setSprintFilter(sprint.id);
                  resetPages();
                }}
              >
                {t("project.sprintNumber", { n: sprint.number })}
              </FilterChip>
            ))}
          </div>

          <span className="text-[11.5px] text-faint">
            {selectedSprint
              ? `${selectedSprint.startDate} – ${selectedSprint.endDate} · ${t(
                  `project.sprintStatus.${selectedSprint.status}` as TranslationKey,
                )}`
              : t("project.allSprints")}
          </span>

          <span className="inline-flex items-center gap-[9px]">
            <Meter
              percent={totalPoints > 0 ? (donePoints / totalPoints) * 100 : 0}
              tone="green"
              width={96}
              grow
            />
            <span className="font-mono text-[11px] text-ink-muted">
              {t("project.pointsDone", {
                done: donePoints,
                total: totalPoints,
              })}
            </span>
          </span>

          <SegmentedControl
            className="ml-auto"
            value={pane}
            onChange={setPane}
            items={[
              { id: "board" as const, label: t("project.board") },
              { id: "list" as const, label: t("project.list") },
              { id: "epic" as const, label: t("project.epicPane") },
              {
                id: "backlog" as const,
                label: t("project.backlog"),
                badge: backlogItems.length,
              },
            ]}
          />

          {canGovern && currentSprint ? (
            <button
              type="button"
              disabled={
                currentSprint.status === "ended" || closeCurrentSprint.isPending
              }
              onClick={() => closeCurrentSprint.mutate(currentSprint.id)}
              className="h-8 cursor-pointer rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] text-ink hover:border-accent-strong disabled:opacity-40"
            >
              {t("project.closeSprint")}
            </button>
          ) : null}
          {canGovern ? (
            <button
              type="button"
              onClick={() => setShowPi((value) => !value)}
              aria-expanded={showPi}
              className="h-8 cursor-pointer rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] text-ink hover:border-accent-strong"
            >
              {t("project.planPi")}
            </button>
          ) : null}
        </div>

        <p className="mt-3.5 inline-flex items-center gap-2 rounded-pill bg-accent-soft px-3 py-[7px] text-[11.5px] text-accent-strong">
          <ArrowsClockwiseIcon size={13} />
          {t("project.callout")}
        </p>

        {showPi && canGovern ? (
          <PiComposer
            timezone={work.project.timezone}
            pending={createPi.isPending}
            onCreate={(input) => createPi.mutate(input)}
          />
        ) : null}

        {pane === "board" || pane === "list" ? (
          <div className="mt-3.5 flex gap-2">
            <input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder={t("project.addItemPlaceholder")}
              aria-label={t("project.addItemPlaceholder")}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  newTitle.trim() &&
                  !create.isPending
                ) {
                  event.preventDefault();
                  create.mutate();
                }
              }}
              className="h-9 min-w-[320px] rounded-btn border border-line2 bg-panel2 px-3 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-accent-strong"
            />
            <button
              type="button"
              disabled={!newTitle.trim() || create.isPending}
              onClick={() => create.mutate()}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-btn border-0 bg-accent-strong px-3.5 text-[12px] font-[620] text-on-accent disabled:opacity-50"
            >
              <PlusIcon size={14} />
              {t("project.create")}
            </button>
          </div>
        ) : null}
      </header>

      {pane === "board" ? (
        <BoardPane
          items={scheduled}
          sprints={work.sprints}
          prCount={prCount}
          nameOf={nameOf}
          formatRelative={formatRelative}
          onOpenItem={onOpenItem}
          onMove={(id, status) => move.mutate({ id, status })}
        />
      ) : null}

      {pane === "list" ? (
        <ListTablePane
          items={scheduled}
          page={listPage}
          onPage={setListPage}
          nameOf={nameOf}
          formatRelative={formatRelative}
          onOpenItem={onOpenItem}
          {...(featureFilter
            ? {
                featureFilter: {
                  id: featureFilter,
                  name: featureNames.get(featureFilter) ?? featureFilter,
                  onClear: () => {
                    setFeatureFilter(undefined);
                    setListPage(0);
                  },
                },
              }
            : {})}
        />
      ) : null}

      {pane === "epic" ? (
        <EpicPane
          work={work}
          page={epicPage}
          onPage={setEpicPage}
          query={epicQuery}
          onQuery={(value) => {
            setEpicQuery(value);
            setEpicPage(0);
          }}
          stage={epicStage}
          onStage={(value) => {
            setEpicStage(value);
            setEpicPage(0);
          }}
          owner={epicOwner}
          onOwner={(value) => {
            setEpicOwner(value);
            setEpicPage(0);
          }}
          openEpics={openEpics}
          onToggleEpic={(id) =>
            setOpenEpics((current) => ({ ...current, [id]: !current[id] }))
          }
          openFeatures={openFeatures}
          onToggleFeature={(id) =>
            setOpenFeatures((current) => ({ ...current, [id]: !current[id] }))
          }
          nameOf={nameOf}
          onOpenItem={onOpenItem}
          onSeeAllInList={(featureId) => {
            setFeatureFilter(featureId);
            setSprintFilter("all");
            setListPage(0);
            setPane("list");
          }}
          onMoveFeature={(id, stage) => moveFeature.mutate({ id, stage })}
          newEpicTitle={newEpicTitle}
          onNewEpicTitle={setNewEpicTitle}
          onCreateEpic={() => createEpicMutation.mutate()}
          creatingEpic={createEpicMutation.isPending}
          newFeatureTitle={newFeatureTitle}
          onNewFeatureTitle={setNewFeatureTitle}
          newFeatureEpicId={newFeatureEpicId}
          onNewFeatureEpicId={setNewFeatureEpicId}
          onCreateFeature={() => createFeatureMutation.mutate()}
          creatingFeature={createFeatureMutation.isPending}
        />
      ) : null}

      {pane === "backlog" ? (
        <BacklogPane
          items={backlogItems}
          epicOfItem={(id) => {
            const featureId = featureOfItem.get(id);
            return featureId ? epicOfFeature.get(featureId) : undefined;
          }}
          featureOfItem={featureOfItem}
          featureNames={featureNames}
          epicNames={epicNames}
          epics={work.epics}
          epicFilter={backlogEpic}
          onEpicFilter={(value) => {
            setBacklogEpic(value);
            setBacklogPage(0);
          }}
          size={backlogSize}
          onSize={(value) => {
            setBacklogSize(value);
            setBacklogPage(0);
          }}
          query={backlogQuery}
          onQuery={(value) => {
            setBacklogQuery(value);
            setBacklogPage(0);
          }}
          sort={backlogSort}
          onSort={setBacklogSort}
          page={backlogPage}
          onPage={setBacklogPage}
          onOpenItem={onOpenItem}
        />
      ) : null}
    </div>
  );

  function resetPages() {
    setListPage(0);
    setEpicPage(0);
    setBacklogPage(0);
  }
}

/* ------------------------------- board ---------------------------------- */

function BoardPane({
  items,
  sprints,
  prCount,
  nameOf,
  formatRelative,
  onOpenItem,
  onMove,
}: {
  items: WorkItem[];
  sprints: Array<Sprint & { status: string }>;
  prCount: Map<string, number>;
  nameOf: (id: string) => string;
  formatRelative: (value: string) => string;
  onOpenItem: (id: string) => void;
  onMove: (id: string, status: WorkItemStatus) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="min-h-0 overflow-auto px-[30px] pb-[34px] pt-5">
      <div className="grid grid-cols-[repeat(4,minmax(0,1fr))] items-start gap-2.5">
        {COLUMNS.map((column) => {
          const columnItems = items.filter((item) => item.status === column.id);
          return (
            <div className="flex flex-col gap-[9px]" key={column.id}>
              <div className="flex items-center gap-2 px-1">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    column.tone === "green"
                      ? "bg-green"
                      : column.tone === "amber"
                        ? "bg-amber"
                        : "bg-faint",
                  )}
                />
                <strong className="text-[11.5px] font-[650]">
                  {t(column.label)}
                </strong>
                <Meta className="text-[10.5px]">{columnItems.length}</Meta>
              </div>
              {columnItems.map((item) => (
                <article
                  key={item.id}
                  className="grid gap-2.5 rounded-[13px] border border-line bg-panel2 px-3.5 py-3 transition-[border-color,transform] duration-[180ms] hover:-translate-y-px hover:border-accent-strong"
                >
                  <button
                    type="button"
                    onClick={() => onOpenItem(item.id)}
                    className="grid w-full cursor-pointer gap-2.5 border-0 bg-transparent p-0 text-left text-ink"
                  >
                    <span className="flex items-center gap-2">
                      <Meta>{item.id.slice(0, 8)}</Meta>
                      <StatusPill tone={PRIORITY_TONE[item.priority]} size="sm">
                        {item.priority}
                      </StatusPill>
                      {item.carryover ? (
                        <StatusPill tone="amber" size="sm">
                          {t("project.carryover", {
                            n:
                              sprints.find(
                                (sprint) => sprint.id === item.sourceSprintId,
                              )?.number ?? "—",
                          })}
                        </StatusPill>
                      ) : null}
                    </span>
                    <span className="text-[12.5px] font-[560] leading-[1.45] [text-wrap:pretty]">
                      {item.title}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-[7px]">
                      {item.ownerId ? (
                        <Avatar
                          id={item.ownerId}
                          name={nameOf(item.ownerId)}
                          size="sm"
                        />
                      ) : (
                        <span className="text-[10px] text-faint">
                          {t("project.unassigned")}
                        </span>
                      )}
                      {item.points === undefined ? null : (
                        <span className="inline-grid h-[18px] min-w-5 place-items-center rounded-quiet bg-raise px-1.5 font-mono text-[10px] text-ink-muted">
                          {item.points}
                        </span>
                      )}
                      {prCount.get(item.id) ? (
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-faint">
                          <GitPullRequestIcon size={12} />
                          {prCount.get(item.id)}
                        </span>
                      ) : null}
                      <Meta
                        tone={
                          isStale(item.updatedAt, undefined) ? "amber" : "faint"
                        }
                        className="ml-auto text-[9.5px]"
                      >
                        {formatRelative(item.updatedAt)}
                      </Meta>
                    </span>
                  </button>
                  <label className="flex items-center gap-1.5 border-t border-line pt-2 text-[9.5px] text-faint">
                    {t("project.moveTo")}
                    <select
                      value={item.status}
                      aria-label={t("project.moveTo")}
                      onChange={(event) =>
                        onMove(item.id, event.target.value as WorkItemStatus)
                      }
                      className="ml-auto h-6 cursor-pointer rounded-quiet border border-line2 bg-transparent px-1.5 text-[10px] text-ink-muted"
                    >
                      {COLUMNS.map((option) => (
                        <option value={option.id} key={option.id}>
                          {t(option.label)}
                        </option>
                      ))}
                    </select>
                  </label>
                </article>
              ))}
              {columnItems.length === 0 ? (
                <EmptySlot>{t("project.columnEmpty")}</EmptySlot>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------- list ---------------------------------- */

function ListTablePane({
  items,
  page,
  onPage,
  nameOf,
  formatRelative,
  onOpenItem,
  featureFilter,
}: {
  items: WorkItem[];
  page: number;
  onPage: (page: number) => void;
  nameOf: (id: string) => string;
  formatRelative: (value: string) => string;
  onOpenItem: (id: string) => void;
  featureFilter?: { id: string; name: string; onClear: () => void };
}) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(items.length / LIST_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const from = current * LIST_PAGE_SIZE;
  const rows = items.slice(from, from + LIST_PAGE_SIZE);

  return (
    <div className="min-h-0 overflow-auto px-[30px] pb-[34px] pt-[18px]">
      <div className="mb-3.5 flex items-center gap-2.5">
        {featureFilter ? (
          <FilterChip active onClick={featureFilter.onClear}>
            {featureFilter.name} ✕
          </FilterChip>
        ) : null}
        <div className="ml-auto">
          <Pager
            page={current}
            pages={pages}
            label={
              items.length
                ? `${from + 1}–${Math.min(from + LIST_PAGE_SIZE, items.length)} / ${items.length}`
                : "0 / 0"
            }
            onPrevious={() => onPage(Math.max(0, current - 1))}
            onNext={() => onPage(Math.min(pages - 1, current + 1))}
          />
        </div>
      </div>
      <TableHead
        template={LIST_TEMPLATE}
        columns={[
          t("project.col.id"),
          t("project.col.task"),
          t("project.col.status"),
          t("project.col.owner"),
          t("project.col.points"),
          t("project.col.priority"),
          t("project.col.updated"),
        ]}
      />
      {rows.map((item) => {
        const column = COLUMNS.find((entry) => entry.id === item.status)!;
        return (
          <button
            type="button"
            key={item.id}
            onClick={() => onOpenItem(item.id)}
            className="grid w-full cursor-pointer items-center gap-3.5 rounded-quiet border-0 border-b border-line p-3 text-left text-ink hover:bg-hover-wash"
            style={{ gridTemplateColumns: LIST_TEMPLATE }}
          >
            <Meta className="text-[10.5px]">{item.id.slice(0, 8)}</Meta>
            <span className="truncate text-[12.5px] font-[540]">
              {item.title}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[11px]",
                column.tone === "green"
                  ? "text-green"
                  : column.tone === "amber"
                    ? "text-amber"
                    : "text-faint",
              )}
            >
              <span
                className={cn(
                  "h-[5px] w-[5px] rounded-full",
                  column.tone === "green"
                    ? "bg-green"
                    : column.tone === "amber"
                      ? "bg-amber"
                      : "bg-faint",
                )}
              />
              {t(column.label)}
            </span>
            <span className="inline-flex min-w-0 items-center gap-[7px]">
              {item.ownerId ? (
                <>
                  <Avatar
                    id={item.ownerId}
                    name={nameOf(item.ownerId)}
                    size="sm"
                  />
                  <span className="truncate text-[11px] text-ink-muted">
                    {nameOf(item.ownerId)}
                  </span>
                </>
              ) : (
                <span className="truncate text-[11px] text-faint">
                  {t("project.unassigned")}
                </span>
              )}
            </span>
            <Meta tone="muted" className="text-[11px]">
              {item.points ?? "—"}
            </Meta>
            <StatusPill tone={PRIORITY_TONE[item.priority]} size="sm">
              {item.priority}
            </StatusPill>
            <Meta tone={isStale(item.updatedAt, undefined) ? "amber" : "faint"}>
              {formatRelative(item.updatedAt)}
            </Meta>
          </button>
        );
      })}
      {rows.length === 0 ? (
        <div className="mt-3.5">
          <EmptySlot>{t("project.listEmpty")}</EmptySlot>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------- feature / epic tree -------------------------- */

function EpicPane({
  work,
  page,
  onPage,
  query,
  onQuery,
  stage,
  onStage,
  owner,
  onOwner,
  openEpics,
  onToggleEpic,
  openFeatures,
  onToggleFeature,
  nameOf,
  onOpenItem,
  onSeeAllInList,
  onMoveFeature,
  newEpicTitle,
  onNewEpicTitle,
  onCreateEpic,
  creatingEpic,
  newFeatureTitle,
  onNewFeatureTitle,
  newFeatureEpicId,
  onNewFeatureEpicId,
  onCreateFeature,
  creatingFeature,
}: {
  work: ProjectWorkPayload;
  page: number;
  onPage: (page: number) => void;
  query: string;
  onQuery: (value: string) => void;
  stage: Feature["stage"] | "all";
  onStage: (value: Feature["stage"] | "all") => void;
  owner: string;
  onOwner: (value: string) => void;
  openEpics: Record<string, boolean>;
  onToggleEpic: (id: string) => void;
  openFeatures: Record<string, boolean>;
  onToggleFeature: (id: string) => void;
  nameOf: (id: string) => string;
  onOpenItem: (id: string) => void;
  onSeeAllInList: (featureId: string) => void;
  onMoveFeature: (id: string, stage: Feature["stage"]) => void;
  newEpicTitle: string;
  onNewEpicTitle: (value: string) => void;
  onCreateEpic: () => void;
  creatingEpic: boolean;
  newFeatureTitle: string;
  onNewFeatureTitle: (value: string) => void;
  newFeatureEpicId: string;
  onNewFeatureEpicId: (value: string) => void;
  onCreateFeature: () => void;
  creatingFeature: boolean;
}) {
  const { t } = useI18n();
  const itemsByFeature = new Map<string, WorkItem[]>();
  for (const item of work.workItems) {
    if (!item.featureId) continue;
    const bucket = itemsByFeature.get(item.featureId) ?? [];
    bucket.push(item);
    itemsByFeature.set(item.featureId, bucket);
  }
  const featuresByEpic = new Map<string, Feature[]>();
  const looseFeatures: Feature[] = [];
  for (const feature of work.features) {
    if (!feature.epicId) {
      looseFeatures.push(feature);
      continue;
    }
    const bucket = featuresByEpic.get(feature.epicId) ?? [];
    bucket.push(feature);
    featuresByEpic.set(feature.epicId, bucket);
  }

  const needle = query.trim().toLowerCase();
  const featurePasses = (feature: Feature) =>
    (stage === "all" || feature.stage === stage) &&
    (owner === "all" || feature.ownerId === owner);
  const matches = (epic: Epic) => {
    const features = featuresByEpic.get(epic.id) ?? [];
    if (!features.some(featurePasses) && features.length > 0) return false;
    if (!needle) return true;
    if (
      `${epic.id}${epic.title}${epic.description}`
        .toLowerCase()
        .includes(needle)
    ) {
      return true;
    }
    return features.some(
      (feature) =>
        `${feature.id}${feature.title}`.toLowerCase().includes(needle) ||
        (itemsByFeature.get(feature.id) ?? []).some((item) =>
          `${item.id}${item.title}`.toLowerCase().includes(needle),
        ),
    );
  };

  const filteredEpics = work.epics.filter(matches);
  const pages = Math.max(1, Math.ceil(filteredEpics.length / EPIC_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const from = current * EPIC_PAGE_SIZE;
  const rows = filteredEpics.slice(from, from + EPIC_PAGE_SIZE);
  const owners = [
    ...new Set(
      work.features.flatMap((feature) =>
        feature.ownerId ? [feature.ownerId] : [],
      ),
    ),
  ];

  return (
    <div className="min-h-0 overflow-auto px-[30px] pb-10 pt-5">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
        <div className="flex items-center gap-1.5">
          <SectionLabel className="tracking-[0.06em]">
            {t("project.filterStage")}
          </SectionLabel>
          {(["all", "planned", "in_development", "released"] as const).map(
            (option) => (
              <FilterChip
                key={option}
                active={stage === option}
                onClick={() => onStage(option)}
              >
                {option === "all"
                  ? t("general.all")
                  : t(`project.stage.${option}` as TranslationKey)}
              </FilterChip>
            ),
          )}
        </div>
        {owners.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <SectionLabel className="tracking-[0.06em]">
              {t("project.col.owner")}
            </SectionLabel>
            <FilterChip active={owner === "all"} onClick={() => onOwner("all")}>
              {t("general.all")}
            </FilterChip>
            {owners.map((id) => (
              <FilterChip
                key={id}
                active={owner === id}
                onClick={() => onOwner(id)}
                leading={<Avatar id={id} name={nameOf(id)} size="xs" />}
              >
                {nameOf(id)}
              </FilterChip>
            ))}
          </div>
        ) : null}
        <SearchField
          value={query}
          onChange={onQuery}
          placeholder={t("project.searchEpics")}
          icon={<MagnifyingGlassIcon size={13} className="text-faint" />}
        />
        <Meta className="ml-auto text-[10.5px]">
          {t("project.epicCount", {
            shown: filteredEpics.length,
            total: work.epics.length,
          })}
        </Meta>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-container border border-line bg-panel p-4">
        <div className="flex gap-2">
          <input
            value={newEpicTitle}
            onChange={(event) => onNewEpicTitle(event.target.value)}
            placeholder={t("project.newEpicPlaceholder")}
            aria-label={t("project.newEpicPlaceholder")}
            className="h-8 min-w-0 flex-1 rounded-quiet border border-line2 bg-panel2 px-3 text-[11px] text-ink outline-none placeholder:text-faint focus:border-accent-strong"
          />
          <button
            type="button"
            disabled={!newEpicTitle.trim() || creatingEpic}
            onClick={onCreateEpic}
            className="h-8 cursor-pointer rounded-btn border-0 bg-raise px-3 text-[10.5px] text-ink disabled:opacity-40"
          >
            {t("project.addEpic")}
          </button>
        </div>
        <div className="flex gap-2">
          <input
            value={newFeatureTitle}
            onChange={(event) => onNewFeatureTitle(event.target.value)}
            placeholder={t("project.newFeaturePlaceholder")}
            aria-label={t("project.newFeaturePlaceholder")}
            className="h-8 min-w-0 flex-1 rounded-quiet border border-line2 bg-panel2 px-3 text-[11px] text-ink outline-none placeholder:text-faint focus:border-accent-strong"
          />
          <select
            value={newFeatureEpicId}
            aria-label={t("project.parentEpic")}
            onChange={(event) => onNewFeatureEpicId(event.target.value)}
            className="h-8 rounded-quiet border border-line2 bg-panel2 px-2 text-[10.5px] text-ink"
          >
            <option value="">{t("project.directFeature")}</option>
            {work.epics.map((epic) => (
              <option value={epic.id} key={epic.id}>
                {epic.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!newFeatureTitle.trim() || creatingFeature}
            onClick={onCreateFeature}
            className="h-8 cursor-pointer rounded-btn border-0 bg-accent-strong px-3 text-[10.5px] font-[620] text-on-accent disabled:opacity-40"
          >
            {t("project.addFeature")}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        {rows.map((epic) => {
          const features = (featuresByEpic.get(epic.id) ?? []).filter(
            featurePasses,
          );
          const allItems = features.flatMap(
            (feature) => itemsByFeature.get(feature.id) ?? [],
          );
          const total = allItems.reduce(
            (sum, item) => sum + (item.points ?? 0),
            0,
          );
          const done = allItems
            .filter((item) => item.status === "done")
            .reduce((sum, item) => sum + (item.points ?? 0), 0);
          const open = openEpics[epic.id] ?? true;
          return (
            <div
              key={epic.id}
              className="overflow-hidden rounded-container border border-line bg-panel2"
            >
              <button
                type="button"
                onClick={() => onToggleEpic(epic.id)}
                aria-expanded={open}
                className="grid w-full cursor-pointer grid-cols-[16px_66px_minmax(0,1fr)_128px_88px] items-center gap-3.5 border-0 bg-transparent px-[18px] py-4 text-left text-ink hover:bg-hover-wash"
              >
                {open ? (
                  <CaretDownIcon size={14} className="text-faint" />
                ) : (
                  <CaretRightIcon size={14} className="text-faint" />
                )}
                <Meta className="text-[10.5px]">{epic.id.slice(0, 8)}</Meta>
                <span className="grid min-w-0 gap-1.5">
                  <span className="text-[14.5px] font-[580] tracking-[-0.015em]">
                    {epic.title}
                  </span>
                  <span className="truncate text-[10.5px] text-faint">
                    {epic.description || t("project.noDescription")}
                  </span>
                </span>
                <span className="grid gap-1.5">
                  <span className="flex items-center gap-2">
                    <Meter
                      percent={total > 0 ? (done / total) * 100 : 0}
                      tone="green"
                      width={68}
                      grow
                    />
                    <Meta tone="muted">
                      {done}/{total}
                    </Meta>
                  </span>
                  <span className="text-[10px] text-faint">
                    {t("project.epicShape", {
                      features: features.length,
                      items: allItems.length,
                    })}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-[10.5px] text-faint">
                  <FileTextIcon size={12} />
                  {t("project.specLinked", {
                    count: allItems.filter((item) => item.specId).length,
                  })}
                </span>
              </button>

              {open ? (
                <div className="flex flex-col pb-3.5 pl-[34px] pr-[18px]">
                  {features.map((feature) => {
                    const items = itemsByFeature.get(feature.id) ?? [];
                    const featureOpen = openFeatures[feature.id] ?? false;
                    const doneCount = items.filter(
                      (item) => item.status === "done",
                    ).length;
                    return (
                      <div
                        key={feature.id}
                        className="border-l border-line2 pl-4"
                      >
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onToggleFeature(feature.id)}
                            aria-expanded={featureOpen}
                            className={cn(
                              "grid flex-1 cursor-pointer grid-cols-[14px_62px_minmax(0,1fr)_96px_74px] items-center gap-3 rounded-inset border-0 px-3 py-2.5 text-left text-ink hover:bg-hover-wash",
                              featureOpen ? "bg-raise" : "bg-transparent",
                            )}
                          >
                            {featureOpen ? (
                              <CaretDownIcon size={12} className="text-faint" />
                            ) : (
                              <CaretRightIcon
                                size={12}
                                className="text-faint"
                              />
                            )}
                            <Meta>{feature.id.slice(0, 8)}</Meta>
                            <span className="truncate text-[12.5px] font-[550]">
                              {feature.title}
                            </span>
                            <StatusPill
                              tone={STAGE_TONE[feature.stage]}
                              size="sm"
                            >
                              {t(
                                `project.stage.${feature.stage}` as TranslationKey,
                              )}
                            </StatusPill>
                            <Meta className="text-[9.5px]">
                              {items.length
                                ? t("project.featureCount", {
                                    done: doneCount,
                                    total: items.length,
                                  })
                                : t("project.featureEmptyShort")}
                            </Meta>
                          </button>
                          <select
                            value={feature.stage}
                            aria-label={t("project.moveTo")}
                            onChange={(event) =>
                              onMoveFeature(
                                feature.id,
                                event.target.value as Feature["stage"],
                              )
                            }
                            className="h-6 cursor-pointer rounded-quiet border border-line2 bg-transparent px-1.5 text-[10px] text-ink-muted"
                          >
                            {(
                              ["planned", "in_development", "released"] as const
                            ).map((option) => (
                              <option value={option} key={option}>
                                {t(`project.stage.${option}` as TranslationKey)}
                              </option>
                            ))}
                          </select>
                        </div>

                        {featureOpen ? (
                          <div className="flex flex-col pb-2 pl-[26px] pt-0.5">
                            {items
                              .slice(0, FEATURE_ITEM_PREVIEW)
                              .map((item) => {
                                const column = COLUMNS.find(
                                  (entry) => entry.id === item.status,
                                )!;
                                return (
                                  <button
                                    type="button"
                                    key={item.id}
                                    onClick={() => onOpenItem(item.id)}
                                    className="grid w-full cursor-pointer grid-cols-[8px_70px_minmax(0,1fr)_84px_26px_30px] items-center gap-3 rounded-btn border-0 bg-transparent px-3 py-2.5 text-left text-ink hover:bg-hover-wash"
                                  >
                                    <span
                                      className={cn(
                                        "h-1.5 w-1.5 rounded-full",
                                        column.tone === "green"
                                          ? "bg-green"
                                          : column.tone === "amber"
                                            ? "bg-amber"
                                            : "bg-faint",
                                      )}
                                    />
                                    <Meta>{item.id.slice(0, 8)}</Meta>
                                    <span
                                      className={cn(
                                        "truncate text-[12px]",
                                        item.status === "done"
                                          ? "text-faint"
                                          : "text-ink",
                                      )}
                                    >
                                      {item.title}
                                    </span>
                                    <span
                                      className={cn(
                                        "text-[10.5px]",
                                        column.tone === "green"
                                          ? "text-green"
                                          : column.tone === "amber"
                                            ? "text-amber"
                                            : "text-faint",
                                      )}
                                    >
                                      {t(column.label)}
                                    </span>
                                    {item.ownerId ? (
                                      <Avatar
                                        id={item.ownerId}
                                        name={nameOf(item.ownerId)}
                                        size="sm"
                                      />
                                    ) : (
                                      <span />
                                    )}
                                    <Meta
                                      tone="muted"
                                      className="text-right text-[10px]"
                                    >
                                      {item.points ?? "—"}
                                    </Meta>
                                  </button>
                                );
                              })}
                            {items.length > FEATURE_ITEM_PREVIEW ? (
                              <button
                                type="button"
                                onClick={() => onSeeAllInList(feature.id)}
                                className="ml-3 mt-1 inline-flex cursor-pointer items-center gap-1.5 self-start border-0 bg-transparent p-0 text-[11px] text-accent-strong hover:underline"
                              >
                                {t("project.seeAllInList", {
                                  count: items.length,
                                })}
                                <ArrowRightIcon size={11} />
                              </button>
                            ) : null}
                            {items.length === 0 ? (
                              <span className="px-3 py-2.5 text-[11px] text-faint">
                                {t("project.featureEmpty")}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {features.length === 0 ? (
                    <span className="py-2.5 pl-4 text-[11px] text-faint">
                      {t("project.epicEmpty")}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {looseFeatures.length > 0 && current === pages - 1 ? (
          <div className="rounded-container border border-dashed border-line2 p-4">
            <SectionLabel>{t("project.directFeatures")}</SectionLabel>
            <div className="mt-3 grid gap-2">
              {looseFeatures.filter(featurePasses).map((feature) => (
                <div
                  key={feature.id}
                  className="flex items-center gap-2.5 rounded-inset bg-raise px-3 py-2.5"
                >
                  <Meta>{feature.id.slice(0, 8)}</Meta>
                  <span className="truncate text-[12px] text-ink">
                    {feature.title}
                  </span>
                  <StatusPill
                    tone={STAGE_TONE[feature.stage]}
                    size="sm"
                    className="ml-auto"
                  >
                    {t(`project.stage.${feature.stage}` as TranslationKey)}
                  </StatusPill>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {filteredEpics.length === 0 ? (
          <EmptySlot>{t("project.epicNone")}</EmptySlot>
        ) : null}

        <Pager
          page={current}
          pages={pages}
          label={
            filteredEpics.length
              ? `${from + 1}–${Math.min(from + EPIC_PAGE_SIZE, filteredEpics.length)} / ${filteredEpics.length}`
              : "0 / 0"
          }
          onPrevious={() => onPage(Math.max(0, current - 1))}
          onNext={() => onPage(Math.min(pages - 1, current + 1))}
        />
      </div>
    </div>
  );
}

/* ------------------------------- backlog -------------------------------- */

function BacklogPane({
  items,
  epicOfItem,
  featureOfItem,
  featureNames,
  epicNames,
  epics,
  epicFilter,
  onEpicFilter,
  size,
  onSize,
  query,
  onQuery,
  sort,
  onSort,
  page,
  onPage,
  onOpenItem,
}: {
  items: WorkItem[];
  epicOfItem: (id: string) => string | undefined;
  featureOfItem: Map<string, string>;
  featureNames: Map<string, string>;
  epicNames: Map<string, string>;
  epics: Epic[];
  epicFilter: string;
  onEpicFilter: (value: string) => void;
  size: "all" | "small" | "large";
  onSize: (value: "all" | "small" | "large") => void;
  query: string;
  onQuery: (value: string) => void;
  sort: "age" | "points";
  onSort: (value: "age" | "points") => void;
  page: number;
  onPage: (page: number) => void;
  onOpenItem: (id: string) => void;
}) {
  const { t, formatRelative } = useI18n();
  const needle = query.trim().toLowerCase();
  const filtered = items
    .filter((item) => {
      if (epicFilter !== "all" && epicOfItem(item.id) !== epicFilter) {
        return false;
      }
      const points = item.points ?? 0;
      if (size === "small" && points > 3) return false;
      if (size === "large" && points < 5) return false;
      return (
        !needle || `${item.id}${item.title}`.toLowerCase().includes(needle)
      );
    })
    .toSorted((left, right) =>
      sort === "age"
        ? Date.parse(left.createdAt) - Date.parse(right.createdAt)
        : (right.points ?? 0) - (left.points ?? 0),
    );
  const pages = Math.max(1, Math.ceil(filtered.length / BACKLOG_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const from = current * BACKLOG_PAGE_SIZE;
  const rows = filtered.slice(from, from + BACKLOG_PAGE_SIZE);

  return (
    <div className="min-h-0 overflow-auto px-[30px] pb-10 pt-[22px]">
      <p className="mb-4 max-w-[640px] text-[12.5px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
        {t("project.backlogLede")}
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <SectionLabel className="tracking-[0.06em]">
            {t("project.epicPane")}
          </SectionLabel>
          <FilterChip
            active={epicFilter === "all"}
            onClick={() => onEpicFilter("all")}
          >
            {t("general.all")}
          </FilterChip>
          {epics.map((epic) => (
            <FilterChip
              key={epic.id}
              active={epicFilter === epic.id}
              onClick={() => onEpicFilter(epic.id)}
            >
              {epic.title}
            </FilterChip>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <SectionLabel className="tracking-[0.06em]">
            {t("project.filterSize")}
          </SectionLabel>
          {(["all", "small", "large"] as const).map((option) => (
            <FilterChip
              key={option}
              active={size === option}
              onClick={() => onSize(option)}
            >
              {option === "all"
                ? t("general.all")
                : t(`project.size.${option}` as TranslationKey)}
            </FilterChip>
          ))}
        </div>
        <SearchField
          value={query}
          onChange={onQuery}
          placeholder={t("project.searchBacklog")}
          width={132}
          icon={<MagnifyingGlassIcon size={13} className="text-faint" />}
        />
        <button
          type="button"
          onClick={() => onSort(sort === "age" ? "points" : "age")}
          className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-pill border border-line2 bg-transparent px-3 text-[11px] text-ink-muted hover:border-accent-strong hover:text-accent-strong"
        >
          <ArrowsDownUpIcon size={12} />
          {sort === "age" ? t("project.sortAge") : t("project.sortPoints")}
        </button>
        <Meta className="ml-auto text-[10.5px]">
          {t("project.backlogCount", {
            shown: filtered.length,
            total: items.length,
          })}
        </Meta>
      </div>

      <TableHead
        template={BACKLOG_TEMPLATE}
        columns={[
          t("project.col.id"),
          t("project.col.points"),
          t("project.col.task"),
          t("project.col.epic"),
          t("project.col.age"),
        ]}
      />
      {rows.map((item) => {
        const featureId = featureOfItem.get(item.id);
        const epicId = epicOfItem(item.id);
        return (
          <button
            type="button"
            key={item.id}
            onClick={() => onOpenItem(item.id)}
            className="grid w-full cursor-pointer items-center gap-3.5 rounded-btn border-0 border-b border-line p-3.5 text-left text-ink hover:bg-hover-wash"
            style={{ gridTemplateColumns: BACKLOG_TEMPLATE }}
          >
            <Meta className="text-[10.5px]">{item.id.slice(0, 8)}</Meta>
            <span className="inline-grid h-5 min-w-[22px] place-items-center justify-self-start rounded-quiet bg-raise px-[7px] font-mono text-[10.5px] text-ink-muted">
              {item.points ?? "—"}
            </span>
            <span className="grid min-w-0 gap-1.5">
              <span className="truncate text-[12.5px] font-[540]">
                {item.title}
              </span>
              <span className="truncate text-[10.5px] text-faint [text-wrap:pretty]">
                {item.description || t("project.noDescription")}
              </span>
            </span>
            <span className="grid gap-1">
              <Meta tone="muted">
                {epicId ? (epicNames.get(epicId) ?? "—") : t("project.noEpic")}
              </Meta>
              <Meta className="text-[9px]">
                {featureId ? (featureNames.get(featureId) ?? "") : ""}
              </Meta>
            </span>
            <Meta>{formatRelative(item.createdAt)}</Meta>
          </button>
        );
      })}
      {rows.length === 0 ? (
        <div className="mt-3.5">
          <EmptySlot>{t("project.backlogEmpty")}</EmptySlot>
        </div>
      ) : null}
      <div className="mt-4">
        <Pager
          page={current}
          pages={pages}
          label={
            filtered.length
              ? `${from + 1}–${Math.min(from + BACKLOG_PAGE_SIZE, filtered.length)} / ${filtered.length}`
              : "0 / 0"
          }
          onPrevious={() => onPage(Math.max(0, current - 1))}
          onNext={() => onPage(Math.min(pages - 1, current + 1))}
        />
      </div>
    </div>
  );
}

/* ------------------------------ PI composer ------------------------------ */

function PiComposer({
  timezone,
  pending,
  onCreate,
}: {
  timezone: string;
  pending: boolean;
  onCreate: (input: {
    startDate: string;
    sprintCount: number;
    sprintDurationWeeks: number;
    timezone: string;
  }) => void;
}) {
  const { t } = useI18n();
  const [startDate, setStartDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [sprintCount, setSprintCount] = useState(3);
  const [duration, setDuration] = useState(2);
  return (
    <div className="mt-3.5 flex flex-wrap items-end gap-2 rounded-card bg-raise p-3">
      <label className="grid gap-1 text-[10px] text-faint">
        {t("project.piStart")}
        <input
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          className="h-8 rounded-quiet border border-line2 bg-panel2 px-2 text-ink"
        />
      </label>
      <label className="grid gap-1 text-[10px] text-faint">
        {t("project.piSprints")}
        <input
          type="number"
          min={1}
          max={12}
          value={sprintCount}
          onChange={(event) => setSprintCount(Number(event.target.value))}
          className="h-8 w-20 rounded-quiet border border-line2 bg-panel2 px-2 text-ink"
        />
      </label>
      <label className="grid gap-1 text-[10px] text-faint">
        {t("project.piWeeks")}
        <input
          type="number"
          min={1}
          max={8}
          value={duration}
          onChange={(event) => setDuration(Number(event.target.value))}
          className="h-8 w-20 rounded-quiet border border-line2 bg-panel2 px-2 text-ink"
        />
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          onCreate({
            startDate,
            sprintCount,
            sprintDurationWeeks: duration,
            timezone,
          })
        }
        className="h-8 cursor-pointer rounded-btn border-0 bg-accent-strong px-3 text-[11px] font-[620] text-on-accent disabled:opacity-45"
      >
        {t("project.createPi")}
      </button>
    </div>
  );
}
