import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SafeMarkdown, parseSafeMarkdown } from "./SafeMarkdown";

describe("SafeMarkdown", () => {
  it("renders edited headings, lists, and inline code", () => {
    const markdown = [
      "# Contract",
      "",
      "A safe paragraph.",
      "",
      "## Review boundary",
      "",
      "- `freshnessAt` is required.",
    ].join("\n");

    expect(parseSafeMarkdown(markdown)).toHaveLength(4);
    expect(
      renderToStaticMarkup(<SafeMarkdown markdown={markdown} />),
    ).toContain("<h2>Review boundary</h2>");
    expect(
      renderToStaticMarkup(<SafeMarkdown markdown={markdown} />),
    ).toContain("<code>freshnessAt</code>");
  });

  it("tracks the source line range each block came from", () => {
    const markdown = [
      "# Contract", // 1
      "", // 2
      "First paragraph line", // 3
      "wrapped onto a second line.", // 4
      "", // 5
      "## Review boundary", // 6
      "", // 7
      "- one", // 8
      "- two", // 9
    ].join("\n");

    // Annotations anchor to these ranges, so an off-by-one here would attach a
    // reader's comment to the wrong part of the spec.
    expect(
      parseSafeMarkdown(markdown).map((block) => [
        block.kind,
        block.lineStart,
        block.lineEnd,
      ]),
    ).toEqual([
      ["heading", 1, 1],
      ["paragraph", 3, 4],
      ["heading", 6, 6],
      ["list", 8, 9],
    ]);
  });

  it("closes a trailing block at the last line", () => {
    expect(parseSafeMarkdown("only line")).toEqual([
      { kind: "paragraph", text: "only line", lineStart: 1, lineEnd: 1 },
    ]);
  });

  it("escapes raw HTML instead of executing it", () => {
    const output = renderToStaticMarkup(
      <SafeMarkdown markdown={"<img src=x onerror=alert(1)>"} />,
    );

    expect(output).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(output).not.toContain("<img");
  });
});
