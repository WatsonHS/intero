import type { ReactNode } from "react";

type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

export function parseSafeMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length > 0) {
      blocks.push({ kind: "list", items: list });
      list = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (line.startsWith("# ")) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: 1, text: line.slice(2) });
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: 2, text: line.slice(3) });
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      list.push(line.slice(2));
      continue;
    }
    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
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

export function SafeMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="markdown-preview">
      {parseSafeMarkdown(markdown).map((block, index) => {
        const key = `${block.kind}-${index}`;
        if (block.kind === "heading") {
          return block.level === 1 ? (
            <h1 key={key}>
              <InlineCode text={block.text} />
            </h1>
          ) : (
            <h2 key={key}>
              <InlineCode text={block.text} />
            </h2>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>
                  <InlineCode text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={key}>
            <InlineCode text={block.text} />
          </p>
        );
      })}
    </div>
  );
}
