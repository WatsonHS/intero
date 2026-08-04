import { describe, expect, it } from "vitest";

import {
  attachmentAttemptContextKey,
  attachmentMutationIdForAttempt,
  settleAttachmentMutation,
} from "./attachment-mutation.js";

describe("attachment mutation lifecycle", () => {
  it("reuses an id only while the request outcome is unresolved", () => {
    const pending = new Map<string, string>();
    const context = attachmentAttemptContextKey("project", "cursor");

    const first = attachmentMutationIdForAttempt(
      pending,
      context,
      () => "first-operation",
    );
    pending.set(context, first);
    settleAttachmentMutation(pending, context, "unresolved_error");

    expect(
      attachmentMutationIdForAttempt(
        pending,
        context,
        () => "second-operation",
      ),
    ).toBe("first-operation");
  });

  it.each(["completed", "cancelled", "terminal_error"] as const)(
    "creates a new attachment operation after %s",
    (outcome) => {
      const pending = new Map<string, string>();
      const context = attachmentAttemptContextKey("project", "grok-build");
      pending.set(context, "consumed-operation");

      settleAttachmentMutation(pending, context, outcome);

      expect(
        attachmentMutationIdForAttempt(
          pending,
          context,
          () => "next-operation",
        ),
      ).toBe("next-operation");
    },
  );

  it("keeps repair attempts distinct from a new same-client attachment", () => {
    expect(attachmentAttemptContextKey("project", "codex")).not.toBe(
      attachmentAttemptContextKey("project", "codex", "binding"),
    );
  });
});
