import { describe, expect, it } from "vitest";

import { MessageId } from "./ids.js";
import {
  decodeMessageSearchCursor,
  encodeMessageSearchCursor,
  highlightSearchSnippet,
  applySearchFilter,
  mergeSearchFilters,
  parseSearchQuery,
  stripSearchFilter,
  tokenizeSearchText,
} from "./search.js";

describe("parseSearchQuery", () => {
  it("extracts Slack-style filters and leaves the remaining text", () => {
    const parsed = parseSearchQuery(
      'deploy in:"Launch room" from:"Alex Rivera" after:2026-08-01 before:2026-09-01 has:attachment',
    );
    expect(parsed).toEqual({
      text: "deploy",
      inTitle: "Launch room",
      fromDisplayName: "Alex Rivera",
      after: "2026-08-01",
      before: "2026-09-01",
      hasAttachment: true,
    });
  });

  it("treats UUID in: and from: values as identifiers", () => {
    const threadId = "019b5ac0-7600-7000-8000-0000000000aa";
    const principalId = "019b5ac0-7600-7000-8000-000000000002";
    const parsed = parseSearchQuery(`in:${threadId} from:${principalId} hello`);
    expect(parsed.inThreadId).toBe(threadId);
    expect(parsed.fromPrincipalId).toBe(principalId);
    expect(parsed.text).toBe("hello");
    expect(parsed.inTitle).toBeUndefined();
    expect(parsed.fromDisplayName).toBeUndefined();
  });

  it("ignores invalid dates and unknown has: values", () => {
    const parsed = parseSearchQuery(
      "status before:2026-13-40 after:not-a-date has:image",
    );
    expect(parsed).toEqual({ text: "status" });
  });

  it("applies and strips Slack-style filter tokens", () => {
    const withFrom = applySearchFilter("deploy", "from", "Alex Rivera");
    expect(withFrom).toBe('deploy from:"Alex Rivera"');
    expect(stripSearchFilter(withFrom, "from")).toBe("deploy");
  });

  it("lets explicit params override tokens parsed from the query", () => {
    const merged = mergeSearchFilters(
      parseSearchQuery("deploy in:old from:Priya"),
      {
        in: "019b5ac0-7600-7000-8000-0000000000aa",
        from: "Alex",
        has: "attachment",
        after: "2026-01-01",
      },
    );
    expect(merged.text).toBe("deploy");
    expect(merged.inThreadId).toBe("019b5ac0-7600-7000-8000-0000000000aa");
    expect(merged.inTitle).toBeUndefined();
    expect(merged.fromDisplayName).toBe("Alex");
    expect(merged.hasAttachment).toBe(true);
    expect(merged.after).toBe("2026-01-01");
  });
});

describe("search snippet helpers", () => {
  it("tokenizes letters and digits and wraps highlighted terms", () => {
    expect(tokenizeSearchText("Hello, 世界 42!")).toEqual([
      "hello",
      "世界",
      "42",
    ]);
    expect(
      highlightSearchSnippet("Please deploy the auth fix today", ["auth"]),
    ).toBe("Please deploy the <b>auth</b> fix today");
  });

  it("round-trips a message search cursor", () => {
    const cursor = {
      rank: 0.42,
      createdAt: "2026-09-01T12:00:00.000Z",
      id: MessageId.parse("019b5ac0-7600-7000-8000-0000000000bb"),
    };
    expect(
      decodeMessageSearchCursor(encodeMessageSearchCursor(cursor)),
    ).toEqual(cursor);
    expect(decodeMessageSearchCursor("not-a-cursor")).toBeUndefined();
  });
});
