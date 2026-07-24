import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  hookShouldCollect,
  isAllowedWorkspace,
  safeSemanticMetadata,
} from "./hook.js";

describe("hook privacy boundary", () => {
  it("retains only the lifecycle event class for a session start", () => {
    expect(safeSemanticMetadata("SessionStart")).toEqual({
      phase: "SessionStart",
    });
  });

  it("maps lifecycle termination to pause rather than completion", () => {
    expect(safeSemanticMetadata("SessionEnd")).toEqual({
      phase: "SessionEnd",
      checkpointKind: "pause",
    });
  });

  it("ignores Agent sessions created by Intero configuration probes", () => {
    expect(hookShouldCollect({ INTERO_INTEGRATION_PROBE: "1" })).toBe(false);
    expect(hookShouldCollect({})).toBe(true);
  });

  it("rejects an unregistered cwd before opening daemon transport", async () => {
    const directory = await mkdtemp(join(tmpdir(), "intero-allowlist-"));
    const enrolled = join(directory, "enrolled");
    const unknown = join(directory, "unknown");
    await mkdir(enrolled);
    await mkdir(unknown);
    const allowlist = join(directory, "workspace-allowlist.json");
    await writeFile(
      allowlist,
      JSON.stringify({
        schemaVersion: 1,
        workspaces: [
          {
            root: await realpath(enrolled),
            repositoryIdentity: "repo:test",
          },
        ],
      }),
    );

    await expect(isAllowedWorkspace(enrolled, allowlist)).resolves.toBe(true);
    await expect(isAllowedWorkspace(unknown, allowlist)).resolves.toBe(false);
  });
});
