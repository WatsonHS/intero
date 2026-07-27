import { describe, expect, it } from "vitest";

import { resolveInteroApiUrl } from "./api-url.js";

describe("Intero API URL resolution", () => {
  it("uses the matching API host during direct Vite development", () => {
    expect(
      resolveInteroApiUrl(undefined, {
        hostname: "127.0.0.1",
        origin: "http://127.0.0.1:5173",
        port: "5173",
        protocol: "http:",
      }),
    ).toBe("http://127.0.0.1:4310");
  });

  it("uses the Caddy origin when the page is reverse proxied", () => {
    expect(
      resolveInteroApiUrl(undefined, {
        hostname: "127.0.0.1",
        origin: "http://127.0.0.1:4311",
        port: "4311",
        protocol: "http:",
      }),
    ).toBe("http://127.0.0.1:4311");
  });

  it("keeps an explicit deployment URL authoritative", () => {
    expect(
      resolveInteroApiUrl("https://intero.example.com/", {
        hostname: "127.0.0.1",
        origin: "http://127.0.0.1:5173",
        port: "5173",
        protocol: "http:",
      }),
    ).toBe("https://intero.example.com");
  });
});
