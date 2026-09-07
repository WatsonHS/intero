import { afterEach, describe, expect, it, vi } from "vitest";

import { codexConnectionDeepLink, openCodexConnection } from "./deep-link.js";

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

describe("openCodexConnection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens the browser protocol in place without a blank popup", () => {
    const assign = vi.fn();
    const open = vi.fn();
    vi.stubGlobal("window", { location: { assign }, open });
    openCodexConnection("connect Project A");
    expect(assign).toHaveBeenCalledExactlyOnceWith(
      codexConnectionDeepLink("connect Project A"),
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("uses Desktop's external-app handler with the confirmed repository", () => {
    const assign = vi.fn();
    const open = vi.fn();
    vi.stubGlobal("window", { interoDesktop: {}, location: { assign }, open });
    openCodexConnection("connect Project A", "/tmp/repository a");
    expect(open).toHaveBeenCalledExactlyOnceWith(
      codexConnectionDeepLink("connect Project A", "/tmp/repository a"),
      "_blank",
      "noopener,noreferrer",
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it("lets the caller show its retry and copy fallback after launch rejection", () => {
    vi.stubGlobal("window", {
      location: {
        assign: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(() => openCodexConnection("connect")).toThrow("blocked");
  });
});
