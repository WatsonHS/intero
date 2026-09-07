import { z } from "zod";

const commitSha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i);
const evidenceUrl = z
  .url()
  .max(500)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, "Use an HTTPS evidence link without credentials, query parameters, or fragments.");

/** References only. These are Agent reports, never independent verification. */
export const DeliveryEvidence = z
  .object({
    repository: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/),
    commitSha,
    branch: z.string().min(1).max(160).optional(),
    pullRequestUrl: evidenceUrl.optional(),
    checks: z
      .array(
        z
          .object({
            name: z.string().min(1).max(120),
            status: z.enum([
              "pending",
              "passed",
              "failed",
              "skipped",
              "cancelled",
            ]),
            commitSha,
            url: evidenceUrl,
            observedAt: z.iso.datetime(),
          })
          .strict(),
      )
      .max(10)
      .default([]),
  })
  .strict();
export type DeliveryEvidence = z.infer<typeof DeliveryEvidence>;

export function deliveryEvidenceStatus(evidence: DeliveryEvidence) {
  const checks = evidence.checks.filter(
    (check) =>
      check.commitSha.toLowerCase() === evidence.commitSha.toLowerCase(),
  );
  if (checks.some((check) => check.status === "failed"))
    return "reported_failed";
  if (checks.some((check) => check.status === "pending"))
    return "reported_pending";
  if (checks.length > 0 && checks.every((check) => check.status === "passed")) {
    return "reported_passed";
  }
  return "unverified";
}
