import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GitAwarenessSettings } from "./GitAwarenessSettings.js";

describe("GitAwarenessSettings", () => {
  it("keeps browser rendering clearly unavailable and local-only", () => {
    const output = renderToStaticMarkup(
      <GitAwarenessSettings
        projectName="客户门户"
        connectedClients={["codex"]}
        onBindAgent={() => undefined}
      />,
    );

    expect(output).toContain("桌面 Git 感知");
    expect(output).toContain("浏览器端不会读取本机仓库");
    expect(output).not.toContain("选择仓库");
  });
});
