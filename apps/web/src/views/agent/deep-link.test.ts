import { describe, expect, it } from "vitest";

import { codexConnectionDeepLink } from "./deep-link.js";

describe("codexConnectionDeepLink", () => {
  it("encodes the setup prompt for a Codex GUI task", () => {
    const link = codexConnectionDeepLink("连接 Project A\n不要回显凭证");
    expect(link).toBe(
      "codex://threads/new?prompt=%E8%BF%9E%E6%8E%A5+Project+A%0A%E4%B8%8D%E8%A6%81%E5%9B%9E%E6%98%BE%E5%87%AD%E8%AF%81",
    );
  });

  it("includes an explicitly selected local checkout when available", () => {
    const link = codexConnectionDeepLink("connect", "/tmp/example repo");
    expect(link).toContain("prompt=connect");
    expect(link).toContain("path=%2Ftmp%2Fexample+repo");
  });
});
