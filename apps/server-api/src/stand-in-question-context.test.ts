import { describe, expect, it } from "vitest";

import { normalizeStandInQuestion } from "./stand-in-question-context.js";

describe("Stand-in question context", () => {
  it("separates a leading UI address from the semantic question", () => {
    expect(
      normalizeStandInQuestion({
        question: "@盛 的替身 hi",
        standInOwnerDisplayName: "盛",
        preferredLanguage: "zh-CN",
      }),
    ).toBe("hi");
  });

  it("turns an inline address into a second-person reference", () => {
    expect(
      normalizeStandInQuestion({
        question: "请问 @盛 的替身，你下一步准备做什么？",
        standInOwnerDisplayName: "盛",
        preferredLanguage: "zh-CN",
      }),
    ).toBe("请问 你，你下一步准备做什么？");
  });

  it("treats a bare address as a greeting", () => {
    expect(
      normalizeStandInQuestion({
        question: "@Alex's Stand-in",
        standInOwnerDisplayName: "Alex",
        preferredLanguage: "en-US",
      }),
    ).toBe("Hello");
  });
});
