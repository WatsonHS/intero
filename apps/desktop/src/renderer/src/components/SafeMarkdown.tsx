import type { ReactNode } from "react";

/**
 * Every block carries the 1-based line range it came from, so a reader can
 * anchor a comment to the text they selected rather than typing line numbers.
 */
export type MarkdownBlock = { lineStart: number; lineEnd: number } & (
  | { kind: "heading"; level: 1 | 2; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
);

export function parseSafeMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let openedAt = 1;

  const flushParagraph = (endLine: number) => {
    if (paragraph.length > 0) {
      blocks.push({
        kind: "paragraph",
        text: paragraph.join(" "),
        lineStart: openedAt,
        lineEnd: endLine,
      });
      paragraph = [];
    }
  };
  const flushList = (endLine: number) => {
    if (list.length > 0) {
      blocks.push({
        kind: "list",
        items: list,
        lineStart: openedAt,
        lineEnd: endLine,
      });
      list = [];
    }
  };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const previous = lineNumber - 1;
    const line = rawLine.trim();
    if (!line) {
      flushParagraph(previous);
      flushList(previous);
      return;
    }
    if (line.startsWith("# ") || line.startsWith("## ")) {
      flushParagraph(previous);
      flushList(previous);
      const level = line.startsWith("## ") ? 2 : 1;
      blocks.push({
        kind: "heading",
        level,
        text: line.slice(level === 2 ? 3 : 2),
        lineStart: lineNumber,
        lineEnd: lineNumber,
      });
      return;
    }
    if (line.startsWith("- ")) {
      flushParagraph(previous);
      if (list.length === 0) openedAt = lineNumber;
      list.push(line.slice(2));
      return;
    }
    flushList(previous);
    if (paragraph.length === 0) openedAt = lineNumber;
    paragraph.push(line);
  });

  flushParagraph(lines.length);
  flushList(lines.length);
  return blocks;
}

function InlineCode({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, index): ReactNode =>
    part.startsWith("`") && part.endsWith("`") ? (
      <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>
    ) : (
      part
    ),
  );
}

/**
 * Renders one parsed block. Split out so callers can wrap blocks individually.
 *
 * `renderText` lets a caller decorate the block's text — annotation highlights
 * use it. The decorated span is marked `data-block-text` and holds exactly the
 * text that character offsets are measured against, so offsets stay meaningful
 * no matter how the block is styled around it.
 */
export function SafeMarkdownBlock({
  block,
  renderText,
}: {
  block: MarkdownBlock;
  renderText?: (text: string) => ReactNode;
}) {
  // Without a decorator the markup is exactly what it always was; the wrapper
  // span only exists to give character offsets something to measure against.
  if (!renderText) {
    if (block.kind === "heading") {
      return block.level === 1 ? (
        <h1>
          <InlineCode text={block.text} />
        </h1>
      ) : (
        <h2>
          <InlineCode text={block.text} />
        </h2>
      );
    }
    if (block.kind === "list") {
      return (
        <ul>
          {block.items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>
              <InlineCode text={item} />
            </li>
          ))}
        </ul>
      );
    }
    return (
      <p>
        <InlineCode text={block.text} />
      </p>
    );
  }

  // A list's offsets run across its items joined by newlines, matching the
  // textContent the browser reports for the rendered <ul>.
  const body = block.kind === "list" ? block.items.join("\n") : block.text;
  const decorated = <span data-block-text="">{renderText(body)}</span>;

  if (block.kind === "heading") {
    return block.level === 1 ? <h1>{decorated}</h1> : <h2>{decorated}</h2>;
  }
  if (block.kind === "list") {
    return (
      <ul>
        <li>{decorated}</li>
      </ul>
    );
  }
  return <p>{decorated}</p>;
}

export function SafeMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="markdown-preview">
      {parseSafeMarkdown(markdown).map((block, index) => (
        <SafeMarkdownBlock key={`${block.kind}-${index}`} block={block} />
      ))}
    </div>
  );
}
