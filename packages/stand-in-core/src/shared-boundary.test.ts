import {
  type PilotSharedBoundaryClaim,
  PrincipalId,
  ProjectId,
  uuidv7,
} from "@intero/domain";
import { describe, expect, it } from "vitest";

import {
  activeSharedBoundaryClaims,
  evaluateAuthorizedSharedBoundaryClaims,
  evaluateSharedBoundaryClaims,
  matchSharedBoundaryClaims,
  normalizeSharedBoundaryKey,
} from "./shared-boundary.js";

const PROJECT = ProjectId.parse(uuidv7());
const ALEX = PrincipalId.parse(uuidv7());
const PRIYA = PrincipalId.parse(uuidv7());
const NOW = "2026-07-31T08:00:00.000Z";

describe("shared boundary matcher", () => {
  it("normalizes semantic keys without accepting natural-language matching", () => {
    expect(normalizeSharedBoundaryKey(" API:Retry-Config/Field-Name ")).toBe(
      "api:retry-config/field-name",
    );
  });

  it("keeps the compatible control quiet when the dependency is preserved", () => {
    const match = matchSharedBoundaryClaims(
      claim(ALEX, {
        relation: "changing",
        change: "compatible",
        assumption: "rename retry delay",
        preserves: ["retryDelayMs"],
      }),
      claim(PRIYA, {
        relation: "depending_on",
        change: "unknown",
        assumption: "retryDelayMs",
      }),
    );
    expect(match).toMatchObject({ classification: "compatible" });
  });

  it("detects a breaking producer change against an active consumer assumption", () => {
    const match = matchSharedBoundaryClaims(
      claim(ALEX, {
        relation: "changing",
        change: "breaking",
        assumption: "replace retry delay",
        preserves: ["retryAfterMs"],
      }),
      claim(PRIYA, {
        relation: "depending_on",
        change: "unknown",
        assumption: "retryDelayMs",
      }),
    );
    expect(match).toMatchObject({
      boundaryKey: "api:retry-config/field-name",
      classification: "potential_conflict",
    });
  });

  it("retains unknown changes as insufficient evidence", () => {
    const match = matchSharedBoundaryClaims(
      claim(ALEX, {
        relation: "changing",
        change: "unknown",
        assumption: "retry delay may change",
      }),
      claim(PRIYA, {
        relation: "validating",
        change: "unknown",
        assumption: "retryDelayMs",
      }),
    );
    expect(match).toMatchObject({ classification: "insufficient_evidence" });
  });

  it("compares different Projects only through an explicit authorized scope", () => {
    const otherProject = ProjectId.parse(uuidv7());
    const producer = claim(ALEX, {
      relation: "changing",
      change: "breaking",
      assumption: "replace retry delay",
    });
    const consumer = {
      ...claim(PRIYA, {
        relation: "depending_on",
        change: "unknown",
        assumption: "retryDelayMs",
      }),
      projectId: otherProject,
    };

    expect(matchSharedBoundaryClaims(producer, consumer)).toBeUndefined();
    expect(
      evaluateAuthorizedSharedBoundaryClaims(
        [producer, consumer],
        [PROJECT, otherProject],
        NOW,
      ),
    ).toMatchObject([{ classification: "potential_conflict" }]);
    expect(
      evaluateAuthorizedSharedBoundaryClaims(
        [producer, consumer],
        [PROJECT],
        NOW,
      ),
    ).toEqual([]);
  });

  it("excludes same-owner, superseded, withdrawn, stale, and future claims", () => {
    const active = claim(ALEX, {
      relation: "changing",
      change: "breaking",
      assumption: "replace retry delay",
    });
    const sameOwner = claim(ALEX, {
      relation: "depending_on",
      change: "unknown",
      assumption: "retryDelayMs",
    });
    expect(evaluateSharedBoundaryClaims([active, sameOwner], NOW)).toEqual([]);

    const consumer = claim(PRIYA, {
      relation: "depending_on",
      change: "unknown",
      assumption: "retryDelayMs",
    });
    expect(
      activeSharedBoundaryClaims(
        [
          { ...active, supersededAt: NOW },
          { ...consumer, withdrawnAt: NOW },
          {
            ...consumer,
            id: uuidv7(),
            observedAt: "2026-07-29T07:59:59.000Z",
          },
          {
            ...consumer,
            id: uuidv7(),
            observedAt: "2026-07-31T08:06:00.000Z",
          },
        ],
        NOW,
      ),
    ).toEqual([]);
  });
});

function claim(
  ownerId: PilotSharedBoundaryClaim["ownerId"],
  input: Pick<
    PilotSharedBoundaryClaim,
    "relation" | "change" | "assumption"
  > & { preserves?: string[] },
): PilotSharedBoundaryClaim {
  return {
    id: uuidv7(),
    projectId: PROJECT,
    workStateId: uuidv7(),
    ownerId,
    bindingId: uuidv7(),
    checkpointClientEventId: `checkpoint-${uuidv7()}`,
    key: "api:retry-config/field-name",
    kind: "api",
    relation: input.relation,
    assumption: input.assumption,
    change: input.change,
    preserves: input.preserves ?? [],
    revision: 1,
    observedAt: "2026-07-31T07:30:00.000Z",
    createdAt: "2026-07-31T07:30:00.000Z",
  };
}
