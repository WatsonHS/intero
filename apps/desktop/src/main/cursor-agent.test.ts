import { describe, expect, it } from "vitest";

import {
  cursorAgentExecutableCandidates,
  cursorAgentMcpListHasIntero,
  isCursorAgentAdapter,
} from "./cursor-agent.js";

describe("Cursor Agent desktop probe", () => {
  it("probes Cursor Agent on PATH and its standard local installation path", () => {
    expect(cursorAgentExecutableCandidates("/Users/example")).toEqual([
      "cursor-agent",
      "/Users/example/.local/bin/cursor-agent",
    ]);
  });

  it("recognizes the exact Intero MCP server in cursor-agent mcp list output", () => {
    expect(
      cursorAgentMcpListHasIntero("MCP servers:\n  intero: configured"),
    ).toBe(true);
    expect(
      cursorAgentMcpListHasIntero("MCP servers:\n  interop: configured"),
    ).toBe(false);
    expect(
      cursorAgentMcpListHasIntero("MCP servers:\n  intero-prod: configured"),
    ).toBe(false);
    expect(
      cursorAgentMcpListHasIntero("MCP servers:\n  team-intero: configured"),
    ).toBe(false);
  });

  it("identifies only the Cursor integration adapter", () => {
    expect(isCursorAgentAdapter("cursor")).toBe(true);
    expect(isCursorAgentAdapter("grok-build")).toBe(false);
  });
});
