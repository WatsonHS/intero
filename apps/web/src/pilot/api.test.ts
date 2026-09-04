import { afterEach, describe, expect, it, vi } from "vitest";

import { isPilotBrowser } from "./api.js";

describe("isPilotBrowser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("enables the product in every browser runtime", () => {
    vi.stubGlobal("window", {});
    expect(isPilotBrowser()).toBe(true);
  });

  it("stays disabled during server rendering", () => {
    vi.stubGlobal("window", undefined);
    expect(isPilotBrowser()).toBe(false);
  });
});
