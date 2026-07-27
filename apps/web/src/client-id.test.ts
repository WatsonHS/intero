import { describe, expect, it } from "vitest";

import { createClientUuid } from "./client-id.js";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("client UUID generation", () => {
  it("uses randomUUID when the browser provides it", () => {
    const expected = "019fa46c-a7c2-4c43-8497-bb4196094599";
    expect(
      createClientUuid({
        randomUUID: () => expected,
      }),
    ).toBe(expected);
  });

  it("falls back to getRandomValues in an HTTP browser context", () => {
    expect(
      createClientUuid({
        getRandomValues: (bytes) => {
          bytes.fill(0xab);
          return bytes;
        },
      }),
    ).toMatch(UUID_V4);
  });

  it("still returns a valid UUID when Web Crypto is unavailable", () => {
    expect(createClientUuid(null)).toMatch(UUID_V4);
  });
});
