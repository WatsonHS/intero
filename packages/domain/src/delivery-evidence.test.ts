import { describe, expect, it } from "vitest";

import {
  DeliveryEvidence,
  deliveryEvidenceStatus,
} from "./delivery-evidence.js";

const sha = "a".repeat(40);
const check = {
  name: "CI",
  commitSha: sha,
  url: "https://github.com/example/repo/actions/runs/1",
  observedAt: "2026-09-06T01:00:00.000Z",
  status: "passed" as const,
};
const evidence = {
  repository: "example/repo",
  commitSha: sha,
  checks: [check],
};

describe("delivery evidence", () => {
  it("keeps a passing check attributed to the Agent report", () => {
    expect(deliveryEvidenceStatus(DeliveryEvidence.parse(evidence))).toBe(
      "reported_passed",
    );
  });

  it("does not reuse passing checks from a different commit", () => {
    expect(
      deliveryEvidenceStatus({ ...evidence, commitSha: "b".repeat(40) }),
    ).toBe("unverified");
    expect(deliveryEvidenceStatus({ ...evidence, checks: [] })).toBe(
      "unverified",
    );
  });

  it("does not let a success hide a failed, pending, or skipped check", () => {
    for (const [status, expected] of [
      ["failed", "reported_failed"],
      ["pending", "reported_pending"],
      ["skipped", "unverified"],
      ["cancelled", "unverified"],
    ] as const) {
      expect(
        deliveryEvidenceStatus({
          ...evidence,
          checks: [check, { ...check, name: "other", status }],
        }),
      ).toBe(expected);
    }
  });

  it("rejects ambiguous commits, credentials, raw payloads, and unsafe links", () => {
    expect(
      DeliveryEvidence.safeParse({ ...evidence, commitSha: "abcdef1" }).success,
    ).toBe(false);
    expect(
      DeliveryEvidence.safeParse({ ...evidence, logs: "raw output" }).success,
    ).toBe(false);
    for (const pullRequestUrl of [
      "not a URL",
      "http://example.com/pr/1",
      "file:///tmp/pr",
      "https://token@example.com/pr/1",
      "https://example.com/pr/1?token=secret",
      "https://example.com/pr/1#secret",
    ]) {
      expect(
        DeliveryEvidence.safeParse({ ...evidence, pullRequestUrl }).success,
      ).toBe(false);
    }
  });

  it("accepts older checkpoints without structured delivery evidence", () => {
    expect(
      DeliveryEvidence.parse({ repository: "example/repo", commitSha: sha })
        .checks,
    ).toEqual([]);
  });
});
