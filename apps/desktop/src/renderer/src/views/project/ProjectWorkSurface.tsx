import {
  CircleNotchIcon,
  KanbanIcon,
  PlusIcon,
  RoadHorizonIcon,
} from "@phosphor-icons/react";
import type { Feature, WorkItem, WorkItemStatus } from "@intero/domain";
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
} from "../../api.js";

const COLUMNS: Array<{ id: WorkItemStatus; label: string }> = [
  { id: "todo", label: "Todo" },
  { id: "in_progress", label: "In progress" },
  { id: "ready_for_test", label: "Ready for test" },
  { id: "done", label: "Done" },
];

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
  const [view, setView] = useState<"sprint" | "backlog" | "roadmap">("sprint");
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
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["project-work", projectId] });
  const create = useMutation({
    mutationFn: () =>
      createWorkItem(projectId, {
        title: newTitle.trim(),
        status: "todo",
        priority: "P2",
        ...(view === "sprint" && currentSprint
          ? { piId: currentSprint.piId, sprintId: currentSprint.id }
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
      createEpic(projectId, {
        title: newEpicTitle.trim(),
        description: "",
      }),
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
    mutationFn: (input: {
      id: string;
      stage: "planned" | "in_development" | "released";
    }) => updateFeature(projectId, input.id, { stage: input.stage }),
    onSuccess: refresh,
  });
  const closeCurrentSprint = useMutation({
    mutationFn: (sprintId: string) => closeSprint(projectId, sprintId),
    onSuccess: refresh,
  });

  const currentSprint = useMemo(
    () =>
      data.data?.sprints.find((sprint) => sprint.status === "active") ??
      data.data?.sprints.find((sprint) => sprint.status === "planned"),
    [data.data?.sprints],
  );

  if (data.isPending) {
    return (
      <div className="grid h-full place-items-center text-ink-muted">
        <CircleNotchIcon size={22} className="animate-spin" />
      </div>
    );
  }
  if (data.isError || !data.data) {
    return (
      <div className="grid h-full place-items-center text-[13px] text-danger">
        Project work is unavailable.
      </div>
    );
  }

  const backlog = data.data.workItems.filter(
    (item) => !item.sprintId && !item.carryover,
  );
  const board = data.data.workItems.filter(
    (item) =>
      item.carryover || item.sprintId === currentSprint?.id,
  );
  const directFeatures = data.data.features.filter(
    (feature) =>
      !data.data.workItems.some((item) => item.featureId === feature.id),
  );
  const backlogFeatures = directFeatures.filter(
    (feature) => !feature.sprintId,
  );
  const boardFeatures = directFeatures.filter(
    (feature) => feature.sprintId === currentSprint?.id,
  );

  return (
    <div className="animate-view-enter grid h-full grid-rows-[auto_minmax(0,1fr)]">
      <header className="border-b border-line p-[26px_30px_18px]">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-[11px] text-faint">Project work</p>
            <h1 className="mt-1 text-[22px] font-[570] tracking-[-0.03em]">
              {data.data.project.name}
            </h1>
          </div>
          <div className="ml-3 flex rounded-[10px] bg-raise p-[3px]">
            {(["sprint", "backlog", "roadmap"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={
                  view === mode
                    ? "h-7 rounded-quiet bg-panel2 px-3 text-[11.5px] text-ink"
                    : "h-7 rounded-quiet px-3 text-[11.5px] text-ink-muted"
                }
              >
                {mode === "sprint"
                  ? "Current Sprint"
                  : mode === "backlog"
                    ? "Backlog"
                    : "Roadmap"}
              </button>
            ))}
          </div>
          <span className="ml-auto font-mono text-[10.5px] text-faint">
            {currentSprint
              ? `Sprint ${currentSprint.number} · ${currentSprint.startDate}—${currentSprint.endDate}`
              : "No active Sprint"}
          </span>
          {canGovern && currentSprint ? (
            <button
              type="button"
              disabled={
                currentSprint.status === "ended" ||
                closeCurrentSprint.isPending
              }
              onClick={() => closeCurrentSprint.mutate(currentSprint.id)}
              className="h-8 rounded-btn border border-line2 px-3 text-[11.5px] text-ink disabled:opacity-40"
            >
              Close Sprint
            </button>
          ) : null}
          {canGovern ? (
            <button
              type="button"
              onClick={() => setShowPi((value) => !value)}
              className="h-8 rounded-btn border border-line2 px-3 text-[11.5px] text-ink"
            >
              Plan PI
            </button>
          ) : null}
        </div>
        {showPi && canGovern ? (
          <PiComposer
            timezone={data.data.project.timezone}
            pending={createPi.isPending}
            onCreate={(input) => createPi.mutate(input)}
          />
        ) : null}
        {view !== "roadmap" ? (
          <div className="mt-4 flex gap-2">
            <input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder={
                view === "backlog" ? "Add backlog Work Item" : "Add Work Item"
              }
              className="h-9 min-w-[320px] rounded-[9px] border border-line2 bg-panel2 px-3 text-[12.5px] text-ink"
            />
            <button
              type="button"
              disabled={!newTitle.trim() || create.isPending}
              onClick={() => create.mutate()}
              className="inline-flex h-9 items-center gap-1.5 rounded-btn bg-accent-strong px-3.5 text-[12px] font-[620] text-on-accent disabled:opacity-50"
            >
              <PlusIcon size={14} /> Add
            </button>
          </div>
        ) : null}
      </header>

      {view === "sprint" ? (
        <div className="grid min-h-0 grid-cols-4 gap-3 overflow-auto p-[22px_26px_50px]">
          {COLUMNS.map((column) => (
            <section key={column.id} className="min-w-[220px]">
              <div className="flex items-center gap-2 px-1">
                <KanbanIcon size={14} className="text-faint" />
                <strong className="text-[11.5px] font-[620]">
                  {column.label}
                </strong>
                <span className="ml-auto font-mono text-[10px] text-faint">
                  {board.filter((item) => item.status === column.id).length +
                    boardFeatures.filter(
                      (feature) =>
                        featureStageStatus(feature.stage) === column.id,
                    ).length}
                </span>
              </div>
              <div className="mt-3 grid gap-2.5">
                {board
                  .filter((item) => item.status === column.id)
                  .map((item) => (
                    <WorkCard
                      item={item}
                      key={item.id}
                      sourceSprintNumber={
                        item.sourceSprintId
                          ? data.data.sprints.find(
                              (sprint) =>
                                sprint.id === item.sourceSprintId,
                            )?.number
                          : undefined
                      }
                      onOpen={() => onOpenItem(item.id)}
                      onMove={(status) =>
                        move.mutate({ id: item.id, status })
                      }
                    />
                  ))}
                {boardFeatures
                  .filter(
                    (feature) => featureStageStatus(feature.stage) === column.id,
                  )
                  .map((feature) => (
                    <FeatureCard
                      key={feature.id}
                      feature={feature}
                      onMove={(stage) =>
                        moveFeature.mutate({ id: feature.id, stage })
                      }
                    />
                  ))}
              </div>
            </section>
          ))}
        </div>
      ) : view === "backlog" ? (
        <div className="overflow-auto p-[22px_30px_50px]">
          <div className="grid gap-2">
            {backlog.map((item) => (
              <WorkCard
                item={item}
                key={item.id}
                sourceSprintNumber={
                  item.sourceSprintId
                    ? data.data.sprints.find(
                        (sprint) => sprint.id === item.sourceSprintId,
                      )?.number
                    : undefined
                }
                onOpen={() => onOpenItem(item.id)}
                onMove={(status) => move.mutate({ id: item.id, status })}
              />
            ))}
            {backlogFeatures.map((feature) => (
              <FeatureCard
                key={feature.id}
                feature={feature}
                onMove={(stage) =>
                  moveFeature.mutate({ id: feature.id, stage })
                }
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="overflow-auto p-[26px_30px_50px]">
          <div className="mb-5 grid grid-cols-2 gap-3 rounded-container border border-line bg-panel p-4">
            <div className="flex gap-2">
              <input
                value={newEpicTitle}
                onChange={(event) => setNewEpicTitle(event.target.value)}
                placeholder="New Epic roadmap title"
                className="h-8 min-w-0 flex-1 rounded-[8px] border border-line2 bg-panel2 px-3 text-[11px]"
              />
              <button
                type="button"
                disabled={
                  !newEpicTitle.trim() || createEpicMutation.isPending
                }
                onClick={() => createEpicMutation.mutate()}
                className="h-8 rounded-btn bg-raise px-3 text-[10.5px] disabled:opacity-40"
              >
                Add Epic
              </button>
            </div>
            <div className="flex gap-2">
              <input
                value={newFeatureTitle}
                onChange={(event) => setNewFeatureTitle(event.target.value)}
                placeholder="New Feature title"
                className="h-8 min-w-0 flex-1 rounded-[8px] border border-line2 bg-panel2 px-3 text-[11px]"
              />
              <select
                value={newFeatureEpicId}
                onChange={(event) =>
                  setNewFeatureEpicId(event.target.value)
                }
                className="h-8 rounded-[8px] border border-line2 bg-panel2 px-2 text-[10.5px]"
              >
                <option value="">Direct Feature</option>
                {data.data.epics.map((epic) => (
                  <option value={epic.id} key={epic.id}>
                    {epic.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={
                  !newFeatureTitle.trim() || createFeatureMutation.isPending
                }
                onClick={() => createFeatureMutation.mutate()}
                className="h-8 rounded-btn bg-accent-strong px-3 text-[10.5px] text-on-accent disabled:opacity-40"
              >
                Add Feature
              </button>
            </div>
          </div>
          <div className="grid gap-4">
            {data.data.epics.map((epic) => (
              <section
                key={epic.id}
                className="rounded-container border border-line bg-panel2 p-5"
              >
                <div className="flex items-center gap-2">
                  <RoadHorizonIcon size={17} className="text-accent-strong" />
                  <strong className="text-[14px]">{epic.title}</strong>
                </div>
                <p className="mt-2 text-[11.5px] text-ink-muted">
                  {epic.description}
                </p>
                <div className="mt-4 grid gap-2">
                  {data.data.features
                    .filter((feature) => feature.epicId === epic.id)
                    .map((feature) => (
                      <div
                        key={feature.id}
                        className="rounded-card bg-raise p-3 text-[12px]"
                      >
                        <strong>{feature.title}</strong>
                        <span className="ml-2 rounded-pill bg-panel px-2 py-1 font-mono text-[9px] text-faint">
                          {feature.stage}
                        </span>
                      </div>
                    ))}
                </div>
              </section>
            ))}
            {data.data.features
              .filter((feature) => !feature.epicId)
              .map((feature) => (
                <div
                  key={feature.id}
                  className="rounded-container border border-line bg-panel2 p-5"
                >
                  <strong>{feature.title}</strong>
                  <span className="ml-2 text-[10px] text-faint">
                    Direct Feature · {feature.stage}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkCard({
  item,
  sourceSprintNumber,
  onOpen,
  onMove,
}: {
  item: WorkItem;
  sourceSprintNumber: number | undefined;
  onOpen: () => void;
  onMove: (status: WorkItemStatus) => void;
}) {
  return (
    <article className="rounded-card border border-line bg-panel2 p-[14px]">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full border-0 bg-transparent p-0 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9.5px] text-accent-strong">
            {item.priority}
          </span>
          {item.carryover ? (
            <span className="rounded-pill bg-amber-soft px-2 py-0.5 text-[9px] text-amber">
              Carryover
              {sourceSprintNumber === undefined
                ? ""
                : ` · from Sprint ${sourceSprintNumber}`}
            </span>
          ) : null}
        </div>
        <h3 className="mt-2 text-[12.5px] font-[600] leading-[1.45]">
          {item.title}
        </h3>
        {item.points !== undefined ? (
          <p className="mt-2 font-mono text-[9.5px] text-faint">
            {item.points} points
          </p>
        ) : null}
      </button>
      <select
        value={item.status}
        onChange={(event) => onMove(event.target.value as WorkItemStatus)}
        className="mt-3 h-7 w-full rounded-[8px] border border-line2 bg-transparent px-2 text-[10.5px] text-ink"
      >
        <option value="todo">Todo</option>
        <option value="in_progress">In progress</option>
        <option value="ready_for_test">Ready for test</option>
        <option value="done">Done</option>
      </select>
    </article>
  );
}

function FeatureCard({
  feature,
  onMove,
}: {
  feature: Feature;
  onMove: (stage: Feature["stage"]) => void;
}) {
  return (
    <article className="rounded-card border border-line bg-panel2 p-[14px]">
      <div className="flex items-center gap-2">
        <span className="rounded-pill bg-accent-soft px-2 py-0.5 text-[9px] text-accent-strong">
          Feature
        </span>
        {feature.piId && !feature.sprintId ? (
          <span className="font-mono text-[9px] text-faint">PI only</span>
        ) : null}
      </div>
      <h3 className="mt-2 text-[12.5px] font-[600] leading-[1.45]">
        {feature.title}
      </h3>
      <select
        value={feature.stage}
        onChange={(event) =>
          onMove(event.target.value as Feature["stage"])
        }
        className="mt-3 h-7 w-full rounded-[8px] border border-line2 bg-transparent px-2 text-[10.5px] text-ink"
      >
        <option value="planned">Planned</option>
        <option value="in_development">In development</option>
        <option value="released">Released</option>
      </select>
    </article>
  );
}

function featureStageStatus(stage: Feature["stage"]): WorkItemStatus {
  if (stage === "released") return "done";
  if (stage === "in_development") return "in_progress";
  return "todo";
}

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
  const [startDate, setStartDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [sprintCount, setSprintCount] = useState(3);
  const [duration, setDuration] = useState(2);
  return (
    <div className="mt-4 flex items-end gap-2 rounded-card bg-raise p-3">
      <label className="grid gap-1 text-[10px] text-faint">
        Start date
        <input
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          className="h-8 rounded-[8px] border border-line2 bg-panel2 px-2 text-ink"
        />
      </label>
      <label className="grid gap-1 text-[10px] text-faint">
        Sprints
        <input
          type="number"
          min={1}
          max={12}
          value={sprintCount}
          onChange={(event) => setSprintCount(Number(event.target.value))}
          className="h-8 w-20 rounded-[8px] border border-line2 bg-panel2 px-2 text-ink"
        />
      </label>
      <label className="grid gap-1 text-[10px] text-faint">
        Weeks each
        <input
          type="number"
          min={1}
          max={8}
          value={duration}
          onChange={(event) => setDuration(Number(event.target.value))}
          className="h-8 w-20 rounded-[8px] border border-line2 bg-panel2 px-2 text-ink"
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
        className="h-8 rounded-btn bg-accent-strong px-3 text-[11px] text-on-accent"
      >
        Create PI
      </button>
    </div>
  );
}
