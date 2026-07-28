import {
  CaretDownIcon,
  ChatsCircleIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  CodeIcon,
  EyeIcon,
  FunnelIcon,
  HourglassMediumIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  RobotIcon,
  SealCheckIcon,
  UserFocusIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import type { Spec } from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import {
  addProjectSpecComment,
  confirmProjectSpec,
  createProjectSpecVersion,
  getProjectSpecs,
  requestProjectSpecReview,
  setProjectSpecCommentStatus,
} from "../../api.js";
import {
  Avatar,
  EmptySlot,
  FilterChip,
  ListPane,
  ListRow,
  LoadMore,
  Meta,
  ScopeMark,
  SegmentedControl,
  StatusPill,
  cn,
} from "../../design/primitives.js";
import type { Tone } from "../../design/utils.js";
import { useI18n } from "../../i18n/index.js";
import type { TranslationKey } from "../../i18n/locales/zh-CN.js";
import { getPilotOverview } from "../../pilot/api.js";
import { usePilotOptional } from "../../pilot/context.js";
import { ProjectAgentConnectionBadge } from "../agent/connection-state.js";
import { AnnotatableSpecBody, type Annotation } from "./AnnotatableSpecBody.js";

const STATUS_TONE: Record<Spec["status"], Tone> = {
  draft: "faint",
  in_review: "amber",
  approved: "green",
  changes_requested: "danger",
  superseded: "faint",
};

type Filter = Spec["status"] | "all" | "mine";

const FILTERS: Array<{ id: Filter; label: TranslationKey }> = [
  { id: "all", label: "general.all" },
  { id: "mine", label: "spec.filterNeedsYou" },
  { id: "in_review", label: "spec.status.in_review" },
  { id: "draft", label: "spec.status.draft" },
  { id: "approved", label: "spec.status.approved" },
];

const PAGE_SIZE = 8;
const NEW_SPEC = "new";

export function ProjectSpecReviewSurface({
  projectId,
  projects,
  onProjectChange,
  onOpenAgentConnections,
}: {
  projectId: string;
  projects: Array<{ id: string; name: string }>;
  onProjectChange: (projectId: string) => void;
  onOpenAgentConnections?: () => void;
}) {
  const pilot = usePilotOptional();
  const queryClient = useQueryClient();
  const { t, formatRelative } = useI18n();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const specs = useQuery({
    queryKey: ["project-specs", projectId],
    queryFn: ({ signal }) => getProjectSpecs(projectId, signal),
    refetchOnWindowFocus: true,
  });
  const overview = useQuery({
    queryKey: ["pilot", "overview", pilot?.identityId, projectId],
    queryFn: ({ signal }) =>
      getPilotOverview(pilot!.identityId!, projectId, signal),
    enabled: Boolean(pilot?.identityId),
  });
  const [activeId, setActiveId] = useState<string>(NEW_SPEC);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>();
  const [comment, setComment] = useState("");
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["project-specs", projectId] });
  const items = specs.data?.items ?? [];
  const active = items.find((item) => item.spec.id === activeId);
  const current = active?.revisions.find(
    (revision) => revision.id === active.spec.currentRevisionId,
  );
  const selected =
    active?.revisions.find((revision) => revision.id === selectedRevisionId) ??
    current;

  useEffect(() => {
    if (activeId === NEW_SPEC && items[0]) setActiveId(items[0].spec.id);
  }, [activeId, items]);
  useEffect(() => {
    if (!active || !current) return;
    setTitle(active.spec.title);
    setMarkdown(current.markdown);
    setSelectedRevisionId(current.id);
    setReviewerIds(active.nominatedReviewerIds);
    setPickerOpen(false);
  }, [active?.spec.id, current?.id]);

  const publish = useMutation({
    mutationFn: () =>
      createProjectSpecVersion(projectId, {
        ...(active ? { specId: active.spec.id } : {}),
        title: title.trim(),
        markdown,
        changeSummary: active
          ? t("spec.revisionChangeSummary")
          : t("spec.initialChangeSummary"),
        affectedScopes: [],
      }),
    onSuccess: async (detail) => {
      setActiveId(detail.spec.id);
      setMode("preview");
      await refresh();
    },
  });
  const requestReview = useMutation({
    mutationFn: (ids: string[]) =>
      requestProjectSpecReview(projectId, active!.spec.id, ids),
    onSuccess: async () => {
      setPickerOpen(false);
      await refresh();
    },
  });
  const confirm = useMutation({
    mutationFn: () => confirmProjectSpec(projectId, active!.spec.id),
    onSuccess: refresh,
  });
  const addComment = useMutation({
    mutationFn: (input: {
      body: string;
      threadId?: string;
      lineStart?: number;
      lineEnd?: number;
      charStart?: number;
      charEnd?: number;
      selection?: string;
    }) =>
      addProjectSpecComment(projectId, active!.spec.id, {
        revisionId: selected!.id,
        ...(input.threadId ? { threadId: input.threadId } : {}),
        lineStart: input.lineStart ?? 1,
        lineEnd: input.lineEnd ?? input.lineStart ?? 1,
        ...(input.charStart === undefined
          ? {}
          : { charStart: input.charStart }),
        ...(input.charEnd === undefined ? {} : { charEnd: input.charEnd }),
        ...(input.selection ? { selection: input.selection } : {}),
        body: input.body,
      }),
    onSuccess: refresh,
  });
  const setThreadStatus = useMutation({
    mutationFn: (input: { threadId: string; status: "open" | "resolved" }) =>
      setProjectSpecCommentStatus(projectId, input.threadId, input.status),
    onSuccess: refresh,
  });

  if (specs.isPending) {
    return (
      <div className="grid h-full place-items-center text-[12px] text-faint">
        {t("spec.loading")}
      </div>
    );
  }
  if (specs.isError) {
    return (
      <div className="grid h-full place-items-center text-[12px] text-danger">
        {t("spec.unavailable")}
      </div>
    );
  }

  const principals = overview.data?.principals ?? [];
  const principalNames = new Map(
    principals.map((principal) => [principal.id, principal.displayName]),
  );
  const nameOf = (id: string) => principalNames.get(id) ?? id.slice(0, 8);
  const me = pilot?.identityId;

  const needsYou = (item: (typeof items)[number]) =>
    item.spec.status === "in_review" &&
    Boolean(me) &&
    item.nominatedReviewerIds.includes(me!) &&
    !item.confirmations.some(
      (entry) =>
        entry.revisionId === item.spec.currentRevisionId &&
        entry.confirmerId === me,
    );

  const filtered = items.filter((item) =>
    filter === "all"
      ? true
      : filter === "mine"
        ? needsYou(item)
        : item.spec.status === filter,
  );
  const visible = filtered.slice(0, shown);
  const inReviewCount = items.filter(
    (item) => item.spec.status === "in_review",
  ).length;
  const needsYouCount = items.filter(needsYou).length;

  const authorId = current?.createdBy;
  const isAuthor = Boolean(me && authorId && me === authorId);
  const project = projects.find((candidate) => candidate.id === projectId);

  // Threads split by how they were made: an anchored selection is an
  // annotation on the text, everything else is discussion about the whole spec.
  const revisionThreads =
    active?.commentThreads.filter(
      (thread) => thread.revisionId === selected?.id,
    ) ?? [];
  const annotations: Annotation[] = revisionThreads
    .filter((thread) => Boolean(thread.selection))
    .map((thread) => ({
      threadId: thread.id,
      lineStart: thread.lineStart,
      lineEnd: thread.lineEnd,
      charStart: thread.charStart,
      charEnd: thread.charEnd,
      selection: thread.selection ?? "",
      status: thread.status,
      comments: thread.comments.map((entry) => ({
        id: entry.id,
        authorId: entry.authorId,
        authorName: nameOf(entry.authorId),
        body: entry.body,
        createdAt: entry.createdAt,
      })),
    }));
  const discussion = revisionThreads.filter((thread) => !thread.selection);
  const shownDiscussion = unresolvedOnly
    ? discussion.filter((thread) => thread.status === "open")
    : discussion;
  // Every visible count comes from the same revision-scoped thread set. Anchored
  // annotations remain rendered in the document body, but they are still
  // review threads and must not disappear from the discussion summary while
  // blocking the Decision Record.
  const openThreadCount = revisionThreads.filter(
    (thread) => thread.status === "open",
  ).length;

  // The stand-in publishes its impact analysis as an agent comment; there is no
  // separate field for it, so the newest agent comment is the analysis.
  const impact = revisionThreads
    .flatMap((thread) => thread.comments)
    .filter((entry) => entry.authorKind === "agent")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

  const confirmations =
    active?.confirmations.filter(
      (entry) => entry.revisionId === selected?.id,
    ) ?? [];
  const requiredConfirmations = active?.policy.requiredConfirmations ?? 1;
  const nominated = active?.nominatedReviewerIds ?? [];
  const outstanding = nominated.filter(
    (id) => !confirmations.some((entry) => entry.confirmerId === id),
  );
  const youConfirmed = confirmations.some((entry) => entry.confirmerId === me);

  // Reviewer load is real: how many specs still in review already name them.
  const loadOf = (id: string) =>
    items.filter(
      (item) =>
        item.spec.status === "in_review" &&
        item.nominatedReviewerIds.includes(id),
    ).length;
  // "Recommended" = they have already engaged with this spec's threads.
  const engaged = new Set<string>(
    revisionThreads.flatMap((thread) =>
      thread.comments
        .filter((entry) => entry.authorKind === "human")
        .map((entry) => entry.authorId),
    ),
  );
  const candidates = principals
    .filter(
      (principal) => principal.kind === "human" && principal.id !== authorId,
    )
    .filter((principal) =>
      pickerQuery.trim()
        ? principal.displayName
            .toLowerCase()
            .includes(pickerQuery.trim().toLowerCase())
        : true,
    )
    .sort((left, right) => {
      const bias = Number(engaged.has(right.id)) - Number(engaged.has(left.id));
      return bias !== 0 ? bias : loadOf(left.id) - loadOf(right.id);
    });

  return (
    <div className="animate-view-enter grid h-full grid-cols-[312px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
      <ListPane
        title={t("nav.spec")}
        count={`${filtered.length} / ${items.length}`}
        lede={
          <>
            <strong className="font-[620] text-amber">
              {t("spec.inReviewCount", { count: inReviewCount })}
            </strong>{" "}
            · {t("spec.needsYouCount", { count: needsYouCount })}
          </>
        }
        header={
          projects.length > 1 ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setProjectMenuOpen((open) => !open)}
                aria-expanded={projectMenuOpen}
                className="-ml-1.5 mb-3 inline-flex w-[calc(100%+6px)] cursor-pointer items-center gap-2 rounded-btn border-0 bg-transparent py-[5px] pl-1.5 pr-[9px] text-left text-ink hover:bg-hover-wash"
              >
                <ScopeMark
                  id={projectId}
                  label={project?.name ?? ""}
                  size="sm"
                />
                {/* `min-w-0` is what lets the name actually truncate: a flex
                    item defaults to its content width, and a project named at
                    any length would otherwise widen the whole pane. */}
                <strong className="min-w-0 truncate text-[13.5px] font-[620]">
                  {project?.name}
                </strong>
                <CaretDownIcon
                  size={10}
                  className="ml-auto shrink-0 text-faint"
                />
              </button>
              {projectMenuOpen ? (
                <div className="absolute left-0 right-0 top-[34px] z-20 grid gap-0.5 rounded-inset border border-line2 bg-panel2 p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.34)]">
                  {projects.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        onProjectChange(option.id);
                        setProjectMenuOpen(false);
                      }}
                      className={cn(
                        "cursor-pointer truncate rounded-quiet border-0 px-2.5 py-2 text-left text-[12px] text-ink",
                        option.id === projectId
                          ? "bg-sel"
                          : "bg-transparent hover:bg-hover-wash",
                      )}
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null
        }
        action={
          <button
            type="button"
            aria-label={t("spec.newDraft")}
            title={t("spec.newDraft")}
            onClick={() => {
              setActiveId(NEW_SPEC);
              setTitle("");
              setMarkdown("");
              setMode("edit");
            }}
            className="grid h-6 w-6 cursor-pointer place-items-center rounded-quiet border-0 bg-raise text-ink-muted hover:text-accent-strong"
          >
            <PlusIcon size={13} />
          </button>
        }
        filters={FILTERS.map((option) => (
          <FilterChip
            key={option.id}
            active={filter === option.id}
            onClick={() => {
              setFilter(option.id);
              setShown(PAGE_SIZE);
            }}
          >
            {t(option.label)}
          </FilterChip>
        ))}
        onScroll={(event) => {
          const element = event.currentTarget;
          if (
            element.scrollTop + element.clientHeight >
            element.scrollHeight - 80
          ) {
            setShown((count) => Math.min(count + PAGE_SIZE, filtered.length));
          }
        }}
        footer={
          <>
            {shown < filtered.length ? (
              <LoadMore
                onClick={() =>
                  setShown((count) =>
                    Math.min(count + PAGE_SIZE, filtered.length),
                  )
                }
                label={t("general.loadMore")}
              />
            ) : null}
            <span className="ml-auto font-mono text-[10px] text-faint">
              {t("general.showingOf", {
                shown: visible.length,
                total: filtered.length,
              })}
            </span>
          </>
        }
      >
        {visible.map((item) => {
          const head = item.revisions.find(
            (revision) => revision.id === item.spec.currentRevisionId,
          );
          const scopes = head?.affectedScopes.length ?? 0;
          const yours = Boolean(me && head?.createdBy === me);
          return (
            <ListRow
              key={item.spec.id}
              selected={item.spec.id === activeId}
              onClick={() => setActiveId(item.spec.id)}
              testId={`project-spec-row-${item.spec.id}`}
            >
              {/* Wraps rather than squeezing: with a status pill and the
                  author badge there is not always room for one line. */}
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Meta className="shrink-0 whitespace-nowrap">
                  {item.spec.id.slice(0, 8)} ·{" "}
                  {t("spec.rev", { n: head?.revision ?? 1 })}
                </Meta>
                <StatusPill tone={STATUS_TONE[item.spec.status]} size="sm">
                  {t(`spec.status.${item.spec.status}` as TranslationKey)}
                </StatusPill>
                {yours ? (
                  <StatusPill tone="accent" size="sm">
                    <UserFocusIcon size={10} />
                    {t("spec.yours")}
                  </StatusPill>
                ) : null}
                <Meta className="ml-auto shrink-0 whitespace-nowrap text-[9px]">
                  {formatRelative(head?.createdAt ?? item.spec.createdAt)}
                </Meta>
              </span>
              <span className="text-[12.5px] font-[560] leading-[1.4] [text-wrap:pretty]">
                {item.spec.title}
              </span>
              <span className="flex min-w-0 items-center gap-2">
                {head ? (
                  <Avatar
                    id={head.createdBy}
                    name={nameOf(head.createdBy)}
                    size="xs"
                  />
                ) : null}
                <span className="min-w-0 truncate text-[10px] text-faint">
                  {head ? nameOf(head.createdBy) : "—"} ·{" "}
                  {t("spec.scopeCount", { count: scopes })}
                </span>
              </span>
            </ListRow>
          );
        })}
        {filtered.length === 0 ? (
          <div className="mx-0.5 my-2.5">
            <EmptySlot>{t("spec.noneInFilter")}</EmptySlot>
          </div>
        ) : null}
      </ListPane>

      <div className="h-full overflow-auto px-[34px] pb-[70px] pt-[30px]">
        <div className="flex flex-wrap items-center gap-2.5">
          <Meta className="text-[10.5px]">
            {active
              ? `${active.spec.id.slice(0, 8)} · ${t("spec.rev", {
                  n: selected?.revision ?? 1,
                })}`
              : t("spec.localDraft")}
          </Meta>
          {active ? (
            <StatusPill tone={STATUS_TONE[active.spec.status]}>
              {t(`spec.status.${active.spec.status}` as TranslationKey)}
            </StatusPill>
          ) : null}
          {isAuthor ? (
            <StatusPill tone="accent">
              <UserFocusIcon size={12} />
              {t("spec.yoursLong")}
            </StatusPill>
          ) : null}
          {active && current ? (
            <span className="text-[11px] text-faint">
              {t("spec.initiated", {
                name: nameOf(current.createdBy),
                time: formatRelative(current.createdAt),
              })}
            </span>
          ) : null}
          {overview.data && onOpenAgentConnections ? (
            <ProjectAgentConnectionBadge
              bindings={overview.data.bindings}
              identityId={pilot?.identityId}
              onOpen={onOpenAgentConnections}
            />
          ) : null}
          <SegmentedControl
            className="ml-auto"
            value={mode}
            onChange={setMode}
            items={[
              {
                id: "preview" as const,
                label: (
                  <>
                    <EyeIcon size={13} />
                    {t("spec.snapshot")}
                  </>
                ),
              },
              {
                id: "edit" as const,
                label: (
                  <>
                    <CodeIcon size={13} />
                    {t("spec.newVersion")}
                  </>
                ),
              },
            ]}
          />
          <button
            type="button"
            disabled={!title.trim() || !markdown.trim() || publish.isPending}
            onClick={() => publish.mutate()}
            className="h-8 cursor-pointer rounded-btn border-0 bg-accent-strong px-3.5 text-[11.5px] font-[620] text-on-accent disabled:opacity-45"
          >
            {t("spec.publishVersion")}
          </button>
        </div>

        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={mode === "preview"}
          placeholder={t("spec.titlePlaceholder")}
          aria-label={t("spec.titleLabel")}
          className="mt-3 w-full border-0 bg-transparent text-[26px] font-[540] tracking-[-0.035em] outline-none placeholder:text-faint disabled:opacity-100"
        />

        <div className="mt-5 flex flex-wrap items-start gap-[22px]">
          <div className="min-w-0 flex-[1_1_440px]">
            {active ? (
              <div className="flex flex-wrap gap-1.5">
                {active.revisions.map((revision) => (
                  <button
                    type="button"
                    key={revision.id}
                    onClick={() => setSelectedRevisionId(revision.id)}
                    className={cn(
                      "grid cursor-pointer gap-1 whitespace-nowrap rounded-[11px] border px-3.5 py-2.5 text-left",
                      selected?.id === revision.id
                        ? "border-accent-strong bg-accent-soft"
                        : "border-line bg-panel2 hover:border-accent-strong",
                    )}
                  >
                    <span className="font-mono text-[11px] text-ink">
                      {t("spec.rev", { n: revision.revision })}
                    </span>
                    <span className="text-[10.5px] text-faint">
                      {active.spec.confirmedRevisionId === revision.id
                        ? t("spec.confirmed")
                        : truncate(revision.changeSummary, 28)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-[22px] rounded-container border border-line bg-panel2 px-9 py-8">
              {mode === "preview" ? (
                <AnnotatableSpecBody
                  markdown={selected?.markdown ?? markdown}
                  annotations={annotations}
                  busy={addComment.isPending}
                  onCreate={(input) => addComment.mutate(input)}
                  onReply={(input) => addComment.mutate(input)}
                />
              ) : (
                <>
                  <div className="flex items-center gap-2.5 rounded-t-[11px] border border-b-0 border-line bg-panel px-3 py-2.5">
                    <Meta className="inline-flex items-center gap-1.5">
                      <CodeIcon size={14} />
                      Markdown
                    </Meta>
                    <span className="text-[10.5px] text-faint">
                      {t("spec.markdownHint")}
                    </span>
                    <Meta className="ml-auto">
                      {t("spec.markdownStat", {
                        lines: markdown.split("\n").length,
                        chars: markdown.length,
                      })}
                    </Meta>
                  </div>
                  <textarea
                    value={markdown}
                    onChange={(event) => setMarkdown(event.target.value)}
                    aria-label={t("spec.markdownEditor")}
                    className="min-h-[440px] w-full resize-y rounded-b-[11px] border border-line bg-panel p-5 font-mono text-[12.5px] leading-[1.9] outline-none focus:border-accent-strong"
                  />
                  {annotations.length > 0 ? (
                    <p className="mt-2.5 inline-flex items-center gap-[7px] rounded-btn bg-amber-soft px-2.5 py-2 text-[10.5px] text-amber">
                      {t("spec.editAnnotationWarn", {
                        count: annotations.length,
                      })}
                    </p>
                  ) : null}
                </>
              )}
            </div>

            <div className="mt-[26px]">
              <div className="flex items-center gap-[11px]">
                <ChatsCircleIcon size={16} className="text-ink-muted" />
                <strong className="text-[12.5px] font-[640]">
                  {t("spec.discussion")}
                </strong>
                <Meta>
                  {t("spec.threadCount", {
                    total: revisionThreads.length,
                    open: openThreadCount,
                  })}
                </Meta>
                <FilterChip
                  className="ml-auto"
                  active={unresolvedOnly}
                  onClick={() => setUnresolvedOnly((on) => !on)}
                  leading={<FunnelIcon size={12} />}
                >
                  {t("spec.onlyUnresolved")}
                </FilterChip>
              </div>

              <div className="mt-3.5 flex flex-col gap-2.5">
                {shownDiscussion.map((thread) => (
                  <ThreadCard
                    key={thread.id}
                    thread={thread}
                    nameOf={nameOf}
                    busy={addComment.isPending || setThreadStatus.isPending}
                    onToggleStatus={() =>
                      setThreadStatus.mutate({
                        threadId: thread.id,
                        status: thread.status === "open" ? "resolved" : "open",
                      })
                    }
                    onReply={(body) =>
                      addComment.mutate({ threadId: thread.id, body })
                    }
                  />
                ))}
                {shownDiscussion.length === 0 ? (
                  <EmptySlot>
                    {annotations.length > 0 && discussion.length === 0
                      ? t("spec.annotationsInBody", {
                          count: annotations.length,
                        })
                      : t(
                          unresolvedOnly
                            ? "spec.noUnresolved"
                            : "spec.noComments",
                        )}
                  </EmptySlot>
                ) : null}
              </div>

              {active && selected ? (
                <div className="mt-3.5 rounded-card border border-line bg-panel2 p-4">
                  <textarea
                    ref={composerRef}
                    rows={3}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder={t("spec.commentPlaceholder")}
                    className="w-full resize-none rounded-inset border border-line bg-panel px-3 py-2.5 text-[12px] leading-[1.65] text-ink outline-none placeholder:text-faint focus:border-accent-strong"
                  />
                  <div className="mt-2.5 flex items-center gap-2.5">
                    <span className="text-[10.5px] text-faint">
                      {t("spec.commentFoot")}
                    </span>
                    <button
                      type="button"
                      disabled={!comment.trim() || addComment.isPending}
                      onClick={() =>
                        addComment.mutate(
                          { body: comment.trim() },
                          { onSuccess: () => setComment("") },
                        )
                      }
                      className="ml-auto h-[30px] cursor-pointer rounded-btn border-0 bg-accent-strong px-4 text-[12px] font-[620] text-on-accent disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {t("spec.addComment")}
                    </button>
                  </div>
                  {addComment.error ? (
                    <p role="alert" className="mt-2 text-[10px] text-danger">
                      {mutationMessage(addComment.error)}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="sticky top-0 flex max-w-[320px] flex-[1_1_260px] flex-col gap-3">
            <div className="rounded-[13px] border border-line bg-panel2 p-4">
              <div className="flex items-center gap-2.5">
                <strong className="text-[11.5px] font-[640]">
                  {t("spec.reviewers")}
                </strong>
                <Meta className="text-[9.5px]">
                  {t("spec.confirmationState", {
                    count: confirmations.length,
                    required: requiredConfirmations,
                  })}
                </Meta>
                <button
                  type="button"
                  title={t("spec.requestReview")}
                  aria-label={t("spec.requestReview")}
                  onClick={() => setPickerOpen((open) => !open)}
                  className="ml-auto grid h-6 w-6 cursor-pointer place-items-center rounded-quiet border border-line2 bg-transparent text-ink-muted hover:border-accent-strong hover:text-accent-strong"
                >
                  <UserPlusIcon size={13} />
                </button>
              </div>

              <div className="mt-3 flex flex-col gap-0.5">
                {nominated.map((id) => {
                  const done = confirmations.some(
                    (entry) => entry.confirmerId === id,
                  );
                  return (
                    <div
                      key={id}
                      className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 px-1 py-[7px]"
                    >
                      <Avatar id={id} name={nameOf(id)} size="md" />
                      <span className="grid min-w-0">
                        <strong className="truncate text-[11.5px] font-[600]">
                          {nameOf(id)}
                        </strong>
                        <small className="mt-0.5 truncate text-[9.5px] text-faint">
                          {t("spec.reviewerLoad", { count: loadOf(id) })}
                        </small>
                      </span>
                      <StatusPill tone={done ? "green" : "amber"} size="sm">
                        {done ? (
                          <CheckCircleIcon size={11} />
                        ) : (
                          <ClockIcon size={11} />
                        )}
                        {t(done ? "spec.confirmedBy" : "spec.awaiting")}
                      </StatusPill>
                    </div>
                  );
                })}
                {nominated.length === 0 ? (
                  <p className="px-1 py-2 text-[10.5px] text-faint">
                    {t("spec.noReviewers")}
                  </p>
                ) : null}
              </div>

              {pickerOpen ? (
                <div className="mt-3 border-t border-line pt-3">
                  <div className="text-[10.5px] font-[640] text-accent-strong">
                    {t("spec.requestForRev", { n: selected?.revision ?? 1 })}
                  </div>
                  <p className="mt-2 text-[10.5px] leading-[1.6] text-faint [text-wrap:pretty]">
                    {t("spec.requestHint")}
                  </p>
                  <div className="mt-2.5 flex h-7 items-center gap-[7px] rounded-btn border border-line bg-panel px-2.5">
                    <MagnifyingGlassIcon size={12} className="text-faint" />
                    <input
                      value={pickerQuery}
                      onChange={(event) => setPickerQuery(event.target.value)}
                      placeholder={t("spec.searchMembers")}
                      className="h-full min-w-0 flex-1 border-0 bg-transparent text-[11px] text-ink outline-none"
                    />
                  </div>
                  <div className="mt-2 flex flex-col gap-[3px]">
                    {candidates.map((principal) => {
                      const picked = reviewerIds.includes(principal.id);
                      return (
                        <button
                          key={principal.id}
                          type="button"
                          onClick={() =>
                            setReviewerIds((ids) =>
                              picked
                                ? ids.filter((id) => id !== principal.id)
                                : [...ids, principal.id],
                            )
                          }
                          className={cn(
                            "grid w-full cursor-pointer grid-cols-[16px_22px_minmax(0,1fr)] items-center gap-2.5 rounded-inset border px-2.5 py-[7px] text-left text-ink",
                            picked
                              ? "border-accent-strong bg-sel"
                              : "border-line bg-transparent hover:border-accent-strong",
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              "grid h-[15px] w-[15px] place-items-center rounded-[4px] border",
                              picked
                                ? "border-accent-strong bg-accent-strong text-on-accent"
                                : "border-line2 bg-transparent text-transparent",
                            )}
                          >
                            <CheckIcon size={10} weight="bold" />
                          </span>
                          <Avatar
                            id={principal.id}
                            name={principal.displayName}
                            size="sm"
                          />
                          <span className="grid min-w-0 gap-0.5">
                            <span className="flex items-center gap-1.5">
                              <strong className="truncate text-[11px] font-[620]">
                                {principal.displayName}
                              </strong>
                              {engaged.has(principal.id) ? (
                                <span className="shrink-0 rounded-pill bg-accent-soft px-1.5 py-px text-[8.5px] font-[620] text-accent-strong">
                                  {t("spec.recommended")}
                                </span>
                              ) : null}
                              <Meta className="ml-auto text-[9px]">
                                {t("spec.reviewerLoad", {
                                  count: loadOf(principal.id),
                                })}
                              </Meta>
                            </span>
                          </span>
                        </button>
                      );
                    })}
                    {candidates.length === 0 ? (
                      <div className="px-2.5 py-3 text-[10.5px] text-faint">
                        {t("spec.noCandidates")}
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPickerOpen(false);
                        setReviewerIds(nominated);
                      }}
                      className="h-7 cursor-pointer border-0 bg-transparent px-2.5 text-[11px] text-ink-muted hover:text-ink"
                    >
                      {t("general.close")}
                    </button>
                    <button
                      type="button"
                      disabled={
                        reviewerIds.length === 0 || requestReview.isPending
                      }
                      onClick={() => requestReview.mutate(reviewerIds)}
                      className="ml-auto h-7 cursor-pointer rounded-btn border-0 bg-accent-strong px-3 text-[11.5px] font-[620] text-on-accent disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {t("spec.sendRequest")}
                    </button>
                  </div>
                  {requestReview.error ? (
                    <p role="alert" className="mt-2 text-[10px] text-danger">
                      {mutationMessage(requestReview.error)}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {impact ? (
              <div className="rounded-[13px] border border-accent-soft bg-accent-soft p-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-[22px] w-[22px] place-items-center rounded-[6px_10px_6px_6px] bg-accent-strong text-on-accent">
                    <RobotIcon size={12} />
                  </span>
                  <strong className="text-[11.5px] font-[620]">
                    {t("spec.impactTitle")}
                  </strong>
                </div>
                <p className="mt-2.5 text-[12px] leading-[1.7] text-ink [text-wrap:pretty]">
                  {impact.body}
                </p>
                <small className="mt-[11px] block text-[10px] text-ink-muted">
                  {t("spec.impactFoot")}
                </small>
              </div>
            ) : null}

            {active && isAuthor ? (
              <div className="rounded-[13px] border border-line bg-panel2 p-4">
                <div className="flex items-center gap-2.5">
                  <HourglassMediumIcon size={16} className="text-amber" />
                  <strong className="text-[11.5px] font-[620]">
                    {t("spec.awaitingTitle")}
                  </strong>
                </div>
                <p className="mt-2.5 text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
                  {outstanding.length > 0
                    ? t("spec.awaitingBody", {
                        names: outstanding.map(nameOf).join("、"),
                      })
                    : t("spec.awaitingNone")}
                </p>
                <p className="mt-2.5 rounded-btn bg-raise px-2.5 py-2 text-[10.5px] leading-[1.6] text-faint [text-wrap:pretty]">
                  {t("spec.authorCannotApprove")}
                </p>
                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    disabled={
                      outstanding.length === 0 || requestReview.isPending
                    }
                    onClick={() => requestReview.mutate(nominated)}
                    className="h-8 cursor-pointer rounded-btn border border-line2 bg-transparent text-[11.5px] font-[600] text-ink hover:border-accent-strong disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {t("spec.nudge")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("edit")}
                    className="h-8 cursor-pointer rounded-btn border-0 bg-accent-strong text-[11.5px] font-[620] text-on-accent"
                  >
                    {t("spec.reviseSpec")}
                  </button>
                </div>
              </div>
            ) : null}

            {active && !isAuthor ? (
              <div className="rounded-[13px] border border-line bg-panel2 p-4">
                <div className="flex items-center gap-2.5">
                  <SealCheckIcon
                    size={16}
                    className={
                      confirmations.length >= requiredConfirmations
                        ? "text-green"
                        : "text-ink-muted"
                    }
                  />
                  <strong className="text-[11.5px] font-[620]">
                    {t("spec.decisionRecord")}
                  </strong>
                </div>
                <p className="mt-2.5 text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
                  {confirmations.length >= requiredConfirmations
                    ? t("spec.confirmationsMet", {
                        count: confirmations.length,
                        required: requiredConfirmations,
                      })
                    : t("spec.confirmationsPending", {
                        count: confirmations.length,
                        required: requiredConfirmations,
                      })}
                </p>
                {openThreadCount > 0 ? (
                  <p className="mt-2.5 rounded-btn bg-amber-soft px-2.5 py-2 text-[10.5px] leading-[1.6] text-amber [text-wrap:pretty]">
                    {t("spec.openThreadsBlock", { count: openThreadCount })}
                  </p>
                ) : null}
                {youConfirmed ? (
                  <div className="mt-3 flex items-center gap-2 rounded-quiet bg-green-soft px-3 py-2.5 text-[11px] text-green">
                    <CheckCircleIcon size={14} weight="fill" />
                    {t("spec.youConfirmed")}
                  </div>
                ) : (
                  <div className="mt-3.5 grid gap-2">
                    <button
                      type="button"
                      disabled={confirm.isPending}
                      onClick={() => confirm.mutate()}
                      className="h-[34px] cursor-pointer rounded-btn border-0 bg-accent-strong text-[12.5px] font-[620] text-on-accent disabled:opacity-45"
                    >
                      {t("spec.approveRev", { n: selected?.revision ?? 1 })}
                    </button>
                    <button
                      type="button"
                      onClick={() => composerRef.current?.focus()}
                      className="h-[34px] cursor-pointer rounded-btn border border-line2 bg-transparent text-[12.5px] text-ink hover:border-accent-strong"
                    >
                      {t("spec.requestChanges")}
                    </button>
                  </div>
                )}
                {confirm.error ? (
                  <p role="alert" className="mt-2 text-[10px] text-danger">
                    {mutationMessage(confirm.error)}
                  </p>
                ) : null}
              </div>
            ) : null}

            {active?.spec.confirmedRevisionId ? (
              <div className="flex items-center gap-2 rounded-quiet bg-green-soft px-3 py-2.5 text-[11px] text-green">
                <CheckCircleIcon size={14} weight="fill" />
                {t("spec.confirmedRevision", {
                  n:
                    active.revisions.find(
                      (revision) =>
                        revision.id === active.spec.confirmedRevisionId,
                    )?.revision ?? "—",
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ThreadCard({
  thread,
  nameOf,
  busy,
  onToggleStatus,
  onReply,
}: {
  thread: {
    id: string;
    status: "open" | "resolved";
    createdAt: string;
    selection?: string | undefined;
    comments: Array<{
      id: string;
      authorId: string;
      authorKind: "human" | "agent";
      body: string;
      createdAt: string;
    }>;
  };
  nameOf: (id: string) => string;
  busy: boolean;
  onToggleStatus: () => void;
  onReply: (body: string) => void;
}) {
  const { t, formatRelative } = useI18n();
  const [reply, setReply] = useState("");
  const [head, ...replies] = thread.comments;
  if (!head) return null;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-card border bg-panel2",
        thread.status === "open" ? "border-line2" : "border-line",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2.5 border-b border-line px-4 py-2.5",
          thread.status === "open" ? "bg-amber-soft" : "bg-transparent",
        )}
      >
        <ChatsCircleIcon
          size={13}
          className={thread.status === "open" ? "text-amber" : "text-faint"}
        />
        <span
          className={cn(
            "text-[10.5px] font-[620]",
            thread.status === "open" ? "text-amber" : "text-faint",
          )}
        >
          {t(`spec.thread.${thread.status}` as TranslationKey)}
        </span>
        <Meta className="ml-auto text-[9.5px]">
          {formatRelative(thread.createdAt)}
        </Meta>
        <button
          type="button"
          disabled={busy}
          onClick={onToggleStatus}
          className="h-6 cursor-pointer rounded-pill border border-line2 bg-transparent px-2.5 text-[10px] text-ink-muted hover:border-accent-strong disabled:opacity-45"
        >
          {t(
            thread.status === "open"
              ? "spec.resolveThread"
              : "spec.reopenThread",
          )}
        </button>
      </div>

      {thread.selection ? (
        <p className="px-4 pt-3">
          <span className="inline-block rounded-r-quiet border-l-2 border-line2 bg-raise px-2.5 py-[7px] text-[11.5px] leading-[1.6] text-ink">
            {thread.selection}
          </span>
        </p>
      ) : null}

      <div className="grid grid-cols-[26px_minmax(0,1fr)] items-start gap-[11px] px-4 pb-3 pt-3.5">
        <Avatar id={head.authorId} name={nameOf(head.authorId)} size="md" />
        <span className="grid min-w-0 gap-[5px]">
          <span className="flex items-baseline gap-2.5">
            <strong className="text-[12px] font-[620]">
              {nameOf(head.authorId)}
            </strong>
            {head.authorKind === "agent" ? (
              <span className="text-[10px] text-faint">
                {t("spec.agentAuthor")}
              </span>
            ) : null}
            <Meta className="ml-auto text-[9.5px]">
              {formatRelative(head.createdAt)}
            </Meta>
          </span>
          <span className="text-[12.5px] leading-[1.7] text-ink [text-wrap:pretty]">
            {head.body}
          </span>
        </span>
      </div>

      {replies.length > 0 ? (
        <div className="mb-1 ml-[41px] mr-4 flex flex-col gap-3 border-l-2 border-line2 pb-1 pl-3.5 pt-3">
          {replies.map((entry) => (
            <div
              key={entry.id}
              className="grid grid-cols-[22px_minmax(0,1fr)] items-start gap-[9px]"
            >
              <Avatar
                id={entry.authorId}
                name={nameOf(entry.authorId)}
                size="sm"
              />
              <span className="grid min-w-0 gap-1">
                <span className="flex items-baseline gap-2">
                  <strong className="text-[11px] font-[620]">
                    {nameOf(entry.authorId)}
                  </strong>
                  <Meta className="ml-auto text-[9.5px]">
                    {formatRelative(entry.createdAt)}
                  </Meta>
                </span>
                <span className="text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
                  {entry.body}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mb-3 ml-[41px] mr-4 flex items-center gap-2">
        <input
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder={t("spec.replyPlaceholder")}
          className="h-[30px] min-w-0 flex-1 rounded-btn border border-line bg-panel px-2.5 text-[11.5px] text-ink outline-none focus:border-accent-strong"
        />
        <button
          type="button"
          disabled={!reply.trim() || busy}
          onClick={() => {
            onReply(reply.trim());
            setReply("");
          }}
          className="h-[30px] cursor-pointer rounded-btn border-0 bg-accent-strong px-3 text-[11.5px] font-[620] text-on-accent disabled:cursor-not-allowed disabled:opacity-45"
        >
          {t("spec.reply")}
        </button>
      </div>
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function mutationMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The action could not be completed.";
}
