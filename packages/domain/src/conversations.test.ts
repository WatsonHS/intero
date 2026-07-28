import { describe, expect, it } from "vitest";

import { isSingleEmojiSequence, ReactionEmoji } from "./conversations.js";

describe("message reaction emoji", () => {
  it("accepts complete emoji graphemes", () => {
    for (const emoji of ["👍", "👩🏽‍💻", "❤️", "1️⃣", "🇨🇳", "🏴󠁧󠁢󠁥󠁮󠁧󠁿"]) {
      expect(isSingleEmojiSequence(emoji)).toBe(true);
      expect(ReactionEmoji.safeParse(emoji).success).toBe(true);
    }
  });

  it("rejects text and multiple emoji", () => {
    for (const value of ["", "好", "👍👍", "👍 好", "©"]) {
      expect(isSingleEmojiSequence(value)).toBe(false);
      expect(ReactionEmoji.safeParse(value).success).toBe(false);
    }
  });
});
