import { describe, expect, it } from "vitest";

import {
  assertSafeUnfurlTarget,
  assertUnfurlUrlShape,
  isBlockedAddress,
  UnfurlBlockedError,
} from "./unfurl-guard.js";

describe("unfurl SSRF guard", () => {
  it.each([
    ["127.0.0.1", true],
    ["127.0.0.2", true],
    ["10.0.0.1", true],
    ["10.255.255.255", true],
    ["172.16.0.1", true],
    ["172.31.255.1", true],
    ["172.32.0.1", false],
    ["192.168.1.1", true],
    ["169.254.169.254", true],
    ["169.254.0.1", true],
    ["100.64.0.1", true],
    ["0.0.0.0", true],
    ["192.0.2.1", true],
    ["198.51.100.1", true],
    ["203.0.113.1", true],
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["::1", true],
    ["::", true],
    ["::ffff:127.0.0.1", true],
    ["::ffff:10.0.0.1", true],
    ["::ffff:8.8.8.8", false],
    ["::ffff:7f00:1", true],
    ["fe80::1", true],
    ["fc00::1", true],
    ["fd12:3456::1", true],
    ["ff02::1", true],
    ["2001:db8::1", true],
    ["2001:4860:4860::8888", false],
  ] as const)("classifies %s as blocked=%s", (address, blocked) => {
    expect(isBlockedAddress(address)).toBe(blocked);
  });

  it.each([
    ["http://127.0.0.1/", "address_blocked"],
    ["http://10.0.0.9/secret", "address_blocked"],
    ["http://169.254.169.254/latest/meta-data/", "address_blocked"],
    ["http://[::1]/", "address_blocked"],
    ["http://[::ffff:127.0.0.1]/", "address_blocked"],
    ["https://example.com:8080/", "port_blocked"],
    ["http://example.com:22/", "port_blocked"],
    ["https://user:pass@example.com/", "credentials_blocked"],
    ["https://localhost/", "host_denied"],
    ["https://foo.localhost/", "host_denied"],
    ["https://foo.local/", "host_denied"],
    ["https://foo.internal/", "host_denied"],
  ])("refuses %s (%s)", (raw, detail) => {
    expect(() => assertUnfurlUrlShape(new URL(raw))).toThrow(
      UnfurlBlockedError,
    );
    try {
      assertUnfurlUrlShape(new URL(raw));
    } catch (error) {
      expect(error).toBeInstanceOf(UnfurlBlockedError);
      expect((error as Error).message).toBe(detail);
    }
  });

  it("allows default http/https ports on public hosts", () => {
    expect(() =>
      assertUnfurlUrlShape(new URL("https://example.com/docs")),
    ).not.toThrow();
    expect(() =>
      assertUnfurlUrlShape(new URL("http://example.com:80/")),
    ).not.toThrow();
    expect(() =>
      assertUnfurlUrlShape(new URL("https://example.com:443/")),
    ).not.toThrow();
  });

  it("resolves DNS and refuses private answers including IPv6-mapped", async () => {
    await expect(
      assertSafeUnfurlTarget("https://evil.example/", {
        lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      }),
    ).rejects.toThrow("address_blocked");
    await expect(
      assertSafeUnfurlTarget("https://evil.example/", {
        lookup: async () => [{ address: "::ffff:10.1.2.3", family: 6 }],
      }),
    ).rejects.toThrow("address_blocked");
    await expect(
      assertSafeUnfurlTarget("https://evil.example/", {
        lookup: async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "192.168.0.9", family: 4 },
        ],
      }),
    ).rejects.toThrow("address_blocked");
  });

  it("accepts a public DNS answer", async () => {
    const url = await assertSafeUnfurlTarget("https://example.com/a", {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    expect(url.href).toBe("https://example.com/a");
  });
});
