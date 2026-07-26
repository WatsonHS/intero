import type { PrincipalId, SpecId, SpecReviewResponse } from "@intero/domain";
import { uuidv7 } from "@intero/domain";
import { describe, expect, it } from "vitest";

import {
  createSpecRevision,
  invalidateAffectedReviews,
} from "./spec-review.js";

describe("Spec Review", () => {
  it("keeps stable blocks and invalidates only affected human review", () => {
    const specId = uuidv7() as SpecId;
    const author = uuidv7() as PrincipalId;
    const first = createSpecRevision({
      specId,
      revision: 1,
      markdown: "# API\n\nKeep the endpoint stable.",
      changeSummary: "Initial revision",
      affectedScopes: ["api"],
      createdBy: author,
    });
    const second = createSpecRevision({
      specId,
      revision: 2,
      markdown:
        "# API\n\nKeep the endpoint stable.\n\nAdd a new response field.",
      changeSummary: "Add response field",
      affectedScopes: ["api"],
      createdBy: author,
    });
    expect(second.blocks[0]?.id).toBe(first.blocks[0]?.id);
    expect(second.blocks[1]?.id).toBe(first.blocks[1]?.id);

    const securityReview: SpecReviewResponse = {
      revisionId: first.id,
      reviewerId: uuidv7() as PrincipalId,
      kind: "human_approval",
      affectedScopes: ["security"],
      body: "Security boundary is unchanged.",
      createdAt: "2026-07-24T10:00:00.000Z",
    };
    const apiReview: SpecReviewResponse = {
      ...securityReview,
      reviewerId: uuidv7() as PrincipalId,
      affectedScopes: ["api"],
    };
    const [kept, invalidated] = invalidateAffectedReviews(
      [securityReview, apiReview],
      second,
    );
    expect(kept?.invalidatedAt).toBeUndefined();
    expect(invalidated?.invalidatedAt).toBeDefined();
  });
});
