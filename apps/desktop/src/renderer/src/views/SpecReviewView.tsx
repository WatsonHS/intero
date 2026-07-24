import { CodeIcon, EyeIcon, GitDiffIcon } from "@phosphor-icons/react";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useState } from "react";

import { createSpec, createSpecRevision } from "../api";
import { SafeMarkdown, parseSafeMarkdown } from "../components/SafeMarkdown";

const SPEC = `# Public Work State API

The projection exposes freshness and confidence without leaking private Claims.

## Contract

- \`freshnessAt\` is always present.
- \`confidence\` is optional for imported state.
- contradictions are references, never raw evidence.
`;

const EDITOR_THEME = EditorView.theme({
  "&": {
    minHeight: "610px",
    background: "transparent",
    color: "#33362f",
  },
  ".cm-content": {
    padding: "48px clamp(32px, 7vw, 86px)",
    caretColor: "#a64b39",
    fontFamily: '"Geist Mono", "SFMono-Regular", monospace',
    fontSize: "12px",
    lineHeight: "1.75",
  },
  ".cm-gutters": {
    display: "none",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(166, 75, 57, 0.035)",
  },
  "&.cm-focused": {
    outline: "2px solid rgba(166, 75, 57, 0.16)",
    outlineOffset: "-2px",
  },
});

const AUTHOR_ID = "019b5ac0-7600-7000-8000-000000000002";

export function SpecReviewView() {
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [markdown, setMarkdown] = useState(SPEC);
  const [published, setPublished] = useState<{
    specId: string;
    revision: number;
  }>();
  const [publishState, setPublishState] = useState<
    "idle" | "publishing" | "published" | "error"
  >("idle");
  const affectedBlocks = parseSafeMarkdown(markdown).filter(
    (block) => block.kind === "heading" && block.level === 2,
  ).length;

  async function publishRevision() {
    setPublishState("publishing");
    try {
      if (published) {
        const revision = await createSpecRevision({
          specId: published.specId,
          revision: published.revision + 1,
          markdown,
          affectedScopes: ["api"],
          createdBy: AUTHOR_ID,
        });
        setPublished({ specId: published.specId, revision: revision.revision });
      } else {
        const created = await createSpec({
          id: crypto.randomUUID(),
          title: "Public Work State API",
          markdown,
          affectedScopes: ["api", "security"],
          createdBy: AUTHOR_ID,
        });
        setPublished({
          specId: created.spec.id,
          revision: created.revision.revision,
        });
      }
      setPublishState("published");
      setMode("preview");
    } catch {
      setPublishState("error");
    }
  }

  return (
    <div className="spec-view">
      <header className="view-header spec-view__header">
        <div>
          <p className="eyebrow">
            {published
              ? `Spec / revision ${published.revision}`
              : "Spec / local draft"}
          </p>
          <h1>Public Work State API</h1>
          <p className="view-header__lede">
            A versioned review gate for shared boundaries.
          </p>
        </div>
        <div className="view-header__actions">
          <div className="segmented-control">
            <button
              className={mode === "edit" ? "active" : ""}
              type="button"
              onClick={() => setMode("edit")}
            >
              <CodeIcon size={15} />
              Edit
            </button>
            <button
              className={mode === "preview" ? "active" : ""}
              type="button"
              onClick={() => setMode("preview")}
            >
              <EyeIcon size={15} />
              Preview
            </button>
          </div>
          <button
            className="button button--primary"
            type="button"
            disabled={publishState === "publishing"}
            onClick={publishRevision}
          >
            {publishState === "publishing"
              ? "Publishing…"
              : published
                ? `Publish revision ${published.revision + 1}`
                : "Publish revision"}
          </button>
        </div>
      </header>

      <div className="spec-grid">
        <section className="spec-document">
          <div className="spec-document__toolbar">
            <span>
              <GitDiffIcon size={16} /> {affectedBlocks} affected blocks
            </span>
            <span>
              {publishState === "error"
                ? "publish failed — local draft kept"
                : publishState === "published"
                  ? `revision ${published?.revision} published`
                  : "autosaved locally"}
            </span>
          </div>
          {mode === "edit" ? (
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
              aria-label="Spec Markdown editor"
            />
          ) : (
            <SafeMarkdown markdown={markdown} />
          )}
        </section>

        <aside className="review-panel">
          <div className="review-panel__header">
            <p className="eyebrow">Affected reviewers</p>
            <h2>Review state</h2>
          </div>
          <div className="reviewer">
            <span className="person-avatar">—</span>
            <span>
              <strong>Human review</strong>
              <small>No reviewer assigned</small>
            </span>
            <span className="review-state">awaiting</span>
          </div>
          <div className="revision-note">
            <strong>
              {published
                ? `Revision ${published.revision} needs review`
                : "Local draft is not under review"}
            </strong>
            <p>
              {published
                ? "No human acknowledgement or approval has been recorded."
                : "Publish a revision before requesting human approval."}
            </p>
          </div>
          <div className="representative-analysis">
            <span>Representative analysis</span>
            <p>Confidence is display metadata, not an authorization input.</p>
            <small>Does not count as human approval</small>
          </div>
        </aside>
      </div>
    </div>
  );
}
