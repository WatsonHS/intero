import { describe, expect, it } from "vitest";

import { chunkPresenceIds, PRESENCE_REQUEST_LIMIT } from "./usePresence.js";

describe("chunkPresenceIds", () => {
  it("returns no chunks for no ids", () => {
    expect(chunkPresenceIds([])).toEqual([]);
  });

  it("keeps a small list in one request", () => {
    expect(chunkPresenceIds(["a", "b"])).toEqual([["a", "b"]]);
  });

  it("splits a directory with more principals than the API limit", () => {
    const ids = Array.from({ length: PRESENCE_REQUEST_LIMIT + 3 }, (_, i) =>
      String(i),
    );
    const chunks = chunkPresenceIds(ids);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(PRESENCE_REQUEST_LIMIT);
    expect(chunks[1]).toEqual([
      String(PRESENCE_REQUEST_LIMIT),
      String(PRESENCE_REQUEST_LIMIT + 1),
      String(PRESENCE_REQUEST_LIMIT + 2),
    ]);
  });
});
