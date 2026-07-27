import {
  CheckCircleIcon,
  CodeIcon,
  EyeIcon,
  PlusIcon,
  SealCheckIcon,
} from "@phosphor-icons/react";
import type { Spec } from "@intero/domain";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useState } from "react";

import {
  addSpecReview,
  createDecision,
  createSpec,
  createSpecRevision,
  getBootstrap,
  getSpecs,
} from "../api.js";
import { SafeMarkdown } from "../components/SafeMarkdown.js";
import {
  Avatar,
  EmptySlot,
  FilterChip,
  ListPane,
  ListRow,
  Meta,
  SectionLabel,
  SegmentedControl,
  StatusPill,
  cn,
} from "../design/primitives.js";
import type { Tone } from "../design/utils.js";
import { useI18n } from "../i18n/index.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";
import { usePilotOptional } from "../pilot/context.js";
import { ProjectSpecReviewSurface } from "./spec/ProjectSpecReviewSurface.js";

const EDITOR_THEME = EditorView.theme({
  "&": {
    minHeight: "610px",
    background: "transparent",
    color: "var(--foreground)",
  },
  ".cm-content": {
    padding: "48px clamp(32px, 7vw, 86px)",
    caretColor: "var(--primary)",
    fontFamily: '"Geist Mono", "SFMono-Regular", monospace',
    fontSize: "12px",
    lineHeight: "1.75",
  },
  ".cm-gutters": { display: "none" },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--primary) 4%, transparent)",
  },
  "&.cm-focused": {
    outline: "2px solid color-mix(in oklab, var(--primary) 16%, transparent)",
    outlineOffset: "-2px",
  },
});

const NEW_SPEC = "new";

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

function reviewTone(kind: string): Tone {
  if (kind.includes("approval")) return "green";
  if (kind === "human_changes_requested") return "danger";
  return "faint";
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function SpecReviewView() {
  const pilot = usePilotOptional();
  const projectId =
    pilot?.selectedProjectId ?? pilot?.projects.data?.projects[0]?.id;
  return projectId &&
    pilot?.bootstrap.data?.adapters.projectWork === "postgres" ? (
    <ProjectSpecReviewSurface
      projectId={projectId}
      projects={(pilot.projects.data?.projects ?? []).map((project) => ({
        id: project.id,
        name: project.name,
      }))}
      onProjectChange={pilot.setSelectedProjectId}
    />
  ) : (
    <LegacySpecReviewView />
  );
}

function LegacySpecReviewView() {
  const { formatRelative, formatTime, t } = useI18n();
  const queryClient = useQueryClient();
  const specs = useQuery({
    queryKey: ["specs"],
    queryFn: ({ signal }) => getSpecs(signal),
  });
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });
  const [activeId, setActiveId] = useState<string>();
  const [filter, setFilter] = useState<Spec["status"] | "all">("all");
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [publishState, setPublishState] = useState<
    "idle" | "publishing" | "published" | "error"
  >("idle");
  const [publishedRevision, setPublishedRevision] = useState<number>();
  const [previewRevisionId, setPreviewRevisionId] = useState<string>();

  useEffect(() => {
    if (!activeId && specs.data?.items[0]) {
      setActiveId(specs.data.items[0].spec.id);
    }
  }, [activeId, specs.data?.items]);

  const items = specs.data?.items ?? [];
  const active = items.find((item) => item.spec.id === activeId);
  const currentRevision = active?.revisions.find(
    (revision) => revision.id === active.spec.currentRevisionId,
  );
  const draftKey =
    activeId === NEW_SPEC
      ? "intero:spec-draft:v1:new"
      : active && currentRevision
        ? `intero:spec-draft:v1:${active.spec.id}:${currentRevision.id}`
        : undefined;

  useEffect(() => {
    if (!draftKey) return;
    const fallbackTitle = active?.spec.title ?? "";
    const fallbackMarkdown = currentRevision?.markdown ?? "";
    try {
      const stored = localStorage.getItem(draftKey);
      if (stored) {
        const draft = JSON.parse(stored) as {
          title?: unknown;
          markdown?: unknown;
        };
        setTitle(typeof draft.title === "string" ? draft.title : fallbackTitle);
        setMarkdown(
          typeof draft.markdown === "string"
            ? draft.markdown
            : fallbackMarkdown,
        );
      } else {
        setTitle(fallbackTitle);
        setMarkdown(fallbackMarkdown);
      }
      setSaveState("idle");
    } catch {
      setTitle(fallbackTitle);
      setMarkdown(fallbackMarkdown);
    }
  }, [active?.spec.id, currentRevision?.id, draftKey]);

  useEffect(() => {
    if (!draftKey) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ title, markdown }));
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draftKey, markdown, title]);

  useEffect(() => {
    setPreviewRevisionId(currentRevision?.id);
  }, [active?.spec.id, currentRevision?.id]);

  const principalNames = new Map<string, string>();
  for (const principal of active?.principals ?? []) {
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

  const revisionNumbers = new Map(
    active?.revisions.map((revision) => [revision.id, revision.revision]) ?? [],
  );
  const reviews = active?.reviews ?? [];
  const reviewerReviews = reviews.filter(
    (review) => review.kind !== "stand_in_impact_analysis",
  );
  const impactReview = reviews.find(
    (review) => review.kind === "stand_in_impact_analysis",
  );

  // Preview always targets the clicked revision pill; editing always targets
  // the live local draft, which is bound to currentRevision.
  const isViewingDraft =
    !previewRevisionId || previewRevisionId === currentRevision?.id;
  const selectedRevision = active?.revisions.find(
    (revision) => revision.id === previewRevisionId,
  );
  const previewMarkdown = isViewingDraft
    ? markdown
    : (selectedRevision?.markdown ?? markdown);
  const revisionForLegend = isViewingDraft ? currentRevision : selectedRevision;
  const previousRevision = active?.revisions.find(
    (revision) => revision.revision === (revisionForLegend?.revision ?? -1) - 1,
  );
  const previousFingerprintsByOrdinal = new Map(
    previousRevision?.blocks.map((block) => [
      block.ordinal,
      block.fingerprint,
    ]) ?? [],
  );
  const changedCount =
    previousRevision && revisionForLegend
      ? revisionForLegend.blocks.filter(
          (block) =>
            previousFingerprintsByOrdinal.get(block.ordinal) !==
            block.fingerprint,
        ).length
      : 0;

  const currentPrincipalId = bootstrap.data?.currentPrincipal.id;
  const existingDecisionReview =
    currentRevision && currentPrincipalId
      ? reviews.find(
          (review) =>
            review.revisionId === currentRevision.id &&
            review.reviewerId === currentPrincipalId &&
            (review.kind === "human_approval" ||
              review.kind === "human_changes_requested"),
        )
      : undefined;

  const approve = useMutation({
    mutationFn: async () => {
      if (!active || !currentRevision || !bootstrap.data) {
        throw new Error("Spec, revision, or identity is unavailable.");
      }
      const principal = bootstrap.data.currentPrincipal;
      await addSpecReview({
        specId: active.spec.id,
        review: {
          revisionId: currentRevision.id,
          reviewerId: principal.id,
          kind: "human_approval",
          affectedScopes: currentRevision.affectedScopes,
          body: "",
        },
      });
      await createDecision({
        title: active.spec.title,
        outcome: t("spec.approve", { revision: currentRevision.revision }),
        sourceSpecRevisionId: currentRevision.id,
        affectedScopes: currentRevision.affectedScopes,
        decidedBy: [principal.id],
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["specs"] });
      await queryClient.invalidateQueries({ queryKey: ["decisions"] });
    },
  });

  const requestChanges = useMutation({
    mutationFn: async () => {
      if (!active || !currentRevision || !bootstrap.data) {
        throw new Error("Spec, revision, or identity is unavailable.");
      }
      const principal = bootstrap.data.currentPrincipal;
      await addSpecReview({
        specId: active.spec.id,
        review: {
          revisionId: currentRevision.id,
          reviewerId: principal.id,
          kind: "human_changes_requested",
          affectedScopes: currentRevision.affectedScopes,
          body: "",
        },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["specs"] });
    },
  });

  async function publishRevision() {
    const principal = bootstrap.data?.currentPrincipal;
    if (!principal || !title.trim() || !markdown.trim() || !draftKey) return;
    setPublishState("publishing");
    try {
      let nextSpecId: string;
      if (active && currentRevision) {
        const revision = await createSpecRevision({
          specId: active.spec.id,
          revision: currentRevision.revision + 1,
          markdown,
          affectedScopes: currentRevision.affectedScopes,
          createdBy: principal.id,
          changeSummary: t("spec.revisionChangeSummary"),
        });
        nextSpecId = active.spec.id;
        setPublishedRevision(revision.revision);
      } else {
        const created = await createSpec({
          id: crypto.randomUUID(),
          title: title.trim(),
          markdown,
          affectedScopes: [],
          createdBy: principal.id,
          changeSummary: t("spec.initialChangeSummary"),
        });
        nextSpecId = created.spec.id;
        setPublishedRevision(created.revision.revision);
      }
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // Publishing succeeded; a stale local draft must not reverse that fact.
      }
      await queryClient.invalidateQueries({ queryKey: ["specs"] });
      setActiveId(nextSpecId);
      setPublishState("published");
      setMode("preview");
    } catch {
      setPublishState("error");
    }
  }

  if (specs.isLoading) {
    return (
      <div className="animate-view-enter grid h-full place-items-center p-[34px]">
        <p className="text-[13px] text-ink-muted">{t("spec.loading")}</p>
      </div>
    );
  }

  if (specs.isError) {
    return (
      <div className="animate-view-enter grid h-full place-items-center p-[34px]">
        <div className="grid max-w-[360px] justify-items-center gap-3 rounded-container border border-dashed border-line2 p-[40px] text-center">
          <strong className="text-[15px] font-[600] text-ink">
            {t("spec.unavailable")}
          </strong>
          <button
            type="button"
            className="h-[34px] cursor-pointer rounded-btn border border-line2 bg-transparent px-3.5 text-[12.5px] text-ink hover:border-accent-strong"
            onClick={() => void specs.refetch()}
          >
            {t("general.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (!activeId) {
    return (
      <div className="animate-view-enter grid h-full place-items-center p-[34px]">
        <div className="grid max-w-[420px] justify-items-center gap-2.5 rounded-container border border-dashed border-line2 px-[44px] py-[54px] text-center">
          <strong className="text-[19px] font-[600] text-ink">
            {t("spec.emptyTitle")}
          </strong>
          <p className="text-[13px] leading-[1.6] text-ink-muted">
            {t("spec.emptyDetail")}
          </p>
          <button
            type="button"
            className="mt-2 inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-btn border-0 bg-accent-strong px-3.5 text-[12.5px] font-[620] text-on-accent"
            onClick={() => {
              setActiveId(NEW_SPEC);
              setMode("edit");
            }}
          >
            <PlusIcon size={16} />
            {t("spec.newDraft")}
          </button>
        </div>
      </div>
    );
  }

  const nextRevision = currentRevision ? currentRevision.revision + 1 : 1;
  const toolbarText =
    publishState === "error"
      ? t("spec.publishFailed")
      : publishState === "published"
        ? t("spec.published", { revision: publishedRevision ?? nextRevision })
        : saveState === "error"
          ? t("spec.saveFailed")
          : saveState === "saved"
            ? t("spec.savedLocally")
            : t("spec.savingLocally");
  const filtered = items.filter(
    (item) => filter === "all" || item.spec.status === filter,
  );
  const inReviewCount = items.filter(
    (item) => item.spec.status === "in_review",
  ).length;

  return (
    <div className="animate-view-enter grid h-full grid-cols-[312px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
      <ListPane
        title={t("nav.spec")}
        count={`${filtered.length} / ${items.length}`}
        lede={
          <strong className="font-[620] text-amber">
            {t("spec.inReviewCount", { count: inReviewCount })}
          </strong>
        }
        action={
          <button
            type="button"
            aria-label={t("spec.newDraft")}
            title={t("spec.newDraft")}
            onClick={() => {
              setActiveId(NEW_SPEC);
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
            onClick={() => setFilter(option.id)}
          >
            {t(option.label)}
          </FilterChip>
        ))}
        footer={
          <span className="ml-auto font-mono text-[10px] text-faint">
            {t("general.showingOf", {
              shown: filtered.length,
              total: items.length,
            })}
          </span>
        }
      >
        {filtered.map((item) => {
          const head = item.revisions.find(
            (revision) => revision.id === item.spec.currentRevisionId,
          );
          return (
            <ListRow
              key={item.spec.id}
              selected={item.spec.id === activeId}
              onClick={() => {
                setActiveId(item.spec.id);
                setPublishState("idle");
                setPublishedRevision(undefined);
              }}
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
                  {t("spec.scopeCount", {
                    count: head?.affectedScopes.length ?? 0,
                  })}
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
          {currentRevision && active ? (
            <>
              <Meta className="text-[10.5px]">
                {active.spec.id.slice(0, 8)} ·{" "}
                {t("spec.rev", { n: currentRevision.revision })}
              </Meta>
              <StatusPill tone={STATUS_TONE[active.spec.status]}>
                {t(`spec.status.${active.spec.status}` as TranslationKey)}
              </StatusPill>
              <span className="text-[11px] text-faint">
                {t("spec.initiated", {
                  name: nameOf(currentRevision.createdBy),
                  time: formatTime(currentRevision.createdAt),
                })}
              </span>
            </>
          ) : (
            <span className="text-[11px] font-[650] tracking-[0.1em] text-accent-strong">
              {t("spec.localDraft")}
            </span>
          )}
          <SegmentedControl
            className="ml-auto"
            value={mode}
            onChange={setMode}
            items={[
              {
                id: "edit" as const,
                label: (
                  <>
                    <CodeIcon size={13} />
                    {t("spec.edit")}
                  </>
                ),
              },
              {
                id: "preview" as const,
                label: (
                  <>
                    <EyeIcon size={13} />
                    {t("spec.preview")}
                  </>
                ),
              },
            ]}
          />
          <button
            type="button"
            className="h-8 cursor-pointer rounded-btn border-0 bg-accent-strong px-3.5 text-[11.5px] font-[620] text-on-accent disabled:opacity-55"
            disabled={
              publishState === "publishing" ||
              !title.trim() ||
              !markdown.trim() ||
              !bootstrap.data
            }
            onClick={() => void publishRevision()}
          >
            {publishState === "publishing"
              ? t("spec.publishing")
              : currentRevision
                ? t("spec.publishNext", { revision: nextRevision })
                : t("spec.publish")}
          </button>
        </div>

        <h1 className="mt-4 text-[26px] font-[540] tracking-[-0.035em] text-ink">
          {active ? active.spec.title : title || t("spec.untitled")}
        </h1>
        <Meta className="mt-2 block text-[10.5px]">{toolbarText}</Meta>

        <div className="mt-5 grid grid-cols-[minmax(0,1fr)_300px] items-start gap-5">
          <div className="min-w-0">
            {active && active.revisions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {[...active.revisions]
                  .sort((left, right) => left.revision - right.revision)
                  .map((revision) => (
                    <button
                      type="button"
                      key={revision.id}
                      onClick={() => setPreviewRevisionId(revision.id)}
                      className={cn(
                        "grid cursor-pointer gap-1 rounded-[11px] border px-3.5 py-2.5 text-left",
                        revision.id === previewRevisionId
                          ? "border-accent-strong bg-accent-soft"
                          : "border-line bg-panel2 hover:border-accent-strong",
                      )}
                    >
                      <span className="font-mono text-[11px] text-ink">
                        {t("spec.rev", { n: revision.revision })}
                      </span>
                      <span className="text-[10.5px] text-faint">
                        {truncate(revision.changeSummary, 28)}
                      </span>
                    </button>
                  ))}
              </div>
            ) : null}

            {mode === "preview" && changedCount > 0 ? (
              <div className="mt-3 font-mono text-[11px] text-green">
                + {changedCount} · {t("spec.changedBlock")}
              </div>
            ) : null}

            <div className="mt-[22px] rounded-container border border-line bg-panel2 px-[38px] py-[34px]">
              {mode === "preview" ? (
                <SafeMarkdown markdown={previewMarkdown} />
              ) : (
                <>
                  <label className="grid gap-1.5">
                    <span className="text-[11px] font-[620] text-ink-muted">
                      {t("spec.titleLabel")}
                    </span>
                    <input
                      className="h-9 rounded-btn border border-line2 bg-transparent px-3 text-[13px] text-ink disabled:opacity-60"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder={t("spec.titlePlaceholder")}
                      disabled={active !== undefined}
                    />
                  </label>
                  <CodeMirror
                    className="mt-4"
                    value={markdown}
                    extensions={[markdownLanguage(), EDITOR_THEME]}
                    basicSetup={{
                      lineNumbers: false,
                      foldGutter: false,
                      highlightActiveLineGutter: false,
                    }}
                    onChange={setMarkdown}
                    aria-label={t("spec.markdownEditor")}
                  />
                </>
              )}
            </div>

            <div className="mt-[26px]">
              <SectionLabel>{t("spec.reviewers")}</SectionLabel>
              {reviewerReviews.length === 0 ? (
                <p className="mt-3 text-[11.5px] text-faint">
                  {t("spec.noReviews")}
                </p>
              ) : (
                <div className="mt-3 grid gap-2">
                  {reviewerReviews.map((review) => (
                    <div
                      className="rounded-[13px] border border-line bg-panel2 px-[15px] py-3.5"
                      key={`${review.revisionId}:${review.reviewerId}:${review.createdAt}`}
                    >
                      <div className="grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2.5">
                        <Avatar
                          id={review.reviewerId}
                          name={nameOf(review.reviewerId)}
                          size="md"
                        />
                        <span className="grid min-w-0">
                          <strong className="text-[12px] font-[620] text-ink">
                            {nameOf(review.reviewerId)}
                          </strong>
                          <small className="mt-[3px] text-[10px] text-faint">
                            {t("spec.rev", {
                              n: revisionNumbers.get(review.revisionId) ?? "—",
                            })}
                          </small>
                        </span>
                        <StatusPill tone={reviewTone(review.kind)} size="sm">
                          {t(`review.${review.kind}` as TranslationKey)}
                          {review.invalidatedAt
                            ? ` · ${t("spec.invalidated")}`
                            : ""}
                        </StatusPill>
                      </div>
                      {review.body ? (
                        <p className="mt-[11px] rounded-btn bg-raise px-3 py-[11px] text-[11.5px] leading-[1.65] text-ink-muted">
                          {review.body}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="sticky top-0 grid gap-3">
            {impactReview ? (
              <div className="rounded-[13px] border border-accent-soft bg-accent-soft p-4">
                <div className="flex items-center gap-[9px]">
                  <span className="grid h-[22px] w-[22px] place-items-center rounded-[6px_10px_6px_6px] bg-accent-strong text-[8px] font-bold text-on-accent">
                    IR
                  </span>
                  <strong className="text-[11.5px] font-[620] text-ink">
                    {t("spec.impact")}
                  </strong>
                </div>
                <p className="mt-2.5 text-[12px] leading-[1.7] text-ink [text-wrap:pretty]">
                  {impactReview.body}
                </p>
                <small className="mt-[11px] block text-[10px] text-ink-muted">
                  {t("spec.notApproval")}
                </small>
              </div>
            ) : null}

            <div className="rounded-[13px] border border-line bg-panel2 p-4">
              <div className="flex items-center gap-2.5">
                <SealCheckIcon size={16} className="text-ink-muted" />
                <strong className="text-[11.5px] font-[620] text-ink">
                  {t("spec.decisionRecord")}
                </strong>
              </div>
              <p className="mt-2.5 text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
                {t("spec.decisionPending")}
              </p>

              {bootstrap.data && currentRevision && !existingDecisionReview ? (
                <div className="mt-3.5 grid gap-2">
                  <button
                    type="button"
                    className="h-[34px] w-full cursor-pointer rounded-btn border-0 bg-accent-strong text-[12px] font-[620] text-on-accent disabled:opacity-55"
                    disabled={approve.isPending}
                    onClick={() => approve.mutate()}
                  >
                    {t("spec.approve", { revision: currentRevision.revision })}
                  </button>
                  <button
                    type="button"
                    className="h-[34px] cursor-pointer rounded-btn border border-line2 bg-transparent text-[12px] text-ink hover:border-accent-strong disabled:opacity-55"
                    disabled={requestChanges.isPending}
                    onClick={() => requestChanges.mutate()}
                  >
                    {t("spec.requestChanges")}
                  </button>
                </div>
              ) : null}

              {existingDecisionReview &&
              currentRevision &&
              existingDecisionReview.kind === "human_approval" ? (
                <div className="mt-[13px] rounded-btn bg-green-soft px-[13px] py-3">
                  <div className="flex items-center gap-2 text-[11.5px] text-green">
                    <CheckCircleIcon size={14} weight="fill" />
                    {t("spec.decisionDone")}
                  </div>
                  <p className="mt-2 font-mono text-[10.5px] leading-[1.6] text-ink-muted">
                    {t("spec.decisionDoneMeta", {
                      revision:
                        revisionNumbers.get(
                          existingDecisionReview.revisionId,
                        ) ?? currentRevision.revision,
                      name: nameOf(existingDecisionReview.reviewerId),
                    })}
                  </p>
                </div>
              ) : null}

              {existingDecisionReview &&
              currentRevision &&
              existingDecisionReview.kind === "human_changes_requested" ? (
                <div className="mt-[13px] rounded-btn bg-amber-soft px-[13px] py-3">
                  <div className="text-[11.5px] text-amber">
                    {t("review.human_changes_requested")}
                  </div>
                  <p className="mt-2 font-mono text-[10.5px] leading-[1.6] text-ink-muted">
                    {t("spec.rev", {
                      n:
                        revisionNumbers.get(
                          existingDecisionReview.revisionId,
                        ) ?? currentRevision.revision,
                    })}
                    {" · "}
                    {nameOf(existingDecisionReview.reviewerId)}
                  </p>
                </div>
              ) : null}

              {approve.isError || requestChanges.isError ? (
                <p className="mt-2 text-[11px] text-danger">
                  {t("spec.decisionFailed")}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
