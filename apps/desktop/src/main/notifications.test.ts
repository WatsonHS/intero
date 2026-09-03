import { describe, expect, it } from "vitest";

import { parseDesktopNotifyRequest } from "./notify-request.js";

describe("desktop notification IPC payload", () => {
  it("accepts a title, optional body, and navigation pointers", () => {
    expect(
      parseDesktopNotifyRequest({
        title: "New message in Room",
        body: "Please review",
        tag: "intero-message-1",
        threadId: "019fb800-0000-7000-8000-000000000010",
      }),
    ).toEqual({
      title: "New message in Room",
      body: "Please review",
      tag: "intero-message-1",
      threadId: "019fb800-0000-7000-8000-000000000010",
    });
  });

  it("rejects an empty title and oversized bodies", () => {
    expect(() => parseDesktopNotifyRequest({ title: "" })).toThrow(
      "A notification title is required.",
    );
    expect(() =>
      parseDesktopNotifyRequest({ title: "Hi", body: "x".repeat(501) }),
    ).toThrow("too long");
  });
});
