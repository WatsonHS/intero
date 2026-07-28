import type { OrganizationId, PrincipalId } from "@intero/domain";
import { describe, expect, it } from "vitest";

import { parseActionInboxChangedEvent } from "./action-inbox-events.js";

describe("Action Inbox events", () => {
  it("accepts the bounded wake-up payload emitted by PostgreSQL", () => {
    expect(
      parseActionInboxChangedEvent(
        JSON.stringify({
          organizationId: "019b5ac0-7600-7000-8000-000000000001",
          principalId: "019b5ac0-7600-7000-8000-000000000002",
          reason: "action_inbox",
          occurredAt: "2026-07-28T05:00:00.000Z",
        }),
      ),
    ).toEqual({
      organizationId: "019b5ac0-7600-7000-8000-000000000001" as OrganizationId,
      principalId: "019b5ac0-7600-7000-8000-000000000002" as PrincipalId,
      reason: "action_inbox",
      occurredAt: "2026-07-28T05:00:00.000Z",
    });
  });

  it("rejects malformed or unexpectedly broad payloads", () => {
    expect(parseActionInboxChangedEvent(undefined)).toBeUndefined();
    expect(parseActionInboxChangedEvent("not-json")).toBeUndefined();
    expect(
      parseActionInboxChangedEvent(
        JSON.stringify({
          organizationId: "organization",
          principalId: "principal",
          reason: "message_contents",
          occurredAt: "now",
          detail: "must not cross the notification channel",
        }),
      ),
    ).toBeUndefined();
  });
});
