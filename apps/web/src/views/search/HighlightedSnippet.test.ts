import { describe, expect, it } from "vitest";

import { snippetParts } from "./HighlightedSnippet.js";

describe("search snippet highlighting", () => {
  it("splits only <b> markers and unescapes the remaining text", () => {
    expect(
      snippetParts("Please deploy the <b>auth</b> &amp; <b>fix</b>."),
    ).toEqual([
      { text: "Please deploy the ", mark: false },
      { text: "auth", mark: true },
      { text: " & ", mark: false },
      { text: "fix", mark: true },
      { text: ".", mark: false },
    ]);
  });
});
