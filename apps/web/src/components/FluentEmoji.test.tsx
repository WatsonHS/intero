import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  FluentEmoji,
  hasFluentEmoji,
  splitFluentEmojiText,
} from "./FluentEmoji.js";

describe("FluentEmoji", () => {
  it("renders supported emoji from the pinned Microsoft sprite assets", () => {
    for (const emoji of [
      "😀",
      "👍🏽",
      "❤️",
      "😂",
      "🎉",
      "😮",
      "😢",
      "🙏",
      "👀",
    ]) {
      expect(hasFluentEmoji(emoji)).toBe(true);
    }

    const output = renderToStaticMarkup(
      <FluentEmoji emoji="😀" label="grinning face" />,
    );
    expect(output).toContain('data-fluent-emoji="😀"');
    expect(output).toContain("/fluent-emoji/smileys-and-emotion-base-1.png");
    expect(output).toContain('aria-label="grinning face"');
  });

  it("keeps unsupported glyphs as Unicode fallbacks", () => {
    expect(hasFluentEmoji("🇨🇳")).toBe(false);
    const output = renderToStaticMarkup(<FluentEmoji emoji="🇨🇳" />);
    expect(output).toContain("🇨🇳");
    expect(output).not.toContain("data-fluent-emoji");
  });

  it("segments inline emoji without breaking the surrounding text", () => {
    expect(splitFluentEmojiText("准备 😀 发布👍🏽")).toEqual([
      { kind: "text", value: "准备 " },
      { kind: "emoji", value: "😀" },
      { kind: "text", value: " 发布" },
      { kind: "emoji", value: "👍🏽" },
    ]);
  });
});
