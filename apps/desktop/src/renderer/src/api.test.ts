import { describe, expect, it } from "vitest";

import { getLocalRuntimeStatus, setModelEgress } from "./api.js";

describe("desktop local runtime client", () => {
  it("reports a truthful browser boundary when the Electron bridge is absent", async () => {
    await expect(getLocalRuntimeStatus()).resolves.toEqual({
      available: false,
      reason: "desktop_required",
    });
  });

  it("rejects policy writes when the Electron bridge is absent", async () => {
    await expect(setModelEgress("disabled")).rejects.toThrow(
      "requires Intero Desktop",
    );
  });
});
