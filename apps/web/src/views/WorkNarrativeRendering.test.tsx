import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StandInAnswerContent } from "./CommunicationsView.js";
import { PilotWorkNarrativeContent } from "./TeamPulseView.js";

const narrative = {
  currentFocus: "正在准备账单导出供财务复核。",
  completedOutcome: "已生成首份完整账单 CSV。",
  evidence: ["预发环境成功导出 12,480 行发票。", "18 个导出用例全部通过。"],
  nextStep: "确认月度对账模板的列名。",
  collaboration: {
    needed: true,
    request: "确认税区和发票状态是否保留为独立列。",
    requestedFrom: "财务",
  },
};

describe("human-readable Coding Agent work rendering", () => {
  it("renders all five Team Pulse questions without progress or confidence noise", () => {
    const output = renderToStaticMarkup(
      <PilotWorkNarrativeContent narrative={narrative} />,
    );

    for (const label of [
      "正在做",
      "刚完成",
      "结果依据",
      "下一步",
      "需要协作",
    ]) {
      expect(output).toContain(label);
    }
    expect(output).toContain("12,480 行发票");
    expect(output).toContain("负责人：财务");
    expect(output).not.toContain("100%");
    expect(output).not.toContain("schemaVersion");
  });

  it("renders a grounded Stand-in answer as outcomes, not metadata", () => {
    const output = renderToStaticMarkup(
      <StandInAnswerContent
        answer={{
          answer: "账单导出已进入财务复核阶段。",
          currentStatus: narrative.currentFocus,
          completedOutcome: narrative.completedOutcome,
          evidence: narrative.evidence,
          nextStep: narrative.nextStep,
          neededCollaboration: "需要财务确认税区和发票状态是否保留为独立列。",
        }}
      />,
    );

    for (const label of [
      "当前状态",
      "已完成",
      "结果依据",
      "下一步",
      "需要协作",
    ]) {
      expect(output).toContain(label);
    }
    expect(output).not.toContain("Work State");
    expect(output).not.toContain("clientEventId");
  });
});
