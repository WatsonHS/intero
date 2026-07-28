import { Fragment, type ReactNode } from "react";

import { FluentEmojiText } from "./FluentEmoji.js";

type ChatMarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; language?: string; text: string };

const EMOJI_COMPONENT = String.raw`(?:\p{Emoji_Presentation}\uFE0F?|\p{Extended_Pictographic}\uFE0F)(?:\p{Emoji_Modifier})?`;
const EMOJI_SEQUENCE = new RegExp(
  String.raw`^(?:` +
    String.raw`\s*(?:` +
    `${EMOJI_COMPONENT}[\\u{E0020}-\\u{E007E}]+\\u{E007F}|` +
    String.raw`\p{Regional_Indicator}{2}|` +
    String.raw`[#*0-9]\uFE0F?\u20E3|` +
    `${EMOJI_COMPONENT}(?:\\u200D${EMOJI_COMPONENT})*` +
    String.raw`)\s*` +
    String.raw`)+$`,
  "u",
);

export function isEmojiOnlyMessage(message: string): boolean {
  return message.trim().length > 0 && EMOJI_SEQUENCE.test(message);
}

export function parseChatMarkdown(markdown: string): ChatMarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ChatMarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let listOrdered = false;
  let quote: string[] = [];
  let code: string[] | undefined;
  let codeLanguage: string | undefined;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length > 0) {
      blocks.push({ kind: "list", ordered: listOrdered, items: list });
      list = [];
    }
  };
  const flushQuote = () => {
    if (quote.length > 0) {
      blocks.push({ kind: "quote", text: quote.join("\n") });
      quote = [];
    }
  };
  const flushText = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const rawLine of lines) {
    if (code) {
      if (rawLine.trimStart().startsWith("```")) {
        blocks.push({
          kind: "code",
          ...(codeLanguage ? { language: codeLanguage } : {}),
          text: code.join("\n"),
        });
        code = undefined;
        codeLanguage = undefined;
      } else {
        code.push(rawLine);
      }
      continue;
    }
    const fence = rawLine.match(/^\s*```([A-Za-z0-9_+-]*)\s*$/);
    if (fence) {
      flushText();
      code = [];
      codeLanguage = fence[1] || undefined;
      continue;
    }
    if (!rawLine.trim()) {
      flushText();
      continue;
    }
    const heading = rawLine.match(/^\s*(#{1,3})\s+(.+)$/);
    if (heading) {
      flushText();
      blocks.push({
        kind: "heading",
        level: heading[1]!.length as 1 | 2 | 3,
        text: heading[2]!,
      });
      continue;
    }
    const unordered = rawLine.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = rawLine.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      flushQuote();
      const nextOrdered = Boolean(ordered);
      if (list.length > 0 && listOrdered !== nextOrdered) flushList();
      listOrdered = nextOrdered;
      list.push((ordered ?? unordered)![1]!);
      continue;
    }
    const quoted = rawLine.match(/^\s*>\s?(.*)$/);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]!);
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(rawLine);
  }

  if (code) {
    blocks.push({
      kind: "code",
      ...(codeLanguage ? { language: codeLanguage } : {}),
      text: code.join("\n"),
    });
  }
  flushText();
  return blocks;
}

function safeLink(href: string): string | undefined {
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function InlineMarkdown({
  text,
  renderText,
}: {
  text: string;
  renderText: ((text: string) => ReactNode) | undefined;
}) {
  const token =
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\[[^\]\n]+\]\([^\s)\n]+\)|(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_))/g;
  const parts = text.split(token);
  return parts.map((part, index) => {
    const key = `${index}-${part}`;
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={key}
          className="rounded-[5px] bg-black/6 px-1 py-0.5 font-mono text-[0.92em] dark:bg-white/8"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (
      (part.startsWith("**") && part.endsWith("**")) ||
      (part.startsWith("__") && part.endsWith("__"))
    ) {
      return (
        <strong key={key} className="font-[680]">
          <InlineMarkdown text={part.slice(2, -2)} renderText={renderText} />
        </strong>
      );
    }
    if (part.startsWith("~~") && part.endsWith("~~")) {
      return (
        <del key={key} className="opacity-70">
          <InlineMarkdown text={part.slice(2, -2)} renderText={renderText} />
        </del>
      );
    }
    if (
      (part.startsWith("*") && part.endsWith("*")) ||
      (part.startsWith("_") && part.endsWith("_"))
    ) {
      return (
        <em key={key}>
          <InlineMarkdown text={part.slice(1, -1)} renderText={renderText} />
        </em>
      );
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = safeLink(link[2]!);
      return href ? (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent-strong underline decoration-current/30 underline-offset-2 hover:decoration-current"
        >
          <InlineMarkdown text={link[1]!} renderText={renderText} />
        </a>
      ) : (
        <Fragment key={key}>
          <FluentEmojiText text={link[1]!} renderText={renderText} />
        </Fragment>
      );
    }
    return (
      <Fragment key={key}>
        <FluentEmojiText text={part} renderText={renderText} />
      </Fragment>
    );
  });
}

function InlineWithBreaks({
  text,
  renderText,
}: {
  text: string;
  renderText: ((text: string) => ReactNode) | undefined;
}) {
  return text.split("\n").map((line, index, lines) => (
    <Fragment key={`${index}-${line}`}>
      <InlineMarkdown text={line} renderText={renderText} />
      {index < lines.length - 1 ? <br /> : null}
    </Fragment>
  ));
}

export function ChatMarkdown({
  markdown,
  renderText,
  className = "",
  enlargeEmojiOnly = true,
}: {
  markdown: string;
  renderText?: (text: string) => ReactNode;
  className?: string;
  enlargeEmojiOnly?: boolean;
}) {
  const emojiOnly = enlargeEmojiOnly && isEmojiOnlyMessage(markdown);
  return (
    <div
      data-emoji-only={emojiOnly ? "true" : undefined}
      style={emojiOnly ? { fontSize: "32px", lineHeight: 1.3 } : undefined}
      className={`chat-markdown grid gap-2 text-[13px] leading-[1.75] text-ink [overflow-wrap:anywhere] [text-wrap:pretty] ${className}`}
    >
      {parseChatMarkdown(markdown).map((block, index) => {
        const key = `${block.kind}-${index}`;
        if (block.kind === "heading") {
          const content = (
            <InlineMarkdown text={block.text} renderText={renderText} />
          );
          if (block.level === 1) {
            return (
              <h3 key={key} className="text-[15px] font-[700] leading-[1.5]">
                {content}
              </h3>
            );
          }
          return (
            <h4 key={key} className="text-[13.5px] font-[680] leading-[1.55]">
              {content}
            </h4>
          );
        }
        if (block.kind === "code") {
          return (
            <pre
              key={key}
              data-language={block.language}
              className="max-w-full overflow-x-auto rounded-[9px] bg-raise p-3 font-mono text-[11.5px] leading-[1.65] text-ink"
            >
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List
              key={key}
              className={
                block.ordered
                  ? "grid list-decimal gap-1 pl-5"
                  : "grid list-disc gap-1 pl-5"
              }
            >
              {block.items.map((item, itemIndex) => (
                <li key={`${itemIndex}-${item}`}>
                  <InlineMarkdown text={item} renderText={renderText} />
                </li>
              ))}
            </List>
          );
        }
        if (block.kind === "quote") {
          return (
            <blockquote
              key={key}
              className="border-l-2 border-accent-strong/45 pl-3 text-ink-muted"
            >
              <InlineWithBreaks text={block.text} renderText={renderText} />
            </blockquote>
          );
        }
        return (
          <p key={key}>
            <InlineWithBreaks text={block.text} renderText={renderText} />
          </p>
        );
      })}
    </div>
  );
}
