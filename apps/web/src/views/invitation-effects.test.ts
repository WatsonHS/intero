import { describe, expect, it, vi } from "vitest";

import { runInvitationCreatedEffects } from "./invitation-effects.js";

describe("runInvitationCreatedEffects", () => {
  it("does not wait for clipboard or refresh work", async () => {
    let finishCopy: (() => void) | undefined;
    let finishRefresh: (() => void) | undefined;
    const copied = vi.fn();

    const result = runInvitationCreatedEffects({
      copyLink: () =>
        new Promise<void>((resolve) => {
          finishCopy = resolve;
        }),
      refresh: () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
      onCopySuccess: copied,
    });

    expect(result).toBeUndefined();
    expect(copied).not.toHaveBeenCalled();

    await Promise.resolve();
    finishCopy?.();
    finishRefresh?.();

    await vi.waitFor(() => expect(copied).toHaveBeenCalledOnce());
  });

  it("contains follow-up failures after an invitation succeeds", async () => {
    const copyFailed = vi.fn();

    runInvitationCreatedEffects({
      copyLink: async () => {
        throw new Error("clipboard denied");
      },
      refresh: async () => {
        throw new Error("refresh failed");
      },
      onCopyFailure: copyFailed,
    });

    await vi.waitFor(() => expect(copyFailed).toHaveBeenCalledOnce());
  });
});
