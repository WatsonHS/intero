import { describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "./copy-text.js";

describe("copyTextToClipboard", () => {
  it("uses the Clipboard API when it succeeds", async () => {
    const writeText = vi.fn(async () => undefined);
    const fallbackCopy = vi.fn(() => true);

    await copyTextToClipboard("connection task", {
      writeText,
      fallbackCopy,
    });

    expect(writeText).toHaveBeenCalledWith("connection task");
    expect(fallbackCopy).not.toHaveBeenCalled();
  });

  it("falls back to selection copy when Clipboard API access is rejected", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    const fallbackCopy = vi.fn(() => true);

    await copyTextToClipboard("connection task", {
      writeText,
      fallbackCopy,
    });

    expect(fallbackCopy).toHaveBeenCalledWith("connection task");
  });

  it("reports failure when neither copy mechanism works", async () => {
    await expect(
      copyTextToClipboard("connection task", {
        fallbackCopy: () => false,
      }),
    ).rejects.toThrow("Clipboard copy was rejected.");
  });

  it("falls back when the Clipboard API never settles", async () => {
    vi.useFakeTimers();
    try {
      const fallbackCopy = vi.fn(() => true);
      const copy = copyTextToClipboard("invitation link", {
        writeText: () => new Promise<void>(() => undefined),
        fallbackCopy,
        writeTimeoutMs: 25,
      });

      await vi.advanceTimersByTimeAsync(25);
      await expect(copy).resolves.toBeUndefined();
      expect(fallbackCopy).toHaveBeenCalledWith("invitation link");
    } finally {
      vi.useRealTimers();
    }
  });
});
