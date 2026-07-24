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

  it("escapes raw HTML instead of executing it", () => {
    const output = renderToStaticMarkup(
      <SafeMarkdown markdown={"<img src=x onerror=alert(1)>"} />,
    );

    expect(output).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(output).not.toContain("<img");
  });
});
