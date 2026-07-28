import { describe, expect, it } from "vitest";
import { PILOT_AGENT_CONFIGURATION_VERSION } from "@intero/domain";

import { deriveFirstUseProgress } from "./first-use-progress.js";

describe("deriveFirstUseProgress", () => {
  it("never completes a step without matching backend state", () => {
    expect(
      deriveFirstUseProgress({ teams: [], overviews: [], specs: [] }),
    ).toEqual({
      invitedMember: false,
      connectedAgent: false,
      receivedCheckpoint: false,
      teamPulseVisible: false,
      completedSpecReview: false,
      completed: 0,
      total: 5,
    });
  });

  it("derives the full first-value loop from durable records", () => {
    const progress = deriveFirstUseProgress({
      teams: [
        {
          id: "team",
          name: "Platform",
          createdAt: "2026-07-29T00:00:00.000Z",
          members: [
            {
              id: "019b5ac0-7600-7000-8000-000000000002" as never,
              displayName: "Alex",
              email: "alex@example.test",
              kind: "human",
              teamRole: "leader",
            },
            {
              id: "019b5ac0-7600-7000-8000-000000000004" as never,
              displayName: "Priya",
              email: "priya@example.test",
              kind: "human",
              teamRole: "member",
            },
          ],
        } as never,
      ],
      overviews: [
        {
          bindings: [
            {
              id: "binding",
              configurationVersion: PILOT_AGENT_CONFIGURATION_VERSION,
              validatedAt: "2026-07-29T00:01:00.000Z",
              activityUpdatedAt: "2026-07-29T00:02:00.000Z",
            },
          ],
          privateWorkState: [{ id: "work-state" }],
          pulse: [{ id: "pulse" }],
        } as never,
      ],
      specs: [
        {
          spec: { status: "approved" },
          confirmations: [],
        } as never,
      ],
    });

    expect(progress.completed).toBe(5);
    expect(progress).toMatchObject({
      invitedMember: true,
      connectedAgent: true,
      receivedCheckpoint: true,
      teamPulseVisible: true,
      completedSpecReview: true,
    });
  });
});
