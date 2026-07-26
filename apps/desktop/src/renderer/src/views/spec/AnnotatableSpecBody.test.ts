import { describe, expect, it } from "vitest";

import { highlightRuns, type Annotation } from "./AnnotatableSpecBody.js";

function annotation(patch: Partial<Annotation>): Annotation {
  return {
    threadId: "t1",
    lineStart: 1,
    lineEnd: 1,
    selection: "",
    status: "open",
    comments: [],
    ...patch,
  };
}

const TEXT = "confidence is optional in revision 3";

describe("highlightRuns", () => {
  it("splits the text around a character-level annotation", () => {
    const runs = highlightRuns(TEXT, [
      annotation({ charStart: 0, charEnd: 10, selection: "confidence" }),
    ]);

    expect(runs.map((run) => run.text)).toEqual([
      "confidence",
      " is optional in revision 3",
    ]);
    expect(runs[0]?.annotation?.threadId).toBe("t1");
    expect(runs[1]?.annotation).toBeUndefined();
  });

  it("keeps several annotations in document order", () => {
    const runs = highlightRuns(TEXT, [
      annotation({
        threadId: "b",
        charStart: 14,
        charEnd: 22,
        selection: "optional",
      }),
      annotation({
        threadId: "a",
        charStart: 0,
        charEnd: 10,
        selection: "confidence",
      }),
    ]);

    expect(
      runs
        .filter((run) => run.annotation)
        .map((run) => run.annotation?.threadId),
    ).toEqual(["a", "b"]);
  });

  it("drops an annotation whose recorded text no longer sits at its offsets", () => {
    // The revision was edited under the anchor. Highlighting the offsets anyway
    // would attach the comment to words nobody commented on.
    const runs = highlightRuns(TEXT, [
      annotation({ charStart: 0, charEnd: 10, selection: "durability" }),
    ]);

    expect(runs).toEqual([{ text: TEXT }]);
  });

  it("ignores offsets that run past the end of the text", () => {
    expect(
      highlightRuns(TEXT, [annotation({ charStart: 30, charEnd: 999 })]),
    ).toEqual([{ text: TEXT }]);
  });

  it("ignores a whole-block annotation, which the block wash renders instead", () => {
    expect(highlightRuns(TEXT, [annotation({})])).toEqual([{ text: TEXT }]);
  });

  it("keeps the first of two overlapping annotations", () => {
    const runs = highlightRuns(TEXT, [
      annotation({
        threadId: "a",
        charStart: 0,
        charEnd: 13,
        selection: TEXT.slice(0, 13),
      }),
      annotation({
        threadId: "b",
        charStart: 3,
        charEnd: 20,
        selection: TEXT.slice(3, 20),
      }),
    ]);

    expect(runs.map((run) => run.annotation?.threadId)).toEqual([
      "a",
      undefined,
    ]);
  });
});
