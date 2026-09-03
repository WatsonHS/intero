import { PrincipalId } from "@intero/domain";
import { describe, expect, it } from "vitest";

import type { PrincipalSummary, ThreadPayload } from "../../api.js";
import {
  buildPrincipalNames,
  collectPrincipals,
  ownerNameFor,
} from "./helpers.js";
import { replyMessageSummary } from "./format.js";

const aliceId = PrincipalId.parse("019f9ba4-3108-7000-8000-000000000001");
const bobId = PrincipalId.parse("019f9ba4-3108-7000-8000-000000000002");

const alice: PrincipalSummary = {
  id: aliceId,
  displayName: "Alice",
  kind: "human",
};
const bob: PrincipalSummary = {
  id: bobId,
  displayName: "Bob",
  kind: "human",
};
const aliceDuplicate: PrincipalSummary = {
  id: PrincipalId.parse("019f9ba4-3108-7000-8000-000000000003"),
  displayName: "Alice",
  kind: "human",
};

describe("collectPrincipals", () => {
  it("deduplicates by id and sorts by display name", () => {
    const thread = {
      principals: [bob, alice],
    } as ThreadPayload;

    expect(
      collectPrincipals([thread], [alice], [undefined, alice]).map(
        (principal) => principal.id,
      ),
    ).toEqual([aliceId, bobId]);
  });
});

describe("buildPrincipalNames", () => {
  it("keeps unique names and disambiguates duplicates with the id suffix", () => {
    expect(buildPrincipalNames([alice, bob]).get(aliceId)).toBe("Alice");
    expect(
      buildPrincipalNames([alice, aliceDuplicate]).get(aliceDuplicate.id),
    ).toBe(`Alice · ${aliceDuplicate.id.slice(-4)}`);
  });
});

describe("ownerNameFor", () => {
  it("returns the first human participant display name", () => {
    expect(
      ownerNameFor(
        {
          participantIds: [aliceId, bobId],
          standInIds: [],
        },
        new Map([[aliceId, "Alice"]]),
      ),
    ).toBe("Alice");
  });

  it("falls back when no human participant exists", () => {
    expect(
      ownerNameFor(
        {
          participantIds: [aliceId],
          standInIds: [aliceId],
        },
        new Map(),
      ),
    ).toBe("—");
  });
});

describe("replyMessageSummary", () => {
  const labels = {
    attachment: "attachment",
    pdf: "pdf",
    encrypted: "encrypted",
    unavailable: "unavailable",
  };

  it("returns unavailable when the quoted message is missing", () => {
    expect(replyMessageSummary(undefined, labels)).toBe("unavailable");
  });

  it("returns encrypted when the body is not server-readable", () => {
    expect(
      replyMessageSummary(
        {
          serverReadable: false,
          body: "secret",
        } as Parameters<typeof replyMessageSummary>[0],
        labels,
      ),
    ).toBe("encrypted");
  });

  it("collapses whitespace in the body", () => {
    expect(
      replyMessageSummary(
        {
          serverReadable: true,
          body: "  hello   world  ",
        } as Parameters<typeof replyMessageSummary>[0],
        labels,
      ),
    ).toBe("hello world");
  });

  it("uses the attachment label when the body is empty", () => {
    expect(
      replyMessageSummary(
        {
          serverReadable: true,
          body: "  ",
          attachments: [{ id: "a" }],
        } as Parameters<typeof replyMessageSummary>[0],
        labels,
      ),
    ).toBe("attachment");
  });

  it("uses the pdf label for PDF-only messages", () => {
    expect(
      replyMessageSummary(
        {
          serverReadable: true,
          body: "",
          attachments: [{ id: "a", contentType: "application/pdf" }],
        } as Parameters<typeof replyMessageSummary>[0],
        labels,
      ),
    ).toBe("pdf");
  });
});
