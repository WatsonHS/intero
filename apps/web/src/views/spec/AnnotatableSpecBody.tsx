import { CursorTextIcon, HighlighterIcon, XIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";

import {
  SafeMarkdownBlock,
  parseSafeMarkdown,
} from "../../components/SafeMarkdown.js";
import { Avatar, Meta, cn } from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";

/** The block's visible text, which is what character offsets are relative to. */
function blockText(block: HTMLElement): string {
  return block.querySelector("[data-block-text]")?.textContent ?? "";
}

/**
 * Offset of a DOM position within the block's visible text. Walks the text
 * nodes in order so the number matches `blockText` exactly.
 */
function textOffset(
  block: HTMLElement,
  node: Node,
  offset: number,
): number | undefined {
  const content = block.querySelector("[data-block-text]");
  if (!content || !content.contains(node)) return undefined;
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  let total = 0;
  let text = walker.nextNode();
  while (text) {
    if (text === node) return total + offset;
    total += text.textContent?.length ?? 0;
    text = walker.nextNode();
  }
  // The position was on an element boundary rather than inside a text node.
  return node === content ? total : undefined;
}

/**
 * Splits a block's text into the runs each annotation covers.
 *
 * An annotation whose recorded text no longer matches what sits at its offsets
 * is treated as stale and falls back to covering the whole block, so a revision
 * can never move a highlight onto unrelated words.
 */
export function highlightRuns(
  text: string,
  annotations: Annotation[],
): Array<{ text: string; annotation?: Annotation }> {
  const spans = annotations
    .map((annotation) => {
      const { charStart, charEnd } = annotation;
      if (charStart === undefined || charEnd === undefined) return undefined;
      if (charEnd <= charStart || charEnd > text.length) return undefined;
      if (
        annotation.selection &&
        text.slice(charStart, charEnd) !== annotation.selection
      ) {
        return undefined;
      }
      return { start: charStart, end: charEnd, annotation };
    })
    .filter((span): span is NonNullable<typeof span> => span !== undefined)
    .sort((left, right) => left.start - right.start);

  const runs: Array<{ text: string; annotation?: Annotation }> = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue; // Overlaps an earlier highlight.
    if (span.start > cursor) {
      runs.push({ text: text.slice(cursor, span.start) });
    }
    runs.push({
      text: text.slice(span.start, span.end),
      annotation: span.annotation,
    });
    cursor = span.end;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor) });
  return runs;
}

export interface Annotation {
  threadId: string;
  lineStart: number;
  lineEnd: number;
  /** Offsets into the anchored block's text; absent for whole-block anchors. */
  charStart?: number | undefined;
  charEnd?: number | undefined;
  selection: string;
  status: "open" | "resolved";
  comments: Array<{
    id: string;
    authorId: string;
    authorName: string;
    body: string;
    createdAt: string;
  }>;
}

interface Pending {
  lineStart: number;
  lineEnd: number;
  charStart: number;
  charEnd: number;
  quote: string;
  x: number;
  y: number;
}

/** Renders a block's text with each annotated run tinted and clickable. */
function AnnotatedText({
  text,
  annotations,
  onOpen,
}: {
  text: string;
  annotations: Annotation[];
  onOpen: (threadId: string) => void;
}) {
  const runs = highlightRuns(text, annotations);
  return (
    <>
      {runs.map((run, index) =>
        run.annotation ? (
          <mark
            key={index}
            role="button"
            tabIndex={0}
            title={run.annotation.comments[0]?.body}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(run.annotation!.threadId);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(run.annotation!.threadId);
              }
            }}
            className={cn(
              "cursor-pointer rounded-[3px] px-[1px] text-ink",
              run.annotation.status === "open"
                ? "bg-accent-soft shadow-[inset_0_-1px_0_var(--intero-accent)]"
                : "bg-raise shadow-[inset_0_-1px_0_var(--intero-line2)]",
            )}
          >
            {run.text}
          </mark>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The spec text with margin-free inline annotation.
 *
 * Selecting text inside a block offers to annotate it; the block's line range
 * becomes the comment anchor, so an annotation survives as a real
 * `SpecCommentThread` rather than a client-side highlight. Blocks that already
 * carry annotations are washed and numbered, and clicking one opens its thread.
 */
export function AnnotatableSpecBody({
  markdown,
  annotations,
  onCreate,
  onReply,
  busy = false,
}: {
  markdown: string;
  annotations: Annotation[];
  onCreate: (input: {
    lineStart: number;
    lineEnd: number;
    charStart: number;
    charEnd: number;
    selection: string;
    body: string;
  }) => void;
  onReply: (input: { threadId: string; body: string }) => void;
  busy?: boolean;
}) {
  const { t, formatRelative } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending>();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [openThreadId, setOpenThreadId] = useState<string>();
  const [reply, setReply] = useState("");

  const blocks = parseSafeMarkdown(markdown);
  const openThread = annotations.find(
    (entry) => entry.threadId === openThreadId,
  );

  function annotationsFor(lineStart: number, lineEnd: number): Annotation[] {
    // A thread belongs to a block when their line ranges overlap at all — a
    // revision can shift text under an anchor, and dropping it would be worse.
    return annotations.filter(
      (entry) => entry.lineStart <= lineEnd && entry.lineEnd >= lineStart,
    );
  }

  function captureSelection() {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.isCollapsed) return;
    const text = selection.toString().trim();
    if (!text) return;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;

    const anchored = (node: Node | null): HTMLElement | null => {
      const element =
        node instanceof HTMLElement ? node : (node?.parentElement ?? null);
      return element?.closest<HTMLElement>("[data-line-start]") ?? null;
    };
    const from = anchored(range.startContainer);
    const to = anchored(range.endContainer) ?? from;
    if (!from || !to) return;

    // Character offsets are measured against the block's own text, so a
    // highlight survives anything that does not edit that block.
    const charStart = textOffset(from, range.startContainer, range.startOffset);
    const charEnd =
      from === to
        ? textOffset(from, range.endContainer, range.endOffset)
        : blockText(from).length;
    if (charStart === undefined || charEnd === undefined) return;

    const rect = range.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    setPending({
      lineStart: Number(from.dataset.lineStart),
      lineEnd: Number(to.dataset.lineEnd ?? from.dataset.lineEnd),
      charStart: Math.min(charStart, charEnd),
      charEnd: Math.max(charStart, charEnd),
      quote: text.slice(0, 2_000),
      x: rect.left + rect.width / 2 - rootRect.left,
      y: rect.top - rootRect.top,
    });
    setComposing(false);
  }

  function dismiss() {
    setPending(undefined);
    setComposing(false);
    setDraft("");
    setOpenThreadId(undefined);
    setReply("");
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="mb-3 flex items-center justify-end">
        <Meta className="inline-flex items-center gap-1.5 text-[10px]">
          <CursorTextIcon size={12} />
          {t("spec.annotateHint", { count: annotations.length })}
        </Meta>
      </div>

      <div className="markdown-preview" onMouseUp={captureSelection}>
        {blocks.map((block, index) => {
          const attached = annotationsFor(block.lineStart, block.lineEnd);
          // Whole-block anchors (or ones whose text moved) wash the block;
          // character anchors only tint the run they actually cover.
          const blockLevel = attached.filter(
            (entry) =>
              entry.charStart === undefined || entry.charEnd === undefined,
          );
          const unresolved = attached.some((entry) => entry.status === "open");
          return (
            <div
              key={`${block.kind}-${index}`}
              data-line-start={block.lineStart}
              data-line-end={block.lineEnd}
              className={cn(
                "-mx-2 rounded-quiet px-2 transition-colors duration-150",
                blockLevel.length > 0
                  ? unresolved
                    ? "cursor-pointer bg-accent-soft"
                    : "cursor-pointer bg-raise"
                  : undefined,
              )}
              onClick={
                blockLevel.length > 0
                  ? () => {
                      setPending(undefined);
                      setOpenThreadId(blockLevel[0]!.threadId);
                    }
                  : undefined
              }
            >
              <SafeMarkdownBlock
                block={block}
                renderText={(text) => (
                  <AnnotatedText
                    text={text}
                    annotations={attached}
                    onOpen={(threadId) => {
                      setPending(undefined);
                      setOpenThreadId(threadId);
                    }}
                  />
                )}
              />
              {attached.length > 0 ? (
                <Meta
                  tone={unresolved ? "amber" : "faint"}
                  className="mb-2 inline-flex items-center gap-1 text-[9.5px]"
                >
                  <HighlighterIcon size={11} />
                  {t("spec.annotationCount", { count: attached.length })}
                </Meta>
              ) : null}
            </div>
          );
        })}
      </div>

      {pending && !composing ? (
        <div
          className="absolute z-10 -translate-x-1/2 -translate-y-full"
          style={{ left: pending.x, top: pending.y }}
        >
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              setComposing(true);
            }}
            className="inline-flex h-8 cursor-pointer items-center gap-[7px] rounded-[10px] border-0 bg-ink px-3.5 text-[11.5px] font-[600] text-bg shadow-[0_8px_20px_rgba(0,0,0,0.22)]"
          >
            <HighlighterIcon size={13} />
            {t("spec.annotateThis")}
          </button>
        </div>
      ) : null}

      {pending && composing ? (
        <div
          className="absolute z-20 w-[min(306px,100%)] -translate-x-1/2 -translate-y-full rounded-[13px] border border-accent-strong bg-panel p-3.5 shadow-[0_14px_34px_rgba(0,0,0,0.24)]"
          style={{ left: pending.x, top: pending.y }}
        >
          <div className="flex items-center gap-2">
            <HighlighterIcon size={13} className="text-accent-strong" />
            <span className="text-[10.5px] font-[640] text-accent-strong">
              {t("spec.annotateTitle")}
            </span>
            <button
              type="button"
              onClick={dismiss}
              aria-label={t("general.close")}
              className="ml-auto grid h-5 w-5 cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent text-faint hover:bg-raise hover:text-ink"
            >
              <XIcon size={12} />
            </button>
          </div>
          <p className="mt-[9px] line-clamp-2 rounded-r-[7px] border-l-2 border-accent-strong bg-accent-soft px-2.5 py-2 text-[11px] leading-[1.6] text-ink">
            {pending.quote}
          </p>
          <textarea
            autoFocus
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("spec.annotatePlaceholder")}
            className="mt-2.5 w-full resize-none rounded-btn border border-line bg-panel2 px-2.5 py-2 text-[11.5px] leading-[1.6] text-ink outline-none focus:border-accent-strong"
          />
          <div className="mt-2.5 flex items-center gap-2">
            <Meta className="text-[9.5px]">{t("spec.annotateBlocks")}</Meta>
            <button
              type="button"
              disabled={!draft.trim() || busy}
              onClick={() => {
                onCreate({
                  lineStart: pending.lineStart,
                  lineEnd: pending.lineEnd,
                  charStart: pending.charStart,
                  charEnd: pending.charEnd,
                  selection: pending.quote,
                  body: draft.trim(),
                });
                dismiss();
              }}
              className="ml-auto h-7 cursor-pointer rounded-quiet border-0 bg-accent-strong px-3.5 text-[11.5px] font-[620] text-on-accent disabled:cursor-not-allowed disabled:opacity-45"
            >
              {t("spec.annotate")}
            </button>
          </div>
        </div>
      ) : null}

      {openThread ? (
        <div className="mt-4 rounded-[13px] border border-line2 bg-panel p-3.5">
          <div className="flex items-center gap-2">
            <Meta className="text-[9.5px]">
              {t("spec.lines", {
                start: openThread.lineStart,
                end: openThread.lineEnd,
              })}
            </Meta>
            <button
              type="button"
              onClick={dismiss}
              aria-label={t("general.close")}
              className="ml-auto grid h-5 w-5 cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent text-faint hover:bg-raise hover:text-ink"
            >
              <XIcon size={12} />
            </button>
          </div>
          {openThread.selection ? (
            <p className="mt-2 rounded-r-[7px] border-l-2 border-line2 bg-raise px-2.5 py-2 text-[11px] leading-[1.6] text-ink-muted">
              {openThread.selection}
            </p>
          ) : null}
          <div className="mt-2.5 flex flex-col gap-2">
            {openThread.comments.map((comment) => (
              <div
                key={comment.id}
                className="grid grid-cols-[22px_minmax(0,1fr)] items-start gap-[9px]"
              >
                <Avatar
                  id={comment.authorId}
                  name={comment.authorName}
                  size="sm"
                />
                <span className="grid min-w-0 gap-1">
                  <span className="flex items-baseline gap-2">
                    <strong className="text-[11px] font-[620]">
                      {comment.authorName}
                    </strong>
                    <Meta className="text-[9.5px]">
                      {formatRelative(comment.createdAt)}
                    </Meta>
                  </span>
                  <span className="text-[11.5px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
                    {comment.body}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-line pt-[11px]">
            <input
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              placeholder={t("spec.replyPlaceholder")}
              className="h-7 min-w-0 flex-1 rounded-quiet border border-line bg-panel2 px-2.5 text-[11px] text-ink outline-none focus:border-accent-strong"
            />
            <button
              type="button"
              disabled={!reply.trim() || busy}
              onClick={() => {
                onReply({ threadId: openThread.threadId, body: reply.trim() });
                setReply("");
              }}
              className="h-7 cursor-pointer rounded-quiet border-0 bg-accent-strong px-3 text-[11px] font-[620] text-on-accent disabled:cursor-not-allowed disabled:opacity-45"
            >
              {t("spec.reply")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
