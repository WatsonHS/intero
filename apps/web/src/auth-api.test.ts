import type { PrincipalId } from "@intero/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getActionInbox } from "./api.js";
import {
  AUTHENTICATION_REQUIRED_EVENT,
  PILOT_IDENTITY_STORAGE_KEY,
  PILOT_PROJECT_STORAGE_KEY,
  PILOT_TEAM_STORAGE_KEY,
} from "./pilot/auth-state.js";
import { getPilotProfile } from "./pilot/api.js";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function installBrowser(storage: Storage) {
  const browser = new EventTarget() as EventTarget & {
    localStorage: Storage;
  };
  browser.localStorage = storage;
  vi.stubGlobal("window", browser);
  return browser;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authenticated API requests", () => {
  it("sends the effective development identity with profile requests", async () => {
    const identityId = "019f9a00-0000-7000-8000-000000000101" as PrincipalId;
    installBrowser(new MemoryStorage());
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          profile: {
            id: identityId,
            displayName: "Alex",
            kind: "human",
            email: "alex@example.com",
            organizationRole: "admin",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getPilotProfile(identityId);

    expect(fetchMock).toHaveBeenCalledOnce();
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(options.headers).toMatchObject({
      "x-intero-dev-principal-id": identityId,
    });
  });

  it("centrally clears scope and requests login for generic API 401s", async () => {
    const storage = new MemoryStorage();
    storage.setItem(PILOT_IDENTITY_STORAGE_KEY, "principal");
    storage.setItem(PILOT_PROJECT_STORAGE_KEY, "project");
    storage.setItem(PILOT_TEAM_STORAGE_KEY, "team");
    const browser = installBrowser(storage);
    let events = 0;
    browser.addEventListener(AUTHENTICATION_REQUIRED_EVENT, () => {
      events += 1;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "AUTHENTICATION_REQUIRED" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(getActionInbox()).rejects.toThrow("Intero API returned 401.");
    expect(storage.getItem(PILOT_IDENTITY_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(PILOT_PROJECT_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(PILOT_TEAM_STORAGE_KEY)).toBeNull();
    expect(events).toBe(1);
  });

  it("centrally requests login for pilot API 401s", async () => {
    const storage = new MemoryStorage();
    storage.setItem(PILOT_IDENTITY_STORAGE_KEY, "principal");
    const browser = installBrowser(storage);
    let events = 0;
    browser.addEventListener(AUTHENTICATION_REQUIRED_EVENT, () => {
      events += 1;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "AUTHENTICATION_REQUIRED" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(getPilotProfile()).rejects.toMatchObject({
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
    });
    expect(storage.getItem(PILOT_IDENTITY_STORAGE_KEY)).toBeNull();
    expect(events).toBe(1);
  });
});
