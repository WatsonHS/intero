import { describe, expect, it } from "vitest";

import { recognizeClientInfoName } from "./index.js";

describe("MCP clientInfo recognition", () => {
  it("recognizes the observed name each supported client sends", () => {
    // Names observed in the published MCP client index, keyed by
    // `clientInfo.name` (apify/mcp-client-capabilities).
    expect(recognizeClientInfoName("Codex")).toBe("codex");
    expect(recognizeClientInfoName("codex-mcp-client")).toBe("codex");
    expect(recognizeClientInfoName("claude-code")).toBe("claude-code");
    expect(recognizeClientInfoName("opencode")).toBe("opencode");
    expect(recognizeClientInfoName("cursor-vscode")).toBe("cursor");
    expect(recognizeClientInfoName("grok-build")).toBe("grok-build");
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(recognizeClientInfoName("CURSOR-VSCODE")).toBe("cursor");
    expect(recognizeClientInfoName("  Claude-Code  ")).toBe("claude-code");
    expect(recognizeClientInfoName("OpenCode")).toBe("opencode");
  });

  it("accepts a recognized prefix only at a separator boundary", () => {
    expect(
      recognizeClientInfoName("cursor-vscode (via mcp-remote 0.1.18)"),
    ).toBe("cursor");
    expect(recognizeClientInfoName("codex.cli")).toBe("codex");
    expect(recognizeClientInfoName("cursor agent")).toBe("cursor");
    expect(recognizeClientInfoName("codexample")).toBeNull();
    expect(recognizeClientInfoName("opencoder")).toBeNull();
    expect(recognizeClientInfoName("grokking")).toBeNull();
  });

  it("does not answer for names it cannot attribute with confidence", () => {
    expect(recognizeClientInfoName("")).toBeNull();
    expect(recognizeClientInfoName("   ")).toBeNull();
    expect(recognizeClientInfoName("mcp-inspector")).toBeNull();
    expect(recognizeClientInfoName("Visual Studio Code")).toBeNull();
    expect(recognizeClientInfoName("Windsurf")).toBeNull();
    expect(recognizeClientInfoName("my-internal-agent")).toBeNull();
  });

  it("keeps Claude Desktop distinct from Claude Code", () => {
    // `claude-ai` is Claude Desktop and claude.ai, a different client from
    // `claude-code`. A bare `claude` prefix would misattribute it and block a
    // legitimate session, so only the full name is recognized.
    expect(recognizeClientInfoName("claude-ai")).toBeNull();
    expect(recognizeClientInfoName("claude")).toBeNull();
    expect(recognizeClientInfoName("claude-desktop")).toBeNull();
  });
});
