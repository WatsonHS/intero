import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ChatMarkdown,
  isEmojiOnlyMessage,
  parseChatMarkdown,
} from "./ChatMarkdown";

describe("ChatMarkdown", () => {
  it("renders common chat Markdown without accepting raw HTML", () => {
    const output = renderToStaticMarkup(
      <ChatMarkdown
        markdown={[
          "**Done** and `typed`.",
          "",
          "- first",
          "- second",
          "",
          "```ts",
          "const value = 1;",
          "```",
          "",
          "<img src=x onerror=alert(1)>",
        ].join("\n")}
      />,
    );
    expect(output).toContain("<strong");
    expect(output).toContain("<ul");
    expect(output).toContain("<pre");
    expect(output).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(output).not.toContain("<img");
  });

  it("drops unsafe link targets", () => {
    const unsafe = renderToStaticMarkup(
      <ChatMarkdown markdown="[click](javascript:alert(1))" />,
    );
    const safe = renderToStaticMarkup(
      <ChatMarkdown markdown="[docs](https://example.com/path)" />,
    );
    expect(unsafe).not.toContain("<a");
    expect(safe).toContain('rel="noreferrer noopener"');
  });

  it("parses quotes, ordered lists, and unterminated code fences", () => {
    expect(
      parseChatMarkdown("> context\n\n1. one\n2. two\n\n```js\nsafe()").map(
        (block) => block.kind,
      ),
    ).toEqual(["quote", "list", "code"]);
  });

  it("recognizes complete emoji sequences without treating decorated text as emoji-only", () => {
    for (const message of [
      "😀",
      "😀  🚀",
      "👩🏽‍💻",
      "❤️",
      "1️⃣",
      "🇨🇳",
      "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
      "👍\n🔥",
    ]) {
      expect(isEmojiOnlyMessage(message)).toBe(true);
    }

    for (const message of ["", "完成 ✅", "*😀*", "😀!", "©"]) {
      expect(isEmojiOnlyMessage(message)).toBe(false);
    }
  });

  it("enlarges emoji-only content and supports opting out for attached messages", () => {
    const enlarged = renderToStaticMarkup(<ChatMarkdown markdown="👋🏻" />);
    const attached = renderToStaticMarkup(
      <ChatMarkdown markdown="👋🏻" enlargeEmojiOnly={false} />,
    );

    expect(enlarged).toContain('data-emoji-only="true"');
    expect(enlarged).toContain('data-fluent-emoji="👋🏻"');
    expect(enlarged).toContain("font-size:32px");
    expect(attached).not.toContain("data-emoji-only");
    expect(attached).not.toContain("font-size:32px");
  });
});
