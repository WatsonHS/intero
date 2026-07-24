import { z } from "zod";

import {
  DecisionId,
  PrincipalId,
  SpecId,
  SpecRevisionId,
  ThreadId,
  WorkstreamId,
} from "./ids.js";

export const SpecBlock = z
  .object({
    id: z.string().min(8).max(80),
    kind: z.enum(["heading", "paragraph", "list", "code", "quote", "table"]),
    ordinal: z.number().int().nonnegative(),
    fingerprint: z.string().min(8).max(128),
  })
  .strict();
export type SpecBlock = z.infer<typeof SpecBlock>;

export const SpecRevision = z
  .object({
    id: SpecRevisionId,
    specId: SpecId,
    revision: z.number().int().positive(),
    markdown: z.string().max(500_000),
    blocks: z.array(SpecBlock),
    changeSummary: z.string().max(2_000),
    affectedScopes: z.array(z.string().max(300)),
    createdBy: PrincipalId,
    createdAt: z.iso.datetime(),
  })
  .strict();
export type SpecRevision = z.infer<typeof SpecRevision>;

export const ReviewResponseKind = z.enum([
  "representative_impact_analysis",
  "human_acknowledgement",
  "human_approval",
  "human_conditional_approval",
  "human_changes_requested",
]);
export type ReviewResponseKind = z.infer<typeof ReviewResponseKind>;

export const SpecReviewResponse = z
  .object({
    revisionId: SpecRevisionId,
    reviewerId: PrincipalId,
    kind: ReviewResponseKind,
    affectedScopes: z.array(z.string().max(300)),
    body: z.string().max(8_000),
    createdAt: z.iso.datetime(),
    invalidatedAt: z.iso.datetime().optional(),
  })
  .strict();
export type SpecReviewResponse = z.infer<typeof SpecReviewResponse>;

export const Spec = z
  .object({
    id: SpecId,
    title: z.string().min(1).max(240),
    currentRevisionId: SpecRevisionId,
    reviewThreadId: ThreadId.optional(),
    relatedWorkstreamIds: z.array(WorkstreamId),
    status: z.enum([
      "draft",
      "in_review",
      "approved",
      "changes_requested",
      "superseded",
    ]),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type Spec = z.infer<typeof Spec>;

export const DecisionRecord = z
  .object({
    id: DecisionId,
    title: z.string().min(1).max(240),
    outcome: z.string().min(1).max(16_000),
    sourceSpecRevisionId: SpecRevisionId.optional(),
    sourceThreadId: ThreadId.optional(),
    affectedScopes: z.array(z.string().max(300)),
    decidedBy: z.array(PrincipalId).min(1),
    supersedes: DecisionId.optional(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DecisionRecord = z.infer<typeof DecisionRecord>;
