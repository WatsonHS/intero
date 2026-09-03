import { describe, expect, it } from "vitest";

import {
  extractHttpUrls,
  isSingleEmojiSequence,
  LinkPreview,
  normalizePublicHttpUrl,
  ReactionEmoji,
} from "./conversations.js";

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

describe("extractHttpUrls", () => {
  it("returns the first two unique normalized http(s) URLs", () => {
    expect(
      extractHttpUrls(
        "See https://Example.com/a, then http://example.com/b and https://example.com/a again plus https://other.test/c.",
      ),
    ).toEqual(["https://example.com/a", "http://example.com/b"]);
  });

  it("strips credentials, fragments, and default ports", () => {
    expect(normalizePublicHttpUrl("https://user:pass@example.com/x")).toBe(
      undefined,
    );
    expect(normalizePublicHttpUrl("https://example.com:443/x#frag")).toBe(
      "https://example.com/x",
    );
    expect(normalizePublicHttpUrl("http://example.com:80/x")).toBe(
      "http://example.com/x",
    );
  });

  it("rejects a link preview without a fetched timestamp", () => {
    expect(
      LinkPreview.safeParse({
        url: "https://example.com",
        status: "ok",
      }).success,
    ).toBe(false);
  });
});
