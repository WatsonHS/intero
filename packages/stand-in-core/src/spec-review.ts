import { createHash } from "node:crypto";

import type {
  PrincipalId,
  SpecBlock,
  SpecId,
  SpecRevision,
  SpecRevisionId,
  SpecReviewResponse,
} from "@intero/domain";
import { uuidv7 } from "@intero/domain";

function fingerprint(value: string): string {
  return createHash("sha256")
    .update(value.trim().replace(/\s+/g, " "))
    .digest("hex");
}

function blockKind(value: string): SpecBlock["kind"] {
  if (value.startsWith("#")) return "heading";
  if (value.startsWith("```")) return "code";
  if (/^[-*]\s/.test(value)) return "list";
  if (value.startsWith(">")) return "quote";
  if (value.includes("|")) return "table";
  return "paragraph";
}

export function parseSpecBlocks(markdown: string): SpecBlock[] {
  const chunks = markdown
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.map((chunk, ordinal) => {
    const hash = fingerprint(chunk);
    return {
      id: `block_${hash.slice(0, 20)}`,
      kind: blockKind(chunk),
      ordinal,
      fingerprint: hash,
    };
  });
}

export function createSpecRevision(input: {
  specId: SpecId;
  revision: number;
  markdown: string;
  changeSummary: string;
  affectedScopes: string[];
  createdBy: PrincipalId;
  now?: Date;
}): SpecRevision {
  return {
    id: uuidv7() as SpecRevisionId,
    specId: input.specId,
    revision: input.revision,
    markdown: input.markdown,
    blocks: parseSpecBlocks(input.markdown),
    changeSummary: input.changeSummary,
    affectedScopes: input.affectedScopes,
    createdBy: input.createdBy,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

export function invalidateAffectedReviews(
  responses: SpecReviewResponse[],
  nextRevision: SpecRevision,
  now = new Date(),
): SpecReviewResponse[] {
  const changed = new Set(nextRevision.affectedScopes);
  return responses.map((response) => {
    if (response.kind === "stand_in_impact_analysis") return response;
    if (!response.affectedScopes.some((scope) => changed.has(scope)))
      return response;
    return { ...response, invalidatedAt: now.toISOString() };
  });
}
