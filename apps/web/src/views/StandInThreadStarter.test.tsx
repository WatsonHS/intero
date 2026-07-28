import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StandInThreadStarter } from "./CommunicationsView.js";

describe("StandInThreadStarter", () => {
  it("keeps the personal Stand-in entry visible before a Thread exists", () => {
    const output = renderToStaticMarkup(
      <StandInThreadStarter
        title="会话用户 的替身"
        label="开始对话"
        busy={false}
        disabled={false}
        ownerId="019f9ba4-3108-7000-8000-000000000001"
        ownerName="会话用户"
        onSelect={() => undefined}
      />,
    );

    expect(output).toContain('data-testid="personal-stand-in-conversation"');
    expect(output).toContain("会话用户 的替身");
    expect(output).toContain("开始对话");
    expect(output).toContain(">会话<");
    expect(output).not.toContain(">IR<");
    expect(output).toContain("rounded-[9px_13px_9px_9px]");
    expect(output).not.toMatch(/^<button[^>]*\sdisabled=/);
  });

  it("prevents duplicate creation while the Thread request is pending", () => {
    const output = renderToStaticMarkup(
      <StandInThreadStarter
        title="Your Stand-in"
        label="Start the thread"
        busy
        disabled={false}
        ownerId="019f9ba4-3108-7000-8000-000000000001"
        ownerName="Alex Morgan"
        onSelect={() => undefined}
      />,
    );

    expect(output).toMatch(/^<button[^>]*\sdisabled=""/);
  });
});
