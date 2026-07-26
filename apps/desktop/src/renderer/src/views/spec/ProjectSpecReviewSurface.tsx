import {
  ChatCircleIcon,
  CheckCircleIcon,
  CodeIcon,
  EyeIcon,
  PlusIcon,
  SealCheckIcon,
} from "@phosphor-icons/react";
import type { Spec } from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  addProjectSpecComment,
  confirmProjectSpec,
  createProjectSpecVersion,
  getProjectSpecs,
  requestProjectSpecReview,
  setProjectSpecCommentStatus,
  updateProjectSpecReviewPolicy,
} from "../../api.js";
import { SafeMarkdown } from "../../components/SafeMarkdown.js";
import {
  Avatar,
  EmptySlot,
  FilterChip,
  ListPane,
  ListRow,
  LoadMore,
  Meta,
  SectionLabel,
  SegmentedControl,
  StatusPill,
  cn,
} from "../../design/primitives.js";
import type { Tone } from "../../design/utils.js";
import { useI18n } from "../../i18n/index.js";
import type { TranslationKey } from "../../i18n/locales/zh-CN.js";
import { getPilotOverview } from "../../pilot/api.js";
import { usePilotOptional } from "../../pilot/context.js";

const STATUS_TONE: Record<Spec["status"], Tone> = {
  draft: "faint",
  in_review: "amber",
  approved: "green",
  changes_requested: "danger",
  superseded: "faint",
};

const FILTERS: Array<{ id: Spec["status"] | "all"; label: TranslationKey }> = [
  { id: "all", label: "general.all" },
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
}: {
  projectId: string;
  projects: Array<{ id: string; name: string }>;
  onProjectChange: (projectId: string) => void;
}) {
  const pilot = usePilotOptional();
  const queryClient = useQueryClient();
  const { t, formatRelative } = useI18n();
  const specs = useQuery({
    queryKey: ["project-specs", projectId],
    queryFn: ({ signal }) => getProjectSpecs(projectId, signal),
    refetchInterval: 4_000,
  });
  const overview = useQuery({
    queryKey: ["pilot", "overview", pilot?.identityId, projectId],
    queryFn: ({ signal }) =>
      getPilotOverview(pilot!.identityId!, projectId, signal),
    enabled: Boolean(pilot?.identityId),
  });
  const [activeId, setActiveId] = useState<string>(NEW_SPEC);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [filter, setFilter] = useState<Spec["status"] | "all">("all");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>();
  const [lineStart, setLineStart] = useState(1);
  const [lineEnd, setLineEnd] = useState(1);
  const [comment, setComment] = useState("");
  const [replyThreadId, setReplyThreadId] = useState<string>();
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
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
    mutationFn: () =>
      requestProjectSpecReview(projectId, active!.spec.id, reviewerIds),
    onSuccess: refresh,
  });
  const confirm = useMutation({
    mutationFn: () => confirmProjectSpec(projectId, active!.spec.id),
    onSuccess: refresh,
  });
  const addComment = useMutation({
    mutationFn: () =>
      addProjectSpecComment(projectId, active!.spec.id, {
        revisionId: selected!.id,
        ...(replyThreadId ? { threadId: replyThreadId } : {}),
        lineStart,
        lineEnd,
        body: comment.trim(),
      }),
    onSuccess: async () => {
      setComment("");
      setReplyThreadId(undefined);
      await refresh();
    },
  });
  const setThreadStatus = useMutation({
    mutationFn: (input: { threadId: string; status: "open" | "resolved" }) =>
      setProjectSpecCommentStatus(projectId, input.threadId, input.status),
    onSuccess: refresh,
  });
  const updatePolicy = useMutation({
    mutationFn: (input: {
      requiredConfirmations: number;
      otherMemberAgentsCount: boolean;
      authorSelfConfirmation: boolean;
    }) => updateProjectSpecReviewPolicy(projectId, input),
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

  const principalNames = new Map(
    (overview.data?.principals ?? []).map((principal) => [
      principal.id,
      principal.displayName,
    ]),
  );
  const nameOf = (id: string) => principalNames.get(id) ?? id.slice(0, 8);

  const filtered = items.filter(
    (item) => filter === "all" || item.spec.status === filter,
  );
  const visible = filtered.slice(0, shown);
  const inReviewCount = items.filter(
    (item) => item.spec.status === "in_review",
  ).length;
  // "Needs you" = in review, you were nominated, and you have not yet
  // confirmed the revision that is currently on the table.
  const needsYouCount = items.filter(
    (item) =>
      item.spec.status === "in_review" &&
      pilot?.identityId &&
      item.nominatedReviewerIds.includes(pilot.identityId) &&
      !item.confirmations.some(
        (entry) =>
          entry.revisionId === item.spec.currentRevisionId &&
          entry.confirmerId === pilot.identityId,
      ),
  ).length;

  const threads =
    active?.commentThreads.filter(
      (thread) => thread.revisionId === selected?.id,
    ) ?? [];
  const confirmationCount =
    active?.confirmations.filter((entry) => entry.revisionId === current?.id)
      .length ?? 0;
  const requiredConfirmations = active?.policy.requiredConfirmations ?? 1;
  const project = pilot?.projects.data?.projects.find(
    (candidate) => candidate.id === projectId,
  );
  const organizationAdmin = pilot?.bootstrap.data?.organizationRole === "admin";
  const teamLeader = pilot?.teams.data?.teams
    .find((team) => team.id === project?.primaryTeamId)
    ?.members.some(
      (member) =>
        member.id === pilot.identityId && member.teamRole === "leader",
    );
  const canGovern = Boolean(organizationAdmin || teamLeader);
  const humanReviewers = (overview.data?.principals ?? []).filter(
    (principal) =>
      principal.kind === "human" && principal.id !== pilot?.identityId,
  );

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
        filters={
          <>
            {FILTERS.map((option) => (
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
            {projects.length > 1 ? (
              <select
                aria-label={t("spec.projectFilter")}
                value={projectId}
                onChange={(event) => onProjectChange(event.target.value)}
                className="h-[26px] rounded-pill border border-line2 bg-transparent px-2.5 text-[11px] text-ink-muted"
              >
                {projects.map((option) => (
                  <option value={option.id} key={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            ) : null}
          </>
        }
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
          return (
            <ListRow
              key={item.spec.id}
              selected={item.spec.id === activeId}
              onClick={() => setActiveId(item.spec.id)}
              testId={`project-spec-row-${item.spec.id}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Meta>
                  {item.spec.id.slice(0, 8)} ·{" "}
                  {t("spec.rev", { n: head?.revision ?? 1 })}
                </Meta>
                <StatusPill tone={STATUS_TONE[item.spec.status]} size="sm">
                  {t(`spec.status.${item.spec.status}` as TranslationKey)}
                </StatusPill>
                <Meta className="ml-auto text-[9px]">
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
        <div className="flex items-center gap-2.5">
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
          {active && current ? (
            <span className="text-[11px] text-faint">
              {t("spec.initiated", {
                name: nameOf(current.createdBy),
                time: formatRelative(current.createdAt),
              })}
            </span>
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
          className="mt-4 w-full border-0 bg-transparent text-[26px] font-[540] tracking-[-0.035em] outline-none placeholder:text-faint disabled:opacity-100"
        />

        <div className="mt-5 grid grid-cols-[minmax(0,1fr)_300px] items-start gap-5">
          <div className="min-w-0">
            {active ? (
              <div className="flex flex-wrap gap-1.5">
                {active.revisions.map((revision) => (
                  <button
                    type="button"
                    key={revision.id}
                    onClick={() => setSelectedRevisionId(revision.id)}
                    className={cn(
                      "grid cursor-pointer gap-1 rounded-[11px] border px-3.5 py-2.5 text-left",
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

            <div className="mt-[22px] rounded-container border border-line bg-panel2 px-[38px] py-[34px]">
              {mode === "preview" ? (
                <SafeMarkdown markdown={selected?.markdown ?? markdown} />
              ) : (
                <textarea
                  value={markdown}
                  onChange={(event) => setMarkdown(event.target.value)}
                  aria-label={t("spec.markdownEditor")}
                  className="min-h-[560px] w-full resize-none bg-transparent font-mono text-[12px] leading-[1.8] outline-none"
                />
              )}
            </div>

            <div className="mt-[26px]">
              <div className="flex items-center gap-2">
                <ChatCircleIcon size={15} className="text-faint" />
                <SectionLabel>{t("spec.inlineComments")}</SectionLabel>
              </div>
              <p className="mt-2 text-[10.5px] text-faint">
                {t("spec.inlineCommentsLede")}
              </p>
              <div className="mt-3 grid gap-2">
                {threads.map((thread) => (
                  <article
                    key={thread.id}
                    className="rounded-card border border-line bg-panel2 p-3.5"
                  >
                    <div className="flex items-center gap-2">
                      <Meta className="text-[9.5px]">
                        {t("spec.lines", {
                          start: thread.lineStart,
                          end: thread.lineEnd,
                        })}
                      </Meta>
                      <StatusPill
                        tone={thread.status === "open" ? "amber" : "green"}
                        size="sm"
                      >
                        {t(`spec.thread.${thread.status}` as TranslationKey)}
                      </StatusPill>
                    </div>
                    {thread.comments.map((entry) => (
                      <p
                        key={entry.id}
                        className="mt-2.5 text-[12px] leading-[1.65] text-ink [text-wrap:pretty]"
                      >
                        <span className="mr-1.5 text-[10.5px] text-faint">
                          {nameOf(entry.authorId)}
                        </span>
                        {entry.body}
                      </p>
                    ))}
                    <div className="mt-2.5 flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setReplyThreadId(thread.id);
                          setComment("");
                        }}
                        className="cursor-pointer border-0 bg-transparent p-0 text-[10.5px] text-accent-strong hover:underline"
                      >
                        {t("spec.reply")}
                      </button>
                      <button
                        type="button"
                        disabled={setThreadStatus.isPending}
                        onClick={() =>
                          setThreadStatus.mutate({
                            threadId: thread.id,
                            status:
                              thread.status === "open" ? "resolved" : "open",
                          })
                        }
                        className="cursor-pointer border-0 bg-transparent p-0 text-[10.5px] text-faint hover:text-ink"
                      >
                        {thread.status === "open"
                          ? t("spec.resolveThread")
                          : t("spec.reopenThread")}
                      </button>
                    </div>
                  </article>
                ))}
                {threads.length === 0 ? (
                  <EmptySlot>{t("spec.noComments")}</EmptySlot>
                ) : null}
              </div>

              {active && selected ? (
                <div className="mt-3 grid gap-2 rounded-card border border-line2 bg-panel2 p-3">
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-[10px] text-faint">
                      {t("spec.lineStart")}
                      <input
                        type="number"
                        min={1}
                        value={lineStart}
                        onChange={(event) =>
                          setLineStart(Number(event.target.value))
                        }
                        className="h-7 w-16 rounded-quiet border border-line2 bg-transparent px-2 text-[10.5px] text-ink"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 text-[10px] text-faint">
                      {t("spec.lineEnd")}
                      <input
                        type="number"
                        min={lineStart}
                        value={lineEnd}
                        onChange={(event) =>
                          setLineEnd(Number(event.target.value))
                        }
                        className="h-7 w-16 rounded-quiet border border-line2 bg-transparent px-2 text-[10.5px] text-ink"
                      />
                    </label>
                    {replyThreadId ? (
                      <button
                        type="button"
                        onClick={() => setReplyThreadId(undefined)}
                        className="ml-auto cursor-pointer border-0 bg-transparent p-0 text-[10px] text-faint hover:text-ink"
                      >
                        {t("spec.cancelReply")}
                      </button>
                    ) : null}
                  </div>
                  <textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder={
                      replyThreadId
                        ? t("spec.replyPlaceholder")
                        : t("spec.commentPlaceholder")
                    }
                    className="min-h-20 resize-none rounded-quiet border border-line2 bg-transparent p-2.5 text-[11.5px] leading-[1.6] outline-none placeholder:text-faint focus:border-accent-strong"
                  />
                  <button
                    type="button"
                    disabled={!comment.trim() || addComment.isPending}
                    onClick={() => addComment.mutate()}
                    className="h-8 cursor-pointer rounded-btn border-0 bg-accent-strong text-[11px] font-[620] text-on-accent disabled:opacity-45"
                  >
                    {t("spec.addComment")}
                  </button>
                  {addComment.error ? (
                    <p
                      role="alert"
                      className="text-[10px] leading-[1.5] text-danger"
                    >
                      {mutationMessage(addComment.error)}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="sticky top-0 grid gap-3">
            <div className="rounded-[13px] border border-line bg-panel2 p-4">
              <div className="flex items-center gap-2.5">
                <SealCheckIcon size={16} className="text-ink-muted" />
                <strong className="text-[11.5px] font-[620]">
                  {t("spec.decisionRecord")}
                </strong>
              </div>
              <p className="mt-2.5 text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
                {confirmationCount >= requiredConfirmations
                  ? t("spec.confirmationsMet", {
                      count: confirmationCount,
                      required: requiredConfirmations,
                    })
                  : t("spec.confirmationsPending", {
                      count: confirmationCount,
                      required: requiredConfirmations,
                    })}
              </p>

              {active && current ? (
                <div className="mt-3.5 grid gap-2">
                  {humanReviewers.length > 0 ? (
                    <div className="rounded-quiet bg-raise p-2.5">
                      <SectionLabel>{t("spec.nominated")}</SectionLabel>
                      {humanReviewers.map((principal) => (
                        <label
                          key={principal.id}
                          className="mt-2 flex items-center gap-2 text-[10.5px] text-ink"
                        >
                          <input
                            type="checkbox"
                            checked={reviewerIds.includes(principal.id)}
                            onChange={(event) =>
                              setReviewerIds((currentIds) =>
                                event.target.checked
                                  ? [...currentIds, principal.id]
                                  : currentIds.filter(
                                      (id) => id !== principal.id,
                                    ),
                              )
                            }
                          />
                          <Avatar
                            id={principal.id}
                            name={principal.displayName}
                            size="sm"
                          />
                          {principal.displayName}
                        </label>
                      ))}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    disabled={requestReview.isPending}
                    onClick={() => requestReview.mutate()}
                    className="h-8 cursor-pointer rounded-btn border border-line2 bg-transparent text-[11px] text-ink hover:border-accent-strong"
                  >
                    {t("spec.requestReview")}
                  </button>
                  <button
                    type="button"
                    disabled={confirm.isPending}
                    onClick={() => confirm.mutate()}
                    className="h-8 cursor-pointer rounded-btn border-0 bg-accent-strong text-[11px] font-[620] text-on-accent"
                  >
                    {t("spec.confirmVersion")}
                  </button>
                  {requestReview.error || confirm.error ? (
                    <p
                      role="alert"
                      className="text-[10px] leading-[1.5] text-danger"
                    >
                      {mutationMessage(requestReview.error ?? confirm.error)}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {active?.spec.confirmedRevisionId ? (
                <div className="mt-3 flex items-center gap-2 rounded-quiet bg-green-soft px-3 py-2.5 text-[11px] text-green">
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

            {active ? (
              <div className="rounded-[13px] border border-line bg-panel2 p-4">
                <SectionLabel>{t("spec.policy")}</SectionLabel>
                <label className="mt-2.5 flex items-center justify-between text-[10.5px] text-ink">
                  {t("spec.policyConfirmations")}
                  <select
                    value={active.policy.requiredConfirmations}
                    disabled={!canGovern}
                    onChange={(event) =>
                      updatePolicy.mutate({
                        requiredConfirmations: Number(event.target.value),
                        otherMemberAgentsCount:
                          active.policy.otherMemberAgentsCount,
                        authorSelfConfirmation:
                          active.policy.authorSelfConfirmation,
                      })
                    }
                    className="h-7 rounded-quiet border border-line2 bg-transparent px-2 text-ink"
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </label>
                <PolicyCheck
                  label={t("spec.policyAgents")}
                  checked={active.policy.otherMemberAgentsCount}
                  disabled={!canGovern}
                  onChange={(checked) =>
                    updatePolicy.mutate({
                      requiredConfirmations:
                        active.policy.requiredConfirmations,
                      otherMemberAgentsCount: checked,
                      authorSelfConfirmation:
                        active.policy.authorSelfConfirmation,
                    })
                  }
                />
                <PolicyCheck
                  label={t("spec.policySelf")}
                  checked={active.policy.authorSelfConfirmation}
                  disabled={!canGovern}
                  onChange={(checked) =>
                    updatePolicy.mutate({
                      requiredConfirmations:
                        active.policy.requiredConfirmations,
                      otherMemberAgentsCount:
                        active.policy.otherMemberAgentsCount,
                      authorSelfConfirmation: checked,
                    })
                  }
                />
              </div>
            ) : null}
          </div>
        </div>
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

function PolicyCheck({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="mt-2 flex items-center justify-between gap-3 text-[10.5px] text-ink">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
