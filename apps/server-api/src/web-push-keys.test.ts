import { describe, expect, it } from "vitest";

import { InMemoryPlatformStore } from "./store.js";
import {
  ensureWebPushKeyPair,
  ensureWebPushKeysForOrganizations,
  type OrganizationWebPushKeyStore,
  type WebPushKeyPair,
  webPushSubjectFromPublicUrl,
} from "./web-push-keys.js";

describe("webPushSubjectFromPublicUrl", () => {
  it("uses the https origin and a mailto subject for non-https URLs", () => {
    expect(webPushSubjectFromPublicUrl("https://intero.example.com")).toBe(
      "https://intero.example.com",
    );
    expect(webPushSubjectFromPublicUrl("https://intero.example.com:8443")).toBe(
      "https://intero.example.com:8443",
    );
    expect(webPushSubjectFromPublicUrl("http://localhost:4311")).toBe(
      "mailto:intero@localhost",
    );
    expect(webPushSubjectFromPublicUrl("http://intero.example.com")).toBe(
      "mailto:intero@intero.example.com",
    );
  });
});

describe("ensureWebPushKeyPair", () => {
  it("returns the same stored pair when two callers race", async () => {
    let stored: WebPushKeyPair | undefined;
    let firstReads = 0;
    let releaseFirstReads: () => void = () => undefined;
    const bothReadEmpty = new Promise<void>((resolve) => {
      releaseFirstReads = resolve;
    });
    const first = {
      publicKey: "vapid-public-a",
      privateKey: "vapid-private-a",
    };
    const second = {
      publicKey: "vapid-public-b",
      privateKey: "vapid-private-b",
    };
    const generate = (() => {
      let calls = 0;
      return () => {
        calls += 1;
        return calls === 1 ? first : second;
      };
    })();
    const store = {
      async read() {
        if (stored) return stored;
        firstReads += 1;
        if (firstReads === 2) releaseFirstReads();
        await bothReadEmpty;
        return stored;
      },
      async insertIfAbsent(keys: WebPushKeyPair) {
        stored ??= keys;
      },
    };

    const [left, right] = await Promise.all([
      ensureWebPushKeyPair(store, generate),
      ensureWebPushKeyPair(store, generate),
    ]);
    expect(left).toEqual(right);
    expect(left).toEqual(stored);
    expect([first.publicKey, second.publicKey]).toContain(left.publicKey);
  });

  it("keeps one generated pair across concurrent in-memory store callers", async () => {
    const store = new InMemoryPlatformStore();
    const [left, right] = await Promise.all([
      store.ensureWebPushKeys(),
      store.ensureWebPushKeys(),
    ]);
    expect(left).toEqual(right);
    expect(store.getWebPushKeys()).toEqual(left);
    expect(left.publicKey.length).toBeGreaterThanOrEqual(16);
  });
});

describe("ensureWebPushKeysForOrganizations", () => {
  it("generates one pair per organization and generates nothing on a second run", async () => {
    const keys = new Map<string, WebPushKeyPair>();
    let generateCalls = 0;
    const generate = (): WebPushKeyPair => {
      generateCalls += 1;
      return {
        publicKey: `vapid-public-${generateCalls}`,
        privateKey: `vapid-private-${generateCalls}`,
      };
    };
    const store: OrganizationWebPushKeyStore = {
      async listOrganizationIds() {
        return ["org-a", "org-b"];
      },
      async read(organizationId) {
        return keys.get(organizationId);
      },
      async insertIfAbsent(organizationId, pair) {
        if (!keys.has(organizationId)) keys.set(organizationId, pair);
      },
    };

    const first = await ensureWebPushKeysForOrganizations(store, generate);
    expect([...first.keys()].sort()).toEqual(["org-a", "org-b"]);
    expect(first.get("org-a")).not.toEqual(first.get("org-b"));
    expect(generateCalls).toBe(2);

    const second = await ensureWebPushKeysForOrganizations(store, generate);
    expect(second).toEqual(first);
    expect(generateCalls).toBe(2);
  });
});
