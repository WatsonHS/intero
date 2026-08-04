import { join } from "node:path";

/**
 * Cursor Agent is distinct from Cursor's editor `cursor` command. The first
 * candidate intentionally relies on PATH resolution; the second covers the
 * CLI's standard per-user installation location.
 */
export function cursorAgentExecutableCandidates(
  homeDirectory: string,
): string[] {
  return ["cursor-agent", join(homeDirectory, ".local/bin/cursor-agent")];
}

export function isCursorAgentAdapter(adapter: string): boolean {
  return adapter === "cursor";
}

/**
 * `cursor-agent mcp list` is a registry probe: configuration is usable when
 * the output contains the exact Intero server name, regardless of any runtime
 * connection status it may also display.
 */
export function cursorAgentMcpListHasIntero(output: string): boolean {
  return output.split(/\r?\n/).some((line) => {
    const normalized = line
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
      .trim()
      .replace(/^[-*•]\s*/, "");
    return /^intero(?:\s|:|$)/i.test(normalized);
  });
}
