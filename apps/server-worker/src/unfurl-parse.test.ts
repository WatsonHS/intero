import { describe, expect, it } from "vitest";

import { parseLinkPreviewHtml } from "./unfurl-parse.js";

describe("parseLinkPreviewHtml", () => {
  it("prefers Open Graph over Twitter and title tags", () => {
    const html = `
      <html><head>
        <title>Fallback title</title>
        <meta name="description" content="Meta description">
        <meta property="og:title" content="OG title">
        <meta property="og:description" content="OG description">
        <meta property="og:site_name" content="Example">
        <meta property="og:image" content="https://cdn.example/og.png">
        <meta name="twitter:title" content="Twitter title">
        <meta name="twitter:image" content="https://cdn.example/tw.png">
      </head></html>
    `;
    expect(
      parseLinkPreviewHtml(html, new URL("https://example.com/page")),
    ).toEqual({
      title: "OG title",
      description: "OG description",
      siteName: "Example",
      image: "https://cdn.example/og.png",
    });
  });

  it("skips non-https images and uses the hostname as site name", () => {
    const html = `
      <title>Docs</title>
      <meta name="twitter:description" content="Hello">
      <meta property="og:image" content="http://cdn.example/insecure.png">
    `;
    expect(
      parseLinkPreviewHtml(html, new URL("https://docs.example/x")),
    ).toEqual({
      title: "Docs",
      description: "Hello",
      siteName: "docs.example",
    });
  });

  it("reads content-first meta attribute order", () => {
    const html = `<meta content="Reversed" property="og:title">`;
    expect(
      parseLinkPreviewHtml(html, new URL("https://example.com")).title,
    ).toBe("Reversed");
  });
});
