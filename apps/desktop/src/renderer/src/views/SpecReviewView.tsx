import {
  CodeIcon,
  EyeIcon,
  GitDiffIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { Button } from "@intero/ui";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useState } from "react";

import {
  createSpec,
  createSpecRevision,
  getBootstrap,
  getSpecs,
} from "../api.js";
import { SafeMarkdown, parseSafeMarkdown } from "../components/SafeMarkdown.js";
import { useI18n } from "../i18n/index.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";

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

export function SpecReviewView() {
  const { t } = useI18n();
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

  useEffect(() => {
    if (!activeId && specs.data?.items[0]) {
      setActiveId(specs.data.items[0].spec.id);
    }
  }, [activeId, specs.data?.items]);

  const active = specs.data?.items.find((item) => item.spec.id === activeId);
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

  const affectedBlocks = useMemo(
    () =>
      parseSafeMarkdown(markdown).filter(
        (block) => block.kind === "heading" && block.level === 2,
      ).length,
    [markdown],
  );
  const reviews = active?.reviews ?? [];
  const principalNames = new Map(
    active?.principals.map((principal) => [
      principal.id,
      principal.displayName,
    ]) ?? [],
  );
  const revisionNumbers = new Map(
    active?.revisions.map((revision) => [revision.id, revision.revision]) ?? [],
  );

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
      <div className="spec-view spec-view--empty">
        <section className="thread-empty">
          <p>{t("spec.loading")}</p>
        </section>
      </div>
    );
  }

  if (specs.isError) {
    return (
      <div className="spec-view spec-view--empty">
        <section className="thread-empty">
          <strong>{t("spec.unavailable")}</strong>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void specs.refetch()}
          >
            {t("general.retry")}
          </Button>
        </section>
      </div>
    );
  }

  if (!activeId && !specs.isLoading) {
    return (
      <div className="spec-view spec-view--empty">
        <header className="view-header spec-view__header">
          <div>
            <p className="eyebrow">{t("spec.localDraft")}</p>
            <h1>{t("spec.title")}</h1>
            <p className="view-header__lede">{t("spec.lede")}</p>
          </div>
        </header>
        <section className="empty-state">
          <strong>{t("spec.emptyTitle")}</strong>
          <p>{t("spec.emptyDetail")}</p>
          <Button
            className="button button--primary"
            type="button"
            onClick={() => {
              setActiveId(NEW_SPEC);
              setMode("edit");
            }}
          >
            <PlusIcon size={16} />
            {t("spec.newDraft")}
          </Button>
        </section>
      </div>
    );
  }

  const nextRevision = currentRevision ? currentRevision.revision + 1 : 1;

  return (
    <div className="spec-view">
      <header className="view-header spec-view__header">
        <div>
          <p className="eyebrow">
            {currentRevision
              ? `${t("spec.revision", {
                  revision: currentRevision.revision,
                })} · ${t(`spec.status.${active?.spec.status}` as TranslationKey)}`
              : t("spec.localDraft")}
          </p>
          <h1>{title || t("spec.untitled")}</h1>
          <p className="view-header__lede">{t("spec.lede")}</p>
        </div>
        <div className="view-header__actions">
          <select
            className="spec-selector"
            value={activeId}
            aria-label={t("spec.title")}
            onChange={(event) => {
              setActiveId(event.target.value);
              setPublishState("idle");
              setPublishedRevision(undefined);
            }}
          >
            {specs.data?.items.map((item) => (
              <option value={item.spec.id} key={item.spec.id}>
                {item.spec.title}
              </option>
            ))}
            <option value={NEW_SPEC}>{t("spec.newDraft")}</option>
          </select>
          <div className="segmented-control">
            <Button
              className={mode === "edit" ? "active" : ""}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMode("edit")}
            >
              <CodeIcon size={15} />
              {t("spec.edit")}
            </Button>
            <Button
              className={mode === "preview" ? "active" : ""}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMode("preview")}
            >
              <EyeIcon size={15} />
              {t("spec.preview")}
            </Button>
          </div>
          <Button
            className="button button--primary"
            type="button"
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
          </Button>
        </div>
      </header>

      <div className="spec-grid">
        <section className="spec-document">
          <div className="spec-document__toolbar">
            <span>
              <GitDiffIcon size={16} />{" "}
              {t("spec.affectedBlocks", { count: affectedBlocks })}
            </span>
            <span>
              {publishState === "error"
                ? t("spec.publishFailed")
                : publishState === "published"
                  ? t("spec.published", {
                      revision: publishedRevision ?? nextRevision,
                    })
                  : saveState === "error"
                    ? t("spec.saveFailed")
                    : saveState === "saved"
                      ? t("spec.savedLocally")
                      : t("spec.savingLocally")}
            </span>
          </div>
          {mode === "edit" ? (
            <>
              <label className="spec-title-field">
                <span>{t("spec.titleLabel")}</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t("spec.titlePlaceholder")}
                  disabled={active !== undefined}
                />
              </label>
              <CodeMirror
                className="spec-editor"
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
          ) : (
            <SafeMarkdown markdown={markdown} />
          )}
        </section>

        <aside className="review-panel">
          <div className="review-panel__header">
            <p className="eyebrow">{t("spec.affectedReviewers")}</p>
            <h2>{t("spec.reviewState")}</h2>
          </div>
          {reviews.length === 0 ? (
            <p className="quiet-copy">{t("spec.noReviews")}</p>
          ) : null}
          {reviews.map((review) => (
            <div
              className={
                review.invalidatedAt
                  ? "reviewer reviewer--invalidated"
                  : "reviewer"
              }
              key={`${review.revisionId}:${review.reviewerId}:${review.createdAt}`}
            >
              <span className="person-avatar">
                {initials(principalNames.get(review.reviewerId))}
              </span>
              <span>
                <strong>
                  {principalNames.get(review.reviewerId) ??
                    review.reviewerId.slice(0, 8)}
                </strong>
                <small>{review.body}</small>
                <small>
                  {t("spec.reviewRevision", {
                    revision: revisionNumbers.get(review.revisionId) ?? "—",
                  })}
                </small>
              </span>
              <span className="review-state">
                {t(`review.${review.kind}` as TranslationKey)}
                {review.invalidatedAt ? ` · ${t("spec.invalidated")}` : ""}
              </span>
            </div>
          ))}
          {reviews.some(
            (review) => review.kind === "representative_impact_analysis",
          ) ? (
            <div className="representative-analysis">
              <small>{t("spec.analysisNotApproval")}</small>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function initials(name: string | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts.at(-1)![0] ?? ""}`.toUpperCase();
}
