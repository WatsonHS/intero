import { describe, expect, it } from "vitest";

import { safeSemanticMetadata } from "./hook.js";

describe("hook privacy boundary", () => {
  it("turns a session start into a generic semantic checkpoint", () => {
    expect(safeSemanticMetadata("SessionStart")).toEqual({
      phase: "SessionStart",
      checkpointKind: "intent",
      summary: "Coding Agent session started in an enrolled Workspace.",
    });
  });

  it("classifies tool resources without retaining hook payloads", () => {
    expect(safeSemanticMetadata("PostToolUse", "WriteFile")).toEqual({
      phase: "PostToolUse",
      resourceKind: "file",
    });
  });

  it("records only the outcome class for tool failures", () => {
    expect(safeSemanticMetadata("PostToolUseFailure", "RunTests")).toEqual({
      phase: "PostToolUseFailure",
      checkpointKind: "validation",
      summary: "A Coding Agent tool reported a failure.",
      validationStatus: "failed",
      resourceKind: "artifact",
    });
  });
});
