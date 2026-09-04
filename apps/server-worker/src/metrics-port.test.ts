import { describe, expect, it } from "vitest";

import {
  isListenAddressInUse,
  metricsPortConflictDecision,
} from "./metrics-port.js";

describe("metricsPortConflictDecision", () => {
  it("fails fast in product and warns in development", () => {
    expect(metricsPortConflictDecision("product")).toBe("rethrow");
    expect(metricsPortConflictDecision("development")).toBe("warn");
  });
});

describe("isListenAddressInUse", () => {
  it("detects EADDRINUSE and ignores other failures", () => {
    expect(isListenAddressInUse({ code: "EADDRINUSE" })).toBe(true);
    expect(isListenAddressInUse({ code: "EACCES" })).toBe(false);
    expect(isListenAddressInUse(new Error("listen failed"))).toBe(false);
    expect(isListenAddressInUse(undefined)).toBe(false);
  });
});
